const { MeetingError } = require("./errors");
const { REVIEW, RETRIEVAL } = require("./constants");
const { extractActionItems, DEFAULT_MAX_ITEMS } = require("./actionItems");

const MAX_TASKS_PER_MEETING = 50;
const DUE_AT_RE = /^\d{4}-\d{2}-\d{2}$/;

function createLocalTasksService({
  prisma,
  transaction,
  now = () => new Date(),
} = {}) {
  if (!prisma)
    throw new TypeError(
      "createLocalTasksService requires an injected Prisma client"
    );

  const runTransaction =
    typeof transaction === "function"
      ? transaction
      : async (callback) =>
          typeof prisma.$transaction === "function"
            ? prisma.$transaction(callback)
            : callback(prisma);

  async function findReadableMeeting(db, meetingId) {
    const meeting = await db.meetings.findUnique({
      where: { id: Number(meetingId) },
    });
    if (
      !meeting ||
      meeting.deletedAt != null ||
      meeting.retrievalStatus === RETRIEVAL.DELETED
    ) {
      throw new MeetingError("Meeting not found", "MEETING_NOT_FOUND", 404);
    }
    return meeting;
  }

  async function assertWritableMeeting({
    meetingId,
    authState,
    meetingAuthAccess,
    action = "meeting.localTask",
  }) {
    if (meetingAuthAccess?.assertMeetingWritable) {
      return meetingAuthAccess.assertMeetingWritable({
        authState,
        meetingId,
        action,
      });
    }
    const meeting = await findReadableMeeting(prisma, meetingId);
    if (meeting.reviewStatus !== REVIEW.DRAFT) {
      throw new MeetingError(
        "Meeting content is immutable after approval",
        "MEETING_IMMUTABLE",
        409
      );
    }
    return meeting;
  }

  function normalizeDueAt(dueAt) {
    if (dueAt == null || dueAt === "") return null;
    const value = String(dueAt).trim();
    if (!DUE_AT_RE.test(value)) {
      throw new MeetingError(
        "dueAt must be a YYYY-MM-DD Shanghai calendar day",
        "INVALID_DUE_AT",
        400
      );
    }
    return value;
  }

  function publicTask(task) {
    if (!task) return task;
    return {
      id: task.id,
      meetingId: task.meetingId,
      candidateId: task.candidateId,
      title: task.title,
      description: task.description ?? null,
      status: task.status,
      assigneeKey: task.assigneeKey ?? null,
      assigneeName: task.assigneeName ?? null,
      assigneeDepartment: task.assigneeDepartment ?? null,
      dueAt: task.dueAt ?? null,
      notes: task.notes ?? null,
      createdBy: task.createdBy ?? null,
      idempotencyKey: task.idempotencyKey ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  async function createLocalTask({
    meetingId,
    candidateId,
    title,
    description,
    assigneeKey,
    assigneeName,
    assigneeDepartment,
    dueAt,
    notes,
    createdBy,
    idempotencyKey,
    authState,
    meetingAuthAccess,
  } = {}) {
    const id = Number(meetingId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new MeetingError("A valid meeting ID is required", "INVALID_ID", 400);
    }

    const candidate = String(candidateId ?? "").trim();
    if (!candidate) {
      throw new MeetingError(
        "candidateId is required",
        "INVALID_CANDIDATE_ID",
        400
      );
    }

    const taskTitle = String(title ?? "").trim();
    if (!taskTitle) {
      throw new MeetingError("title is required", "INVALID_TASK_TITLE", 400);
    }

    const key = String(assigneeKey ?? "").trim();
    const name = String(assigneeName ?? "").trim();
    if (!key || !name) {
      throw new MeetingError(
        "OA assignee key and name are required",
        "INVALID_ASSIGNEE",
        400
      );
    }

    const normalizedDueAt = normalizeDueAt(dueAt);
    const idempotency =
      idempotencyKey == null || String(idempotencyKey).trim() === ""
        ? null
        : String(idempotencyKey).trim().slice(0, 128);

    await assertWritableMeeting({
      meetingId: id,
      authState,
      meetingAuthAccess,
      action: "meeting.localTask.create",
    });

    return runTransaction(async (db) => {
      const meeting = await findReadableMeeting(db, id);
      if (meeting.reviewStatus !== REVIEW.DRAFT) {
        throw new MeetingError(
          "Meeting content is immutable after approval",
          "MEETING_IMMUTABLE",
          409
        );
      }

      if (idempotency) {
        const byKey = await db.meeting_local_tasks.findUnique({
          where: { idempotencyKey: idempotency },
        });
        if (byKey) {
          if (Number(byKey.meetingId) !== Number(meeting.id)) {
            throw new MeetingError(
              "Idempotency key already used for another meeting",
              "IDEMPOTENCY_CONFLICT",
              409
            );
          }
          return publicTask(byKey);
        }
      }

      const byCandidate = await db.meeting_local_tasks.findUnique({
        where: {
          meetingId_candidateId: {
            meetingId: meeting.id,
            candidateId: candidate,
          },
        },
      });
      if (byCandidate) return publicTask(byCandidate);

      const existingCount = await db.meeting_local_tasks.count({
        where: { meetingId: meeting.id },
      });
      if (existingCount >= MAX_TASKS_PER_MEETING) {
        throw new MeetingError(
          `A meeting can have no more than ${MAX_TASKS_PER_MEETING} local tasks`,
          "MEETING_TASK_LIMIT",
          413
        );
      }

      const task = await db.meeting_local_tasks.create({
        data: {
          meetingId: meeting.id,
          candidateId: candidate,
          title: taskTitle,
          description:
            description == null ? null : String(description).slice(0, 4000),
          status: "pending",
          assigneeKey: key,
          assigneeName: name,
          assigneeDepartment:
            assigneeDepartment == null
              ? null
              : String(assigneeDepartment).trim().slice(0, 255) || null,
          dueAt: normalizedDueAt,
          notes: notes == null ? null : String(notes).slice(0, 4000),
          createdBy: createdBy ?? null,
          idempotencyKey: idempotency,
          createdAt: now(),
          updatedAt: now(),
        },
      });

      const existingCandidate = await db.meeting_action_candidates.findUnique({
        where: {
          meetingId_candidateId: {
            meetingId: meeting.id,
            candidateId: candidate,
          },
        },
      });
      if (existingCandidate) {
        await db.meeting_action_candidates.update({
          where: { id: existingCandidate.id },
          data: {
            status: "created",
            taskId: task.id,
            updatedAt: now(),
          },
        });
      }

      return publicTask(task);
    });
  }

  async function listLocalTasks({
    meetingId,
    authState,
    meetingAuthAccess,
    includeCandidates = false,
  } = {}) {
    const id = Number(meetingId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new MeetingError("A valid meeting ID is required", "INVALID_ID", 400);
    }

    if (meetingAuthAccess?.assertLocalMeetingReadable) {
      await meetingAuthAccess.assertLocalMeetingReadable({
        authState,
        meetingIds: [id],
        action: "meeting.localTask.list",
      });
    }

    await findReadableMeeting(prisma, id);

    const tasks = await prisma.meeting_local_tasks.findMany({
      where: { meetingId: id },
      orderBy: { id: "asc" },
    });

    const result = { tasks: tasks.map(publicTask) };
    if (includeCandidates) {
      const sources = await prisma.meeting_sources.findMany({
        where: {
          meetingId: id,
          deletedAt: null,
          sourceType: { in: ["LOCAL_SUMMARY", "SUMMARY", "GATEWAY_ARTIFACT"] },
        },
        orderBy: { id: "asc" },
      });
      result.candidates = extractActionItems(sources, {
        maxItems: DEFAULT_MAX_ITEMS,
      });
    }
    return result;
  }

  return { createLocalTask, listLocalTasks, publicTask };
}

module.exports = {
  createLocalTasksService,
  MAX_TASKS_PER_MEETING,
};
