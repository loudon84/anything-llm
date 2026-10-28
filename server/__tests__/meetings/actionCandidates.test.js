const {
  syncActionCandidates,
  createManualCandidate,
  updateActionCandidate,
  listActionCandidates,
  CANDIDATE_STATUS,
  CANDIDATE_KIND,
  MAX_CANDIDATES,
} = require("../../modules/meetings/actionItems");
const { MeetingError } = require("../../modules/meetings/errors");

function fakePrisma(seed = {}) {
  const state = {
    meetings: [...(seed.meetings || [])],
    meeting_sources: [...(seed.meeting_sources || [])],
    meeting_action_candidates: [...(seed.meeting_action_candidates || [])],
    meeting_local_tasks: [...(seed.meeting_local_tasks || [])],
    nextId: 1,
  };
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value == null) return row[key] == null;
      if (value && typeof value === "object" && "in" in value)
        return value.in.includes(row[key]);
      return row[key] === value;
    });
  const delegate = (collection) => ({
    findMany: async ({ where = {}, orderBy } = {}) => {
      let rows = state[collection].filter((row) => matches(row, where));
      if (orderBy?.id === "asc") rows = [...rows].sort((a, b) => a.id - b.id);
      return rows;
    },
    findFirst: async ({ where = {} } = {}) =>
      state[collection].find((row) => matches(row, where)) || null,
    findUnique: async ({ where = {} } = {}) => {
      if (where.meetingId_candidateId) {
        const { meetingId, candidateId } = where.meetingId_candidateId;
        return (
          state[collection].find(
            (row) =>
              row.meetingId === meetingId && row.candidateId === candidateId
          ) || null
        );
      }
      return state[collection].find((row) => matches(row, where)) || null;
    },
    count: async ({ where = {} } = {}) =>
      state[collection].filter((row) => matches(row, where)).length,
    create: async ({ data }) => {
      const row = {
        id: state.nextId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      state[collection].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row =
        state[collection].find((candidate) => matches(candidate, where)) ||
        null;
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
  });
  return {
    db: {
      meetings: delegate("meetings"),
      meeting_sources: delegate("meeting_sources"),
      meeting_action_candidates: delegate("meeting_action_candidates"),
      meeting_local_tasks: delegate("meeting_local_tasks"),
    },
    state,
  };
}

function summarySource(contentText, overrides = {}) {
  return {
    id: overrides.id || 1,
    meetingId: overrides.meetingId || 1,
    sourceType: "SUMMARY",
    originKey: overrides.originKey || "gateway:rf1:meeting_summary:0",
    name: "meeting_summary",
    contentText,
    parseStatus: "SUCCESS",
    deletedAt: null,
    ...overrides,
  };
}

describe("syncActionCandidates", () => {
  test("creates auto candidates from SUCCESS summary sources", async () => {
    const { db, state } = fakePrisma({
      meeting_sources: [
        summarySource(
          ["## 待办事项", "- 完成方案评审", "- 提交预算"].join("\n")
        ),
      ],
    });

    const candidates = await syncActionCandidates(1, { prisma: db });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((row) => row.kind === CANDIDATE_KIND.AUTO)).toBe(
      true
    );
    expect(candidates.every((row) => row.status === CANDIDATE_STATUS.PENDING)).toBe(
      true
    );
    expect(state.meeting_action_candidates).toHaveLength(2);
    expect(candidates.map((row) => row.title)).toEqual([
      "完成方案评审",
      "提交预算",
    ]);
  });

  test("refresh drift marks vanished pending autos as needs_confirm and keeps created", async () => {
    const { db, state } = fakePrisma({
      meeting_sources: [
        summarySource(["## 待办事项", "- 完成方案评审", "- 提交预算"].join("\n")),
      ],
    });
    const first = await syncActionCandidates(1, { prisma: db });
    expect(first).toHaveLength(2);

    const keep = state.meeting_action_candidates.find(
      (row) => row.title === "完成方案评审"
    );
    const vanish = state.meeting_action_candidates.find(
      (row) => row.title === "提交预算"
    );
    keep.status = CANDIDATE_STATUS.CREATED;
    keep.taskId = 99;

    state.meeting_sources[0].contentText = [
      "## 待办事项",
      "- 完成方案评审",
      "- 全新行动项",
    ].join("\n");

    const second = await syncActionCandidates(1, { prisma: db });
    const byTitle = Object.fromEntries(second.map((row) => [row.title, row]));

    expect(byTitle["完成方案评审"].status).toBe(CANDIDATE_STATUS.CREATED);
    expect(byTitle["完成方案评审"].taskId).toBe(99);
    expect(byTitle["提交预算"].status).toBe(CANDIDATE_STATUS.NEEDS_CONFIRM);
    expect(byTitle["提交预算"].candidateId).toBe(vanish.candidateId);
    expect(byTitle["全新行动项"].kind).toBe(CANDIDATE_KIND.AUTO);
    expect(byTitle["全新行动项"].status).toBe(CANDIDATE_STATUS.NEEDS_CONFIRM);
    expect(second).toHaveLength(3);
  });

  test("never deletes rows on refresh", async () => {
    const { db, state } = fakePrisma({
      meeting_sources: [
        summarySource(["## TODO", "- Keep me", "- Drop me"].join("\n")),
      ],
    });
    await syncActionCandidates(1, { prisma: db });
    const before = state.meeting_action_candidates.length;
    state.meeting_sources[0].contentText = "## TODO\n- Keep me";
    await syncActionCandidates(1, { prisma: db });
    expect(state.meeting_action_candidates.length).toBe(before);
  });
});

