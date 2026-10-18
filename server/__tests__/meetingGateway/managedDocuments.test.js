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
    commitGeneration: jest.fn(async (_id, fence, patch) => {
      if (fence !== generation.fencing_token) throw new Error("MGW_STALE_FENCE");
      Object.assign(generation, patch);
      return { ...generation };
    }),
  };
  const vectorDb = {
    managedDocumentFenceContract: "anythingllm-meeting-managed-fence-v1",
    addDocumentToNamespace: jest.fn(async (_namespace, document) => ({ vectorized: document.docId === "doc-old", error: null })),
    deleteDocumentFromNamespace: jest.fn(async () => true),
    hasDocument: jest.fn(async () => true),
  };
  function assertProviderFence({ fencingToken, signal }) {
    if (!signal || signal.aborted) throw new Error("MGW_FENCED_VECTOR_OPERATIONS_UNAVAILABLE");
    if (fencingToken !== generation.fencing_token) throw new Error("MGW_STALE_FENCE");
  }
  vectorDb.addDocumentToNamespaceFenced = jest.fn(async (args) => {
    assertProviderFence(args);
    return vectorDb.addDocumentToNamespace(args.namespace, args.document, args.location, true);
  });
  vectorDb.deleteDocumentFromNamespaceFenced = jest.fn(async (args) => {
    assertProviderFence(args);
    return vectorDb.deleteDocumentFromNamespace(args.namespace, args.docId);
  });
  const documents = {
    getWorkspace: jest.fn(async () => ({ id: 5, slug: "private-a" })),
    addManagedDocument: jest.fn(async () => ({ associated: true })),
    getManagedDocument: jest.fn(async () => ({ docId: "doc-old", workspaceId: 5, docpath: "meeting-managed/doc-old.json", vectorCount: 1 })),
    getManagedDocumentByDocId: jest.fn(async () => ({
      docId: "doc-old", workspaceId: 5, docpath: "meeting-managed/doc-old.json", vectorCount: 1,
      managedProvenance: { operation_id: "operation-a", import_id: "import-a", generation: 1, owner_user_id: 11, workspace_id: 5, payload_sha256: "c".repeat(64) },
    })),
    removeManagedDocument: jest.fn(async () => ({ removed: true })),
  };
  store.managedDocumentFenceContract = "anythingllm-meeting-managed-fence-v1";
  async function fencedStoreMutation(args, mutation) {
    if (args.signal?.aborted || args.fencingToken !== generation.fencing_token ||
        args.workspaceId !== 5 || args.policyEpoch !== 7 || args.docId !== "doc-old" || args.location !== "meeting-managed/doc-old.json")
      throw new Error("MGW_STALE_FENCE");
    if (typeof overrides.beforeFencedAssociationMutation === "function")
      await overrides.beforeFencedAssociationMutation(args);
    if (args.signal?.aborted || args.fencingToken !== generation.fencing_token ||
        args.workspaceId !== 5 || args.policyEpoch !== 7 || args.docId !== "doc-old" || args.location !== "meeting-managed/doc-old.json")
      throw new Error("MGW_STALE_FENCE");
    return mutation();
  }
  store.addManagedDocumentFenced = jest.fn((args) => fencedStoreMutation(args, () => args.mutateAssociation({ tx: true })));
  store.removeManagedDocumentFenced = jest.fn((args) => fencedStoreMutation(args, () => args.mutateAssociation({ tx: true })));
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
  const signal = new AbortController().signal;
  return { module, generation, store, vectorDb, documents, readFile, content, signal };
}

