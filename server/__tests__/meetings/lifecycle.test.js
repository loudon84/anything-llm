const {
  createMeetingService,
} = require("../../modules/meetings/meetingService");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

function fakePrisma(seed = {}) {
  const state = {
    meetings: [...(seed.meetings || [])],
    meeting_sources: [...(seed.meeting_sources || [])],
    meeting_chunks: [...(seed.meeting_chunks || [])],
    meeting_jobs: [...(seed.meeting_jobs || [])],
    nextMeetingId: 1,
    nextJobId: 1,
  };
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && "in" in value)
        return value.in.includes(row[key]);
      return row[key] === value;
    });
  const delegate = (collection) => ({
    findMany: async ({ where = {} } = {}) =>
      state[collection].filter((row) => matches(row, where)),
    findFirst: async ({ where = {} } = {}) =>
      state[collection].find((row) => matches(row, where)) || null,
    findUnique: async ({ where = {} } = {}) =>
      state[collection].find((row) => matches(row, where)) || null,
    create: async ({ data }) => {
      const row = {
        id:
          collection === "meetings" ? state.nextMeetingId++ : state.nextJobId++,
        ...data,
      };
      state[collection].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = state[collection].find((candidate) =>
        matches(candidate, where)
      );
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
    const { db } = fakePrisma({
      meetings: Array.from({ length: 200 }, (_, id) => ({
        id: id + 1,
        connectionId: 1,
        quarter: "2026-Q2",
        deletedAt: null,
      })),
    });
    const service = createMeetingService({ prisma: db });
    await expect(
      service.createMetadata(metadata("new"), 5)
    ).rejects.toMatchObject({ code: "MEETING_QUARTER_LIMIT" });
  });

  test("creates metadata-only meetings as waiting content and refuses approval", async () => {
    const { db } = fakePrisma();
    const service = createMeetingService({ prisma: db });
    const meeting = await service.createMetadata(metadata("metadata"), 5);
    expect(meeting.retrievalStatus).toBe("WAITING_CONTENT");
    await expect(service.approve(meeting.id, 5)).rejects.toMatchObject({
      code: "MEETING_NOT_AVAILABLE",
    });
  });

  test("soft deletes a draft and reimport creates a new identity", async () => {
    const { db, state } = fakePrisma();
    const service = createMeetingService({ prisma: db });
    const first = await service.createMetadata(metadata("same"), 5);
    await service.softDelete(first.id, 5);
    const second = await service.createMetadata(metadata("same"), 5);
    expect(second.id).not.toBe(first.id);
    expect(state.meetings[0]).toMatchObject({
      retrievalStatus: "DELETED",
      activeKey: null,
    });
  });

  test("revision returns to draft, pauses retrieval, and queues reindexing", async () => {
    const { db, state } = fakePrisma();
    const service = createMeetingService({ prisma: db });
    const meeting = await service.createMetadata(metadata("revision"), 5);
    Object.assign(meeting, {
      retrievalStatus: "AVAILABLE",
      reviewStatus: "APPROVED",
      generation: 1,
    });
    const revised = await service.revise(
      meeting.id,
      { summary: "Updated summary" },
      5
    );
    expect(revised).toMatchObject({
      reviewStatus: "DRAFT",
      retrievalStatus: "INDEXING",
      generation: 2,
    });
    expect(state.meeting_jobs).toHaveLength(1);
    expect(state.meeting_jobs[0]).toMatchObject({
      kind: "REINDEX",
      meetingId: meeting.id,
      status: "CREATED",
    });
  });

  test("revision creates indexable sources for manually supplied text and rejects non-string values", async () => {
    const { db, state } = fakePrisma();
    const service = createMeetingService({ prisma: db });
    const meeting = await service.createMetadata(metadata("manual-source"), 5);
    await expect(
      service.revise(meeting.id, { summary: { unexpected: true } }, 5)
    ).rejects.toMatchObject({ code: "INVALID_REVISION" });
    await service.revise(
      meeting.id,
      { summary: "Decision one\nDecision two" },
      5
    );
    expect(state.meeting_sources).toHaveLength(1);
    expect(state.meeting_sources[0]).toMatchObject({
      sourceType: "SUMMARY",
      parseStatus: "SUCCESS",
      contentText: "Decision one\nDecision two",
    });
    expect(JSON.parse(state.meeting_sources[0].segments)).toEqual([
      { text: "Decision one", location: { type: "paragraph", paragraph: 0 } },
      { text: "Decision two", location: { type: "paragraph", paragraph: 1 } },
    ]);
  });

  test("queues a profile rebuild without changing meeting review state", async () => {
    const { db, state } = fakePrisma();
    const service = createMeetingService({ prisma: db });
    const meeting = await service.createMetadata(
      metadata("profile-rebuild"),
      5
    );
    Object.assign(meeting, {
      retrievalStatus: "AVAILABLE",
      reviewStatus: "APPROVED",
      generation: 3,
    });
    const job = await service.requestReindex(meeting.id, 5, "model-b");
    expect(job).toMatchObject({
      kind: "REINDEX",
      status: "CREATED",
      meetingId: meeting.id,
    });
    expect(JSON.parse(job.payload)).toMatchObject({
      generation: 4,
      profileId: "model-b",
      manual: true,
    });
    expect(meeting).toMatchObject({
      generation: 4,
      retrievalStatus: "INDEXING",
      reviewStatus: "APPROVED",
    });
    expect(state.meeting_jobs).toHaveLength(1);
  });

  test("allows approval after a failed supplemental source was deleted and cleanup completed", async () => {
    const { db, state } = fakePrisma();
    const service = createMeetingService({ prisma: db });
    const meeting = await service.createMetadata(
      metadata("resolved-source"),
      5
    );
    Object.assign(meeting, { retrievalStatus: "AVAILABLE", generation: 2 });
    const [source] = state.meeting_sources;
    if (!source)
      state.meeting_sources.push({
        id: 41,
        meetingId: meeting.id,
        sourceType: "SUPPLEMENT_FILE",
        name: "failed.txt",
        parseStatus: "FAILED",
        deletedAt: new Date(),
      });
    else
      Object.assign(source, {
        id: 41,
        meetingId: meeting.id,
        parseStatus: "FAILED",
        deletedAt: new Date(),
      });
    state.meeting_jobs.push({
      id: 91,
      kind: "PARSE_SOURCE",
      meetingId: meeting.id,
      status: "FAILED",
      error: "parser unavailable",
      payload: JSON.stringify({ sourceId: 41, sourceRevision: "old" }),
    });
    await expect(service.approve(meeting.id, 5)).resolves.toMatchObject({
      reviewStatus: "APPROVED",
    });
  });
});

