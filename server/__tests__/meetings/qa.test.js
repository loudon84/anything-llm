const { createQAService } = require("../../modules/meetings/qa");
const {
  createWorkspaceRetriever,
} = require("../../modules/meetings/retrieval");

function fakePrisma({ meetingRows, sourceRows } = {}) {
  const meetings = meetingRows || [];
  const sources = sourceRows || [];
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

  test("persists immutable scopes, snapshots citations, and retains history after source deletion", async () => {
    const { service, prisma } = setup();
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    await expect(
      service.createConversation({ meetingIds: [1, 2], workspaceIds: [2] }, 9)
    ).rejects.toThrow();
    const answer = await service.ask(
      conversation.id,
      { question: "When does it start?" },
      9
    );
    prisma.meeting_sources.findMany = async () => [];
    const history = await service.history(conversation.id, 9);
    expect(history.conversation.meetingIds).toEqual([1]);
    expect(history.conversation.workspaceIds).toEqual([2]);
    expect(history.answers[0].citations[0].quote).toBe(
      "The project starts in May."
    );
    expect(history.answers[0].stale).toBe(true);
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
    const { service, prisma } = setup();
    const conversation = await service.createConversation(
      { meetingIds: [1], workspaceIds: [2] },
      9
    );
    const answer = await service.ask(conversation.id, { question: "When?" }, 9);
    prisma.meetings.findMany = async () => [
      { ...availableMeeting(), retrievalStatus: "WAITING_CONTENT" },
    ];
    const history = await service.history(conversation.id, 9);
    expect(history.answers[0].citations[0].quote).toBe(
      "The project starts in May."
    );
    expect(history.answers[0].stale).toBe(true);
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
      service.ask(conversation.id, { question: "When?" }, 9)
    ).rejects.toThrow("changed while generating");
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
    const answer = await service.ask(conversation.id, { question: "When?" }, 9);
    expect(answer.status).toBe("FAILED_INCOMPLETE");
    expect(answer.text).toBe("Maybe May");
    expect(prisma._answers[0].error).toContain("provider unavailable");
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
});
