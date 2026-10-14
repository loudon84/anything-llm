const { createMeetingService } = require("../../modules/meetings/meetingService");

function fakePrisma(seed = {}) {
  const state = {
    meetings: [...(seed.meetings || [])],
    meeting_sources: [...(seed.meeting_sources || [])],
    meeting_chunks: [...(seed.meeting_chunks || [])],
    meeting_jobs: [...(seed.meeting_jobs || [])],
    nextMeetingId: 1,
    nextJobId: 1,
  };
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
  const delegate = (collection) => ({
    findMany: async ({ where = {} } = {}) => state[collection].filter((row) => matches(row, where)),
    findFirst: async ({ where = {} } = {}) => state[collection].find((row) => matches(row, where)) || null,
    findUnique: async ({ where = {} } = {}) => state[collection].find((row) => matches(row, where)) || null,
    create: async ({ data }) => {
      const row = { id: collection === "meetings" ? state.nextMeetingId++ : state.nextJobId++, ...data };
      state[collection].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = state[collection].find((candidate) => matches(candidate, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where = {}, data }) => {
      const rows = state[collection].filter((row) => matches(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
    deleteMany: async ({ where = {} } = {}) => {
      const rows = state[collection].filter((row) => matches(row, where));
      state[collection] = state[collection].filter((row) => !rows.includes(row));
      return { count: rows.length };
    },
  });
  const db = {
    meetings: delegate("meetings"),
    meeting_sources: delegate("meeting_sources"),
    meeting_chunks: delegate("meeting_chunks"),
    meeting_jobs: delegate("meeting_jobs"),
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

describe("meeting persistence lifecycle", () => {
  test("rejects the 201st quarterly meeting, counting metadata-only drafts", async () => {
    const { db } = fakePrisma({ meetings: Array.from({ length: 200 }, (_, id) => ({
      id: id + 1, connectionId: 1, quarter: "2026-Q2", deletedAt: null,
    })) });
    const service = createMeetingService({ prisma: db });
    await expect(service.createMetadata(metadata("new"), 5))
      .rejects.toMatchObject({ code: "MEETING_QUARTER_LIMIT" });
  });

  test("creates metadata-only meetings as waiting content and refuses approval", async () => {
    const { db } = fakePrisma();
    const service = createMeetingService({ prisma: db });
    const meeting = await service.createMetadata(metadata("metadata"), 5);
    expect(meeting.retrievalStatus).toBe("WAITING_CONTENT");
    await expect(service.approve(meeting.id, 5)).rejects.toMatchObject({ code: "MEETING_NOT_AVAILABLE" });
  });

  test("soft deletes a draft and reimport creates a new identity", async () => {
    const { db, state } = fakePrisma();
    const service = createMeetingService({ prisma: db });
    const first = await service.createMetadata(metadata("same"), 5);
    await service.softDelete(first.id, 5);
    const second = await service.createMetadata(metadata("same"), 5);
    expect(second.id).not.toBe(first.id);
    expect(state.meetings[0]).toMatchObject({ retrievalStatus: "DELETED", activeKey: null });
  });

  test("revision returns to draft, pauses retrieval, and queues reindexing", async () => {
    const { db, state } = fakePrisma();
    const service = createMeetingService({ prisma: db });
    const meeting = await service.createMetadata(metadata("revision"), 5);
    Object.assign(meeting, { retrievalStatus: "AVAILABLE", reviewStatus: "APPROVED", generation: 1 });
    const revised = await service.revise(meeting.id, { summary: "Updated summary" }, 5);
    expect(revised).toMatchObject({ reviewStatus: "DRAFT", retrievalStatus: "INDEXING", generation: 2 });
    expect(state.meeting_jobs).toHaveLength(1);
    expect(state.meeting_jobs[0]).toMatchObject({ kind: "REINDEX", meetingId: meeting.id, status: "CREATED" });
  });
});