describe("manual action candidates", () => {
  test("creates manual candidate with server UUID", async () => {
    const { db } = fakePrisma();
    const candidate = await createManualCandidate(
      1,
      { title: "手动跟进", description: "详情" },
      { prisma: db }
    );
    expect(candidate.kind).toBe(CANDIDATE_KIND.MANUAL);
    expect(candidate.status).toBe(CANDIDATE_STATUS.PENDING);
    expect(candidate.title).toBe("手动跟进");
    expect(candidate.description).toBe("详情");
    expect(candidate.candidateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    const listed = await listActionCandidates(1, { prisma: db });
    expect(listed).toHaveLength(1);
  });

  test("updates title and description only", async () => {
    const { db } = fakePrisma();
    const created = await createManualCandidate(
      1,
      { title: "旧标题", description: "旧描述" },
      { prisma: db }
    );
    const updated = await updateActionCandidate(
      1,
      created.candidateId,
      { title: "新标题", description: "新描述" },
      { prisma: db }
    );
    expect(updated).toMatchObject({
      candidateId: created.candidateId,
      kind: CANDIDATE_KIND.MANUAL,
      status: CANDIDATE_STATUS.PENDING,
      title: "新标题",
      description: "新描述",
    });
  });

  test("enforces max 50 total candidates", async () => {
    const { db, state } = fakePrisma();
    for (let i = 0; i < MAX_CANDIDATES; i += 1) {
      state.meeting_action_candidates.push({
        id: i + 1,
        meetingId: 1,
        candidateId: `auto-${i}`,
        kind: CANDIDATE_KIND.AUTO,
        status: CANDIDATE_STATUS.PENDING,
        title: `Item ${i}`,
        description: "",
        originKey: null,
        sourceFingerprint: null,
        sourceExcerpt: null,
        taskId: null,
      });
    }
    state.nextId = MAX_CANDIDATES + 1;
    await expect(
      createManualCandidate(1, { title: "overflow" }, { prisma: db })
    ).rejects.toMatchObject({
      code: "CANDIDATE_LIMIT",
      status: 409,
    });
  });
});

describe("APPROVED mutate guard", () => {
  test("writable assert rejects APPROVED meetings before mutate", async () => {
    const { createMeetingAuthAccess } = require("../../utils/meetingGateway/meetingAuthAccess");
    const { db, state } = fakePrisma({
      meetings: [
        {
          id: 7,
          reviewStatus: "APPROVED",
          retrievalStatus: "AVAILABLE",
          deletedAt: null,
          createdBy: 1,
        },
      ],
    });
    const admission = createMeetingAuthAccess({
      meetingStore: {
        findMeeting: (id) => db.meetings.findUnique({ where: { id: Number(id) } }),
        findMeetings: (ids) =>
          db.meetings.findMany({ where: { id: { in: ids.map(Number) } } }),
      },
      workspaceAccess: async () => true,
    });
    const authState = {
      kind: "LEGACY_SINGLE_USER",
      authenticated: true,
      actor: { id: 1, userId: 1 },
    };
    await expect(
      admission.assertMeetingWritable({
        authState,
        meetingId: 7,
        action: "actionCandidates.create",
      })
    ).rejects.toMatchObject({
      code: "MEETING_IMMUTABLE",
      status: 409,
    });
    expect(state.meeting_action_candidates).toHaveLength(0);
  });
});
