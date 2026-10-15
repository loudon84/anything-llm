const { createImporter, clipContent } = require("../../modules/meetings/importer");
const { createJobRunner } = require("../../modules/meetings/jobs");
const { createMeetingService } = require("../../modules/meetings/meetingService");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

function fakePrisma(seed = {}) {
  const state = {
    meeting_connections: seed.meeting_connections || [{ id: 1, config: "{}" }],
    meetings: seed.meetings || [],
    meeting_sources: seed.meeting_sources || [],
    meeting_chunks: seed.meeting_chunks || [],
    meeting_jobs: seed.meeting_jobs || [],
    stageHistory: [],
  };
  let nextJob = 1;
  let nextMeeting = 1;
  let nextSource = 1;
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    if (value && typeof value === "object" && "lte" in value) return row[key] != null && new Date(row[key]) <= value.lte;
    return row[key] === value;
  });
  const delegates = {};
  for (const collection of Object.keys(state)) delegates[collection] = {
    findMany: async ({ where = {} } = {}) => state[collection].filter((row) => matches(row, where)),
    findFirst: async ({ where = {} } = {}) => state[collection].find((row) => matches(row, where)) || null,
    findUnique: async ({ where = {} } = {}) => state[collection].find((row) => matches(row, where)) || null,
    create: async ({ data }) => {
      const id = collection === "meeting_jobs" ? nextJob++ : collection === "meetings" ? nextMeeting++ : nextSource++;
      const row = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
      state[collection].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = state[collection].find((item) => matches(item, where));
      if (!row) throw new Error("row not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }) => {
      const rows = state[collection].filter((row) => matches(row, where));
      if (collection === "meeting_jobs" && data.stage)
        rows.forEach((row) => state.stageHistory.push([row.id, data.stage]));
      rows.forEach((row) => Object.assign(row, data, { updatedAt: new Date() }));
      return { count: rows.length };
    },
  };
  const db = { ...delegates };
  db.$transaction = async (callback) => {
    const snapshot = JSON.parse(JSON.stringify(state));
    try { return await callback(db); }
    catch (error) {
      for (const key of Object.keys(state)) state[key].splice(0, state[key].length, ...snapshot[key]);
      throw error;
    }
  };
  return { db, state };
}

const officialMeeting = {
  externalId: "m-1", title: "Review", startTime: "2026-04-01T10:00:00+08:00", endTime: "2026-04-01T11:00:00+08:00",
};
const importerWith = ({ db = fakePrisma().db, client = {}, sourceService = {}, meetingService } = {}) => createImporter({
  prisma: db,
  meetingService: meetingService || { createMetadata: async (data, userId) => db.meetings.create({ data: {
    connectionId: data.connectionId, externalId: data.externalId, activeKey: `${data.connectionId}:${data.externalId}`,
    title: data.title, startTime: new Date(data.startTime), endTime: new Date(data.endTime), quarter: "2026-Q2",
    reviewStatus: "DRAFT", retrievalStatus: "WAITING_CONTENT", summary: null, transcript: null, coverage: "{}", generation: 0,
    deletedAt: null, createdBy: userId,
  } }) },
  clientFactory: () => ({
    listMeetings: async () => ({ items: [officialMeeting], nextCursor: null }),
    getContent: async () => ({ summary: null, transcript: null, segments: [], attachments: [], capabilities: {} }),
    ...client,
  }),
  sourceService: { prepareImport: async () => [], commitImport: async () => {}, ...sourceService },
});

