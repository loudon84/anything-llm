const {
  createWorkspaceSearchAdapter,
  workspaceLocation,
} = require("../../modules/meetings/runtime");

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
});
