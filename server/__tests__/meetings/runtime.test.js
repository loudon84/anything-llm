const {
  createWorkspaceSearchAdapter,
  workspaceLocation,
  createBoundedSseSink,
} = require("../../modules/meetings/runtime");
const { Chroma } = require("../../utils/vectorDbProviders/chroma");
const { OpenAiLLM } = require("../../utils/AiProviders/openAi");

describe("real Workspace provider projection adapter", () => {
  test("maps provider vector IDs to current document membership and emits distinct chunk evidence IDs", async () => {
    const document = {
      docId: "real-doc-7",
      workspaceId: 3,
      filename: "decision.pdf",
      metadata: JSON.stringify({ workspaceOriginalId: "retained-uuid" }),
      lastUpdatedAt: new Date("2026-10-10T00:00:00Z"),
    };
    const vectorRows = [
      { vectorId: "vector-chunk-1", docId: "real-doc-7" },
      { vectorId: "vector-chunk-2", docId: "real-doc-7" },
    ];
    const prisma = {
      document_vectors: {
        findMany: async ({ where }) =>
          vectorRows.filter((row) =>
            where.vectorId
              ? row.vectorId === where.vectorId
              : row.docId === where.docId
          ),
      },
      workspace_documents: {
        findFirst: async ({ where }) =>
          where.docId === document.docId &&
          where.workspaceId === document.workspaceId
            ? document
            : null,
      },
    };
    const vectorDb = {
      performSimilaritySearch: async ({
        namespace,
        input,
        LLMConnector,
        topN,
      }) => {
        expect(namespace).toBe("legal-workspace");
        expect(input).toBe("what changed?");
        expect(await LLMConnector.embedTextInput(input)).toEqual([1, 0]);
        expect(topN).toBe(10);
        // This matches the real provider projection: a flattened metadata object
        // whose id is the vector/chunk id, not workspace_documents.docId.
        return {
          sources: [
            {
              id: "vector-chunk-1",
              text: "First chunk from the decision.",
              type: "page",
              page: 4,
            },
            {
              id: "vector-chunk-2",
              text: "Second chunk from the same decision.",
            },
          ],
        };
      },
    };
    const originals = {
      resolve: async ({ referenceId, workspaceId, docId }) =>
        referenceId === "retained-uuid" &&
        workspaceId === 3 &&
        docId === "real-doc-7"
          ? { filePath: "C:/private/original.pdf", fileName: "decision.pdf" }
          : null,
    };
    const search = createWorkspaceSearchAdapter({
      prisma,
      vectorDb,
      embedder: { embedTextInput: async () => [1, 0] },
      originals,
      lookupDocument: async () => ({ revision: "a".repeat(64) }),
    });
    const evidence = await search({
      workspace: { id: 3, slug: "legal-workspace" },
      userId: 9,
      question: "what changed?",
    });
    expect(evidence).toHaveLength(2);
    expect(evidence.map((item) => item.evidenceId)).toEqual([
      "vector:vector-chunk-1",
      "vector:vector-chunk-2",
    ]);
    expect(evidence.map((item) => item.documentId)).toEqual([
      "real-doc-7",
      "real-doc-7",
    ]);
    expect(evidence[0].revision).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence[0].link).toBe(
      "/api/meetings/workspaces/3/sources/real-doc-7/file"
    );
    expect(evidence[0].location).toEqual({ type: "page", page: 4 });
    expect(evidence[1].quote).toBe("Second chunk from the same decision.");
  });

  test("preserves only supported Workspace locator metadata", () => {
    expect(
      workspaceLocation({
        locationType: "cell",
        sheet: "Forecast",
        cell: "C8",
        secret: "must not escape",
      })
    ).toEqual({ type: "cell", sheet: "Forecast", cell: "C8" });
    expect(workspaceLocation({ type: "unknown", page: 4 })).toBeNull();
    expect(
      workspaceLocation({ location: { type: "transcript", startMs: 20 } })
    ).toEqual({ type: "transcript", startMs: 20 });
  });

  test("maps actual Chroma response.ids to document_vectors membership", async () => {
    const records = [
      { docId: "real-doc-8", vectorId: "chroma-vector-1" },
      { docId: "real-doc-8", vectorId: "chroma-vector-2" },
    ];
    const collection = {
      query: async () => ({
        ids: [["chroma-vector-1", "chroma-vector-2"]],
        distances: [[0.1, 0.2]],
        metadatas: [
          [
            { id: "parsed-document-id", page: 2, type: "page" },
            { id: "parsed-document-id", page: 3, type: "page" },
          ],
        ],
        documents: [["Chroma first chunk.", "Chroma second chunk."]],
      }),
    };
    const chroma = new Chroma();
    chroma.connect = async () => ({
      client: { getCollection: async () => collection },
    });
    chroma.namespaceExists = async () => true;
    const document = {
      docId: "real-doc-8",
      workspaceId: 4,
      filename: "real-document.pdf",
      metadata: "{}",
      lastUpdatedAt: new Date("2026-10-13T00:00:00Z"),
    };
    const prisma = {
      document_vectors: {
        findMany: async ({ where }) =>
          records.filter((row) =>
            where.vectorId
              ? row.vectorId === where.vectorId
              : row.docId === where.docId
          ),
      },
      workspace_documents: {
        findFirst: async ({ where }) =>
          where.docId === document.docId && where.workspaceId === 4
            ? document
            : null,
      },
    };
    const search = createWorkspaceSearchAdapter({
      prisma,
      vectorDb: chroma,
      embedder: { embedTextInput: async () => [1, 0] },
      lookupDocument: async () => ({ revision: "current-revision" }),
    });

    const evidence = await search({
      workspace: { id: 4, slug: "chroma-workspace" },
      userId: 10,
      question: "What changed?",
    });

    expect(evidence.map((item) => item.evidenceId)).toEqual([
      "vector:chroma-vector-1",
      "vector:chroma-vector-2",
    ]);
    expect(evidence.map((item) => item.documentId)).toEqual([
      "real-doc-8",
      "real-doc-8",
    ]);
    expect(evidence.map((item) => item.quote)).toEqual([
      "Chroma first chunk.",
      "Chroma second chunk.",
    ]);
  });
});

