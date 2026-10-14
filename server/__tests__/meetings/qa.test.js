const { createQAService } = require("../../modules/meetings/qa");
const {
  createWorkspaceRetriever,
} = require("../../modules/meetings/retrieval");
const { createIndexer } = require("../../modules/meetings/indexer");

function fakePrisma({ meetingRows, sourceRows, chunkRows } = {}) {
  const meetings = meetingRows || [];
  const sources = sourceRows || [];
  const chunks = chunkRows || [];
  const conversations = [];
  const answers = [];
  const fake = {
    meetings: {
      findMany: async ({ where }) =>
        meetings.filter((row) => where.id.in.includes(row.id)),
      findUnique: async ({ where }) =>
        meetings.find((row) => row.id === where.id) || null,
    },
    meeting_sources: {
      findMany: async ({ where }) =>
        sources.filter(
          (row) => row.meetingId === where.meetingId && row.deletedAt == null
        ),
    },
    meeting_chunks: {
      findMany: async ({ where }) =>
        chunks.filter((row) => row.meetingId === where.meetingId),
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
      create: async ({ data }) => {
        const row = { id: answers.length + 1, createdAt: new Date(), ...data };
        answers.push(row);
        return row;
      },
      findMany: async ({ where }) =>
        answers.filter((row) => row.conversationId === where.conversationId),
      findUnique: async ({ where }) =>
        answers.find((row) => row.id === where.id) || null,
    },
    $transaction: async (callback) => callback(fake),
    _conversations: conversations,
    _answers: answers,
    _sources: sources,
    _chunks: chunks,
  };
  return fake;
}

