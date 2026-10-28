const {
  createLocalTasksService,
  MAX_TASKS_PER_MEETING,
} = require("../../modules/meetings/localTasks");
const { MeetingError } = require("../../modules/meetings/errors");

function fakePrisma(seed = {}) {
  const state = {
    meetings: [...(seed.meetings || [])],
    meeting_local_tasks: [...(seed.meeting_local_tasks || [])],
    meeting_action_candidates: [...(seed.meeting_action_candidates || [])],
    meeting_sources: [...(seed.meeting_sources || [])],
    nextId: 1,
  };

  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if ("in" in value) return value.in.includes(row[key]);
        if (key === "meetingId_candidateId") {
          return (
            row.meetingId === value.meetingId &&
            row.candidateId === value.candidateId
          );
        }
        return Object.entries(value).every(
          ([innerKey, innerValue]) => row[innerKey] === innerValue
        );
      }
      return row[key] === value;
    });

  const resolveWhere = (where = {}) => {
    if (where.meetingId_candidateId) {
      return {
        meetingId: where.meetingId_candidateId.meetingId,
        candidateId: where.meetingId_candidateId.candidateId,
      };
    }
    return where;
  };

  const delegate = (collection) => ({
    findMany: async ({ where = {}, orderBy } = {}) => {
      let rows = state[collection].filter((row) =>
        matches(row, resolveWhere(where))
      );
      if (orderBy?.id === "asc") rows = [...rows].sort((a, b) => a.id - b.id);
      return rows;
    },
    findFirst: async ({ where = {} } = {}) =>
      state[collection].find((row) => matches(row, resolveWhere(where))) ||
      null,
    findUnique: async ({ where = {} } = {}) => {
      if (where.idempotencyKey != null) {
        return (
          state[collection].find(
            (row) => row.idempotencyKey === where.idempotencyKey
          ) || null
        );
      }
      if (where.id != null) {
        return (
          state[collection].find((row) => row.id === where.id) || null
        );
      }
      return (
        state[collection].find((row) => matches(row, resolveWhere(where))) ||
        null
      );
    },
    count: async ({ where = {} } = {}) =>
      state[collection].filter((row) => matches(row, resolveWhere(where)))
        .length,
    create: async ({ data }) => {
      const row = { id: state.nextId++, ...data };
      state[collection].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = state[collection].find((candidate) =>
        matches(candidate, resolveWhere(where))
      );
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
  });

  const db = {
    meetings: delegate("meetings"),
    meeting_local_tasks: delegate("meeting_local_tasks"),
    meeting_action_candidates: delegate("meeting_action_candidates"),
    meeting_sources: delegate("meeting_sources"),
    $transaction: async (callback) => callback(db),
  };
  return { db, state };
}

function draftMeeting(overrides = {}) {
  return {
    id: 1,
    reviewStatus: "DRAFT",
    retrievalStatus: "AVAILABLE",
    deletedAt: null,
    ...overrides,
  };
}

describe("createLocalTask", () => {
  test("idempotent create by candidate and Idempotency-Key returns same task", async () => {
    const { db, state } = fakePrisma({ meetings: [draftMeeting()] });
    state.meeting_action_candidates.push({
      id: 9,
      meetingId: 1,
      candidateId: "cand-1",
      kind: "auto",
      status: "pending",
      title: "完成方案",
      taskId: null,
    });
    const service = createLocalTasksService({ prisma: db });

    const first = await service.createLocalTask({
      meetingId: 1,
      candidateId: "cand-1",
      title: "完成方案",
      assigneeKey: "E001",
      assigneeName: "张三",
      assigneeDepartment: "研发",
      dueAt: "2026-11-01",
      createdBy: 5,
      idempotencyKey: "idem-1",
    });
    const second = await service.createLocalTask({
      meetingId: 1,
      candidateId: "cand-1",
      title: "完成方案（改）",
      assigneeKey: "E002",
      assigneeName: "李四",
      createdBy: 5,
      idempotencyKey: "idem-other",
    });
    const byKey = await service.createLocalTask({
      meetingId: 1,
      candidateId: "cand-new",
      title: "另一候选",
      assigneeKey: "E001",
      assigneeName: "张三",
      createdBy: 5,
      idempotencyKey: "idem-1",
    });

    expect(first.id).toBe(second.id);
    expect(byKey.id).toBe(first.id);
    expect(first.status).toBe("pending");
    expect(first.dueAt).toBe("2026-11-01");
    expect(state.meeting_local_tasks).toHaveLength(1);
    expect(state.meeting_action_candidates[0]).toMatchObject({
      status: "created",
      taskId: first.id,
    });
  });

  test("enforces max 50 tasks per meeting", async () => {
    const { db, state } = fakePrisma({ meetings: [draftMeeting()] });
    for (let i = 0; i < MAX_TASKS_PER_MEETING; i += 1) {
      state.meeting_local_tasks.push({
        id: i + 1,
        meetingId: 1,
        candidateId: `c-${i}`,
        title: `t-${i}`,
        status: "pending",
      });
    }
    state.nextId = MAX_TASKS_PER_MEETING + 1;
    const service = createLocalTasksService({ prisma: db });
    await expect(
      service.createLocalTask({
        meetingId: 1,
        candidateId: "overflow",
        title: "overflow",
        assigneeKey: "E1",
        assigneeName: "A",
      })
    ).rejects.toMatchObject({
      code: "MEETING_TASK_LIMIT",
      status: 413,
    });
  });

  test("APPROVED create fails MEETING_IMMUTABLE", async () => {
    const { db } = fakePrisma({
      meetings: [draftMeeting({ reviewStatus: "APPROVED" })],
    });
    const service = createLocalTasksService({ prisma: db });
    await expect(
      service.createLocalTask({
        meetingId: 1,
        candidateId: "c1",
        title: "x",
        assigneeKey: "E1",
        assigneeName: "A",
      })
    ).rejects.toMatchObject({
      code: "MEETING_IMMUTABLE",
      status: 409,
    });
  });

  test("soft-deleted meeting is hidden via readable", async () => {
    const { db } = fakePrisma({
      meetings: [
        draftMeeting({
          deletedAt: new Date("2026-10-01T00:00:00.000Z"),
          retrievalStatus: "DELETED",
        }),
      ],
    });
    const service = createLocalTasksService({ prisma: db });
    await expect(
      service.createLocalTask({
        meetingId: 1,
        candidateId: "c1",
        title: "x",
        assigneeKey: "E1",
        assigneeName: "A",
      })
    ).rejects.toMatchObject({
      code: "MEETING_NOT_FOUND",
      status: 404,
    });
    await expect(service.listLocalTasks({ meetingId: 1 })).rejects.toMatchObject(
      {
        code: "MEETING_NOT_FOUND",
        status: 404,
      }
    );
  });

  test("assertMeetingWritable denial surfaces MEETING_IMMUTABLE", async () => {
    const { db } = fakePrisma({ meetings: [draftMeeting()] });
    const service = createLocalTasksService({ prisma: db });
    await expect(
      service.createLocalTask({
        meetingId: 1,
        candidateId: "c1",
        title: "x",
        assigneeKey: "E1",
        assigneeName: "A",
        meetingAuthAccess: {
          assertMeetingWritable: async () => {
            throw new MeetingError(
              "Meeting content is immutable after approval",
              "MEETING_IMMUTABLE",
              409
            );
          },
        },
      })
    ).rejects.toMatchObject({ code: "MEETING_IMMUTABLE", status: 409 });
  });
});
