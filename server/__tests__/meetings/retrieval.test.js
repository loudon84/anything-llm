const {
  createWorkspaceRetriever,
} = require("../../modules/meetings/retrieval");

describe("authenticated Workspace evidence validation", () => {
  test("retains real document identity and validates current membership and revision in the supplied transaction", async () => {
    const workspaceDocuments = [
      {
        workspaceId: 2,
        docId: "doc-7",
        lastUpdatedAt: new Date("2026-10-01T00:00:00Z"),
      },
    ];
    const db = {
      workspace_documents: {
        findFirst: async ({ where }) =>
          workspaceDocuments.find(
            (row) =>
              row.workspaceId === where.workspaceId && row.docId === where.docId
          ) || null,
      },
    };
    const retriever = createWorkspaceRetriever({
      lookupWorkspace: async ({ id, userId }) => (userId === 9 ? { id } : null),
      searchWorkspace: async () => [
        {
          id: "chunk-1",
          docId: "doc-7",
          lastUpdatedAt: "2026-10-01T00:00:00.000Z",
          text: "Decision text",
        },
      ],
    });
    const evidence = await retriever.search({
      workspaceIds: [2],
      userId: 9,
      question: "decision",
    });
    expect(evidence[0]).toMatchObject({
      documentId: "doc-7",
      revision: "2026-10-01T00:00:00.000Z",
    });
    await expect(
      retriever.validateEvidence({ workspaceIds: [2], userId: 9, evidence, db })
    ).resolves.toBe(true);
    workspaceDocuments.splice(0, 1);
    await expect(
      retriever.validateEvidence({ workspaceIds: [2], userId: 9, evidence, db })
    ).resolves.toBe(false);
    workspaceDocuments.push({
      workspaceId: 2,
      docId: "doc-7",
      lastUpdatedAt: new Date("2026-10-02T00:00:00Z"),
    });
    await expect(
      retriever.validateEvidence({ workspaceIds: [2], userId: 9, evidence, db })
    ).resolves.toBe(false);
  });
});
