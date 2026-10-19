const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { createImporter } = require("../../modules/meetings/importer");
const { createIndexer } = require("../../modules/meetings/indexer");
const {
  createMeetingService,
} = require("../../modules/meetings/meetingService");
const { createSourceService } = require("../../modules/meetings/sources");

const serverRoot = path.resolve(__dirname, "../..");
const prismaRoot = path.join(serverRoot, "prisma");

describe("meeting persistence integration on a fresh SQLite database", () => {
  let prisma;
  let temporaryRoot;
  let storageRoot;
  let sourceService;
  let meetingService;
  let connectionId;

  beforeAll(async () => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-task7-"));
    const isolatedPrismaRoot = path.join(temporaryRoot, "prisma");
    fs.cpSync(prismaRoot, isolatedPrismaRoot, { recursive: true });
    const isolatedSchema = path.join(isolatedPrismaRoot, "schema.prisma");
    const schema = fs
      .readFileSync(isolatedSchema, "utf8")
      .replace(
        /url\s*=\s*"file:\.\.\/storage\/anythingllm\.db"/,
        'url      = "file:./isolated.db"'
      );
    fs.writeFileSync(isolatedSchema, schema);
    const databasePath = path.join(isolatedPrismaRoot, "isolated.db");
    fs.writeFileSync(databasePath, Buffer.alloc(0));
    try {
      childProcess.execFileSync(
        process.execPath,
        [
          require.resolve("prisma/build/index.js"),
          "migrate",
          "deploy",
          "--schema",
          isolatedSchema,
        ],
        { cwd: serverRoot, stdio: "pipe" }
      );
    } catch (error) {
      throw new Error(
        `Fresh SQLite migrations failed: ${error.stderr?.toString() || ""}${error.stdout?.toString() || ""}${error.message}`
      );
    }
    prisma = new PrismaClient({
      datasources: {
        db: { url: `file:${databasePath.replace(/\\/g, "/")}` },
      },
    });
    await prisma.$connect();
    storageRoot = path.join(temporaryRoot, "storage");
    const connection = await prisma.meeting_connections.create({
      data: { name: "Synthetic Tencent", config: "{}" },
    });
    connectionId = connection.id;
    meetingService = createMeetingService({ prisma });
    sourceService = createSourceService({
      prisma,
      storageRoot,
      trustedUploadRoot: temporaryRoot,
      parser: {
        parse: async ({ name, buffer }) => [
          {
            text: `${name}: ${buffer.toString("utf8")}`,
            location: { type: "paragraph", paragraph: 1 },
          },
        ],
      },
      indexer: createIndexer({
        prisma,
        profileId: "native:integration-test",
        embedder: {
          embedDocuments: async (texts) => texts.map(() => [1, 0]),
        },
      }),
      enqueue: async () => {},
    });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (temporaryRoot)
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  async function processLatestSourceJob(meetingId) {
    const job = await prisma.meeting_jobs.findFirst({
      where: {
        meetingId,
        kind: { in: ["PARSE_SOURCE", "REINDEX"] },
        status: "CREATED",
      },
      orderBy: { id: "desc" },
    });
    if (!job) throw new Error("Expected a durable source job");
    const result = await sourceService.process(job);
    await prisma.meeting_jobs.update({
      where: { id: job.id },
      data: { status: "SUCCESS", activeKey: null },
    });
    return result;
  }

  async function makeMeeting(externalId) {
    const startTime = "2026-04-01T02:00:00.000Z";
    const metadata = {
      externalId,
      title: `Review ${externalId}`,
      startTime,
      endTime: "2026-04-01T03:00:00.000Z",
    };
    const importer = createImporter({
      prisma,
      meetingService,
      clientFactory: () => ({
        listMeetings: async () => ({ items: [metadata] }),
        getContent: async () => ({
          summary: "Imported summary evidence",
          attachments: [
            {
              externalFileId: `original-${externalId}`,
              name: "tencent-original.txt",
              buffer: Buffer.from("read-only Tencent original"),
            },
          ],
          capabilities: {},
        }),
      }),
      sourceService,
      configService: { getPrivate: async () => ({}) },
    });
    const job = await importer.queue(
      connectionId,
      externalId,
      { startTime, endTime: "2026-04-02T02:00:00.000Z" },
      7
    );
    return importer.process(job);
  }

  test("legacy revision persists trusted auth context and completes through the job runner", async () => {
    const { createMeetingRuntime } = require("../../modules/meetings/runtime");
    const originalEngine = process.env.EMBEDDING_ENGINE;
    process.env.EMBEDDING_ENGINE = "native";
    const runtime = createMeetingRuntime({
      prisma,
      encryption: { encrypt: (value) => value, decrypt: (value) => value },
      getEmbedder: () => ({
        model: "legacy-revision-integration",
        embedChunks: async (texts) => texts.map(() => [1, 0]),
        embedTextInput: async () => [1, 0],
      }),
      getVectorDb: () => ({ performSimilaritySearch: async () => ({ sources: [] }) }),
      resolveConnector: async () => ({}),
      storageRoot: path.join(temporaryRoot, "legacy-revision-storage"),
      uploadRoot: path.join(temporaryRoot, "legacy-revision-uploads"),
      audit: async () => {},
    });
    const authState = {
      authenticated: true,
      kind: "LEGACY_MULTI_USER",
      actor: { id: 7, userId: 7 },
      session: null,
      remoteAccessMode: null,
    };

    try {
      const meeting = await runtime.meetings.createMetadata(
        {
          connectionId,
          externalId: "legacy-revision-worker",
          title: "Legacy revision worker",
          startTime: "2026-04-03T02:00:00.000Z",
        },
        7
      );
      const revised = await runtime.meetings.revise(
        meeting.id,
        { summary: "Persist this revised decision." },
        7,
        authState
      );
      const job = await prisma.meeting_jobs.findFirst({
        where: { meetingId: meeting.id, kind: "REINDEX" },
      });

      expect(revised.retrievalStatus).toBe("INDEXING");
      expect(JSON.parse(job.payload).authContext).toEqual({
        kind: "LEGACY_MULTI_USER",
        userId: 7,
      });
      await expect(runtime.jobs.runOnce()).resolves.toBe(true);
      await expect(
        prisma.meeting_jobs.findUnique({ where: { id: job.id } })
      ).resolves.toMatchObject({ status: "SUCCESS", error: null });
      await expect(
        prisma.meetings.findUnique({ where: { id: meeting.id } })
      ).resolves.toMatchObject({ retrievalStatus: "AVAILABLE" });
    } finally {
      await runtime.stop();
      if (originalEngine === undefined) delete process.env.EMBEDDING_ENGINE;
      else process.env.EMBEDDING_ENGINE = originalEngine;
    }
  }, 120_000);

  async function createMetadataMeeting(externalId) {
    return meetingService.createMetadata(
      {
        connectionId,
        externalId,
        title: `Review ${externalId}`,
        startTime: "2026-04-01T02:00:00.000Z",
      },
      7
    );
  }

  test("retains deleted upload identity and rejects approved same-content reupload", async () => {
    const imported = await makeMeeting("history-guard");
    const meetingId = imported.id;
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("AVAILABLE");
    const original = await prisma.meeting_sources.findFirst({
      where: { meetingId, sourceType: "TENCENT_ORIGINAL" },
    });
    await expect(
      sourceService.remove(meetingId, original.id, 7)
    ).rejects.toMatchObject({
      code: "SOURCE_IMMUTABLE",
    });

    const oldContent = Buffer.from("first effective supplement");
    const first = await sourceService.upload(
      meetingId,
      { name: "first.txt", buffer: oldContent },
      7
    );
    await processLatestSourceJob(meetingId);
    const text = await sourceService.addText(
      meetingId,
      { name: "follow-up", text: "Second effective supplement" },
      7
    );
    await processLatestSourceJob(meetingId);
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .retrievalStatus
    ).toBe("AVAILABLE");
    await meetingService.approve(meetingId, 7);

    const newFile = await sourceService.upload(
      meetingId,
      { name: "new-material.txt", buffer: Buffer.from("a genuinely new file") },
      7
    );
    await processLatestSourceJob(meetingId);
    expect(
      (await prisma.meetings.findUnique({ where: { id: meetingId } }))
        .reviewStatus
    ).toBe("DRAFT");
    await sourceService.remove(meetingId, first.id, 7);
    await processLatestSourceJob(meetingId);
    const archived = await prisma.meeting_sources.findUnique({
      where: { id: first.id },
    });
    expect(archived.deletedAt).toBeInstanceOf(Date);
    expect(fs.existsSync(archived.filePath)).toBe(true);
    await meetingService.approve(meetingId, 7);

    const before = await prisma.meetings.findUnique({
      where: { id: meetingId },
    });
    const activeBefore = await prisma.meeting_sources.findMany({
      where: { meetingId, deletedAt: null },
    });
    await expect(
      sourceService.upload(
        meetingId,
        { name: "renamed-first.txt", buffer: oldContent },
        7
      )
    ).rejects.toMatchObject({ code: "SOURCE_REUPLOAD_REQUIRES_DRAFT" });
    const after = await prisma.meetings.findUnique({
      where: { id: meetingId },
    });
    expect(after).toMatchObject({
      reviewStatus: "APPROVED",
      generation: before.generation,
      retrievalStatus: before.retrievalStatus,
    });
    expect(
      await prisma.meeting_sources.findMany({
        where: { meetingId, deletedAt: null },
      })
    ).toEqual(activeBefore);
    expect(
      await prisma.meeting_sources.findUnique({ where: { id: first.id } })
    ).toMatchObject({
      deletedAt: archived.deletedAt,
      filePath: archived.filePath,
    });
    expect(text.id).not.toBe(newFile.id);

    const draftMeeting = await makeMeeting("draft-reupload");
    const draftFile = await sourceService.upload(
      draftMeeting.id,
      { name: "first-name.txt", buffer: oldContent },
      7
    );
    await processLatestSourceJob(draftMeeting.id);
    await expect(
      sourceService.upload(
        draftMeeting.id,
        { name: "duplicate-name.txt", buffer: oldContent },
        7
      )
    ).rejects.toMatchObject({ code: "SOURCE_DUPLICATE" });
    await sourceService.remove(draftMeeting.id, draftFile.id, 7);
    await processLatestSourceJob(draftMeeting.id);
    const redraftUpload = await sourceService.upload(
      draftMeeting.id,
      { name: "renamed-after-delete.txt", buffer: oldContent },
      7
    );
    expect(redraftUpload.id).not.toBe(draftFile.id);
    await processLatestSourceJob(draftMeeting.id);

    const otherMeeting = await makeMeeting("cross-meeting-duplicate");
    const crossMeetingUpload = await sourceService.upload(
      otherMeeting.id,
      { name: "same-content.txt", buffer: oldContent },
      7
    );
    expect(crossMeetingUpload.contentHash).toBe(first.contentHash);
    await processLatestSourceJob(otherMeeting.id);
  });

  test("enforces the 500 MB limit across files only, without large allocations", async () => {
    const fullMeeting = await createMetadataMeeting("file-limit-full");
    await prisma.meeting_sources.create({
      data: {
        meetingId: fullMeeting.id,
        sourceType: "TENCENT_ORIGINAL",
        name: "synthetic-full-original.txt",
        contentHash: "a".repeat(64),
        activeHash: "tencent:full-original",
        bytes: 500_000_000,
        segments: JSON.stringify([
          {
            text: "Synthetic fixture attachment",
            location: { type: "paragraph", paragraph: 1 },
          },
        ]),
        parseStatus: "SUCCESS",
      },
    });

    await expect(
      sourceService.addText(
        fullMeeting.id,
        { name: "text at file limit", text: "Text remains allowed." },
        7
      )
    ).resolves.toMatchObject({ sourceType: "SUPPLEMENT_TEXT" });
    await processLatestSourceJob(fullMeeting.id);
    await expect(
      sourceService.upload(
        fullMeeting.id,
        { name: "one-byte-over.txt", buffer: Buffer.from("x") },
        7
      )
    ).rejects.toMatchObject({ code: "MEETING_SOURCE_LIMIT" });

    const existingTextMeeting = await createMetadataMeeting(
      "text-outside-file-limit"
    );
    await prisma.meeting_sources.create({
      data: {
        meetingId: existingTextMeeting.id,
        sourceType: "TENCENT_ORIGINAL",
        name: "synthetic-near-limit-original.txt",
        contentHash: "b".repeat(64),
        activeHash: "tencent:near-limit-original",
        bytes: 499_999_999,
        segments: JSON.stringify([
          {
            text: "Synthetic fixture attachment",
            location: { type: "paragraph", paragraph: 1 },
          },
        ]),
        parseStatus: "SUCCESS",
      },
    });
    await prisma.meeting_sources.create({
      data: {
        meetingId: existingTextMeeting.id,
        sourceType: "SUPPLEMENT_TEXT",
        name: "synthetic-large-text-metadata",
        contentHash: "c".repeat(64),
        activeHash: "text:large-metadata",
        bytes: 50_000_000,
        contentText: "Synthetic quota fixture; no large allocation.",
        segments: JSON.stringify([
          {
            text: "Synthetic quota fixture; no large allocation.",
            location: { type: "paragraph", paragraph: 1 },
          },
        ]),
        parseStatus: "SUCCESS",
      },
    });
    await expect(
      sourceService.upload(
        existingTextMeeting.id,
        { name: "one-byte-to-limit.txt", buffer: Buffer.from("x") },
        7
      )
    ).resolves.toMatchObject({ sourceType: "SUPPLEMENT_FILE", bytes: 1 });
    await processLatestSourceJob(existingTextMeeting.id);
  });

  test("captures the current provider profile and OCR settings per operation", async () => {
    await prisma.meeting_jobs.updateMany({
      where: { status: "CREATED" },
      data: {
        status: "FAILED",
        activeKey: null,
        error: "[TEST_FIXTURE_ISOLATION] Prior integration fixture job",
      },
    });
    const { createMeetingRuntime } = require("../../modules/meetings/runtime");
    const originalEngine = process.env.EMBEDDING_ENGINE;
    process.env.EMBEDDING_ENGINE = "native";
    let currentModel = "integration-model-a";
    const runtime = createMeetingRuntime({
      prisma,
      encryption: { encrypt: (value) => value, decrypt: (value) => value },
      getEmbedder: () => ({
        model: currentModel,
        embedChunks: async (texts) => texts.map(() => [1, 0]),
        embedTextInput: async () => [1, 0],
      }),
      getVectorDb: () => ({
        performSimilaritySearch: async () => ({ sources: [] }),
      }),
      resolveConnector: async () => ({
        connector: {
          getChatCompletion: async (messages) => {
            const evidenceText = messages[1].content.match(
              /Current evidence data: (\[[\s\S]*\])$/
            )?.[1];
            const evidence = JSON.parse(evidenceText || "[]");
            return {
              textResponse: JSON.stringify({
                status: "ANSWERED",
                text: evidence[0].quote,
                missingInfo: null,
                citations: [
                  {
                    evidenceId: evidence[0].evidenceId,
                    quote: evidence[0].quote,
                  },
                ],
              }),
            };
          },
        },
      }),
      storageRoot: path.join(temporaryRoot, "runtime-storage"),
      uploadRoot: path.join(temporaryRoot, "runtime-uploads"),
      audit: async () => {},
    });
    const authState = {
      authenticated: true,
      kind: "LEGACY_MULTI_USER",
      actor: { id: 7, userId: 7 },
      session: null,
      remoteAccessMode: null,
    };

    const ocrRequests = [[], []];
    const servers = [];
    const startOcrService = async (index, responseText) => {
      const server = http.createServer((request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
          ocrRequests[index].push({
            url: request.url,
            authorization: request.headers.authorization,
            body: Buffer.concat(chunks),
          });
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              segments: [{ text: responseText, location: { type: "image" } }],
            })
          );
        });
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      servers.push(server);
      return `http://127.0.0.1:${server.address().port}/parse`;
    };
    const runUntil = async (complete) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await complete()) return;
        if (!(await runtime.jobs.runOnce())) break;
      }
      throw new Error("Expected runtime job did not complete");
    };

    try {
      const metadataMeeting = await runtime.meetings.createMetadata(
        {
          connectionId,
          externalId: "runtime-profile",
          title: "Runtime profile",
          startTime: "2026-04-02T02:00:00.000Z",
        },
        7
      );
      const source = await runtime.upload(
        metadataMeeting.id,
        { name: "profile.txt", buffer: Buffer.from("profile decision") },
        7,
        authState
      );
      await runUntil(async () => {
        const current = await prisma.meeting_sources.findUnique({
          where: { id: source.id },
        });
        return current.parseStatus === "SUCCESS";
      });
      const initialChunk = await prisma.meeting_chunks.findFirst({
        where: { sourceId: source.id },
      });
      expect(JSON.parse(initialChunk.embedding).profileId).toBe(
        "native:integration-model-a"
      );
      await runtime.meetings.approve(metadataMeeting.id, 7);
      const conversation = await runtime.qa.createConversation(
        { meetingIds: [metadataMeeting.id], workspaceIds: [] },
        7,
        authState
      );

      currentModel = "integration-model-b";
      await expect(
        runtime.qa.ask(conversation.id, { question: "What was decided?" }, 7, authState)
      ).rejects.toMatchObject({ code: "EMBEDDING_PROFILE_MISMATCH" });
      const rebuild = await runtime.requestReindex(metadataMeeting.id, 7, authState);
      expect(JSON.parse(rebuild.payload)).toMatchObject({
        manual: true,
        profileId: "native:integration-model-b",
        authContext: { kind: "LEGACY_MULTI_USER", userId: 7 },
      });
      await runUntil(async () => {
        const current = await prisma.meeting_jobs.findUnique({
          where: { id: rebuild.id },
        });
        return current.status === "SUCCESS";
      });
      const rebuiltChunk = await prisma.meeting_chunks.findFirst({
        where: { sourceId: source.id },
      });
      expect(JSON.parse(rebuiltChunk.embedding).profileId).toBe(
        "native:integration-model-b"
      );
      await expect(
        runtime.qa.ask(conversation.id, { question: "What was decided?" }, 7, authState)
      ).resolves.toMatchObject({ status: "ANSWERED" });

      const endpointA = await startOcrService(0, "OCR from service A");
      const endpointB = await startOcrService(1, "OCR from service B");
      await runtime.config.save(
        {
          id: connectionId,
          name: "Synthetic Tencent",
          services: { ocr: { url: endpointA, token: "synthetic-token-A" } },
        },
        7
      );
      const firstScan = await runtime.upload(
        metadataMeeting.id,
        { name: "first-scan.png", buffer: Buffer.from("synthetic image A") },
        7,
        authState
      );
      await runUntil(async () => {
        const current = await prisma.meeting_sources.findUnique({
          where: { id: firstScan.id },
        });
        return current.parseStatus === "SUCCESS";
      });
      await runtime.config.save(
        {
          id: connectionId,
          name: "Synthetic Tencent",
          services: { ocr: { url: endpointB, token: "synthetic-token-B" } },
        },
        7
      );
      const secondScan = await runtime.upload(
        metadataMeeting.id,
        { name: "second-scan.png", buffer: Buffer.from("synthetic image B") },
        7,
        authState
      );
      await runUntil(async () => {
        const current = await prisma.meeting_sources.findUnique({
          where: { id: secondScan.id },
        });
        return current.parseStatus === "SUCCESS";
      });

      expect(ocrRequests[0]).toHaveLength(1);
      expect(ocrRequests[0][0]).toMatchObject({
        url: "/parse",
        authorization: "Bearer synthetic-token-A",
      });
      expect(ocrRequests[1]).toHaveLength(1);
      expect(ocrRequests[1][0]).toMatchObject({
        url: "/parse",
        authorization: "Bearer synthetic-token-B",
      });
      expect(
        JSON.parse(
          (
            await prisma.meeting_sources.findUnique({
              where: { id: firstScan.id },
            })
          ).segments
        )[0].text
      ).toBe("OCR from service A");
      expect(
        JSON.parse(
          (
            await prisma.meeting_sources.findUnique({
              where: { id: secondScan.id },
            })
          ).segments
        )[0].text
      ).toBe("OCR from service B");
    } finally {
      await runtime.stop();
      await Promise.all(
        servers.map((server) => new Promise((resolve) => server.close(resolve)))
      );
      if (originalEngine == null) delete process.env.EMBEDDING_ENGINE;
      else process.env.EMBEDDING_ENGINE = originalEngine;
    }
  }, 30_000);

  test("runtime reindex failure marks the current meeting INDEX_FAILED", async () => {
    await prisma.meeting_jobs.updateMany({
      where: { status: "CREATED" },
      data: {
        status: "FAILED",
        activeKey: null,
        error: "[TEST_FIXTURE_ISOLATION] Prior integration fixture job",
      },
    });
    const { createMeetingRuntime } = require("../../modules/meetings/runtime");
    const originalEngine = process.env.EMBEDDING_ENGINE;
    process.env.EMBEDDING_ENGINE = "native";
    let failEmbedding = false;
    const runtime = createMeetingRuntime({
      prisma,
      encryption: { encrypt: (value) => value, decrypt: (value) => value },
      getEmbedder: () => ({
        model: "runtime-reindex-failure",
        embedChunks: async (texts) => {
          if (failEmbedding) throw new Error("embedding unavailable");
          return texts.map(() => [1, 0]);
        },
        embedTextInput: async () => [1, 0],
      }),
      getVectorDb: () => ({ performSimilaritySearch: async () => ({ sources: [] }) }),
      resolveConnector: async () => ({ connector: {} }),
      storageRoot: path.join(temporaryRoot, "runtime-reindex-storage"),
      uploadRoot: path.join(temporaryRoot, "runtime-reindex-uploads"),
      audit: async () => {},
    });
    const authState = {
      authenticated: true,
      kind: "LEGACY_MULTI_USER",
      actor: { id: 7, userId: 7 },
      session: null,
      remoteAccessMode: null,
    };
    try {
      const meeting = await runtime.meetings.createMetadata(
        {
          connectionId,
          externalId: "runtime-reindex-failure",
          title: "Runtime reindex failure",
          startTime: "2026-04-03T02:00:00.000Z",
        },
        7
      );
      const source = await runtime.upload(
        meeting.id,
        { name: "reindex.txt", buffer: Buffer.from("reindex evidence") },
        7,
        authState
      );
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (
          (await prisma.meeting_sources.findUnique({ where: { id: source.id } }))
            .parseStatus === "SUCCESS"
        )
          break;
        if (!(await runtime.jobs.runOnce())) break;
      }
      failEmbedding = true;
      const reindex = await runtime.requestReindex(meeting.id, 7, authState);
      await expect(runtime.jobs.runOnce()).rejects.toThrow(
        "Configured embedding service request failed"
      );
      expect(
        await prisma.meeting_jobs.findUnique({ where: { id: reindex.id } })
      ).toMatchObject({ status: "FAILED" });
      expect(
        await prisma.meetings.findUnique({ where: { id: meeting.id } })
      ).toMatchObject({ retrievalStatus: "INDEX_FAILED" });

      failEmbedding = false;
      const superseded = await runtime.requestReindex(meeting.id, 7, authState);
      await prisma.meetings.update({
        where: { id: meeting.id },
        data: {
          generation: JSON.parse(superseded.payload).generation + 1,
          retrievalStatus: "AVAILABLE",
        },
      });
      await expect(runtime.jobs.runOnce()).resolves.toBe(true);
      expect(
        await prisma.meeting_jobs.findUnique({ where: { id: superseded.id } })
      ).toMatchObject({ status: "SUCCESS" });
      expect(
        await prisma.meetings.findUnique({ where: { id: meeting.id } })
      ).toMatchObject({ retrievalStatus: "AVAILABLE" });
    } finally {
      failEmbedding = false;
      if (originalEngine === undefined) delete process.env.EMBEDDING_ENGINE;
      else process.env.EMBEDDING_ENGINE = originalEngine;
    }
  });
});
