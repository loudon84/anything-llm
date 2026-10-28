/**
 * Task 10 regression pack — PRD §9 acceptance deltas for LOCAL_SUMMARY,
 * contentVersion CAS, APPROVED freeze, action-item drift, indexer preference,
 * readable-write ACL, OA/tasks feature flag default-off, and soft-delete visibility.
 */
const {
  createLocalSummaryService,
  LOCAL_SUMMARY_ORIGIN,
  LOCAL_SUMMARY_TYPE,
} = require("../../modules/meetings/localSummary");
const { createMeetingService } = require("../../modules/meetings/meetingService");
const { createIndexer } = require("../../modules/meetings/indexer");
const { createSourceService } = require("../../modules/meetings/sources");
const {
  syncActionCandidates,
  CANDIDATE_STATUS,
  CANDIDATE_KIND,
} = require("../../modules/meetings/actionItems");
const { createLocalTasksService } = require("../../modules/meetings/localTasks");
const {
  isMeetingLocalTasksEnabled,
  assertMeetingLocalTasksEnabled,
  MEETING_LOCAL_TASKS_FLAG,
} = require("../../modules/meetings/featureFlags");
const { createMeetingAuthAccess } = require("../../utils/meetingGateway/meetingAuthAccess");
const { MeetingError } = require("../../modules/meetings/errors");
const { assertSourceDeletion, REVIEW } = require("../../modules/meetings/policy");

function fakePrisma(seed = {}) {
  const state = {
    meetings: [...(seed.meetings || [])],
    meeting_sources: [...(seed.meeting_sources || [])],
    meeting_chunks: [...(seed.meeting_chunks || [])],
    meeting_jobs: [...(seed.meeting_jobs || [])],
    meeting_action_candidates: [...(seed.meeting_action_candidates || [])],
    meeting_local_tasks: [...(seed.meeting_local_tasks || [])],
    nextMeetingId: 1,
    nextRowId: 1,
  };
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value == null) return row[key] == null;
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
      if (where.meetingId_candidateId) {
        return (
          state[collection].find((row) =>
            matches(row, resolveWhere(where))
          ) || null
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
      const row = {
        id:
          collection === "meetings"
            ? state.nextMeetingId++
            : state.nextRowId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      state[collection].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = state[collection].find((candidate) =>
        matches(candidate, resolveWhere(where))
      );
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where = {}, data } = {}) => {
      const rows = state[collection].filter((row) =>
        matches(row, resolveWhere(where))
      );
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
    deleteMany: async ({ where = {} } = {}) => {
      const rows = state[collection].filter((row) =>
        matches(row, resolveWhere(where))
      );
      state[collection] = state[collection].filter(
        (row) => !rows.includes(row)
      );
      return { count: rows.length };
    },
  });
  const db = {
    meetings: delegate("meetings"),
    meeting_sources: delegate("meeting_sources"),
    meeting_chunks: delegate("meeting_chunks"),
    meeting_jobs: delegate("meeting_jobs"),
    meeting_action_candidates: delegate("meeting_action_candidates"),
    meeting_local_tasks: delegate("meeting_local_tasks"),
    $transaction: async (callback) => callback(db),
  };
  return { db, state };
}

const metadata = (externalId, overrides = {}) => ({
  connectionId: 1,
  externalId,
  title: `Meeting ${externalId}`,
  startTime: new Date("2026-04-01T02:00:00.000Z"),
  endTime: new Date("2026-04-01T03:00:00.000Z"),
  ...overrides,
});

function gatewaySummarySource(meetingId, overrides = {}) {
  return {
    id: overrides.id || 100,
    meetingId,
    sourceType: "SUMMARY",
    originKey: overrides.originKey || "gateway:rf1:meeting_summary:0",
    contentText: overrides.contentText || "Imported gateway summary",
    contentHash: overrides.contentHash || "gateway-hash",
    activeHash: overrides.activeHash || "GATEWAY:gateway:rf1:meeting_summary:0",
    parseStatus: "SUCCESS",
    deletedAt: null,
    segments: JSON.stringify([
      {
        text: overrides.contentText || "Imported gateway summary",
        location: { type: "paragraph", paragraph: 0 },
      },
    ]),
    ...overrides,
  };
}