describe("durable Tencent meeting imports", () => {
  test("persists fetch, parse/OCR, index, and publication stages in order", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({
      db,
      client: {
        getContent: async () => ({
          summary: "A meeting summary.",
          transcript: null,
          segments: [],
          attachments: [],
          capabilities: { summary: { status: "supported" } },
        }),
      },
      sourceService: {
        prepareImport: async (_content, { onStage }) => {
          await onStage("INDEXING");
          return [{ sourceType: "SUMMARY", name: "summary" }];
        },
      },
    });
    const job = await importer.queue(
      1,
      "m-1",
      { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z" },
      7
    );

    await importer.process(job);

    expect(
      state.stageHistory.filter(([jobId]) => jobId === job.id).map(([, stage]) => stage)
    ).toEqual(["FETCHING", "PARSING_OCR", "INDEXING", "PUBLISHING", "COMMITTED"]);
    expect(state.meeting_jobs[0]).toMatchObject({ status: "SUCCESS", stage: "COMMITTED" });
  });
  test("preserves an offset boundary of zero and rejects ranges over three hours", () => {
    const content = { transcript: "start end", segments: [
      { text: "start", location: { type: "transcript", startMs: 0, endMs: 10 } },
      { text: "end", location: { type: "transcript", startMs: 10_800_001, endMs: 10_800_010 } },
    ] };
    expect(clipContent(content, { from: 0, to: 10 }).transcript).toBe("start");
    expect(() => clipContent(content, { from: 0, to: 10_800_001 })).toThrow("no more than three hours");
  });

  test("queues an offset selection starting at zero using its actual bounds", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({ db });
    const job = await importer.queue(1, "m-1", {
      ...{ startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z" }, from: 0, to: 10_800_000,
    }, 7);
    expect(JSON.parse(job.payload).scope).toMatchObject({ from: 0, to: 10_800_000 });
    await expect(importer.queue(1, "m-2", {
      startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z", from: 0, to: 10_800_001,
    }, 7)).rejects.toMatchObject({ code: "TRANSCRIPT_SCOPE_LIMIT" });
    expect(state.meeting_jobs).toHaveLength(1);
  });

  test("worker rejects a full transcript exceeding three hours when offsets are omitted", async () => {
    const { db, state } = fakePrisma();
    const prepareImport = jest.fn(async () => [
      { sourceType: "TRANSCRIPT", name: "transcript" },
    ]);
    const importer = importerWith({
      db,
      client: {
        getContent: async () => ({
          transcript: "four hour transcript",
          segments: [
            {
              text: "late speech within a four-hour recording",
              location: {
                type: "transcript",
                startMs: 3 * 60 * 60 * 1000,
                endMs: 4 * 60 * 60 * 1000,
              },
            },
          ],
          transcriptDurationMs: 4 * 60 * 60 * 1000,
          attachments: [],
          capabilities: { transcript: { status: "supported" } },
        }),
      },
      sourceService: { prepareImport },
    });
    const job = await importer.queue(1, "m-1", {
      startTime: "2026-04-01T00:00:00Z",
      endTime: "2026-04-02T00:00:00Z",
    }, 7);

    await expect(importer.process(job)).rejects.toMatchObject({
      code: "TRANSCRIPT_SCOPE_LIMIT",
    });
    expect(state.meetings).toHaveLength(0);
    expect(prepareImport).not.toHaveBeenCalled();
    expect(state.meeting_jobs[0]).toMatchObject({ status: "FAILED" });
  });

  test("allows a selected silent interval within authoritative recording duration", () => {
    const content = {
      summary: "Whole-meeting summary",
      transcript: null,
      segments: [],
      transcriptDurationMs: 3 * 60 * 60 * 1000,
    };
    expect(
      clipContent(content, {
        from: 2 * 60 * 60 * 1000,
        to: 3 * 60 * 60 * 1000,
      })
    ).toMatchObject({ summary: "Whole-meeting summary", segments: [] });
  });

  test("worker rejects selected transcript bounds beyond the returned transcript", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({
      db,
      client: {
        getContent: async () => ({
          transcript: "one hour transcript",
          segments: [
            {
              text: "one hour transcript",
              location: { type: "transcript", startMs: 0, endMs: 60 * 60 * 1000 },
            },
          ],
          attachments: [],
          capabilities: { transcript: { status: "supported" } },
        }),
      },
    });
    const job = await importer.queue(1, "m-1", {
      startTime: "2026-04-01T00:00:00Z",
      endTime: "2026-04-02T00:00:00Z",
      from: 0,
      to: 2 * 60 * 60 * 1000,
    }, 7);

    await expect(importer.process(job)).rejects.toMatchObject({
      code: "TRANSCRIPT_SCOPE_OUT_OF_RANGE",
    });
    expect(state.meetings).toHaveLength(0);
  });

  test("persists selected coverage and whole-summary scope for citations", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({
      db,
      client: {
        getContent: async () => ({
          summary: "Whole meeting summary",
          transcript: "Selected transcript",
          segments: [
            { text: "Selected transcript", location: { type: "transcript", startMs: 0, endMs: 100 } },
          ],
          attachments: [
            { externalFileId: "file-a", name: "selected.txt", buffer: Buffer.from("a") },
            { externalFileId: "file-b", name: "excluded.txt", buffer: Buffer.from("b") },
          ],
          capabilities: {
            transcript: { status: "supported" },
            summary: { status: "supported" },
            attachments: { status: "supported" },
          },
        }),
      },
      sourceService: {
        prepareImport: async () => [{ sourceType: "SUMMARY", name: "summary" }],
        commitImport: async () => {},
      },
    });
    const job = await importer.queue(1, "m-1", {
      startTime: "2026-04-01T00:00:00Z",
      endTime: "2026-04-02T00:00:00Z",
      from: 0,
      to: 100,
      attachmentIds: ["file-a"],
    }, 7);

    await importer.process(job);
    const coverage = JSON.parse(state.meetings[0].coverage);
    expect(coverage).toMatchObject({
      transcript: { status: "supported", selection: { mode: "selected", from: 0, to: 100 } },
      summary: { status: "supported", coverage: "whole_meeting" },
      attachments: {
        status: "supported",
        selection: "selected",
        selected: [{ externalFileId: "file-a", name: "selected.txt" }],
        excluded: [{ externalFileId: "file-b", name: "excluded.txt" }],
      },
    });
    expect(JSON.stringify(coverage)).not.toContain("downloadUrl");
  });

  test("creates a metadata-only waiting meeting when content is confirmed unavailable", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({ db, client: { getContent: async () => ({
      summary: null, transcript: null, segments: [], attachments: [],
      capabilities: {
        transcript: { status: "unsupported", reason: "Transcript feature is unavailable for this tenant." },
        summary: { status: "unsupported" },
        attachments: { status: "unsupported" },
      },
    }) } });
    const job = await importer.queue(1, "m-1", { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z" }, 7);
    await importer.process(job);
    expect(state.meetings).toHaveLength(1);
    expect(state.meetings[0]).toMatchObject({ externalId: "m-1", retrievalStatus: "WAITING_CONTENT", reviewStatus: "DRAFT" });
    expect(state.meeting_jobs[0]).toMatchObject({ status: "SUCCESS", activeKey: null });
  });

  test("refuses metadata-only success while any Tencent capability remains unknown", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({
      db,
      client: {
        getContent: async () => ({
          summary: null,
          transcript: null,
          segments: [],
          attachments: [],
          capabilities: {
            transcript: { status: "unknown" },
            summary: { status: "unsupported" },
            attachments: { status: "absent" },
          },
        }),
      },
    });
    const job = await importer.queue(1, "m-1", {
      startTime: "2026-04-01T00:00:00Z",
      endTime: "2026-04-02T00:00:00Z",
    }, 7);

    await expect(importer.process(job)).rejects.toMatchObject({
      code: "TENCENT_CAPABILITY_UNVERIFIED",
    });
    expect(state.meetings).toHaveLength(0);
    expect(state.meeting_jobs[0]).toMatchObject({ status: "FAILED" });
  });

  test("treats missing capability configuration as unknown rather than absence", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({
      db,
      client: {
        getContent: async () => ({
          summary: null,
          transcript: null,
          segments: [],
          attachments: [],
        }),
      },
    });
    const job = await importer.queue(
      1,
      "m-1",
      { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z" },
      7
    );

    await expect(importer.process(job)).rejects.toMatchObject({
      code: "TENCENT_CAPABILITY_UNVERIFIED",
    });
    expect(state.meetings).toHaveLength(0);
  });

  test("propagates configured API failures and releases the failed reservation without creating a meeting", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({ db, client: { getContent: async () => { throw new Error("Tencent Meeting request failed (HTTP 500)"); } } });
    const job = await importer.queue(1, "m-1", { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z" }, 7);
    await expect(importer.process(job)).rejects.toThrow("HTTP 500");
    expect(state.meetings).toHaveLength(0);
    expect(state.meeting_jobs[0]).toMatchObject({ status: "FAILED", activeKey: null });
  });

  test("fails the complete import if any preflight-selected artifact is absent at worker time", async () => {
    const { db, state } = fakePrisma();
    const prepareImport = jest.fn(async () => [{ sourceType: "TENCENT_ORIGINAL", name: "one" }]);
    const importer = importerWith({ db,
      client: {
        getContent: async () => ({
          summary: null, transcript: null, segments: [], capabilities: { attachments: { status: "supported" } },
          attachments: [{ name: "one.txt", externalFileId: "file-1", downloadUrl: "https://download.tencent.com/file-1" }],
        }),
        downloadAttachment: async () => Buffer.from("one"),
      },
      sourceService: { prepareImport },
    });
    const job = await importer.queue(1, "m-1", {
      startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z", attachmentIds: ["file-1", "file-2"],
    }, 7);
    await expect(importer.process(job)).rejects.toMatchObject({ code: "IMPORT_SELECTED_ARTIFACT_MISSING" });
    expect(prepareImport).not.toHaveBeenCalled();
    expect(state.meetings).toHaveLength(0);
    expect(state.meeting_jobs[0]).toMatchObject({ status: "FAILED", activeKey: null });
  });

  test("rolls back meeting and all prepared content when one source commit fails", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({ db,
      client: { getContent: async () => ({
        summary: "Summary", transcript: null, segments: [{ text: "Evidence", location: { type: "paragraph", paragraph: 1 } }], attachments: [],
        capabilities: { transcript: { status: "supported" } },
      }) },
      sourceService: {
        prepareImport: async () => [{ sourceType: "SUMMARY", name: "summary", contentText: "Summary" }],
        commitImport: async (tx, meeting) => {
          await tx.meeting_sources.create({ data: { meetingId: meeting.id, sourceType: "SUMMARY", name: "summary", parseStatus: "SUCCESS" } });
          throw new Error("chunk write failed");
        },
      },
    });
    const job = await importer.queue(1, "m-1", { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z" }, 7);
    await expect(importer.process(job)).rejects.toThrow("chunk write failed");
    expect(state.meetings).toHaveLength(0);
    expect(state.meeting_sources).toHaveLength(0);
    expect(state.meeting_jobs[0]).toMatchObject({ status: "FAILED", activeKey: null });
  });

  test("cleans attachment files when the enclosing transaction rolls back after source commit", async () => {
    const { db } = fakePrisma();
    const filePath = path.join(os.tmpdir(), `meeting-rollback-${Date.now()}-${Math.random()}.bin`);
    const importer = importerWith({ db,
      client: { getContent: async () => ({ summary: "Summary", transcript: null, segments: [], attachments: [], capabilities: {} }) },
      sourceService: {
        prepareImport: async () => [{ sourceType: "TENCENT_ORIGINAL", name: "attachment.bin" }],
        commitImport: async (tx, _meeting, _prepared, { onRollback }) => {
          fs.writeFileSync(filePath, "private attachment");
          onRollback(async () => fs.promises.rm(filePath, { force: true }));
          const updateMany = tx.meeting_jobs.updateMany;
          tx.meeting_jobs.updateMany = async (args) => args.data.status === "SUCCESS" ? { count: 0 } : updateMany(args);
        },
      },
    });
    const job = await importer.queue(1, "m-1", { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z" }, 7);
    await expect(importer.process(job)).rejects.toMatchObject({ code: "IMPORT_LEASE_LOST" });
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test("queue reserves the same external meeting once and treats active reservations as quota", async () => {
    const { db, state } = fakePrisma();
    const importer = importerWith({ db });
    const scope = { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z" };
    const first = await importer.queue(1, "m-1", scope, 7);
    await expect(importer.queue(1, "m-1", scope, 7)).rejects.toMatchObject({ code: "MEETING_DUPLICATE" });
    expect(state.meeting_jobs).toHaveLength(1);
    expect(first.activeKey).toBe("1:m-1");
  });

  test("retry reuses its job and reclaims stale PROCESSING work after a runner restart", async () => {
    const { db, state } = fakePrisma({ meeting_jobs: [{
      id: 8, kind: "IMPORT", connectionId: 1, externalId: "m-1", activeKey: null, quarter: "2026-Q2",
      payload: JSON.stringify({ scope: { from: "2026-04-01T00:00:00Z", to: "2026-04-02T00:00:00Z" }, userId: 7 }),
      status: "PROCESSING", attempts: 1, leaseOwner: "a", leaseUntil: new Date(0), updatedAt: new Date(0),
    }] });
    const runnerA = createJobRunner({ prisma: db, handlers: { IMPORT: async () => {} }, pollMs: 5, leaseMs: 10, runnerId: "a" });
    const runnerB = createJobRunner({ prisma: db, handlers: { IMPORT: async () => { throw new Error("still unavailable"); } }, pollMs: 5, leaseMs: 10, runnerId: "b" });
    await expect(runnerB.runOnce()).rejects.toThrow("still unavailable");
    expect(state.meeting_jobs[0]).toMatchObject({ status: "FAILED", leaseOwner: null, attempts: 2 });
    const retry = await runnerB.retry(8);
    expect(retry).toMatchObject({ id: 8, status: "CREATED" });
    expect(state.meeting_jobs).toHaveLength(1);
  });
});

describe("durable imports with SQLite", () => {
  let prisma;
  let directory;
  let connectionId;

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-import-"));
    const database = path.join(directory, "meetings.db");
    fs.copyFileSync(path.join(__dirname, "../../storage/anythingllm.db"), database);
    prisma = new PrismaClient({ datasources: { db: { url: `file:${database.replace(/\\/g, "/")}` } } });
    const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("meeting_jobs")');
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("leaseOwner")) await prisma.$executeRawUnsafe('ALTER TABLE "meeting_jobs" ADD COLUMN "leaseOwner" TEXT');
    if (!names.has("leaseUntil")) await prisma.$executeRawUnsafe('ALTER TABLE "meeting_jobs" ADD COLUMN "leaseUntil" DATETIME');
  });

  beforeEach(async () => {
    await prisma.meeting_jobs.deleteMany();
    await prisma.meeting_chunks.deleteMany();
    await prisma.meeting_sources.deleteMany();
    await prisma.meetings.deleteMany();
    await prisma.meeting_connections.deleteMany();
    const connection = await prisma.meeting_connections.create({ data: { name: "Tencent integration", config: "{}" } });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  const testImporter = (overrides = {}) => createImporter({
    prisma,
    meetingService: createMeetingService({ prisma }),
    clientFactory: () => ({
      listMeetings: async () => ({ items: [officialMeeting], nextCursor: null }),
      getContent: async () => ({
        summary: null,
        transcript: null,
        segments: [],
        attachments: [],
        capabilities: {
          transcript: { status: "unsupported" },
          summary: { status: "unsupported" },
          attachments: { status: "unsupported" },
        },
      }),
      ...overrides.client,
    }),
    sourceService: { prepareImport: async () => [], commitImport: async () => {}, ...overrides.sourceService },
  });
  const dateRange = { startTime: "2026-04-01T00:00:00Z", endTime: "2026-04-02T00:00:00Z" };

  test("concurrent queue requests reserve one database identity", async () => {
    const importer = testImporter();
    const results = await Promise.allSettled([
      importer.queue(connectionId, "m-1", dateRange, 7),
      importer.queue(connectionId, "m-1", dateRange, 7),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.meeting_jobs.count({ where: { kind: "IMPORT", status: "CREATED" } })).toBe(1);
  });

  test("concurrent reservations cannot exceed the quarterly capacity", async () => {
    for (let index = 0; index < 199; index += 1) await prisma.meetings.create({ data: {
      connectionId, externalId: `existing-${index}`, activeKey: `${connectionId}:existing-${index}`,
      title: "Existing", startTime: new Date("2026-04-01T02:00:00Z"), quarter: "2026-Q2",
      reviewStatus: "DRAFT", retrievalStatus: "WAITING_CONTENT", coverage: "{}",
    } });
    const importer = testImporter({ client: { listMeetings: async () => ({
      items: [{ ...officialMeeting, externalId: "m-2" }, { ...officialMeeting, externalId: "m-3" }], nextCursor: null,
    }) } });
    const results = await Promise.allSettled([
      importer.queue(connectionId, "m-2", dateRange, 7),
      importer.queue(connectionId, "m-3", dateRange, 7),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.meeting_jobs.count({ where: { quarter: "2026-Q2", status: "CREATED" } })).toBe(1);
    expect(await prisma.meetings.count({ where: { quarter: "2026-Q2", deletedAt: null } })).toBe(199);
  });

  test("the reserved import can create metadata in the last quarterly slot and then releases its key", async () => {
    for (let index = 0; index < 199; index += 1) await prisma.meetings.create({ data: {
      connectionId, externalId: `existing-${index}`, activeKey: `${connectionId}:existing-${index}`,
      title: "Existing", startTime: new Date("2026-04-01T02:00:00Z"), quarter: "2026-Q2",
      reviewStatus: "DRAFT", retrievalStatus: "WAITING_CONTENT", coverage: "{}",
    } });
    const importer = testImporter();
    const job = await importer.queue(connectionId, "m-1", dateRange, 7);
    expect(job.activeKey).toBe(`${connectionId}:m-1`);
    const meeting = await importer.process(job);
    expect(meeting.retrievalStatus).toBe("WAITING_CONTENT");
    const persisted = await prisma.meeting_jobs.findUnique({ where: { id: job.id } });
    expect(persisted).toMatchObject({ activeKey: null, meetingId: meeting.id, status: "SUCCESS" });
    expect(await prisma.meetings.count({ where: { quarter: "2026-Q2", deletedAt: null } })).toBe(200);
  });

  test("rolls back all import rows when a source commit fails in SQLite", async () => {
    const importer = testImporter({
      client: { getContent: async () => ({ summary: "Usable summary", transcript: null, segments: [], attachments: [], capabilities: {} }) },
      sourceService: {
        prepareImport: async () => [{ sourceType: "SUMMARY", name: "minutes" }],
        commitImport: async (tx, meeting) => {
          await tx.meeting_sources.create({ data: { meetingId: meeting.id, sourceType: "SUMMARY", name: "minutes", parseStatus: "SUCCESS" } });
          throw new Error("simulated source write failure");
        },
      },
    });
    const job = await importer.queue(connectionId, "m-1", dateRange, 7);
    await expect(importer.process(job)).rejects.toThrow("simulated source write failure");
    expect(await prisma.meetings.count()).toBe(0);
    expect(await prisma.meeting_sources.count()).toBe(0);
    expect(await prisma.meeting_jobs.findUnique({ where: { id: job.id } })).toMatchObject({ status: "FAILED", activeKey: null });
  });

  test("reclaims a stale lease and retries the same persisted import job", async () => {
    const job = await prisma.meeting_jobs.create({ data: {
      kind: "IMPORT", connectionId, externalId: "m-1", activeKey: null, quarter: "2026-Q2",
      payload: JSON.stringify({ scope: dateRange, meeting: officialMeeting, userId: 7 }), status: "PROCESSING",
      attempts: 1, leaseOwner: "previous-worker", leaseUntil: new Date(0),
    } });
    const runner = createJobRunner({ prisma, handlers: { IMPORT: async () => { throw new Error("temporary"); } }, runnerId: "restarted-worker", leaseMs: 100 });
    await expect(runner.runOnce()).rejects.toThrow("temporary");
    const failed = await prisma.meeting_jobs.findUnique({ where: { id: job.id } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 2, leaseOwner: null, activeKey: null });
    const retried = await runner.retry(job.id);
    expect(retried).toMatchObject({ id: job.id, status: "CREATED", activeKey: `${connectionId}:m-1` });
  });

  test("two runners cannot claim the same created row", async () => {
    const job = await prisma.meeting_jobs.create({ data: {
      kind: "IMPORT", connectionId, externalId: "m-1", activeKey: `${connectionId}:m-1`, quarter: "2026-Q2",
      payload: JSON.stringify({ scope: dateRange }), status: "CREATED", attempts: 0,
    } });
    const handled = [];
    const handler = async (job) => {
      handled.push(job.id);
      await new Promise((resolve) => setTimeout(resolve, 40));
    };
    const runnerA = createJobRunner({ prisma, handlers: { IMPORT: handler }, runnerId: "runner-a", leaseMs: 200 });
    const runnerB = createJobRunner({ prisma, handlers: { IMPORT: handler }, runnerId: "runner-b", leaseMs: 200 });
    await Promise.allSettled([runnerA.runOnce(), runnerB.runOnce()]);
    expect(handled).toEqual([job.id]);
    expect(await prisma.meeting_jobs.count({ where: { status: "SUCCESS" } })).toBe(1);
    expect(await prisma.meeting_jobs.findFirst()).toMatchObject({ attempts: 1, leaseOwner: null });
  });
});
