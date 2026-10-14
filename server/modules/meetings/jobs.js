const crypto = require("crypto");
const { MeetingError } = require("./errors");
const { LIMITS } = require("./constants");

function createJobRunner({
  prisma,
  handlers = {},
  pollMs = 2000,
  leaseMs = 30_000,
  runnerId = crypto.randomUUID(),
} = {}) {
  if (!prisma?.meeting_jobs)
    throw new TypeError("createJobRunner requires a Prisma client");
  let timer = null;
  let ticking = false;

  async function transaction(callback) {
    return prisma.$transaction
      ? prisma.$transaction(callback)
      : callback(prisma);
  }

  async function enqueue(kind, payload, identity = {}) {
    const data = {
      kind: String(kind),
      payload:
        typeof payload === "string" ? payload : JSON.stringify(payload || {}),
      status: "CREATED",
      attempts: 0,
      stage: null,
      error: null,
      meetingId: identity.meetingId ?? null,
      connectionId: identity.connectionId ?? null,
      externalId: identity.externalId ?? null,
      activeKey: identity.activeKey ?? null,
      quarter: identity.quarter ?? null,
    };
    try {
      return await prisma.meeting_jobs.create({ data });
    } catch (error) {
      if (error.code === "P2002")
        throw new MeetingError(
          "This meeting import is already queued",
          "MEETING_DUPLICATE",
          409
        );
      throw error;
    }
  }

  async function claimNext() {
    return transaction(async (db) => {
      const now = new Date();
      const candidates = await db.meeting_jobs.findMany({
        where: { status: "CREATED" },
        orderBy: { createdAt: "asc" },
        take: 1,
      });
      let candidate = candidates[0];
      let stale = false;
      if (!candidate) {
        const expired = await db.meeting_jobs.findMany({
          where: { status: "PROCESSING", leaseUntil: { lte: now } },
          orderBy: { updatedAt: "asc" },
          take: 1,
        });
        candidate = expired[0];
        stale = Boolean(candidate);
      }
      if (!candidate) return null;
      const where = stale
        ? { id: candidate.id, status: "PROCESSING", leaseUntil: { lte: now } }
        : { id: candidate.id, status: "CREATED" };
      const leaseOwner = `${runnerId}:${crypto.randomUUID()}`;
      const claimed = await db.meeting_jobs.updateMany({
        where,
        data: {
          status: "PROCESSING",
          leaseOwner,
          leaseUntil: new Date(now.getTime() + leaseMs),
          attempts: Number(candidate.attempts || 0) + 1,
        },
      });
      if (claimed.count !== 1) return null;
      return db.meeting_jobs.findUnique({ where: { id: candidate.id } });
    });
  }

  async function runOnce() {
    const job = await claimNext();
    if (!job) return false;
    const heartbeatMs = Math.max(1, Math.floor(leaseMs / 3));
    const heartbeat = setInterval(() => {
      prisma.meeting_jobs
        .updateMany({
          where: {
            id: job.id,
            status: "PROCESSING",
            leaseOwner: job.leaseOwner,
          },
          data: { leaseUntil: new Date(Date.now() + leaseMs) },
        })
        .catch(() => {});
    }, heartbeatMs);
    heartbeat.unref?.();
    try {
      const handler = handlers[job.kind];
      if (typeof handler !== "function")
        throw new MeetingError(
          `No handler is registered for ${job.kind}`,
          "JOB_HANDLER_MISSING",
          500
        );
      await handler(job);
      await prisma.meeting_jobs.updateMany({
        where: { id: job.id, status: "PROCESSING", leaseOwner: job.leaseOwner },
        data: {
          status: "SUCCESS",
          error: null,
          leaseOwner: null,
          leaseUntil: null,
          activeKey: null,
        },
      });
    } catch (error) {
      await prisma.meeting_jobs.updateMany({
        where: { id: job.id, status: "PROCESSING", leaseOwner: job.leaseOwner },
        data: {
          status: "FAILED",
          error: String(error?.message || "Job failed").slice(0, 1000),
          leaseOwner: null,
          leaseUntil: null,
          activeKey: null,
        },
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  async function retry(id) {
    return transaction(async (db) => {
      const job = await db.meeting_jobs.findUnique({
        where: { id: Number(id) },
      });
      if (!job || job.status !== "FAILED")
        throw new MeetingError(
          "Only failed jobs can be retried",
          "JOB_NOT_RETRYABLE",
          409
        );
      let activeKey = job.activeKey;
      if (job.kind === "IMPORT") {
        activeKey = `${job.connectionId}:${job.externalId}`;
        if (await db.meetings.findUnique({ where: { activeKey } })) {
          throw new MeetingError(
            "This meeting is already imported",
            "MEETING_DUPLICATE",
            409
          );
        }
        const [meetings, reservations] = await Promise.all([
          db.meetings.findMany({
            where: { quarter: job.quarter, deletedAt: null },
          }),
          db.meeting_jobs.findMany({
            where: {
              kind: "IMPORT",
              quarter: job.quarter,
              status: { in: ["CREATED", "PROCESSING"] },
            },
          }),
        ]);
        const activeKeys = new Set(
          meetings.map((meeting) => meeting.activeKey).filter(Boolean)
        );
        const reserved = reservations.filter(
          (reservation) =>
            reservation.id !== job.id &&
            (!reservation.activeKey || !activeKeys.has(reservation.activeKey))
        ).length;
        if (meetings.length + reserved >= LIMITS.meetingsPerQuarter) {
          throw new MeetingError(
            "The quarterly meeting limit has been reached",
            "MEETING_QUARTER_LIMIT",
            409
          );
        }
      }
      try {
        return await db.meeting_jobs.update({
          where: { id: job.id },
          data: {
            status: "CREATED",
            activeKey,
            error: null,
            stage: null,
            leaseOwner: null,
            leaseUntil: null,
          },
        });
      } catch (error) {
        if (error.code === "P2002")
          throw new MeetingError(
            "This meeting import already has an active reservation",
            "MEETING_DUPLICATE",
            409
          );
        throw error;
      }
    });
  }

  function start() {
    if (timer) return;
    timer = setInterval(async () => {
      if (ticking) return;
      ticking = true;
      try {
        await runOnce();
      } catch {
        /* job state records the failure */
      } finally {
        ticking = false;
      }
    }, pollMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, enqueue, retry, runOnce };
}

module.exports = { createJobRunner };