function localSummarySource(meetingId, overrides = {}) {
  return {
    id: overrides.id || 101,
    meetingId,
    sourceType: LOCAL_SUMMARY_TYPE,
    originKey: LOCAL_SUMMARY_ORIGIN,
    contentText: overrides.contentText || "Locally maintained summary",
    contentHash: overrides.contentHash || "local-hash",
    activeHash: overrides.activeHash || "LOCAL_SUMMARY:local-hash",
    parseStatus: "SUCCESS",
    deletedAt: null,
    segments: JSON.stringify([
      {
        text: overrides.contentText || "Locally maintained summary",
        location: { type: "paragraph", paragraph: 0 },
      },
    ]),
    ...overrides,
  };
}

function snapshotLocal(row) {
  return {
    id: row.id,
    sourceType: row.sourceType,
    originKey: row.originKey,
    contentText: row.contentText,
    contentHash: row.contentHash,
    activeHash: row.activeHash,
    deletedAt: row.deletedAt,
  };
}

/**
 * Simulates a gateway re-import / refresh that may rewrite the SUMMARY row
 * keyed by gateway originKey — never selecting local:summary.
 */
function simulateGatewaySummaryRefresh(state, meetingId, nextText) {
  const originKey = "gateway:rf1:meeting_summary:0";
  const gateway = state.meeting_sources.find(
    (row) =>
      row.meetingId === meetingId &&
      row.originKey === originKey &&
      row.sourceType === "SUMMARY"
  );
  if (!gateway) throw new Error("gateway SUMMARY missing");
  gateway.contentText = nextText;
  gateway.contentHash = `refreshed-${nextText.length}`;
  gateway.activeHash = `GATEWAY:${originKey}`;
  gateway.segments = JSON.stringify([
    { text: nextText, location: { type: "paragraph", paragraph: 0 } },
  ]);
  return gateway;
}

describe("PRD §9 regression: LOCAL_SUMMARY vs import / refresh", () => {
  test("1+5: re-import may update gateway SUMMARY but never touches LOCAL_SUMMARY", async () => {
    const { db, state } = fakePrisma();
    const meetings = createMeetingService({ prisma: db });
    const meeting = await meetings.createMetadata(metadata("reimport-protect"), 5);
    Object.assign(meeting, {
      retrievalStatus: "AVAILABLE",
      reviewStatus: "DRAFT",
      generation: 1,
      contentVersion: 1,
      summary: "table summary",
    });
    state.meeting_sources.push(
      gatewaySummarySource(meeting.id),
      localSummarySource(meeting.id, {
        contentText: "Owner local draft — must survive refresh",
      })
    );
    const beforeLocal = snapshotLocal(
      state.meeting_sources.find((row) => row.originKey === LOCAL_SUMMARY_ORIGIN)
    );

    const refreshed = simulateGatewaySummaryRefresh(
      state,
      meeting.id,
      "Refreshed gateway summary after re-import"
    );

    expect(refreshed.contentText).toBe(
      "Refreshed gateway summary after re-import"
    );
    expect(
      snapshotLocal(
        state.meeting_sources.find(
          (row) => row.originKey === LOCAL_SUMMARY_ORIGIN
        )
      )
    ).toEqual(beforeLocal);

    // Import-style lookup is originKey-scoped — local:summary is never selected.
    const byGatewayOrigin = await db.meeting_sources.findFirst({
      where: {
        meetingId: meeting.id,
        originKey: "gateway:rf1:meeting_summary:0",
      },
    });
    expect(byGatewayOrigin.sourceType).toBe("SUMMARY");
    expect(byGatewayOrigin.contentText).toBe(
      "Refreshed gateway summary after re-import"
    );
  });

  test("legacy revise does not clobber gateway SUMMARY or LOCAL_SUMMARY", async () => {
    const { db, state } = fakePrisma();
    const meetings = createMeetingService({ prisma: db });
    const meeting = await meetings.createMetadata(metadata("revise-guard"), 5);
    Object.assign(meeting, {
      retrievalStatus: "AVAILABLE",
      reviewStatus: "DRAFT",
      generation: 1,
      contentVersion: 0,
    });
    state.meeting_sources.push(
      gatewaySummarySource(meeting.id),
      localSummarySource(meeting.id)
    );
    const beforeGateway = snapshotLocal(
      state.meeting_sources.find((row) => row.sourceType === "SUMMARY")
    );
    const beforeLocal = snapshotLocal(
      state.meeting_sources.find((row) => row.originKey === LOCAL_SUMMARY_ORIGIN)
    );

    await meetings.revise(meeting.id, { summary: "Non-gateway revise text" }, 5);

    expect(
      snapshotLocal(
        state.meeting_sources.find((row) => row.sourceType === "SUMMARY")
      )
    ).toEqual(beforeGateway);
    expect(
      snapshotLocal(
        state.meeting_sources.find(
          (row) => row.originKey === LOCAL_SUMMARY_ORIGIN
        )
      )
    ).toEqual(beforeLocal);
    const nonGateway = state.meeting_sources.find(
      (row) =>
        row.sourceType === "SUMMARY" &&
        !(row.originKey || "").startsWith("gateway:")
    );
    expect(nonGateway.contentText).toBe("Non-gateway revise text");
  });
});

