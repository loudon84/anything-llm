const fs = require("fs");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { createSourceService } = require("../../modules/meetings/sources");
const { createIndexer } = require("../../modules/meetings/indexer");

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
});
