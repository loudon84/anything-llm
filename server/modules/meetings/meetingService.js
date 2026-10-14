const { MeetingError } = require("./errors");
const { LIMITS, REVIEW, RETRIEVAL, quarterFor } = require("./policy");

const activeMeetingWhere = { deletedAt: null };
const now = () => new Date();
const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

function isTransactionContention(error) {
  if (["P1008", "P2028", "P2034"].includes(error.code)) return true;
  return /database is locked|SQLITE_BUSY|write conflict|transaction.*(?:closed|timeout)|timed out during query execution/i
    .test(error.message || "");
}

function createMeetingService({ prisma, audit = async () => {} } = {}) {
  if (!prisma) throw new TypeError("createMeetingService requires an injected Prisma client");

  async function transaction(callback) {
    return typeof prisma.$transaction === "function" ? prisma.$transaction(callback) : callback(prisma);
  }

  async function findMeeting(db, id) {
    const meeting = await db.meetings.findUnique({ where: { id: Number(id) } });
    if (!meeting || meeting.retrievalStatus === RETRIEVAL.DELETED) {
      throw new MeetingError("Meeting not found", "MEETING_NOT_FOUND", 404);
    }
    return meeting;
  }

  async function auditMutation(action, meeting, userId, details = {}) {
    await audit({ action, meetingId: meeting.id, userId: userId ?? null, ...details });
  }

  return {
    async list(filters = {}) {
      return prisma.meetings.findMany({ where: { ...filters, ...activeMeetingWhere } });
    },

    async get(id) {
      return findMeeting(prisma, id);
    },

    async createMetadata(data, userId) {
      const connectionId = Number(data.connectionId);
      if (!Number.isSafeInteger(connectionId) || connectionId <= 0) {
        throw new MeetingError("A valid connection ID is required", "INVALID_CONNECTION_ID");
      }
      const externalId = typeof data.externalId === "string" ? data.externalId.trim() : "";
      if (!externalId) throw new MeetingError("An external meeting ID is required", "INVALID_EXTERNAL_ID");
      const startTime = new Date(data.startTime);
      if (Number.isNaN(startTime.getTime())) throw new MeetingError("A valid meeting start time is required", "INVALID_DATE");
      const quarter = quarterFor(startTime);
      if (data.quarter && data.quarter !== quarter) {
        throw new MeetingError("Meeting quarter must match its start time", "QUARTER_MISMATCH");
      }
      const activeKey = `${connectionId}:${externalId}`;
      let attempt = 0;
      while (true) {
        try {
          return await transaction(async (db) => {
            const duplicate = await db.meetings.findUnique({ where: { activeKey } });
            if (duplicate) throw new MeetingError("This meeting is already imported", "MEETING_DUPLICATE", 409);

            const existing = await db.meetings.findMany({ where: { quarter, deletedAt: null } });
            const activeKeys = new Set(existing.map((meeting) => meeting.activeKey).filter(Boolean));
            const reservations = await db.meeting_jobs.findMany({
              where: { quarter, kind: "IMPORT", status: { in: ["CREATED", "PROCESSING"] } },
            });
            const reservationCount = reservations.filter((job) => job.activeKey !== activeKey &&
              (!job.activeKey || !activeKeys.has(job.activeKey))).length;
            if (existing.length + reservationCount >= LIMITS.meetingsPerQuarter) {
              throw new MeetingError("The quarterly meeting limit has been reached", "MEETING_QUARTER_LIMIT", 409);
            }

            const meeting = await db.meetings.create({ data: {
              connectionId,
              externalId,
              activeKey,
              title: String(data.title || "").trim(),
              startTime,
              endTime: data.endTime ? new Date(data.endTime) : null,
              quarter,
              reviewStatus: REVIEW.DRAFT,
              retrievalStatus: RETRIEVAL.WAITING_CONTENT,
              summary: data.summary ?? null,
              transcript: data.transcript ?? null,
              coverage: data.coverage || "{}",
              generation: 0,
              deletedAt: null,
              createdBy: userId ?? null,
            } });
            await auditMutation("MEETING_METADATA_CREATED", meeting, userId);
            return meeting;
          });
        } catch (error) {
          if (error.code === "P2002") {
            throw new MeetingError("This meeting is already imported", "MEETING_DUPLICATE", 409);
          }
          if (!isTransactionContention(error)) throw error;
          if (attempt >= 2) {
            throw new MeetingError("Meeting creation was contended; retry this request", "MEETING_WRITE_CONFLICT", 409);
          }
          await sleep(15 * (attempt + 1));
          attempt += 1;
        }
      }
    },

    async approve(id, userId) {
      return transaction(async (db) => {
        const meeting = await findMeeting(db, id);
        if (meeting.retrievalStatus !== RETRIEVAL.AVAILABLE) {
          throw new MeetingError("Meeting content must be indexed before approval", "MEETING_NOT_AVAILABLE", 409);
        }
        const [sources, jobs] = await Promise.all([
          db.meeting_sources.findMany({ where: { meetingId: meeting.id, deletedAt: null } }),
          db.meeting_jobs.findMany({ where: { meetingId: meeting.id } }),
        ]);
        if (sources.some((source) => source.parseStatus !== "SUCCESS") ||
            jobs.some((job) => ["CREATED", "PROCESSING", "FAILED"].includes(job.status) || job.error)) {
          throw new MeetingError("Meeting has unresolved source or job errors", "MEETING_UNRESOLVED_WORK", 409);
        }
        const updated = await db.meetings.update({ where: { id: meeting.id }, data: {
          reviewStatus: REVIEW.APPROVED, reviewedBy: userId ?? null, reviewedAt: now(),
        } });
        await auditMutation("MEETING_APPROVED", updated, userId);
        return updated;
      });
    },

    async softDelete(id, userId) {
      return transaction(async (db) => {
        const meeting = await findMeeting(db, id);
        if (meeting.reviewStatus !== REVIEW.DRAFT) {
          throw new MeetingError("Only draft meetings can be deleted", "MEETING_IMMUTABLE", 409);
        }
        const deletedAt = now();
        const updated = await db.meetings.update({ where: { id: meeting.id }, data: {
          activeKey: null, retrievalStatus: RETRIEVAL.DELETED, deletedAt,
        } });
        await db.meeting_sources.updateMany({
          where: { meetingId: meeting.id, deletedAt: null }, data: { deletedAt, activeHash: null },
        });
        await db.meeting_chunks.deleteMany({ where: { meetingId: meeting.id } });
        await auditMutation("MEETING_DELETED", updated, userId);
        return updated;
      });
    },

    async revise(id, changes = {}, userId) {
      const hasSummary = Object.prototype.hasOwnProperty.call(changes, "summary");
      const hasTranscript = Object.prototype.hasOwnProperty.call(changes, "transcript");
      if (!hasSummary && !hasTranscript) throw new MeetingError("A summary or transcript revision is required", "EMPTY_REVISION");
      return transaction(async (db) => {
        const meeting = await findMeeting(db, id);
        if (meeting.reviewStatus !== REVIEW.DRAFT && meeting.reviewStatus !== REVIEW.APPROVED) {
          throw new MeetingError("Meeting cannot be revised in its current state", "MEETING_IMMUTABLE", 409);
        }
        const generation = Number(meeting.generation || 0) + 1;
        const updated = await db.meetings.update({ where: { id: meeting.id }, data: {
          ...(hasSummary ? { summary: changes.summary } : {}),
          ...(hasTranscript ? { transcript: changes.transcript } : {}),
          generation,
          reviewStatus: REVIEW.DRAFT,
          reviewedBy: null,
          reviewedAt: null,
          retrievalStatus: RETRIEVAL.INDEXING,
        } });
        await db.meeting_jobs.create({ data: {
          kind: "REINDEX", meetingId: meeting.id, connectionId: meeting.connectionId,
          externalId: meeting.externalId, activeKey: `REINDEX:${meeting.id}:${generation}`,
          quarter: meeting.quarter, payload: JSON.stringify({ generation }), status: "CREATED", attempts: 0,
        } });
        await auditMutation("MEETING_REVISED", updated, userId, { generation });
        return updated;
      });
    },
  };
}

module.exports = { createMeetingService };