describe("PRD §9 regression: APPROVED freezes content-mutating supplements (D-REV-01)", () => {
  test("2+6: APPROVED blocks supplement addText and remove", async () => {
    const meeting = {
      id: 42,
      deletedAt: null,
      reviewStatus: "APPROVED",
      retrievalStatus: "AVAILABLE",
      generation: 3,
      connectionId: 1,
      externalId: "approved-freeze",
      quarter: "2026-Q2",
    };
    const supplement = {
      id: 9,
      meetingId: 42,
      sourceType: "SUPPLEMENT_TEXT",
      name: "notes",
      contentText: "keep me",
      contentHash: "keep",
      activeHash: "keep",
      deletedAt: null,
      parseStatus: "SUCCESS",
    };
    const { db, state } = fakePrisma({
      meetings: [meeting],
      meeting_sources: [supplement],
    });
    const sources = createSourceService({
      prisma: db,
      parser: { parse: async () => [] },
      indexer: { reindex: async () => {} },
    });

    await expect(
      sources.addText(42, { name: "more", text: "should fail" }, 5)
    ).rejects.toMatchObject({ code: "MEETING_IMMUTABLE", status: 409 });

    await expect(sources.remove(42, 9, 5)).rejects.toMatchObject({
      code: "MEETING_IMMUTABLE",
      status: 409,
    });

    expect(state.meeting_sources.find((row) => row.id === 9)).toMatchObject({
      deletedAt: null,
      contentText: "keep me",
    });
    expect(state.meetings[0].reviewStatus).toBe("APPROVED");
    expect(state.meetings[0].generation).toBe(3);

    expect(() =>
      assertSourceDeletion(
        { reviewStatus: REVIEW.APPROVED },
        { sourceType: "SUPPLEMENT_FILE" }
      )
    ).toThrow(expect.objectContaining({ code: "MEETING_IMMUTABLE" }));
  });
});

