const fs = require("fs");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { createSourceService } = require("../../modules/meetings/sources");
const { createIndexer } = require("../../modules/meetings/indexer");
const {
  createMeetingService,
} = require("../../modules/meetings/meetingService");

const meetingData = (connectionId, externalId = "source-test") => ({
  connectionId,
  externalId,
  activeKey: `${connectionId}:${externalId}`,
  title: "Review",
  startTime: new Date("2026-04-01T02:00:00.000Z"),
  quarter: "2026-Q2",
  reviewStatus: "DRAFT",
  retrievalStatus: "WAITING_CONTENT",
  coverage: "{}",
});

describe("meeting source identity and lifecycle", () => {
  let prisma;
  let directory;
  let storageRoot;
  let meetingId;
  let connectionId;
  let jobs;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-sources-"));
    const database = path.join(directory, "meetings.db");
    fs.copyFileSync(
      path.join(__dirname, "../../storage/anythingllm.db"),
      database
    );
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${database.replace(/\\/g, "/")}` } },
    });
    storageRoot = path.join(directory, "storage");
  });

  beforeEach(async () => {
    fs.rmSync(storageRoot, { recursive: true, force: true });
    await prisma.meeting_jobs.deleteMany();
    await prisma.meeting_chunks.deleteMany();
    await prisma.meeting_sources.deleteMany();
    await prisma.meetings.deleteMany();
    await prisma.meeting_connections.deleteMany();
    const connection = await prisma.meeting_connections.create({
      data: { name: "test", config: "{}" },
    });
    connectionId = connection.id;
    const meeting = await prisma.meetings.create({
      data: meetingData(connectionId),
    });
    meetingId = meeting.id;
    jobs = [];
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  function service(overrides = {}) {
    const indexer = createIndexer({
      prisma,
      embedder: { embedDocuments: async (texts) => texts.map(() => [1, 0]) },
    });
    return createSourceService({
      prisma,
      storageRoot,
      trustedUploadRoot: directory,
      parser: {
        parse: async () => [
          {
            text: "A useful decision",
            location: { type: "paragraph", paragraph: 0 },
          },
        ],
      },
      indexer,
      enqueue: async (kind, payload, identity) => {
        jobs.push({ kind, payload, identity });
      },
      ...overrides,
    });
  }

  test("deduplicates identical content even when the uploaded name changes", async () => {
    const sources = service();
    await sources.upload(
      meetingId,
      { name: "agenda.txt", buffer: Buffer.from("same bytes") },
      7
    );
    await expect(
      sources.upload(
        meetingId,
        { name: "renamed.txt", buffer: Buffer.from("same bytes") },
        7
      )
    ).rejects.toMatchObject({ code: "SOURCE_DUPLICATE" });
    expect(
      await prisma.meeting_sources.count({
        where: { meetingId, deletedAt: null },
      })
    ).toBe(1);
  });

  test("database uniqueness prevents concurrent duplicate uploads", async () => {
    const sources = service();
    const results = await Promise.allSettled([
      sources.upload(
        meetingId,
        { name: "one.txt", buffer: Buffer.from("same") },
        7
      ),
      sources.upload(
        meetingId,
        { name: "two.txt", buffer: Buffer.from("same") },
        8
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected").reason
    ).toMatchObject({ code: "SOURCE_DUPLICATE" });
  });

  test("rejects deletion of Tencent originals and accepts only a current draft supplement", async () => {
    const source = await prisma.meeting_sources.create({
      data: {
        meetingId,
        sourceType: "TENCENT_ORIGINAL",
        name: "recording.docx",
        parseStatus: "SUCCESS",
      },
    });
    await expect(
      service().remove(meetingId, source.id, 7)
    ).rejects.toMatchObject({ code: "SOURCE_IMMUTABLE" });
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { reviewStatus: "APPROVED" },
    });
    await service().upload(
      meetingId,
      { name: "new.txt", buffer: Buffer.from("x") },
      7
    );
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .reviewStatus
    ).toBe("DRAFT");
  });

  test("does not allow deleting imported summary or transcript sources", async () => {
    const imported = await prisma.meeting_sources.create({
      data: {
        meetingId,
        sourceType: "SUMMARY",
        name: "Imported summary",
        contentHash: "summary",
        activeHash: "summary",
        parseStatus: "SUCCESS",
      },
    });
    await expect(
      service().remove(meetingId, imported.id, 7)
    ).rejects.toMatchObject({
      code: "SOURCE_IMMUTABLE",
    });
    expect(
      (await prisma.meeting_sources.findUnique({ where: { id: imported.id } }))
        .deletedAt
    ).toBeNull();
  });

  test("uses an opaque safe storage path regardless of a traversal filename", async () => {
    const source = await service().upload(
      meetingId,
      { name: "../../outside.txt", buffer: Buffer.from("safe") },
      7
    );
    expect(
      path.resolve(source.filePath).startsWith(path.resolve(storageRoot))
    ).toBe(true);
    expect(path.basename(source.filePath)).not.toContain("outside");
    expect(fs.readFileSync(source.filePath, "utf8")).toBe("safe");
    const archivedParts = path
      .relative(storageRoot, source.filePath)
      .split(path.sep);
    expect(archivedParts).toHaveLength(3);
    expect(archivedParts.slice(0, 2)).toEqual(["2026-Q2", String(meetingId)]);
    expect(archivedParts[2]).toMatch(/^[0-9a-f-]{36}\.txt$/i);
  });

  test("allows approved supplemental-text deletion with downgrade and archives its content", async () => {
    const filePath = path.join(storageRoot, "archive.txt");
    fs.mkdirSync(storageRoot, { recursive: true });
    fs.writeFileSync(filePath, "archive bytes");
    const source = await prisma.meeting_sources.create({
      data: {
        meetingId,
        sourceType: "SUPPLEMENT_TEXT",
        name: "notes",
        contentHash: "archive",
        activeHash: "archive",
        contentText: "Retained decision",
        filePath,
        parseStatus: "SUCCESS",
      },
    });
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { reviewStatus: "APPROVED", retrievalStatus: "AVAILABLE" },
    });
    const sources = service();
    await sources.remove(meetingId, source.id, 7);
    expect(fs.readFileSync(filePath, "utf8")).toBe("archive bytes");
    await expect(sources.getSource(meetingId, source.id)).rejects.toMatchObject(
      { code: "SOURCE_NOT_FOUND" }
    );
    expect(await sources.getArchivedSource(meetingId, source.id)).toMatchObject(
      { deleted: true, contentText: "Retained decision" }
    );
    expect(
      await prisma.meetings.findUnique({ where: { id: meetingId } })
    ).toMatchObject({ reviewStatus: "DRAFT", retrievalStatus: "INDEXING" });
  });

  test("rejects approved file deletion without changing review state or removing its original", async () => {
    const source = await service().upload(
      meetingId,
      { name: "archive.txt", buffer: Buffer.from("keep") },
      7
    );
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { reviewStatus: "APPROVED" },
    });
    await expect(
      service().remove(meetingId, source.id, 7)
    ).rejects.toMatchObject({ code: "SOURCE_IMMUTABLE" });
    expect(fs.readFileSync(source.filePath, "utf8")).toBe("keep");
    expect(
      await prisma.meetings.findUnique({ where: { id: meetingId } })
    ).toMatchObject({ reviewStatus: "APPROVED" });
  });

  test("streams a trusted temporary upload and deduplicates it against the buffer contract", async () => {
    const tempPath = path.join(directory, "server-issued-upload.txt");
    fs.writeFileSync(tempPath, "identical bytes");
    const sources = service();
    const streamed = await sources.upload(
      meetingId,
      { name: "stream.txt", tempPath },
      7
    );
    expect(fs.readFileSync(streamed.filePath, "utf8")).toBe("identical bytes");
    await expect(
      sources.upload(
        meetingId,
        { name: "buffer.txt", buffer: Buffer.from("identical bytes") },
        7
      )
    ).rejects.toMatchObject({ code: "SOURCE_DUPLICATE" });
  });

  test("deleting the last source pauses retrieval and queues cleanup without erasing history", async () => {
    const source = await prisma.meeting_sources.create({
      data: {
        meetingId,
        sourceType: "SUPPLEMENT_TEXT",
        name: "notes",
        contentHash: "x",
        activeHash: "x",
        contentText: "Decision",
        segments: JSON.stringify([
          { text: "Decision", location: { type: "paragraph", paragraph: 0 } },
        ]),
        parseStatus: "SUCCESS",
      },
    });
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { retrievalStatus: "AVAILABLE", generation: 3 },
    });
    await prisma.meeting_chunks.create({
      data: {
        meetingId,
        sourceId: source.id,
        text: "Decision",
        location: "{}",
        embedding: "[1,0]",
        generation: 3,
      },
    });
    const sources = service();
    await sources.remove(meetingId, source.id, 7);
    const [meeting, deleted, chunks] = await Promise.all([
      prisma.meetings.findUnique({ where: { id: meetingId } }),
      prisma.meeting_sources.findUnique({ where: { id: source.id } }),
      prisma.meeting_chunks.findMany({ where: { meetingId } }),
    ]);
    expect(meeting).toMatchObject({
      retrievalStatus: "INDEXING",
      generation: 4,
    });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(chunks).toHaveLength(1);
    const reindex = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "REINDEX" },
    });
    expect(reindex).toMatchObject({
      kind: "REINDEX",
      payload: JSON.stringify({ generation: 4 }),
    });
    await sources.process(reindex);
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("WAITING_CONTENT");
    expect(await prisma.meeting_chunks.count({ where: { meetingId } })).toBe(0);
  });

  test("failed new-source parsing preserves existing available content", async () => {
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { retrievalStatus: "AVAILABLE", generation: 2 },
    });
    const sources = service({
      parser: {
        parse: async () => {
          throw new Error("parse outage");
        },
      },
    });
    const source = await sources.upload(
      meetingId,
      { name: "new.txt", buffer: Buffer.from("broken") },
      7
    );
    await expect(
      sources.process({
        id: 99,
        kind: "PARSE_SOURCE",
        meetingId,
        payload: JSON.stringify({
          sourceId: source.id,
          sourceRevision: source.contentHash,
        }),
      })
    ).rejects.toThrow("parse outage");
    const meeting = await prisma.meetings.findUnique({
      where: { id: meetingId },
    });
    const current = await prisma.meeting_sources.findUnique({
      where: { id: source.id },
    });
    expect(meeting.retrievalStatus).toBe("AVAILABLE");
    expect(current.parseStatus).toBe("FAILED");
    expect(current.error).toMatch(/parse outage/);
  });

  test("rejects a supplement with incompatible dimensions and keeps existing chunks queryable", async () => {
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { retrievalStatus: "AVAILABLE", generation: 2 },
    });
    const existing = await prisma.meeting_sources.create({
      data: {
        meetingId,
        sourceType: "SUPPLEMENT_TEXT",
        name: "Existing decision",
        contentHash: "existing",
        activeHash: "existing",
        contentText: "Existing decision",
        segments: JSON.stringify([
          {
            text: "Existing decision",
            location: { type: "paragraph", paragraph: 0 },
          },
        ]),
        parseStatus: "SUCCESS",
      },
    });
    await prisma.meeting_chunks.create({
      data: {
        meetingId,
        sourceId: existing.id,
        text: "Existing decision",
        location: JSON.stringify({ type: "paragraph", paragraph: 0 }),
        embedding: JSON.stringify({
          profileId: "current-profile",
          vector: [1, 0],
        }),
        generation: 2,
      },
    });
    const indexer = createIndexer({
      prisma,
      profileId: "current-profile",
      embedder: {
        embedDocuments: async () => [[0, 0, 1]],
        embedQuery: async () => [1, 0],
      },
    });
    const sources = service({
      indexer,
      parser: {
        parse: async () => [
          {
            text: "New incompatible decision",
            location: { type: "paragraph", paragraph: 0 },
          },
        ],
      },
    });
    const supplement = await sources.upload(
      meetingId,
      { name: "new.txt", buffer: Buffer.from("new source bytes") },
      7
    );

    await expect(
      sources.process({
        id: 901,
        kind: "PARSE_SOURCE",
        meetingId,
        payload: JSON.stringify({
          sourceId: supplement.id,
          sourceRevision: supplement.contentHash,
          generation: 2,
        }),
      })
    ).rejects.toMatchObject({ code: "EMBEDDING_PROFILE_MISMATCH" });

    const [meeting, failedSource, chunks] = await Promise.all([
      prisma.meetings.findUnique({ where: { id: meetingId } }),
      prisma.meeting_sources.findUnique({ where: { id: supplement.id } }),
      prisma.meeting_chunks.findMany({ where: { meetingId } }),
    ]);
    expect(meeting.retrievalStatus).toBe("AVAILABLE");
    expect(failedSource.parseStatus).toBe("FAILED");
    expect(chunks).toHaveLength(1);
    await expect(
      indexer.search([meetingId], "decision")
    ).resolves.toMatchObject([
      { quote: "Existing decision", sourceId: existing.id },
    ]);
  });

  test("a successful later supplement can make an initially failed draft available", async () => {
    const failedParser = service({
      parser: {
        parse: async () => {
          throw new Error("first parse failed");
        },
      },
    });
    const failedSource = await failedParser.upload(
      meetingId,
      { name: "first.txt", buffer: Buffer.from("first") },
      7
    );
    const firstJob = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "PARSE_SOURCE" },
    });
    await expect(failedParser.process(firstJob)).rejects.toThrow(
      "first parse failed"
    );
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("INDEX_FAILED");
    expect(
      (
        await prisma.meeting_sources.findUnique({
          where: { id: failedSource.id },
        })
      ).parseStatus
    ).toBe("FAILED");

    const next = await service().upload(
      meetingId,
      { name: "second.txt", buffer: Buffer.from("second") },
      7
    );
    const secondJob = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "PARSE_SOURCE", NOT: { id: firstJob.id } },
    });
    await service().process(secondJob);
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("AVAILABLE");
    expect(
      (await prisma.meeting_sources.findUnique({ where: { id: next.id } }))
        .parseStatus
    ).toBe("SUCCESS");
  });

  test("a late parse worker cannot revive a source deleted before it publishes", async () => {
    const sources = service();
    const source = await sources.upload(
      meetingId,
      { name: "late.txt", buffer: Buffer.from("late content") },
      7
    );
    const parseJob = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "PARSE_SOURCE" },
    });
    await sources.remove(meetingId, source.id, 7);
    await expect(sources.process(parseJob)).resolves.toMatchObject({
      stale: true,
    });
    const current = await prisma.meeting_sources.findUnique({
      where: { id: source.id },
    });
    expect(current).toMatchObject({ parseStatus: "PENDING" });
    expect(current.deletedAt).toBeInstanceOf(Date);
    expect(
      await prisma.meeting_chunks.count({ where: { sourceId: source.id } })
    ).toBe(0);
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("INDEXING");
  });

  test("reindex aborts if a source finishes parsing while embeddings are being prepared", async () => {
    const original = await prisma.meeting_sources.create({
      data: {
        meetingId,
        sourceType: "SUPPLEMENT_TEXT",
        name: "existing",
        contentHash: "existing-hash",
        activeHash: "existing-hash",
        segments: JSON.stringify([
          { text: "Existing", location: { type: "paragraph", paragraph: 0 } },
        ]),
        parseStatus: "SUCCESS",
      },
    });
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { generation: 3, retrievalStatus: "INDEXING" },
    });
    await prisma.meeting_chunks.create({
      data: {
        meetingId,
        sourceId: original.id,
        text: "Existing",
        location: "{}",
        embedding: "[1,0]",
        generation: 3,
      },
    });

    let signalStarted;
    const started = new Promise((resolve) => {
      signalStarted = resolve;
    });
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const delayedIndex = createIndexer({
      prisma,
      embedder: {
        embedDocuments: async (texts) => {
          signalStarted();
          await blocked;
          return texts.map(() => [0, 1]);
        },
      },
    });
    const reindexing = delayedIndex.reindex(meetingId);
    await started;
    const added = await service().upload(
      meetingId,
      { name: "new.txt", buffer: Buffer.from("new evidence") },
      7
    );
    const parseJob = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "PARSE_SOURCE" },
    });
    await service().process(parseJob);
    release();
    await expect(reindexing).resolves.toMatchObject({ stale: true });
    const [meeting, sources, chunks] = await Promise.all([
      prisma.meetings.findUnique({ where: { id: meetingId } }),
      prisma.meeting_sources.findMany({
        where: { meetingId, deletedAt: null },
      }),
      prisma.meeting_chunks.findMany({ where: { meetingId, generation: 3 } }),
    ]);
    expect(chunks.some((chunk) => chunk.sourceId === added.id)).toBe(true);
    expect(chunks.some((chunk) => chunk.sourceId === original.id)).toBe(true);
    expect(
      sources.every((source) =>
        chunks.some((chunk) => chunk.sourceId === source.id)
      )
    ).toBe(true);
    expect(meeting.retrievalStatus).toBe("AVAILABLE");
  });

  test("requeues a pending source when its parse job belongs to an old generation", async () => {
    let signalStarted;
    const started = new Promise((resolve) => {
      signalStarted = resolve;
    });
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const sources = service({
      parser: {
        parse: async () => {
          calls += 1;
          if (calls === 1) {
            signalStarted();
            await blocked;
          }
          return [
            { text: "Parsed", location: { type: "paragraph", paragraph: 0 } },
          ];
        },
      },
    });
    const source = await sources.upload(
      meetingId,
      { name: "pending.txt", buffer: Buffer.from("pending") },
      7
    );
    const oldJob = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "PARSE_SOURCE" },
    });
    const processing = sources.process(oldJob);
    await started;
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { generation: 1, retrievalStatus: "INDEXING" },
    });
    release();
    await expect(processing).resolves.toMatchObject({
      stale: true,
      requeued: true,
    });
    const [pending, jobs] = await Promise.all([
      prisma.meeting_sources.findUnique({ where: { id: source.id } }),
      prisma.meeting_jobs.findMany({
        where: { meetingId, kind: "PARSE_SOURCE" },
      }),
    ]);
    expect(pending.parseStatus).toBe("PENDING");
    expect(
      jobs.some(
        (job) =>
          JSON.parse(job.payload).generation === 1 && job.status === "CREATED"
      )
    ).toBe(true);
  });

  test("an expired worker cannot publish success or failure after another lease succeeds", async () => {
    let signalStarted;
    const started = new Promise((resolve) => {
      signalStarted = resolve;
    });
    let rejectSlow;
    const blocked = new Promise((_, reject) => {
      rejectSlow = reject;
    });
    let calls = 0;
    const sources = service({
      parser: {
        parse: async () => {
          calls += 1;
          if (calls === 1) {
            signalStarted();
            return blocked;
          }
          return [
            { text: "Winner", location: { type: "paragraph", paragraph: 0 } },
          ];
        },
      },
    });
    const source = await sources.upload(
      meetingId,
      { name: "leased.txt", buffer: Buffer.from("leased") },
      7
    );
    const created = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "PARSE_SOURCE" },
    });
    await prisma.meeting_jobs.update({
      where: { id: created.id },
      data: {
        status: "PROCESSING",
        leaseOwner: "worker-a",
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });
    const staleWorker = sources.process({
      ...created,
      status: "PROCESSING",
      leaseOwner: "worker-a",
    });
    await started;
    await prisma.meeting_jobs.update({
      where: { id: created.id },
      data: { leaseOwner: "worker-b" },
    });
    await sources.process({
      ...created,
      status: "PROCESSING",
      leaseOwner: "worker-b",
    });
    rejectSlow(new Error("late parser failure"));
    await expect(staleWorker).resolves.toMatchObject({ stale: true });
    const [currentSource, chunks, meeting] = await Promise.all([
      prisma.meeting_sources.findUnique({ where: { id: source.id } }),
      prisma.meeting_chunks.findMany({ where: { sourceId: source.id } }),
      prisma.meetings.findUnique({ where: { id: meetingId } }),
    ]);
    expect(currentSource).toMatchObject({
      parseStatus: "SUCCESS",
      error: null,
    });
    expect(chunks).toHaveLength(1);
    expect(meeting.retrievalStatus).toBe("AVAILABLE");
  });

  test("a reindex job from an older generation cannot publish after meeting revision", async () => {
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { generation: 8, retrievalStatus: "INDEXING" },
    });
    const reindex = jest.fn();
    const sources = service({ indexer: { reindex } });
    await expect(
      sources.process({
        kind: "REINDEX",
        meetingId,
        payload: JSON.stringify({ generation: 7 }),
      })
    ).resolves.toMatchObject({ stale: true });
    expect(reindex).not.toHaveBeenCalled();
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("INDEXING");
  });

  test("revision reindex synchronizes summary source text and clears obsolete locators", async () => {
    const source = await prisma.meeting_sources.create({
      data: {
        meetingId,
        sourceType: "SUMMARY",
        name: "Tencent summary",
        contentText: "Original decision",
        contentHash: "original-hash",
        activeHash: "SUMMARY:original-hash",
        segments: JSON.stringify({
          segments: [
            {
              text: "Original decision",
              location: {
                type: "paragraph",
                paragraph: 0,
                recordFileId: "old-record",
              },
            },
          ],
          provenance: { recordFileIds: ["old-record"] },
        }),
        parseStatus: "SUCCESS",
      },
    });
    await prisma.meetings.update({
      where: { id: meetingId },
      data: {
        summary: "Revised decision",
        generation: 2,
        retrievalStatus: "INDEXING",
      },
    });
    const job = await prisma.meeting_jobs.create({
      data: {
        kind: "REINDEX",
        meetingId,
        connectionId,
        externalId: "source-test",
        quarter: "2026-Q2",
        activeKey: "REINDEX:2",
        payload: JSON.stringify({ generation: 2 }),
        status: "CREATED",
        attempts: 0,
      },
    });
    await service().process(job);
    const [current, chunks] = await Promise.all([
      prisma.meeting_sources.findUnique({ where: { id: source.id } }),
      prisma.meeting_chunks.findMany({ where: { meetingId, generation: 2 } }),
    ]);
    expect(current.contentText).toBe("Revised decision");
    expect(current.contentHash).not.toBe("original-hash");
    expect(JSON.parse(current.segments)).toEqual([
      {
        text: "Revised decision",
        location: { type: "paragraph", paragraph: 0 },
      },
    ]);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["Revised decision"]);
    expect(JSON.parse(chunks[0].location)).toEqual({
      type: "paragraph",
      paragraph: 0,
    });
  });

  test("metadata-only meetings become searchable after manual summary entry and clearing the last summary removes old evidence", async () => {
    const meetings = createMeetingService({ prisma });
    const revised = await meetings.revise(
      meetingId,
      { summary: "Manual decision" },
      7
    );
    const sourceService = service();
    let job = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "REINDEX" },
    });
    await sourceService.process(job);
    expect(
      await prisma.meetings.findUnique({ where: { id: meetingId } })
    ).toMatchObject({ retrievalStatus: "AVAILABLE" });
    const indexer = createIndexer({
      prisma,
      embedder: {
        embedQuery: async () => [1, 0],
        embedDocuments: async (texts) => texts.map(() => [1, 0]),
      },
    });
    expect(
      (await indexer.search([meetingId], "decision")).map((item) => item.quote)
    ).toEqual(["Manual decision"]);
    await meetings.revise(revised.id, { summary: "" }, 7);
    job = await prisma.meeting_jobs.findFirst({
      where: {
        meetingId,
        kind: "REINDEX",
        status: "CREATED",
        id: { not: job.id },
      },
    });
    await sourceService.process(job);
    expect(
      await prisma.meetings.findUnique({ where: { id: meetingId } })
    ).toMatchObject({ retrievalStatus: "WAITING_CONTENT", summary: "" });
    expect(await prisma.meeting_chunks.count({ where: { meetingId } })).toBe(0);
  });

  test("manual profile rebuild restores search after mismatch without using old vectors", async () => {
    const source = await prisma.meeting_sources.create({
      data: {
        meetingId,
        sourceType: "SUPPLEMENT_TEXT",
        name: "notes",
        contentHash: "profile-source",
        activeHash: "profile-source",
        contentText: "Rebuild decision",
        segments: JSON.stringify([
          {
            text: "Rebuild decision",
            location: { type: "paragraph", paragraph: 0 },
          },
        ]),
        parseStatus: "SUCCESS",
      },
    });
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { generation: 3, retrievalStatus: "AVAILABLE" },
    });
    await prisma.meeting_chunks.create({
      data: {
        meetingId,
        sourceId: source.id,
        text: "Rebuild decision",
        location: "{}",
        embedding: JSON.stringify({ profileId: "model-a", vector: [1, 0] }),
        generation: 3,
      },
    });
    const currentIndexer = createIndexer({
      prisma,
      embedder: {
        profileId: "model-b",
        embedQuery: async () => [1, 0],
        embedDocuments: async (texts) => texts.map(() => [1, 0]),
      },
    });
    await expect(
      currentIndexer.search([meetingId], "decision")
    ).rejects.toMatchObject({ code: "EMBEDDING_PROFILE_MISMATCH" });
    const job = await createMeetingService({ prisma }).requestReindex(
      meetingId,
      7,
      currentIndexer.profileId
    );
    await service({ indexer: currentIndexer }).process(job);
    expect(await currentIndexer.search([meetingId], "decision")).toHaveLength(
      1
    );
    expect(
      JSON.parse(
        (await prisma.meeting_chunks.findFirst({ where: { meetingId } }))
          .embedding
      ).profileId
    ).toBe("model-b");
  });

  test("keeps the last-source deletion blocked when the next upload fails", async () => {
    const oldSource = await prisma.meeting_sources.create({
      data: {
        meetingId,
        sourceType: "SUPPLEMENT_TEXT",
        name: "old",
        contentHash: "old",
        activeHash: "old",
        contentText: "Old decision",
        segments: JSON.stringify([
          {
            text: "Old decision",
            location: { type: "paragraph", paragraph: 0 },
          },
        ]),
        parseStatus: "SUCCESS",
      },
    });
    await prisma.meetings.update({
      where: { id: meetingId },
      data: { retrievalStatus: "AVAILABLE", generation: 1 },
    });
    await prisma.meeting_chunks.create({
      data: {
        meetingId,
        sourceId: oldSource.id,
        text: "Old decision",
        location: "{}",
        embedding: "[1,0]",
        generation: 1,
      },
    });
    const working = service();
    await working.remove(meetingId, oldSource.id, 7);
    const cleanup = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "REINDEX" },
    });
    await working.process(cleanup);
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("WAITING_CONTENT");
    const failed = service({
      parser: {
        parse: async () => {
          throw new Error("parser outage");
        },
      },
    });
    const source = await failed.upload(
      meetingId,
      { name: "replacement.txt", buffer: Buffer.from("replacement") },
      7
    );
    const job = await prisma.meeting_jobs.findFirst({
      where: { meetingId, kind: "PARSE_SOURCE" },
    });
    await expect(failed.process(job)).rejects.toThrow("parser outage");
    const [meeting, current] = await Promise.all([
      prisma.meetings.findUnique({ where: { id: meetingId } }),
      prisma.meeting_sources.findUnique({ where: { id: source.id } }),
    ]);
    expect(meeting.retrievalStatus).toBe("INDEX_FAILED");
    expect(current.parseStatus).toBe("FAILED");
    expect(await prisma.meeting_chunks.count({ where: { meetingId } })).toBe(0);
  });

  test("rejects per-file and per-meeting limits before storage", async () => {
    await expect(
      service().upload(
        meetingId,
        { name: "big.txt", buffer: Buffer.alloc(100_000_001) },
        7
      )
    ).rejects.toMatchObject({ code: "SOURCE_FILE_TOO_LARGE" });
    expect(fs.existsSync(storageRoot)).toBe(false);
  });

  test("prepares and atomically commits Tencent provenance and located chunks", async () => {
    const sources = service();
    const prepared = await sources.prepareImport({
      summary: "Aggregate summary",
      summarySegments: [
        {
          text: "Recorded decision",
          location: {
            type: "paragraph",
            paragraph: 0,
            recordFileId: "record-1",
          },
        },
      ],
      transcript: "Opening",
      segments: [
        {
          text: "Opening",
          location: {
            type: "transcript",
            startMs: 0,
            endMs: 200,
            recordFileId: "record-1",
          },
        },
      ],
      attachments: [
        {
          name: "minutes.txt",
          externalFileId: "artifact-9",
          artifactType: "minutes",
          bytes: 4,
          buffer: Buffer.from("file"),
        },
      ],
    });
    expect(prepared.map((source) => source.sourceType)).toEqual([
      "SUMMARY",
      "TRANSCRIPT",
      "TENCENT_ORIGINAL",
    ]);
    expect(prepared[1].segments[0].location).toMatchObject({
      startMs: 0,
      endMs: 200,
      recordFileId: "record-1",
    });
    await prisma.$transaction(async (tx) => {
      const meeting = await tx.meetings.update({
        where: { id: meetingId },
        data: { retrievalStatus: "INDEXING", generation: 1 },
      });
      await sources.commitImport(tx, meeting, prepared);
    });
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("AVAILABLE");
    const original = await prisma.meeting_sources.findFirst({
      where: { meetingId, sourceType: "TENCENT_ORIGINAL" },
    });
    expect(original).toMatchObject({
      name: "minutes.txt",
      parseStatus: "SUCCESS",
      bytes: 4,
    });
    const provenance = JSON.parse(original.segments);
    expect(provenance.provenance).toMatchObject({
      externalFileId: "artifact-9",
      artifactType: "minutes",
    });
    expect(
      await prisma.meeting_chunks.count({ where: { meetingId, generation: 1 } })
    ).toBeGreaterThan(0);
    await expect(
      sources.commitImport(prisma, { id: meetingId, generation: 1 }, [])
    ).rejects.toMatchObject({ code: "IMPORT_CONTENT_UNUSABLE" });
  });

  test("deduplicates imported Tencent file bytes against renamed supplements", async () => {
    const sources = service();
    const prepared = await sources.prepareImport({
      attachments: [
        {
          name: "original.txt",
          externalFileId: "tencent-file-1",
          artifactType: "recording",
          bytes: 4,
          buffer: Buffer.from("same"),
        },
      ],
    });
    await prisma.$transaction(async (tx) => {
      const meeting = await tx.meetings.update({
        where: { id: meetingId },
        data: { retrievalStatus: "INDEXING", generation: 1 },
      });
      await sources.commitImport(tx, meeting, prepared);
    });

    await expect(
      sources.upload(
        meetingId,
        { name: "renamed.txt", buffer: Buffer.from("same") },
        7
      )
    ).rejects.toMatchObject({ code: "SOURCE_DUPLICATE" });
    const original = await prisma.meeting_sources.findFirst({
      where: { meetingId, sourceType: "TENCENT_ORIGINAL" },
    });
    expect(JSON.parse(original.segments).provenance).toMatchObject({
      externalFileId: "tencent-file-1",
      artifactType: "recording",
    });
  });

  test("rejects mixed dimensions across separately prepared Tencent sources before publishing", async () => {
    let batch = 0;
    const indexer = createIndexer({
      prisma,
      profileId: "current-profile",
      embedder: {
        embedDocuments: async (texts) => {
          batch += 1;
          return texts.map(() => Array(batch === 1 ? 2 : 3).fill(1));
        },
      },
    });
    const sources = service({ indexer });
    const prepared = await sources.prepareImport({
      summarySegments: [
        {
          text: "Imported summary",
          location: { type: "paragraph", paragraph: 0 },
        },
      ],
      segments: [
        {
          text: "Imported transcript",
          location: { type: "transcript", startMs: 0, endMs: 100 },
        },
      ],
    });
    expect(prepared.map((source) => source.chunks[0].embedding.length)).toEqual(
      [2, 3]
    );
    expect(prepared.map((source) => source.profileId)).toEqual([
      "current-profile",
      "current-profile",
    ]);

    await expect(
      prisma.$transaction(async (tx) => {
        const indexing = await tx.meetings.update({
          where: { id: meetingId },
          data: { retrievalStatus: "INDEXING", generation: 1 },
        });
        return sources.commitImport(tx, indexing, prepared);
      })
    ).rejects.toMatchObject({ code: "EMBEDDING_PROFILE_MISMATCH" });

    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("WAITING_CONTENT");
    expect(await prisma.meeting_sources.count({ where: { meetingId } })).toBe(
      0
    );
    expect(await prisma.meeting_chunks.count({ where: { meetingId } })).toBe(0);
    await expect(
      sources.commitImport(
        prisma,
        { id: meetingId, generation: 1 },
        prepared.map((source, index) =>
          index === 1 ? { ...source, profileId: "previous-profile" } : source
        )
      )
    ).rejects.toMatchObject({ code: "EMBEDDING_PROFILE_MISMATCH" });
  });
});