describe("PLAN-MGW-009 managed vector documents", () => {
  test("A-RETRY-001 stale attach fails its transactional association CAS after takeover", async () => {
    const h = makeHarness({ beforeFencedAssociationMutation: async () => { h.generation.fencing_token = 4; } });
    await expect(h.module.attach({ generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7, signal: h.signal }))
      .rejects.toThrow("MGW_STALE_FENCE");
    expect(h.documents.addManagedDocument).not.toHaveBeenCalled();
    expect(h.vectorDb.addDocumentToNamespace).not.toHaveBeenCalled();
  });

  test("A-REMOVE-001 stale cleanup fails its transactional association CAS after takeover", async () => {
    let harness;
    harness = makeHarness({ beforeFencedAssociationMutation: async () => { harness.generation.fencing_token = 4; } });
    harness.generation.state = "ATTACHING";
    harness.vectorDb.hasDocument.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(harness.module.cleanup({ generationId: "generation-old", fence: 3, signal: harness.signal }))
      .rejects.toThrow("MGW_STALE_FENCE");
    expect(harness.documents.removeManagedDocument).not.toHaveBeenCalled();
    expect(harness.store.commitGeneration).not.toHaveBeenCalledWith("generation-old", 3, { state: "REMOVED" });
  });
  test("A-WORKSPACE-001-03 fails closed before writes when fenced provider operations are unavailable", async () => {
    const h = makeHarness();
    delete h.vectorDb.managedDocumentFenceContract;
    await expect(h.module.attach({
      generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7, signal: new AbortController().signal,
    })).rejects.toThrow("MGW_FENCED_VECTOR_OPERATIONS_UNAVAILABLE");
    expect(h.store.commitGeneration).not.toHaveBeenCalled();
    expect(h.documents.addManagedDocument).not.toHaveBeenCalled();
    expect(h.vectorDb.addDocumentToNamespace).not.toHaveBeenCalled();
    expect(h.vectorDb.deleteDocumentFromNamespace).not.toHaveBeenCalled();
  });

  test("A-WORKSPACE-001-03 fails closed before writes when fenced store operations are unavailable", async () => {
    const h = makeHarness();
    delete h.store.removeManagedDocumentFenced;
    await expect(h.module.attach({
      generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7, signal: h.signal,
    })).rejects.toThrow("MGW_FENCED_STORE_OPERATIONS_UNAVAILABLE");
    expect(h.store.commitGeneration).not.toHaveBeenCalled();
    expect(h.documents.addManagedDocument).not.toHaveBeenCalled();
    expect(h.vectorDb.addDocumentToNamespace).not.toHaveBeenCalled();
  });
  test("A-REMOVE-001-04 refuses deletion when docId association ownership does not match", async () => {
    const h = makeHarness();
    h.generation.state = "VERIFIED";
    h.documents.getManagedDocumentByDocId = jest.fn(async () => ({
      docId: "doc-old", workspaceId: 99, docpath: "meeting-managed/other.json",
      managedProvenance: h.content.managedProvenance, vectorCount: 1,
    }));
    await expect(h.module.cleanup({
      generationId: "generation-old", fence: 3, signal: new AbortController().signal,
    })).rejects.toThrow("MGW_REVOKE_CLEANUP_FAILED");
    expect(h.documents.getManagedDocumentByDocId).toHaveBeenCalledWith({ docId: "doc-old" });
    expect(h.vectorDb.deleteDocumentFromNamespace).not.toHaveBeenCalled();
    expect(h.documents.removeManagedDocument).not.toHaveBeenCalled();
  });
  test("A-WORKSPACE-001-01 persists the generation docId before embedding and verifies all records", async () => {
    const h = makeHarness();
    await expect(h.module.attach({ generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7, signal: h.signal }))
      .resolves.toMatchObject({ vectorDocId: "doc-old", attached: true });
    expect(h.documents.addManagedDocument).toHaveBeenCalledWith(expect.objectContaining({
      workspace: expect.objectContaining({ id: 5, slug: "private-a" }),
      location: "meeting-managed/doc-old.json",
      docId: "doc-old",
      generation: expect.objectContaining({ id: "generation-old", generation: 1 }),
    }));
    expect(h.documents.addManagedDocument.mock.invocationCallOrder[0]).toBeLessThan(
      h.vectorDb.addDocumentToNamespaceFenced.mock.invocationCallOrder[0]
    );
    expect(h.vectorDb.addDocumentToNamespaceFenced).toHaveBeenCalledWith(expect.objectContaining({ namespace: "private-a", document: expect.objectContaining({ docId: "doc-old" }), location: "meeting-managed/doc-old.json", fencingToken: 3, signal: h.signal }));
    await expect(h.module.verify("generation-old")).resolves.toMatchObject({ verified: true, vectorDocId: "doc-old" });
  });

  test("A-WORKSPACE-001-02 blocks embedding when the private policy epoch changed", async () => {
    const h = makeHarness();
    h.store.policyByWorkspace.mockResolvedValue({ workspace_id: 5, owner_user_id: 11, state: "ACTIVE", policy_epoch: 8 });
    await expect(h.module.attach({ generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7, signal: h.signal }))
      .rejects.toThrow("MGW_WORKSPACE_NOT_PRIVATE");
    expect(h.documents.addManagedDocument).not.toHaveBeenCalled();
    expect(h.vectorDb.addDocumentToNamespace).not.toHaveBeenCalled();
  });

  test("A-REMOVE-001-01 cleanup removes only the recorded generation docId and confirms absence", async () => {
    const h = makeHarness();
    h.generation.state = "ATTACHING";
    h.vectorDb.hasDocument.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(h.module.cleanup({ generationId: "generation-old", fence: 3, signal: h.signal }))
      .resolves.toMatchObject({ removed: true, generation: 1 });
    expect(h.vectorDb.deleteDocumentFromNamespaceFenced).toHaveBeenCalledWith(expect.objectContaining({ namespace: "private-a", docId: "doc-old", fencingToken: 3, signal: h.signal }));
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
    await expect(h.module.cleanup({ generationId: "generation-old", fence: 3, signal: h.signal }))
      .rejects.toThrow("MGW_REVOKE_CLEANUP_FAILED");
    expect(h.store.commitGeneration).not.toHaveBeenCalledWith("generation-old", 3, { state: "REMOVED" });
  });

  test("A-REMOVE-001-02 does not treat a missing managed file as successful cleanup", async () => {
    const h = makeHarness();
    h.generation.state = "ATTACHING";
    h.readFile.mockRejectedValue(new Error("ENOENT"));
    await expect(h.module.cleanup({ generationId: "generation-old", fence: 3, signal: h.signal })).rejects.toThrow("ENOENT");
    expect(h.vectorDb.deleteDocumentFromNamespace).not.toHaveBeenCalled();
    expect(h.store.commitGeneration).not.toHaveBeenCalledWith("generation-old", 3, { state: "REMOVED" });
  });

  test("A-WORKSPACE-001-02 blocks when the vector engine cannot verify a document", async () => {
    const h = makeHarness();
    delete h.vectorDb.hasDocument;
    await expect(h.module.attach({ generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7, signal: h.signal }))
      .rejects.toThrow("MGW_VECTOR_VERIFY_UNAVAILABLE");
    expect(h.documents.addManagedDocument).not.toHaveBeenCalled();
    expect(h.vectorDb.addDocumentToNamespace).not.toHaveBeenCalled();
  });

  test("A-RETRY-001-01 stale worker defers shared cleanup after the newer fence verifies", async () => {
    const h = makeHarness();
    let finishFirstInsert;
    let markFirstStarted;
    const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
    let insertCalls = 0;
    let present = false;
    let associated = false;
    h.documents.addManagedDocument.mockImplementation(async () => {
      associated = true;
      return { associated: true };
    });
    h.documents.getManagedDocumentByDocId.mockImplementation(async () => associated
      ? { docId: "doc-old", workspaceId: 5, docpath: "meeting-managed/doc-old.json", vectorCount: 1,
          managedProvenance: h.content.managedProvenance }
      : null);
    h.vectorDb.addDocumentToNamespace.mockImplementation(() => {
      insertCalls += 1;
      if (insertCalls === 1) return new Promise((resolve) => {
        markFirstStarted();
        finishFirstInsert = () => {
          present = true;
          resolve({ vectorized: true, error: null });
        };
      });
      present = true;
      return Promise.resolve({ vectorized: true, error: null });
    });
    h.vectorDb.hasDocument.mockImplementation(async () => present);

    const staleAttach = h.module.attach({ generationId: "generation-old", fence: 3, workspaceId: 5, epoch: 7, signal: h.signal });
    await firstStarted;
    h.generation.fencing_token = 4;
    await h.module.attach({ generationId: "generation-old", fence: 4, workspaceId: 5, epoch: 7, signal: h.signal });
    h.generation.state = "VERIFIED";
    await expect(h.module.verify("generation-old")).resolves.toMatchObject({ verified: true });

    finishFirstInsert();
    await expect(staleAttach).rejects.toThrow("MGW_STALE_FENCE");
    expect(h.generation.state).toBe("VERIFIED");
    expect(h.store.commitGeneration).not.toHaveBeenCalledWith("generation-old", 3, { state: "VERIFYING" });
    expect(h.vectorDb.deleteDocumentFromNamespace).not.toHaveBeenCalled();
    expect(await h.vectorDb.hasDocument("private-a", "doc-old")).toBe(true);
    await expect(h.documents.getManagedDocument({
      workspaceId: 5, location: "meeting-managed/doc-old.json", docId: "doc-old",
    })).resolves.toMatchObject({ docId: "doc-old" });
    expect(h.documents.removeManagedDocument).not.toHaveBeenCalled();
  });
  test("A-REMOVE-001-03 stale cleanup rechecks its fence after provider probe before deleting", async () => {
    const h = makeHarness();
    h.generation.state = "VERIFIED";
    let finishProbe;
    let markProbeStarted;
    const probeStarted = new Promise((resolve) => { markProbeStarted = resolve; });
    let probes = 0;
    h.vectorDb.hasDocument.mockImplementation(() => {
      probes += 1;
      if (probes === 1) return new Promise((resolve) => {
        markProbeStarted();
        finishProbe = () => resolve(true);
      });
      return Promise.resolve(true);
    });

    const staleCleanup = h.module.cleanup({ generationId: "generation-old", fence: 3, signal: h.signal });
    await probeStarted;
    h.generation.fencing_token = 4;
    h.generation.state = "VERIFIED";
    await expect(h.module.verify("generation-old")).resolves.toMatchObject({ verified: true });
    finishProbe();

    await expect(staleCleanup).rejects.toThrow("MGW_STALE_FENCE");
    expect(h.generation.state).toBe("VERIFIED");
    expect(h.vectorDb.deleteDocumentFromNamespace).not.toHaveBeenCalled();
    expect(h.documents.removeManagedDocument).not.toHaveBeenCalled();
  });
  test("A-REMOVE-001-01 retries cleanup after association deletion but before REMOVED commit", async () => {
    const h = makeHarness();
    h.generation.state = "ATTACHING";
    let associated = true;
    let present = true;
    h.documents.getManagedDocumentByDocId.mockImplementation(async () => associated
      ? { docId: "doc-old", workspaceId: 5, docpath: "meeting-managed/doc-old.json", vectorCount: 1,
          managedProvenance: h.content.managedProvenance }
      : null);
    h.vectorDb.hasDocument.mockImplementation(async () => present);
    h.vectorDb.deleteDocumentFromNamespace.mockImplementation(async () => {
      present = false;
      return true;
    });
    h.documents.removeManagedDocument.mockImplementation(async () => {
      associated = false;
      return { removed: true };
    });
    h.store.commitGeneration.mockRejectedValueOnce(new Error("simulated process loss"));

    await expect(h.module.cleanup({ generationId: "generation-old", fence: 3, signal: h.signal })).rejects.toThrow("simulated process loss");
    await expect(h.module.cleanup({ generationId: "generation-old", fence: 3, signal: h.signal }))
      .resolves.toMatchObject({ removed: true, generation: 1 });
    expect(h.vectorDb.deleteDocumentFromNamespaceFenced).toHaveBeenCalledTimes(1);
    expect(h.documents.removeManagedDocument).toHaveBeenCalledTimes(1);
    expect(h.store.commitGeneration).toHaveBeenLastCalledWith("generation-old", 3, { state: "REMOVED" });
  });
});




