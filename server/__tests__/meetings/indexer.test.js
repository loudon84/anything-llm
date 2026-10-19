const { createIndexer } = require("../../modules/meetings/indexer");

function prismaFor({ meetings, chunks, sources }) {
  return {
    meetings: {
      findMany: async ({ where }) =>
        meetings.filter(
          (meeting) =>
            where.id.in.includes(meeting.id) &&
            meeting.deletedAt == null &&
            meeting.retrievalStatus === "AVAILABLE"
        ),
    },
    meeting_sources: {
      findMany: async ({ where }) =>
        sources.filter(
          (source) =>
            where.meetingId.in.includes(source.meetingId) &&
            source.deletedAt == null &&
            source.parseStatus === "SUCCESS"
        ),
    },
    meeting_chunks: {
      findMany: async ({ where }) =>
        chunks.filter(
          (chunk) =>
            where.meetingId.in.includes(chunk.meetingId) &&
            where.sourceId.in.includes(chunk.sourceId)
        ),
    },
  };
}

describe("located meeting chunk index", () => {
  test("source changes during reindex preserve the trusted initiator on follow-up work", async () => {
    const meeting = {
      id: 1,
      generation: 2,
      retrievalStatus: "INDEXING",
      deletedAt: null,
      connectionId: 3,
      externalId: "meeting-1",
      quarter: "2026-Q2",
    };
    const firstSource = {
      id: 10,
      meetingId: 1,
      contentHash: "one",
      parseStatus: "SUCCESS",
      deletedAt: null,
      contentText: "first source",
      segments: JSON.stringify([{ text: "first source", location: { type: "paragraph", paragraph: 0 } }]),
    };
    const changedSource = {
      ...firstSource,
      id: 11,
      contentHash: "two",
      contentText: "new source",
      segments: JSON.stringify([{ text: "new source", location: { type: "paragraph", paragraph: 0 } }]),
    };
    let sourceReads = 0;
    let queuedJob;
    const tx = {
      meetings: { findUnique: async () => meeting, update: async () => {} },
      meeting_sources: {
        findMany: async () => {
          sourceReads += 1;
          return sourceReads <= 2 ? [firstSource] : [firstSource, changedSource];
        },
      },
      meeting_chunks: { deleteMany: async () => {}, create: async () => {} },
      meeting_jobs: {
        findFirst: async () => null,
        create: async ({ data }) => { queuedJob = data; return data; },
      },
    };
    const prisma = {
      meetings: tx.meetings,
      meeting_sources: tx.meeting_sources,
      $transaction: async (callback) => callback(tx),
    };
    const authContext = { kind: "LEGACY_MULTI_USER", userId: 7 };
    const indexer = createIndexer({
      prisma,
      embedder: { embedDocuments: async (texts) => texts.map(() => [1, 0]) },
    });

    await expect(
      indexer.reindex(1, {
        job: { payload: JSON.stringify({ generation: 2, authContext }) },
      })
    ).resolves.toMatchObject({ stale: true, sourceSetChanged: true });

    expect(JSON.parse(queuedJob.payload).authContext).toEqual(authContext);
  });

  test("reindex preserves ownership when an earlier source segment splits", async () => {
    const meeting = {
      id: 1,
      generation: 2,
      retrievalStatus: "INDEXING",
      deletedAt: null,
      summary: null,
      transcript: null,
    };
    const sources = [
      {
        id: 10,
        meetingId: 1,
        sourceType: "SUPPLEMENT_TEXT",
        contentHash: "a",
        parseStatus: "SUCCESS",
        deletedAt: null,
        segments: JSON.stringify([
          {
            text: "one two three four",
            location: { type: "paragraph", paragraph: 0 },
          },
        ]),
      },
      {
        id: 11,
        meetingId: 1,
        sourceType: "SUPPLEMENT_TEXT",
        contentHash: "b",
        parseStatus: "SUCCESS",
        deletedAt: null,
        segments: JSON.stringify([
          {
            text: "next source",
            location: { type: "paragraph", paragraph: 0 },
          },
        ]),
      },
    ];
    const inserted = [];
    const tx = {
      meetings: {
        findUnique: async () => meeting,
        update: async ({ data }) => Object.assign(meeting, data),
      },
      meeting_sources: { findMany: async () => sources },
      meeting_chunks: {
        deleteMany: async () => {},
        create: async ({ data }) => inserted.push(data),
      },
    };
    const prisma = {
      ...tx,
      $transaction: async (callback) => callback(tx),
    };
    const indexer = createIndexer({
      prisma,
      embedder: { embedDocuments: async (texts) => texts.map(() => [1, 0]) },
      chunkCharacters: 8,
    });
    await indexer.reindex(1);
    expect(
      inserted.filter((chunk) => chunk.sourceId === 10).map((c) => c.text)
    ).toEqual(["one two", "three", "four"]);
    expect(
      inserted.filter((chunk) => chunk.sourceId === 11).map((c) => c.text)
    ).toEqual(["next", "source"]);
  });

  test("embeds bounded chunks while preserving source locator", async () => {
    const embedder = {
      embedDocuments: async (texts) => texts.map(() => [1, 0]),
    };
    const indexer = createIndexer({ prisma: {}, embedder, chunkCharacters: 8 });
    const prepared = await indexer.prepare([
      { text: "one two three", location: { type: "page", page: 4 } },
    ]);
    expect(prepared.map((chunk) => chunk.text)).toEqual(["one two", "three"]);
    expect(prepared.every((chunk) => chunk.location.page === 4)).toBe(true);
    expect(prepared.every((chunk) => chunk.embedding.length === 2)).toBe(true);
  });

  test("rejects missing embedder and empty located segments", async () => {
    await expect(
      createIndexer({ prisma: {} }).prepare([
        { text: "x", location: { type: "paragraph", paragraph: 0 } },
      ])
    ).rejects.toMatchObject({ code: "EMBEDDER_UNCONFIGURED" });
    const indexer = createIndexer({
      prisma: {},
      embedder: { embedDocuments: async () => [] },
    });
    await expect(indexer.prepare([])).rejects.toMatchObject({
      code: "INDEX_CONTENT_EMPTY",
    });
  });

  test("rejects mixed dimensions within one document embedding batch", async () => {
    const indexer = createIndexer({
      prisma: {},
      embedder: {
        embedDocuments: async () => [
          [1, 0],
          [1, 0, 0],
        ],
      },
      chunkCharacters: 5,
    });
    await expect(
      indexer.prepare([
        { text: "first", location: { type: "paragraph", paragraph: 0 } },
        { text: "second", location: { type: "paragraph", paragraph: 1 } },
      ])
    ).rejects.toMatchObject({ code: "EMBEDDING_VECTOR_INVALID" });
  });

  test("searches only current chunks from selected available meetings", async () => {
    const meetings = [
      {
        id: 1,
        title: "Quarterly Planning",
        startTime: new Date("2026-05-18T09:30:00Z"),
        retrievalStatus: "AVAILABLE",
        deletedAt: null,
        reviewStatus: "DRAFT",
        coverage: "{}",
        generation: 4,
      },
      { id: 2, retrievalStatus: "WAITING_CONTENT", deletedAt: null },
    ];
    const sources = [
      {
        id: 10,
        meetingId: 1,
        sourceType: "SUPPLEMENT_TEXT",
        name: "notes",
        parseStatus: "SUCCESS",
        deletedAt: null,
      },
      {
        id: 11,
        meetingId: 1,
        sourceType: "SUPPLEMENT_FILE",
        name: "removed",
        parseStatus: "SUCCESS",
        deletedAt: new Date(),
      },
    ];
    const chunks = [
      {
        id: 100,
        meetingId: 1,
        sourceId: 10,
        text: "approved plan",
        location: JSON.stringify({ type: "paragraph", paragraph: 2 }),
        embedding: "[1,0]",
        generation: 4,
      },
      {
        id: 101,
        meetingId: 1,
        sourceId: 10,
        text: "outdated",
        location: "{}",
        embedding: "[1,0]",
        generation: 3,
      },
      {
        id: 102,
        meetingId: 1,
        sourceId: 11,
        text: "deleted",
        location: "{}",
        embedding: "[1,0]",
        generation: 4,
      },
    ];
    const db = prismaFor({ meetings, chunks, sources });
    const embedder = {
      embedQuery: async (question) => {
        expect(question).toBe("What plan?");
        return [1, 0];
      },
    };
    const indexer = createIndexer({ prisma: db, embedder });
    const result = await indexer.search([1, 2], "What plan?", 20);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 100,
      meetingId: 1,
      meetingName: "Quarterly Planning",
      meetingStartTime: "2026-05-18T09:30:00.000Z",
      sourceId: 10,
      sourceType: "SUPPLEMENT_TEXT",
      name: "notes",
      text: "approved plan",
      reviewStatus: "DRAFT",
      location: { type: "paragraph", paragraph: 2 },
    });
  });

  test("fails visibly when a current chunk was embedded with another profile or has an invalid vector", async () => {
    const meeting = {
      id: 1,
      retrievalStatus: "AVAILABLE",
      deletedAt: null,
      reviewStatus: "DRAFT",
      coverage: "{}",
      generation: 4,
    };
    const source = {
      id: 10,
      meetingId: 1,
      sourceType: "SUPPLEMENT_TEXT",
      name: "notes",
      parseStatus: "SUCCESS",
      deletedAt: null,
    };
    const chunk = {
      id: 100,
      meetingId: 1,
      sourceId: 10,
      text: "old model",
      location: "{}",
      embedding: JSON.stringify({ profileId: "model-a", vector: [1, 0] }),
      generation: 4,
    };
    const db = prismaFor({
      meetings: [meeting],
      sources: [source],
      chunks: [chunk],
    });
    const indexer = createIndexer({
      prisma: db,
      embedder: { profileId: "model-b", embedQuery: async () => [1, 0] },
    });
    await expect(indexer.search([1], "question")).rejects.toMatchObject({
      code: "EMBEDDING_PROFILE_MISMATCH",
    });
    chunk.embedding = JSON.stringify({ profileId: "model-b", vector: [0, 0] });
    await expect(indexer.search([1], "question")).rejects.toMatchObject({
      code: "EMBEDDING_VECTOR_INVALID",
    });
    chunk.embedding = JSON.stringify({ vector: [1, 0] });
    await expect(indexer.search([1], "question")).rejects.toMatchObject({
      code: "EMBEDDING_PROFILE_MISMATCH",
    });
  });

  test("does not publish an AVAILABLE index when one source batch mixes dimensions", async () => {
    const meeting = {
      id: 1,
      generation: 3,
      retrievalStatus: "INDEXING",
      deletedAt: null,
      summary: null,
      transcript: null,
    };
    const sources = [
      {
        id: 10,
        meetingId: 1,
        sourceType: "SUPPLEMENT_TEXT",
        contentHash: "a",
        contentText: "first second",
        parseStatus: "SUCCESS",
        deletedAt: null,
        segments: JSON.stringify([
          { text: "first", location: { type: "paragraph", paragraph: 0 } },
          { text: "second", location: { type: "paragraph", paragraph: 1 } },
        ]),
      },
    ];
    const inserted = [];
    const tx = {
      meetings: {
        findUnique: async () => meeting,
        update: async ({ data }) => Object.assign(meeting, data),
      },
      meeting_sources: { findMany: async () => sources },
      meeting_chunks: {
        deleteMany: async () => {},
        create: async ({ data }) => inserted.push(data),
      },
    };
    const indexer = createIndexer({
      prisma: { ...tx, $transaction: async (callback) => callback(tx) },
      embedder: {
        profileId: "model-a",
        embedDocuments: async () => [
          [1, 0],
          [1, 0, 0],
        ],
      },
      chunkCharacters: 20,
    });
    await expect(indexer.reindex(1)).rejects.toMatchObject({
      code: "EMBEDDING_VECTOR_INVALID",
    });
    expect(inserted).toHaveLength(0);
    expect(meeting.retrievalStatus).toBe("INDEXING");
  });

  test("rejects a missing query embedding operation", async () => {
    const indexer = createIndexer({
      prisma: {},
      embedder: { embedDocuments: async () => [] },
    });
    await expect(indexer.search([1], "question")).rejects.toMatchObject({
      code: "EMBEDDER_UNCONFIGURED",
    });
  });
});