const availableMeeting = (id = 1) => ({
  id,
  generation: 1,
  retrievalStatus: "AVAILABLE",
  reviewStatus: "DRAFT",
  coverage: "FULL",
  deletedAt: null,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const activeSource = (id = 1, meetingId = 1) => ({
  id,
  meetingId,
  sourceType: "SUPPLEMENT_TEXT",
  name: "notes.txt",
  contentHash: `hash-${id}`,
  activeHash: `active-${id}`,
  parseStatus: "SUCCESS",
  deletedAt: null,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const citation = (evidenceId, quote = "The project starts in May.") => ({
  id: 1,
  evidenceId,
  quote,
  meetingId: 1,
  sourceId: 1,
  sourceType: "SUPPLEMENT_TEXT",
  name: "notes.txt",
  location: { type: "paragraph", paragraph: 0 },
  reviewStatus: "DRAFT",
  coverage: "FULL",
});

function setup(overrides = {}) {
  const prisma =
    overrides.prisma ||
    fakePrisma({
      meetingRows: [availableMeeting()],
      sourceRows: [activeSource()],
    });
  const evidence = overrides.evidence || [citation("meeting:chunk:1")];
  const workspaceRetriever = overrides.workspaceRetriever || {
    resolve: async ({ workspaceIds, userId }) =>
      workspaceIds.map((id) => ({ id, userId })),
    search: async () => [],
  };
  const indexer = overrides.indexer || { search: async () => evidence };
  const llm = overrides.llm || {
    generate: async () => ({
      status: "ANSWERED",
      text: "The project starts in May.",
      missingInfo: null,
      citations: [
        {
          evidenceId: evidence[0].id
            ? `meeting:${evidence[0].id}`
            : evidence[0].evidenceId,
          quote: "The project starts in May.",
        },
      ],
    }),
  };
  return {
    prisma,
    service: createQAService({
      prisma,
      indexer,
      workspaceRetriever,
      llm,
      ...overrides,
    }),
    workspaceRetriever,
  };
}

describe("fixed-scope meeting QA and history", () => {
  test("marks saved Workspace citations stale when their current document revision changes", async () => {
    let currentDocument = {
      workspaceId: 2,
      docId: "doc-a",
      lastUpdatedAt: new Date("2026-05-01T00:00:00.000Z"),
    };
    const revision = currentDocument.lastUpdatedAt;
    const retriever = createWorkspaceRetriever({
      lookupWorkspace: async ({ id, userId }) => (userId === 9 ? { id } : null),
      searchWorkspace: async () => [
        {
          evidenceId: "chunk-a",
          workspaceId: 2,
          documentId: "doc-a",
          revision,
          quote: "The Workspace document says May.",
          name: "planning.txt",
        },
      ],
      lookupDocument: async ({ workspace, userId, documentId }) =>
        workspace.id === 2 && userId === 9 && documentId === "doc-a"
          ? currentDocument
          : null,
    });
    const { service } = setup({
      indexer: { search: async () => [] },
      workspaceRetriever: retriever,
      llm: {
        generate: async () => ({
          status: "ANSWERED",
          text: "The Workspace document says May.",
          missingInfo: null,
          citations: [
            {
              evidenceId: "workspace:2:chunk-a",
              quote: "The Workspace document says May.",
            },
          ],
        }),
      },
    });
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    const answer = await service.ask(
      conversation.id,
      { question: "What date?" },
      9
    );
    expect(answer.citations[0].quote).toBe("The Workspace document says May.");
    currentDocument = {
      ...currentDocument,
      lastUpdatedAt: new Date("2026-06-01T00:00:00.000Z"),
    };
    const history = await service.history(conversation.id, 9);
    expect(history.answers[0].stale).toBe(true);
    expect(history.answers[0].citations[0].quote).toBe(
      "The Workspace document says May."
    );
  });

  test("does not call the model when a selected meeting has no current evidence", async () => {
    const llm = { generate: jest.fn() };
    const { service, prisma } = setup({
      indexer: { search: async () => [] },
      llm,
    });
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    const answer = await service.ask(
      conversation.id,
      { question: "When does it start?" },
      9
    );
    expect(answer.status).toBe("AWAITING_SOURCES");
    expect(llm.generate).not.toHaveBeenCalled();
    expect(prisma._answers).toHaveLength(1);
  });

  test("persists immutable scopes, citations, and history with omitted or empty Workspace scope", async () => {
    const { service, prisma } = setup();
    const conversation = await service.createConversation(
      { meetingIds: [1] },
      9
    );
    const emptyWorkspaceConversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [] },
      9
    );
    expect(conversation.workspaceIds).toEqual([]);
    expect(emptyWorkspaceConversation.workspaceIds).toEqual([]);
    await expect(
      service.createConversation({ meetingIds: [1, 2] }, 9)
    ).rejects.toThrow();
    const answer = await service.ask(
      conversation.id,
      { question: "When does it start?", clarification: "Warehouse B" },
      9
    );
    expect(answer.clarification).toBe("Warehouse B");
    prisma.meeting_sources.findMany = async () => [];
    const history = await service.history(conversation.id, 9);
    expect(history.conversation.meetingIds).toEqual([1]);
    expect(history.conversation.workspaceIds).toEqual([]);
    expect(history.answers[0].citations[0].quote).toBe(
      "The project starts in May."
    );
    expect(history.answers[0].clarification).toBe("Warehouse B");
    expect(history.answers[0].stale).toBe(true);
    expect(history.conversation.scopeState.available).toBe(true);
    expect(answer.id).toBe(history.answers[0].id);
  });

  test("creates a new answer row that references the prior answer", async () => {
    const { service, prisma } = setup();
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    const first = await service.ask(conversation.id, { question: "When?" }, 9);
    const second = await service.ask(
      conversation.id,
      { question: "When?", previousAnswerId: first.id },
      9
    );
    expect(second.id).not.toBe(first.id);
    expect(second.previousAnswerId).toBe(first.id);
    expect(prisma._answers).toHaveLength(2);
  });

  test("reuses prior clarification on reanswer unless new conditions are supplied", async () => {
    const llm = {
      generate: jest.fn(async () => ({
        status: "ANSWERED",
        text: "The project starts in May.",
        missingInfo: null,
        citations: [
          { evidenceId: "meeting:1", quote: "The project starts in May." },
        ],
      })),
    };
    const retrievalQueries = [];
    const indexer = {
      search: async (_meetingIds, query) => {
        retrievalQueries.push(query);
        return [citation("current:1")];
      },
    };
    const workspaceRetriever = {
      resolve: async () => [],
      search: async ({ question }) => {
        retrievalQueries.push(question);
        return [];
      },
    };
    const { service, prisma } = setup({ llm, indexer, workspaceRetriever });
    const conversation = await service.createConversation(
      { meetingIds: [1] },
      9
    );
    const prior = await service.ask(
      conversation.id,
      { question: "Which warehouse?", clarification: "Warehouse B only" },
      9
    );
    prisma._answers[0].missingInfo = "Confirm the warehouse city";
    prisma._answers[0].text = "OLD ANSWER FACT MUST NEVER BE PROMPTED";
    prisma._answers[0].citations = JSON.stringify([
      { quote: "OLD CITATION MUST NEVER BE PROMPTED" },
    ]);
    const followup = await service.ask(
      conversation.id,
      { question: "What about that warehouse?", previousAnswerId: prior.id },
      9
    );
    expect(
      retrievalQueries
        .slice(-2)
        .every(
          (query) =>
            query.includes("Which warehouse?") &&
            query.includes("Confirm the warehouse city") &&
            query.includes("Warehouse B only")
        )
    ).toBe(true);
    expect(llm.generate.mock.calls.at(-1)[0].prompt).toContain(
      "Which warehouse?"
    );
    expect(llm.generate.mock.calls.at(-1)[0].prompt).toContain(
      "Confirm the warehouse city"
    );
    expect(llm.generate.mock.calls.at(-1)[0].prompt).toContain(
      "Warehouse B only"
    );
    expect(llm.generate.mock.calls.at(-1)[0].prompt).not.toContain(
      "OLD ANSWER FACT"
    );
    expect(llm.generate.mock.calls.at(-1)[0].prompt).not.toContain(
      "OLD CITATION"
    );
    expect(followup.clarification).toBe("Warehouse B only");

    const changedConditions = await service.ask(
      conversation.id,
      {
        question: "What about that warehouse?",
        previousAnswerId: prior.id,
        clarification: "Warehouse C",
      },
      9
    );
    expect(changedConditions.clarification).toBe("Warehouse C");
    expect(
      retrievalQueries.slice(-2).every((query) => query.includes("Warehouse C"))
    ).toBe(true);
  });

  test("retrieves with clarification before deciding sources are missing", async () => {
    const searchQuestions = [];
    const indexer = {
      search: async (_meetingIds, question) => {
        searchQuestions.push(question);
        return question.includes("Warehouse B") ? [citation("meeting:1")] : [];
      },
    };
    const workspaceRetriever = {
      resolve: async () => [],
      search: async ({ question }) => {
        searchQuestions.push(question);
        return [];
      },
    };
    const llm = {
      generate: jest.fn(async () => ({
        status: "ANSWERED",
        text: "The project starts in May.",
        missingInfo: null,
        citations: [
          { evidenceId: "meeting:1", quote: "The project starts in May." },
        ],
      })),
    };
    const { service } = setup({ indexer, workspaceRetriever, llm });
    const conversation = await service.createConversation(
      { meetingIds: [1] },
      9
    );
    const answer = await service.ask(
      conversation.id,
      { question: "When for that warehouse?", clarification: "Warehouse B" },
      9
    );
    expect(searchQuestions).toHaveLength(2);
    expect(
      searchQuestions.every((query) => query.includes("Warehouse B"))
    ).toBe(true);
    expect(answer.status).toBe("ANSWERED");
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  test("blocks another user's access to a conversation", async () => {
    const { service } = setup();
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    await expect(service.history(conversation.id, 10)).rejects.toMatchObject({
      code: "CONVERSATION_FORBIDDEN",
    });
  });

  test("rechecks Workspace access before returning saved history", async () => {
    let accessible = true;
    const workspaceRetriever = {
      resolve: async () => {
        if (!accessible)
          throw Object.assign(new Error("Workspace access was revoked"), {
            code: "WORKSPACE_FORBIDDEN",
          });
      },
      search: async () => [],
    };
    const { service } = setup({ workspaceRetriever });
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    accessible = false;
    await expect(service.history(conversation.id, 9)).rejects.toMatchObject({
      code: "WORKSPACE_FORBIDDEN",
    });
  });

  test("preserves citation snapshots when a meeting becomes unavailable", async () => {
    const prisma = fakePrisma({
      meetingRows: [availableMeeting()],
      sourceRows: [activeSource()],
      chunkRows: [{ id: 10, meetingId: 1, sourceId: 1, generation: 1 }],
    });
    const { service } = setup({ prisma });
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    const answer = await service.ask(
      conversation.id,
      { question: "When?", clarification: "Warehouse B" },
      9
    );
    prisma.meetings.findMany = async () => [
      { ...availableMeeting(), retrievalStatus: "WAITING_CONTENT" },
    ];
    const history = await service.history(conversation.id, 9);
    expect(history.answers[0].citations[0].quote).toBe(
      "The project starts in May."
    );
    expect(history.answers[0].stale).toBe(false);
    expect(history.conversation.scopeState.available).toBe(false);
    expect(history.conversation.scopeState.blockedReason).toContain(
      "WAITING_CONTENT"
    );
    await expect(
      service.ask(
        conversation.id,
        { question: "Again?", previousAnswerId: answer.id },
        9
      )
    ).rejects.toMatchObject({ code: "MEETING_UNAVAILABLE" });
  });

  test("blocks a model result when the source set changes during generation", async () => {
    const prisma = fakePrisma({
      meetingRows: [availableMeeting()],
      sourceRows: [activeSource()],
    });
    const llm = {
      generate: async () => {
        prisma.meeting_sources.findMany = async () => [
          activeSource(1),
          activeSource(2),
        ];
        return {
          status: "ANSWERED",
          text: "The project starts in May.",
          missingInfo: null,
          citations: [
            {
              evidenceId: "meeting:1",
              quote: "The project starts in May.",
            },
          ],
        };
      },
    };
    const { service } = setup({ prisma, llm });
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    await expect(
      service.ask(
        conversation.id,
        { question: "When?", clarification: "Warehouse B" },
        9
      )
    ).rejects.toThrow("changed while generating");
    expect(prisma._answers[0].clarification).toBe("Warehouse B");
  });

  test("rejects a baseline where the selected meeting became unavailable while retrieval initialized", async () => {
    for (const includeWorkspaceEvidence of [false, true]) {
      const prisma = fakePrisma({
        meetingRows: [availableMeeting()],
        sourceRows: [activeSource()],
      });
      let meetingReads = 0;
      prisma.meetings.findMany = async ({ where }) => {
        meetingReads += 1;
        const status = meetingReads === 1 ? "AVAILABLE" : "INDEXING";
        return [availableMeeting()]
          .filter((row) => where.id.in.includes(row.id))
          .map((row) => ({ ...row, retrievalStatus: status }));
      };
      const actualIndexer = createIndexer({
        prisma,
        embedder: {
          embedDocuments: async () => [[1]],
          embedQuery: async () => [1],
        },
      });
      const workspaceRetriever = {
        resolve: async () => [],
        search: async () =>
          includeWorkspaceEvidence
            ? [
                {
                  evidenceId: "workspace:2:chunk",
                  workspaceId: 2,
                  quote: "Current Workspace evidence.",
                  name: "current.txt",
                },
              ]
            : [],
      };
      const llm = {
        generate: jest.fn(async () => ({
          status: "ANSWERED",
          text: "Workspace answer.",
          missingInfo: null,
          citations: [
            {
              evidenceId: "workspace:2:chunk",
              quote: "Current Workspace evidence.",
            },
          ],
        })),
      };
      const service = createQAService({
        prisma,
        indexer: actualIndexer,
        workspaceRetriever,
        llm,
      });
      const conversation = await service.createConversation(
        {
          meetingIds: [1],
          ...(includeWorkspaceEvidence ? { workspaceIds: [2] } : {}),
        },
        9
      );
      meetingReads = 0;
      await expect(
        service.ask(
          conversation.id,
          { question: "Status?", clarification: "Supply date" },
          9
        )
      ).rejects.toMatchObject({ code: "MEETING_UNAVAILABLE" });
      expect(prisma._answers).toHaveLength(1);
      expect(prisma._answers[0].status).toBe("FAILED_STALE");
      expect(prisma._answers[0].clarification).toBe("Supply date");
      expect(llm.generate).not.toHaveBeenCalled();
    }
  });

  test("blocks publication when availability changes even if later snapshot data matches baseline", async () => {
    const prisma = fakePrisma({
      meetingRows: [availableMeeting()],
      sourceRows: [activeSource()],
    });
    let askRead = 0;
    let publicationProbe = false;
    const seenStatuses = [];
    prisma.meetings.findMany = async ({ where }) => {
      askRead += 1;
      let status = "AVAILABLE";
      if (publicationProbe && askRead === 4) status = "INDEXING";
      seenStatuses.push(status);
      return [availableMeeting()]
        .filter((row) => where.id.in.includes(row.id))
        .map((row) => ({ ...row, retrievalStatus: status }));
    };
    const workspaceRetriever = {
      resolve: async () => [],
      search: async () => [
        {
          evidenceId: "workspace:2:chunk",
          workspaceId: 2,
          quote: "Current Workspace evidence.",
          name: "current.txt",
        },
      ],
    };
    const indexer = { search: async () => [] };
    const llm = {
      generate: async () => {
        publicationProbe = true;
        return {
          status: "ANSWERED",
          text: "Workspace answer.",
          missingInfo: null,
          citations: [
            {
              evidenceId: "workspace:2:chunk",
              quote: "Current Workspace evidence.",
            },
          ],
        };
      },
    };
    const service = createQAService({
      prisma,
      indexer,
      workspaceRetriever,
      llm,
    });
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    askRead = 0;
    await expect(
      service.ask(conversation.id, { question: "Status?" }, 9)
    ).rejects.toMatchObject({ code: "MEETING_UNAVAILABLE" });
    expect(seenStatuses.slice(-5)).toEqual([
      "AVAILABLE",
      "AVAILABLE",
      "AVAILABLE",
      "INDEXING",
      "AVAILABLE",
    ]);
    expect(prisma._answers[0].status).toBe("FAILED_STALE");
  });

  test("only reports successfully indexed additions and cited source changes in history", async () => {
    const chunks = [{ id: 10, meetingId: 1, sourceId: 1, generation: 1 }];
    const prisma = fakePrisma({
      meetingRows: [availableMeeting()],
      sourceRows: [activeSource()],
      chunkRows: chunks,
    });
    const { service } = setup({ prisma });
    const conversation = await service.createConversation(
      { meetingIds: [1] },
      9
    );
    const answer = await service.ask(
      conversation.id,
      { question: "When?", clarification: "Warehouse B" },
      9
    );

    for (const status of ["PENDING", "FAILED"]) {
      prisma._sources.push({ ...activeSource(2), parseStatus: status });
      const history = await service.history(conversation.id, 9);
      expect(history.answers[0].stale).toBe(false);
      expect(history.answers[0].newSources).toBe(false);
      prisma._sources.pop();
    }

    prisma._sources.push({ ...activeSource(3), parseStatus: "SUCCESS" });
    prisma._chunks.push({ id: 30, meetingId: 1, sourceId: 3, generation: 1 });
    history = await service.history(conversation.id, 9);
    expect(history.answers[0].stale).toBe(false);
    expect(history.answers[0].newSources).toBe(true);

    prisma._sources[1].contentHash = "revised-hash-3";
    history = await service.history(conversation.id, 9);
    expect(history.answers[0].stale).toBe(false);
    expect(history.answers[0].newSources).toBe(true);

    prisma._sources.splice(1, 1);
    prisma._chunks.splice(1, 1);
    history = await service.history(conversation.id, 9);
    expect(history.answers[0].stale).toBe(false);
    expect(history.answers[0].newSources).toBe(false);

    prisma._sources.splice(
      prisma._sources.findIndex((source) => source.id === 1),
      1
    );
    history = await service.history(conversation.id, 9);
    expect(history.answers[0].stale).toBe(true);
    expect(answer.id).toBe(history.answers[0].id);
  });

  test("does not mislabel model failures as missing sources", async () => {
    const llm = {
      generate: async () => {
        const error = new Error("provider unavailable");
        error.partialText = "Maybe May";
        throw error;
      },
    };
    const { service, prisma } = setup({ llm });
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    const answer = await service.ask(
      conversation.id,
      { question: "When?", clarification: "Warehouse B" },
      9
    );
    expect(answer.status).toBe("FAILED_INCOMPLETE");
    expect(answer.text).toBe("Maybe May");
    expect(prisma._answers[0].error).toContain("provider unavailable");
    expect(prisma._answers[0].clarification).toBe("Warehouse B");
  });

  test("blocks metadata-only meetings and validates explicit accessible Workspace scope", async () => {
    const prisma = fakePrisma({
      meetingRows: [
        { ...availableMeeting(), retrievalStatus: "WAITING_CONTENT" },
      ],
      sourceRows: [],
    });
    const retriever = createWorkspaceRetriever({
      lookupWorkspace: async ({ id, userId }) =>
        id === 2 && userId === 9 ? { id, vectorTag: "safe" } : null,
      searchWorkspace: async () => [
        {
          id: "chunk-1",
          text: "The project starts in May.",
          filePath: "must-not-leak",
        },
      ],
    });
    const service = createQAService({
      prisma,
      indexer: { search: async () => [] },
      workspaceRetriever: retriever,
      llm: { generate: jest.fn() },
    });
    await expect(
      service.createConversation({ meetingIds: [1], workspaceIds: [2] }, 9)
    ).rejects.toMatchObject({ code: "MEETING_UNAVAILABLE" });
    await expect(
      retriever.resolve({ workspaceIds: [3], userId: 9 })
    ).rejects.toMatchObject({ code: "WORKSPACE_FORBIDDEN" });
    const workspaceEvidence = await retriever.search({
      workspaceIds: [2],
      userId: 9,
      question: "When?",
    });
    expect(workspaceEvidence[0].link).toBeNull();
    expect(workspaceEvidence[0].filePath).toBeUndefined();
    expect(workspaceEvidence[0].evidenceId).toBe("workspace:2:chunk-1");
  });

  test("does not publish an answer after a Workspace document changes during generation", async () => {
    const prisma = fakePrisma({
      meetingRows: [availableMeeting()],
      sourceRows: [activeSource()],
    });
    const evidence = {
      evidenceId: "workspace:2:chunk",
      workspaceId: 2,
      documentId: "doc-7",
      revision: "2026-10-01T00:00:00.000Z",
      quote: "Current Workspace evidence.",
      name: "current.txt",
      sourceType: "WORKSPACE",
    };
    const workspaceRetriever = {
      resolve: async () => [{ id: 2 }],
      search: async () => [evidence],
      validateEvidence: async ({ db }) => db === prisma && false,
    };
    const llm = {
      generate: jest.fn(async () => ({
        status: "ANSWERED",
        text: "Current Workspace evidence.",
        missingInfo: null,
        citations: [{ evidenceId: evidence.evidenceId, quote: evidence.quote }],
      })),
    };
    const { service } = setup({
      prisma,
      workspaceRetriever,
      evidence: [evidence],
      llm,
    });
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    await expect(
      service.ask(conversation.id, { question: "Status?" }, 9)
    ).rejects.toMatchObject({ code: "WORKSPACE_SOURCE_CHANGED" });
    expect(llm.generate).toHaveBeenCalledTimes(1);
    expect(prisma._answers[0].status).toBe("FAILED_STALE");
  });
});
