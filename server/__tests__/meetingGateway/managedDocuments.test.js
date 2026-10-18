const { createManagedDocuments } = require("../../utils/meetingGateway/managedDocuments");
const { hashPageContent } = require("../../utils/meetingGateway/hashes");

function makeHarness(overrides = {}) {
  const generation = {
    id: "generation-old",
    import_id: "import-a",
    generation: 1,
    operation_id: "operation-a",
    state: "DOCUMENT_CREATED",
    document_location: "meeting-managed/doc-old.json",
    vector_doc_id: "doc-old",
    last_applied_doc_sha256: hashPageContent({ pageContent: "Meeting notes" }),
    container_sha256: "b".repeat(64),
    workspace_id: 5,
    policy_epoch: 7,
    fencing_token: 3,
  };
  const store = {
    getGeneration: jest.fn(async (id) => id === generation.id ? { ...generation } : null),
    policyByWorkspace: jest.fn(async () => ({ workspace_id: 5, owner_user_id: 11, state: "ACTIVE", policy_epoch: 7 })),
    commitGeneration: jest.fn(async (_id, _fence, patch) => {
      Object.assign(generation, patch);
      return { ...generation };
    }),
  };
  const vectorDb = {
    addDocumentToNamespace: jest.fn(async (_namespace, document) => ({ vectorized: document.docId === "doc-old", error: null })),
    deleteDocumentFromNamespace: jest.fn(async () => true),
    hasDocument: jest.fn(async () => true),
  };
  const documents = {
    getWorkspace: jest.fn(async () => ({ id: 5, slug: "private-a" })),
    addManagedDocument: jest.fn(async () => ({ associated: true })),
    getManagedDocument: jest.fn(async () => ({ docId: "doc-old", workspaceId: 5, docpath: "meeting-managed/doc-old.json", vectorCount: 1 })),
    removeManagedDocument: jest.fn(async () => ({ removed: true })),
  };
  const content = {
    id: "doc-old",
    pageContent: "Meeting notes",
    managedProvenance: {
      operation_id: "operation-a", import_id: "import-a", generation: 1,
      owner_user_id: 11, workspace_id: 5, payload_sha256: "c".repeat(64),
    },
  };
  const readFile = jest.fn(async () => ({ document: content, containerSha256: "b".repeat(64) }));
  const module = createManagedDocuments({ store, vectorDb, documents, readFile, ...overrides });
  return { module, generation, store, vectorDb, documents, readFile, content };
}

describe("PLAN-MGW-009 managed vector documents", () => {
  test("A-WORKSPACE-001-01 persists the generation docId before embedding and verifies all records", async () => {
    const h = makeHarness();
    await expect(h.module.attach({ generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7 }))
      .resolves.toMatchObject({ vectorDocId: "doc-old", attached: true });
    expect(h.documents.addManagedDocument).toHaveBeenCalledWith(expect.objectContaining({
      workspace: expect.objectContaining({ id: 5, slug: "private-a" }),
      location: "meeting-managed/doc-old.json",
      docId: "doc-old",
      generation: expect.objectContaining({ id: "generation-old", generation: 1 }),
    }));
    expect(h.documents.addManagedDocument.mock.invocationCallOrder[0]).toBeLessThan(
      h.vectorDb.addDocumentToNamespace.mock.invocationCallOrder[0]
    );
    expect(h.vectorDb.addDocumentToNamespace).toHaveBeenCalledWith("private-a", expect.objectContaining({ docId: "doc-old" }), "meeting-managed/doc-old.json", true);
    await expect(h.module.verify("generation-old")).resolves.toMatchObject({ verified: true, vectorDocId: "doc-old" });
  });

  test("A-WORKSPACE-001-02 blocks embedding when the private policy epoch changed", async () => {
    const h = makeHarness();
    h.store.policyByWorkspace.mockResolvedValue({ workspace_id: 5, owner_user_id: 11, state: "ACTIVE", policy_epoch: 8 });
    await expect(h.module.attach({ generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7 }))
      .rejects.toThrow("MGW_WORKSPACE_NOT_PRIVATE");
    expect(h.documents.addManagedDocument).not.toHaveBeenCalled();
    expect(h.vectorDb.addDocumentToNamespace).not.toHaveBeenCalled();
  });

  test("A-REMOVE-001-01 cleanup removes only the recorded generation docId and confirms absence", async () => {
    const h = makeHarness();
    h.generation.state = "ATTACHING";
    h.vectorDb.hasDocument.mockResolvedValueOnce(false);
    await expect(h.module.cleanup({ generationId: "generation-old", fence: 3 }))
      .resolves.toMatchObject({ removed: true, generation: 1 });
    expect(h.vectorDb.deleteDocumentFromNamespace).toHaveBeenCalledWith("private-a", "doc-old");
    expect(h.documents.removeManagedDocument).toHaveBeenCalledWith(expect.objectContaining({
      docId: "doc-old",
      generation: expect.objectContaining({ id: "generation-old", generation: 1 }),
    }));
    expect(h.store.commitGeneration).toHaveBeenCalledWith("generation-old", 3, { state: "REMOVED" });
  });

  test("A-REMOVE-001-02 keeps cleanup pending when the provider cannot confirm absence", async () => {
    const h = makeHarness();
    h.generation.state = "ATTACHING";
    h.vectorDb.hasDocument.mockResolvedValueOnce(true);
    await expect(h.module.cleanup({ generationId: "generation-old", fence: 3 }))
      .rejects.toThrow("MGW_REVOKE_CLEANUP_FAILED");
    expect(h.store.commitGeneration).not.toHaveBeenCalledWith("generation-old", 3, { state: "REMOVED" });
  });

  test("A-REMOVE-001-02 does not treat a missing managed file as successful cleanup", async () => {
    const h = makeHarness();
    h.generation.state = "ATTACHING";
    h.readFile.mockRejectedValue(new Error("ENOENT"));
    await expect(h.module.cleanup({ generationId: "generation-old", fence: 3 })).rejects.toThrow("ENOENT");
    expect(h.vectorDb.deleteDocumentFromNamespace).not.toHaveBeenCalled();
    expect(h.store.commitGeneration).not.toHaveBeenCalledWith("generation-old", 3, { state: "REMOVED" });
  });

  test("A-WORKSPACE-001-02 blocks when the vector engine cannot verify a document", async () => {
    const h = makeHarness();
    delete h.vectorDb.hasDocument;
    await expect(h.module.attach({ generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7 }))
      .rejects.toThrow("MGW_VECTOR_VERIFY_UNAVAILABLE");
    expect(h.documents.addManagedDocument).not.toHaveBeenCalled();
    expect(h.vectorDb.addDocumentToNamespace).not.toHaveBeenCalled();
  });
});