function runtimePrismaFixture() {
  const profileId = `${process.env.EMBEDDING_ENGINE || "native"}:runtime-test`;
  const meeting = {
    id: 1,
    connectionId: 1,
    generation: 1,
    retrievalStatus: "AVAILABLE",
    reviewStatus: "DRAFT",
    coverage: "FULL",
    deletedAt: null,
    updatedAt: new Date("2026-10-14T00:00:00Z"),
  };
  const source = {
    id: 1,
    meetingId: 1,
    sourceType: "SUPPLEMENT_TEXT",
    name: "decision.txt",
    contentHash: "decision-hash",
    activeHash: "decision-active-hash",
    parseStatus: "SUCCESS",
    deletedAt: null,
    updatedAt: new Date("2026-10-14T00:00:00Z"),
  };
  const chunk = {
    id: 1,
    meetingId: 1,
    sourceId: 1,
    text: "The approved plan starts in May.",
    location: JSON.stringify({ type: "paragraph", paragraph: 0 }),
    embedding: JSON.stringify({ profileId, vector: [1, 0] }),
    generation: 1,
  };
  const conversations = [];
  const answers = [];
  const prisma = {
    meetings: {
      findMany: async ({ where = {} } = {}) => {
        if (where.id?.in && !where.id.in.includes(meeting.id)) return [];
        if (
          where.retrievalStatus &&
          meeting.retrievalStatus !== where.retrievalStatus
        )
          return [];
        if (where.deletedAt === null && meeting.deletedAt !== null) return [];
        return [{ ...meeting }];
      },
      findUnique: async ({ where }) =>
        where.id === meeting.id ? { ...meeting } : null,
    },
    meeting_sources: {
      findMany: async ({ where = {} } = {}) => {
        const meetingIds = where.meetingId?.in;
        if (meetingIds && !meetingIds.includes(source.meetingId)) return [];
        if (
          Number.isInteger(where.meetingId) &&
          where.meetingId !== source.meetingId
        )
          return [];
        if (where.deletedAt === null && source.deletedAt !== null) return [];
        if (where.parseStatus && source.parseStatus !== where.parseStatus)
          return [];
        return [{ ...source }];
      },
    },
    meeting_chunks: {
      findMany: async ({ where = {} } = {}) => {
        const meetingIds = where.meetingId?.in;
        const sourceIds = where.sourceId?.in;
        if (meetingIds && !meetingIds.includes(chunk.meetingId)) return [];
        if (
          Number.isInteger(where.meetingId) &&
          where.meetingId !== chunk.meetingId
        )
          return [];
        if (sourceIds && !sourceIds.includes(chunk.sourceId)) return [];
        return [{ ...chunk }];
      },
    },
    meeting_conversations: {
      create: async ({ data }) => {
        const row = {
          id: conversations.length + 1,
          createdAt: new Date(),
          ...data,
        };
        conversations.push(row);
        return row;
      },
      findUnique: async ({ where }) =>
        conversations.find((row) => row.id === where.id) || null,
    },
    meeting_answers: {
      rows: answers,
      create: async ({ data }) => {
        const row = { id: answers.length + 1, createdAt: new Date(), ...data };
        answers.push(row);
        return row;
      },
      findUnique: async ({ where }) =>
        answers.find((row) => row.id === where.id) || null,
      findMany: async ({ where }) =>
        answers.filter((row) => row.conversationId === where.conversationId),
    },
    meeting_connections: { findUnique: async () => null },
    meeting_jobs: { findMany: async () => [] },
    users: {
      findUnique: async ({ where }) => ({ id: where.id, role: "default" }),
    },
    $transaction: async (callback) => callback(prisma),
  };
  return { prisma, meeting, source, chunk, profileId };
}

