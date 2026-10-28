const crypto = require("crypto");
const { MeetingError } = require("./errors");
const { REVIEW, RETRIEVAL } = require("./constants");

const LOCAL_SUMMARY_ORIGIN = "local:summary";
const LOCAL_SUMMARY_TYPE = "LOCAL_SUMMARY";

function createLocalSummaryService({
  prisma,
  transaction,
  now = () => new Date(),
  audit = async () => {},
} = {}) {
  if (!prisma)
    throw new TypeError(
      "createLocalSummaryService requires an injected Prisma client"
    );

  const runTransaction =
    typeof transaction === "function"
      ? transaction
      : async (callback) =>
          typeof prisma.$transaction === "function"
            ? prisma.$transaction(callback)
            : callback(prisma);

  async function findMeeting(db, meetingId) {
    const meeting = await db.meetings.findUnique({
      where: { id: Number(meetingId) },
    });
    if (!meeting || meeting.retrievalStatus === RETRIEVAL.DELETED) {
      throw new MeetingError("Meeting not found", "MEETING_NOT_FOUND", 404);
    }
    return meeting;
  }

  async function saveLocalSummary({
    meetingId,
    content,
    expectedContentVersion,
    userId,
    authState,
    meetingAuthAccess,
  } = {}) {
    if (typeof content !== "string") {
      throw new MeetingError(
        "content must be a string",
        "INVALID_LOCAL_SUMMARY",
        400
      );
    }
    const expected = Number(expectedContentVersion);
    if (!Number.isSafeInteger(expected) || expected < 0) {
      throw new MeetingError(
        "contentVersion must be a non-negative integer",
        "INVALID_CONTENT_VERSION",
        400
      );
    }

    if (meetingAuthAccess?.assertMeetingWritable) {
      await meetingAuthAccess.assertMeetingWritable({
        authState,
        meetingId,
        action: "meeting.localSummary",
      });
    }

    return runTransaction(async (db) => {
      const meeting = await findMeeting(db, meetingId);
      if (meeting.reviewStatus !== REVIEW.DRAFT) {
        throw new MeetingError(
          "Meeting content is immutable after approval",
          "MEETING_IMMUTABLE",
          409
        );
      }

      const currentVersion = Number(meeting.contentVersion ?? 0);
      if (currentVersion !== expected) {
        throw new MeetingError(
          "Meeting content was changed by another request",
          "CONTENT_VERSION_CONFLICT",
          409
        );
      }

      const trimmed = content.trim();
      const generation = Number(meeting.generation || 0) + 1;
      const contentVersion = currentVersion + 1;
      const stamp = now();

      const existing = await db.meeting_sources.findFirst({
        where: {
          meetingId: meeting.id,
          originKey: LOCAL_SUMMARY_ORIGIN,
        },
      });

      // Never mutate gateway-imported SUMMARY or any gateway: originKey rows.
      if (
        existing &&
        (existing.sourceType === "SUMMARY" ||
          (typeof existing.originKey === "string" &&
            existing.originKey.startsWith("gateway:")))
      ) {
        throw new MeetingError(
          "Local summary cannot overwrite imported gateway sources",
          "LOCAL_SUMMARY_ORIGIN_CONFLICT",
          409
        );
      }

      let localSummary = null;
      if (!trimmed) {
        if (existing) {
          localSummary = await db.meeting_sources.update({
            where: { id: existing.id },
            data: {
              sourceType: LOCAL_SUMMARY_TYPE,
              originKey: LOCAL_SUMMARY_ORIGIN,
              activeHash: null,
              contentText: null,
              contentHash: crypto.createHash("sha256").update("").digest("hex"),
              segments: JSON.stringify([]),
              parseStatus: "SUCCESS",
              error: null,
              deletedAt: stamp,
            },
          });
        }
      } else {
        const segments = content
          .split(/\r?\n+/)
          .map((text) => text.trim())
          .filter(Boolean)
          .map((text, paragraph) => ({
            text,
            location: { type: "paragraph", paragraph },
          }));
        const contentHash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");
        const sourceData = {
          sourceType: LOCAL_SUMMARY_TYPE,
          originKey: LOCAL_SUMMARY_ORIGIN,
          name: "本地维护摘要",
          contentHash,
          activeHash: `${LOCAL_SUMMARY_TYPE}:${contentHash}`,
          contentText: content,
          segments: JSON.stringify(segments),
          parseStatus: "SUCCESS",
          error: null,
          deletedAt: null,
          bytes: 0,
          filePath: null,
        };
        if (existing) {
          localSummary = await db.meeting_sources.update({
            where: { id: existing.id },
            data: sourceData,
          });
        } else {
          localSummary = await db.meeting_sources.create({
            data: {
              meetingId: meeting.id,
              createdBy: userId ?? null,
              ...sourceData,
            },
          });
        }
      }

      // Do not write local text into meetings.summary; leave reviewStatus as-is.
      const updated = await db.meetings.update({
        where: { id: meeting.id },
        data: {
          contentVersion,
          generation,
          retrievalStatus: RETRIEVAL.INDEXING,
        },
      });

      await db.meeting_jobs.create({
        data: {
          kind: "REINDEX",
          meetingId: meeting.id,
          connectionId: meeting.connectionId,
          externalId: meeting.externalId,
          activeKey: `REINDEX:${meeting.id}:${generation}`,
          quarter: meeting.quarter,
          payload: JSON.stringify({ generation }),
          status: "CREATED",
          attempts: 0,
        },
      });

      await audit(
        {
          action: "MEETING_LOCAL_SUMMARY_SAVED",
          meetingId: meeting.id,
          userId: userId ?? null,
          contentVersion,
          generation,
          cleared: !trimmed,
        },
        db
      );

      return { meeting: updated, localSummary };
    });
  }

  return { saveLocalSummary };
}

module.exports = {
  createLocalSummaryService,
  LOCAL_SUMMARY_ORIGIN,
  LOCAL_SUMMARY_TYPE,
};