describe("meeting creation with real SQLite transactions", () => {
  let prisma;
  let service;
  let databaseDirectory;
  let connectionId;

  beforeAll(() => {
    databaseDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "meeting-lifecycle-")
    );
    const isolatedDatabase = path.join(databaseDirectory, "meetings.db");
    fs.copyFileSync(
      path.join(__dirname, "../../storage/anythingllm.db"),
      isolatedDatabase
    );
    const databaseUrl = `file:${isolatedDatabase.replace(/\\/g, "/")}`;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    service = createMeetingService({ prisma });
  });

  beforeEach(async () => {
    await prisma.meeting_jobs.deleteMany();
    await prisma.meeting_chunks.deleteMany();
    await prisma.meeting_sources.deleteMany();
    await prisma.meetings.deleteMany();
    await prisma.meeting_connections.deleteMany();
    const connection = await prisma.meeting_connections.create({
      data: { name: "SQLite test", config: "{}" },
    });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (databaseDirectory)
      fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  const insertQuarterMeetings = async (count) => {
    for (let index = 0; index < count; index += 1) {
      await prisma.meetings.create({
        data: {
          connectionId,
          externalId: `existing-${index}`,
          activeKey: `${connectionId}:existing-${index}`,
          title: `Existing ${index}`,
          startTime: new Date("2026-04-01T02:00:00.000Z"),
          quarter: "2026-Q2",
          reviewStatus: "DRAFT",
          retrievalStatus: "WAITING_CONTENT",
          coverage: "{}",
        },
      });
    }
  };

  const databaseMetadata = (externalId, overrides = {}) =>
    metadata(externalId, {
      ...overrides,
      connectionId: overrides.connectionId ?? connectionId,
    });

  test("rejects a caller quarter that differs from the Shanghai start-time quarter", async () => {
    await expect(
      service.createMetadata(
        databaseMetadata("wrong-quarter", { quarter: "2026-Q1" }),
        5
      )
    ).rejects.toMatchObject({ code: "QUARTER_MISMATCH" });
    expect(await prisma.meetings.count()).toBe(0);
  });

  test("normalizes connection IDs before checking active duplicate identity", async () => {
    await service.createMetadata(
      databaseMetadata("  normalized  ", {
        connectionId: String(connectionId).padStart(2, "0"),
      }),
      5
    );
    await expect(
      service.createMetadata(
        databaseMetadata("normalized", { connectionId }),
        5
      )
    ).rejects.toMatchObject({ code: "MEETING_DUPLICATE" });
    expect(await prisma.meetings.count({ where: { deletedAt: null } })).toBe(1);
  });

  test("rejects invalid connection IDs before attempting persistence", async () => {
    await expect(
      service.createMetadata(
        databaseMetadata("invalid", { connectionId: "1.5" }),
        5
      )
    ).rejects.toMatchObject({ code: "INVALID_CONNECTION_ID" });
    expect(await prisma.meetings.count()).toBe(0);
  });

  test("rolls back meeting creation when its transactional audit write fails", async () => {
    const auditedService = createMeetingService({
      prisma,
      audit: async () => {
        throw new Error("audit unavailable");
      },
    });
    await expect(
      auditedService.createMetadata(databaseMetadata("audit-rollback"), 5)
    ).rejects.toThrow("audit unavailable");
    expect(
      await prisma.meetings.count({
        where: { activeKey: `${connectionId}:audit-rollback` },
      })
    ).toBe(0);
  });

  test("rejects an empty or non-string external meeting ID", async () => {
    await expect(
      service.createMetadata(databaseMetadata("  "), 5)
    ).rejects.toMatchObject({ code: "INVALID_EXTERNAL_ID" });
    await expect(
      service.createMetadata(databaseMetadata(42), 5)
    ).rejects.toMatchObject({ code: "INVALID_EXTERNAL_ID" });
    expect(await prisma.meetings.count()).toBe(0);
  });

  test("does not count the current import reservation twice against its own meeting", async () => {
    await insertQuarterMeetings(199);
    await prisma.meeting_jobs.create({
      data: {
        kind: "IMPORT",
        connectionId,
        externalId: "reservation-owner",
        activeKey: `${connectionId}:reservation-owner`,
        quarter: "2026-Q2",
        payload: "{}",
        status: "PROCESSING",
      },
    });
    const meeting = await service.createMetadata(
      databaseMetadata("reservation-owner"),
      5
    );
    expect(meeting.quarter).toBe("2026-Q2");
    expect(
      await prisma.meetings.count({
        where: { quarter: "2026-Q2", deletedAt: null },
      })
    ).toBe(200);
  });

  test("concurrent duplicate creates persist exactly one meeting", async () => {
    const results = await Promise.allSettled([
      service.createMetadata(databaseMetadata("same-concurrent"), 5),
      service.createMetadata(databaseMetadata("same-concurrent"), 5),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected").reason
    ).toMatchObject({ code: "MEETING_DUPLICATE" });
    expect(
      await prisma.meetings.count({
        where: { activeKey: `${connectionId}:same-concurrent` },
      })
    ).toBe(1);
  });

  test("concurrent distinct creates cannot oversubscribe the last quarterly slot", async () => {
    await insertQuarterMeetings(199);
    const results = await Promise.allSettled([
      service.createMetadata(databaseMetadata("last-slot-a"), 5),
      service.createMetadata(databaseMetadata("last-slot-b"), 5),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    expect(["MEETING_QUARTER_LIMIT", "MEETING_WRITE_CONFLICT"]).toContain(
      results.find((result) => result.status === "rejected").reason.code
    );
    expect(
      await prisma.meetings.count({
        where: { quarter: "2026-Q2", deletedAt: null },
      })
    ).toBe(200);
  });
});