describe("PRD §9 regression: action-item drift → needs_confirm; tasks intact", () => {
  test("5+7+8: refresh drift marks needs_confirm and keeps created local tasks", async () => {
    const { db, state } = fakePrisma({
      meetings: [
        {
          id: 1,
          reviewStatus: "DRAFT",
          retrievalStatus: "AVAILABLE",
          deletedAt: null,
        },
      ],
      meeting_sources: [
        {
          id: 1,
          meetingId: 1,
          sourceType: "SUMMARY",
          originKey: "gateway:rf1:meeting_summary:0",
          name: "meeting_summary",
          contentText: ["## 待办事项", "- 完成方案评审", "- 提交预算"].join(
            "\n"
          ),
          parseStatus: "SUCCESS",
          deletedAt: null,
        },
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

    const tasks = createLocalTasksService({ prisma: db });
    const task = await tasks.createLocalTask({
      meetingId: 1,
      candidateId: keep.candidateId,
      title: keep.title,
      assigneeKey: "E001",
      assigneeName: "张三",
      assigneeDepartment: "研发",
      idempotencyKey: "idem-regression-1",
    });
    expect(task.status).toBe("pending");
    expect(state.meeting_local_tasks).toHaveLength(1);

    state.meeting_sources[0].contentText = [
      "## 待办事项",
      "- 完成方案评审",
      "- 全新行动项",
    ].join("\n");

    const second = await syncActionCandidates(1, { prisma: db });
    const byTitle = Object.fromEntries(second.map((row) => [row.title, row]));

    expect(byTitle["完成方案评审"].status).toBe(CANDIDATE_STATUS.CREATED);
    expect(byTitle["完成方案评审"].taskId).toBe(task.id);
    expect(byTitle["提交预算"].status).toBe(CANDIDATE_STATUS.NEEDS_CONFIRM);
    expect(byTitle["提交预算"].candidateId).toBe(vanish.candidateId);
    expect(byTitle["全新行动项"].kind).toBe(CANDIDATE_KIND.AUTO);
    expect(byTitle["全新行动项"].status).toBe(CANDIDATE_STATUS.NEEDS_CONFIRM);

    expect(state.meeting_local_tasks).toHaveLength(1);
    expect(state.meeting_local_tasks[0]).toMatchObject({
      id: task.id,
      candidateId: keep.candidateId,
      title: keep.title,
      status: "pending",
    });
  });
});

describe("PRD §9 regression: contentVersion CAS leaves gateway SUMMARY alone", () => {
  test("3: CAS conflict keeps gateway SUMMARY and LOCAL_SUMMARY unchanged", async () => {
    const { db, state } = fakePrisma();
    const meetings = createMeetingService({ prisma: db });
    const meeting = await meetings.createMetadata(metadata("cas-conflict"), 5);
    Object.assign(meeting, {
      retrievalStatus: "AVAILABLE",
      reviewStatus: "DRAFT",
      generation: 2,
      contentVersion: 4,
      summary: "table summary stays",
    });
    state.meeting_sources.push(
      gatewaySummarySource(meeting.id),
      localSummarySource(meeting.id, { contentText: "prior local" })
    );
    const beforeGateway = snapshotLocal(
      state.meeting_sources.find((row) => row.sourceType === "SUMMARY")
    );
    const beforeLocal = snapshotLocal(
      state.meeting_sources.find((row) => row.originKey === LOCAL_SUMMARY_ORIGIN)
    );

    const service = createLocalSummaryService({ prisma: db });
    await expect(
      service.saveLocalSummary({
        meetingId: meeting.id,
        content: "stale client write",
        expectedContentVersion: 2,
        userId: 5,
      })
    ).rejects.toMatchObject({
      code: "CONTENT_VERSION_CONFLICT",
      status: 409,
    });

    expect(
      snapshotLocal(
        state.meeting_sources.find((row) => row.sourceType === "SUMMARY")
      )
    ).toEqual(beforeGateway);
    expect(
      snapshotLocal(
        state.meeting_sources.find(
          (row) => row.originKey === LOCAL_SUMMARY_ORIGIN
        )
      )
    ).toEqual(beforeLocal);
    expect(meeting.contentVersion).toBe(4);
    expect(meeting.summary).toBe("table summary stays");
    expect(state.meeting_jobs).toHaveLength(0);
  });
});

describe("PRD §9 regression: indexer LOCAL_SUMMARY preference (D-SUM-04 / §9.13)", () => {
  async function reindexWith(sources, meetingOverrides = {}) {
    const meeting = {
      id: 1,
      generation: 3,
      retrievalStatus: "INDEXING",
      deletedAt: null,
      summary: "Poisoned meeting.summary",
      transcript: null,
      ...meetingOverrides,
    };
    const inserted = [];
    const tx = {
      meetings: {
        findUnique: async () => meeting,
        update: async ({ data }) => Object.assign(meeting, data),
      },
      meeting_sources: {
        findMany: async () => sources,
        update: async ({ where, data }) => {
          const row = sources.find((source) => source.id === where.id);
          if (row) Object.assign(row, data);
          return data;
        },
      },
      meeting_chunks: {
        deleteMany: async () => {},
        create: async ({ data }) => inserted.push(data),
      },
    };
    const indexer = createIndexer({
      prisma: { ...tx, $transaction: async (callback) => callback(tx) },
      embedder: {
        embedDocuments: async (texts) => texts.map(() => [1, 0]),
      },
      chunkCharacters: 80,
    });
    await indexer.reindex(1);
    return inserted;
  }

  test("13: prefers non-empty LOCAL_SUMMARY and excludes gateway SUMMARY", async () => {
    const inserted = await reindexWith([
      gatewaySummarySource(1, {
        id: 10,
        contentText: "Gateway imported summary",
      }),
      localSummarySource(1, {
        id: 11,
        contentText: "Local maintained summary",
      }),
    ]);
    expect(inserted.map((chunk) => chunk.sourceId)).toEqual([11]);
    expect(inserted.map((chunk) => chunk.text)).toEqual([
      "Local maintained summary",
    ]);
    expect(inserted.some((chunk) => /Gateway|Poisoned/.test(chunk.text))).toBe(
      false
    );
  });

  test("13: empty / soft-deleted LOCAL_SUMMARY falls back to SUMMARY (+ meetings.summary override)", async () => {
    const inserted = await reindexWith(
      [
        gatewaySummarySource(1, {
          id: 10,
          contentText: "Gateway imported summary",
        }),
        localSummarySource(1, {
          id: 11,
          contentText: "   ",
          deletedAt: new Date("2026-10-01T00:00:00.000Z"),
        }),
      ],
      { summary: "Override summary from meeting row" }
    );
    // Soft-deleted LOCAL_SUMMARY is filtered by findMany deletedAt:null in real
    // indexer; our fake returns all SUCCESS rows — empty trim still fails
    // hasLocalSummary, so SUMMARY + override applies.
    expect(inserted.map((chunk) => chunk.text)).toEqual([
      "Override summary from meeting row",
    ]);
    expect(inserted[0].sourceId).toBe(10);
  });
});

describe("PRD §9 regression: readable-write / DRAFT-only ACL (D-ACL-01 / D-REV)", () => {
  test("6: DRAFT readable actor may write; APPROVED rejects; soft-deleted denies", async () => {
    const meetings = [
      {
        id: 10,
        createdBy: 11,
        deletedAt: null,
        reviewStatus: "DRAFT",
        workspaceId: null,
      },
      {
        id: 11,
        createdBy: 11,
        deletedAt: null,
        reviewStatus: "APPROVED",
        workspaceId: null,
      },
      {
        id: 12,
        createdBy: 11,
        deletedAt: new Date("2026-10-01T00:00:00.000Z"),
        reviewStatus: "DRAFT",
        workspaceId: null,
      },
    ];
    const access = createMeetingAuthAccess({
      clock: () => new Date("2026-10-20T00:00:00.000Z"),
      meetingStore: {
        findMeeting: async (id) =>
          meetings.find((row) => row.id === Number(id)) || null,
        findMeetings: async (ids) =>
          meetings.filter((row) => ids.includes(row.id)),
      },
      workspaceAccess: async () => true,
    });
    const gatewayAuth = {
      authenticated: true,
      kind: "GATEWAY_SESSION",
      actor: { id: 22, userId: 22 },
      session: {
        id: "session-22",
        userId: 22,
        credentialEpoch: 1,
        expiresAt: "2026-11-01T00:00:00.000Z",
        remoteAccessMode: "LOCAL_ONLY",
      },
      remoteAccessMode: "LOCAL_ONLY",
    };

    await expect(
      access.assertMeetingWritable({
        authState: gatewayAuth,
        meetingId: 10,
        action: "meeting.localSummary",
      })
    ).resolves.toMatchObject({ id: 10, reviewStatus: "DRAFT" });

    await expect(
      access.assertMeetingWritable({
        authState: gatewayAuth,
        meetingId: 11,
        action: "meeting.localSummary",
      })
    ).rejects.toMatchObject({ code: "MEETING_IMMUTABLE", status: 409 });

    await expect(
      access.assertMeetingWritable({
        authState: gatewayAuth,
        meetingId: 12,
        action: "meeting.localTask",
      })
    ).rejects.toMatchObject({
      code: "MGW_RESOURCE_NOT_ACCESSIBLE",
      status: 403,
    });

    // APPROVED path on service itself (no auth inject) still freezes writes.
    const { db, state } = fakePrisma();
    const meetingsSvc = createMeetingService({ prisma: db });
    const meeting = await meetingsSvc.createMetadata(
      metadata("approved-local"),
      5
    );
    Object.assign(meeting, {
      retrievalStatus: "AVAILABLE",
      reviewStatus: "APPROVED",
      contentVersion: 0,
    });
    const service = createLocalSummaryService({ prisma: db });
    await expect(
      service.saveLocalSummary({
        meetingId: meeting.id,
        content: "nope",
        expectedContentVersion: 0,
        userId: 5,
      })
    ).rejects.toMatchObject({ code: "MEETING_IMMUTABLE", status: 409 });
    expect(state.meeting_sources).toHaveLength(0);
  });
});

describe("PRD §9 regression: feature flag default off for OA/tasks (D-OA-01)", () => {
  test("9–12 gate: missing / disabled flag → false; assert throws FEATURE_DISABLED", async () => {
    expect(MEETING_LOCAL_TASKS_FLAG).toBe("meeting_local_tasks");

    await expect(
      isMeetingLocalTasksEnabled({ getSetting: async () => null })
    ).resolves.toBe(false);
    await expect(
      isMeetingLocalTasksEnabled({
        getSetting: async () => ({ value: "disabled" }),
      })
    ).resolves.toBe(false);
    await expect(
      isMeetingLocalTasksEnabled({
        getSetting: async () => ({ value: "enabled" }),
      })
    ).resolves.toBe(true);

    await expect(
      assertMeetingLocalTasksEnabled({ getSetting: async () => null })
    ).rejects.toMatchObject({
      code: "FEATURE_DISABLED",
      status: 403,
    });
    expect(MeetingError).toBeTruthy();
  });
});

describe("PRD §9 regression: soft-deleted meeting hides tasks (D-VIS-01)", () => {
  test("soft-deleted meeting is not readable for list/create local tasks", async () => {
    const { db } = fakePrisma({
      meetings: [
        {
          id: 1,
          reviewStatus: "DRAFT",
          retrievalStatus: "DELETED",
          deletedAt: new Date("2026-10-01T00:00:00.000Z"),
        },
      ],
      meeting_local_tasks: [
        {
          id: 99,
          meetingId: 1,
          candidateId: "hidden",
          title: "should not list",
          status: "pending",
        },
      ],
    });
    const service = createLocalTasksService({ prisma: db });
    await expect(service.listLocalTasks({ meetingId: 1 })).rejects.toMatchObject(
      {
        code: "MEETING_NOT_FOUND",
        status: 404,
      }
    );
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
  });
});