function runtimeFixture(connector) {
  const { createMeetingRuntime } = require("../../modules/meetings/runtime");
  const { prisma } = runtimePrismaFixture();
  const runtime = createMeetingRuntime({
    prisma,
    encryption: { encrypt: (value) => value, decrypt: (value) => value },
    getEmbedder: () => ({
      model: "runtime-test",
      embedChunks: async (texts) => texts.map(() => [1, 0]),
      embedTextInput: async () => [1, 0],
    }),
    getVectorDb: () => ({
      performSimilaritySearch: async () => ({ sources: [] }),
    }),
    resolveConnector: async () => ({ connector }),
    audit: async () => {},
  });
  return { runtime, prisma };
}

describe("runtime provider-to-QA boundary", () => {
  const validAnswer = JSON.stringify({
    status: "ANSWERED",
    text: "The approved plan starts in May.",
    missingInfo: null,
    citations: [
      { evidenceId: "meeting:1", quote: "The approved plan starts in May." },
    ],
  });

  test("passes valid provider JSON through QA's grounded validator", async () => {
    const connector = {
      getChatCompletion: async () => ({ textResponse: validAnswer }),
    };
    const { runtime } = runtimeFixture(connector);
    const conversation = await runtime.qa.createConversation(
      { meetingIds: [1] },
      8
    );

    const answer = await runtime.qa.ask(
      conversation.id,
      { question: "When does the approved plan start?" },
      8
    );

    expect(answer.status).toBe("ANSWERED");
    expect(answer.text).toBe("The approved plan starts in May.");
    expect(answer.citations[0]).toMatchObject({
      evidenceId: "meeting:1",
      quote: "The approved plan starts in May.",
    });
  });

  test("an actual OpenAI handler abort that resolves valid JSON stays incomplete", async () => {
    const connector = {
      streamingEnabled: () => true,
      streamGetChatCompletion: async () => {
        const stream = (async function* () {
          yield { type: "response.output_text.delta", delta: validAnswer };
          throw Object.assign(new Error("cancelled"), { name: "AbortError" });
        })();
        stream.endMeasurement = jest.fn();
        return stream;
      },
      handleStream: OpenAiLLM.prototype.handleStream,
    };
    const { runtime, prisma } = runtimeFixture(connector);
    const conversation = await runtime.qa.createConversation(
      { meetingIds: [1] },
      8
    );

    const answer = await runtime.qa.ask(
      conversation.id,
      { question: "When does the approved plan start?" },
      8
    );

    expect(answer.status).toBe("FAILED_INCOMPLETE");
    expect(answer.text).toBe(validAnswer);
    expect(prisma.meeting_answers.rows[0].status).toBe("FAILED_INCOMPLETE");
  });

  test("SSE capture keeps only bounded state while processing many chunks", () => {
    const { sink, state } = createBoundedSseSink({
      maxBufferedBytes: 256,
      maxPartialBytes: 128,
    });
    for (let index = 0; index < 500; index += 1) {
      sink.write(
        `data: ${JSON.stringify({
          type: "textResponseChunk",
          textResponse: "x",
          close: false,
          error: false,
        })}\n\n`
      );
    }
    sink.write(
      `data: ${JSON.stringify({
        type: "textResponseChunk",
        textResponse: "",
        close: true,
        error: false,
      })}\n\n`
    );
    expect(state.completed).toBe(true);
    expect(state.failed).toBe(false);
    expect(state.partialText).toBe("x".repeat(128));
    expect(state.peakBufferedBytes).toBeLessThanOrEqual(256);
    expect(state.events).toBeUndefined();
  });
});
