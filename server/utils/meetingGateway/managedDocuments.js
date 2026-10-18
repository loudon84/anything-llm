const { hashPageContent } = require("./hashes");

function fail(code) {
  throw new Error(code);
}

function requireEngineProbe(vectorDb) {
  if (typeof vectorDb?.hasDocument !== "function") fail("MGW_VECTOR_VERIFY_UNAVAILABLE");
}

function matchesProvenance(document, generation, policy, workspaceId) {
  const provenance = document?.managedProvenance;
  return document?.id === generation.vector_doc_id &&
    provenance?.operation_id === generation.operation_id &&
    provenance?.import_id === generation.import_id &&
    provenance?.generation === generation.generation &&
    provenance?.owner_user_id === policy.owner_user_id &&
    provenance?.workspace_id === workspaceId &&
    typeof provenance?.payload_sha256 === "string" && /^[a-f0-9]{64}$/i.test(provenance.payload_sha256);
}

function createManagedDocuments({ store, vectorDb, documents, readFile }) {
  if (!store || !documents || typeof readFile !== "function") fail("MGW_MANAGED_DOCUMENTS_DEPENDENCIES_REQUIRED");

  async function loadGeneration(generationId) {
    if (typeof store.getGeneration !== "function") fail("MGW_GENERATION_LOOKUP_UNAVAILABLE");
    const generation = await store.getGeneration(generationId);
    if (!generation) fail("MGW_GENERATION_NOT_FOUND");
    return generation;
  }

  async function policyFor(workspaceId, epoch) {
    if (typeof store.policyByWorkspace !== "function") fail("MGW_WORKSPACE_POLICY_REQUIRED");
    const policy = await store.policyByWorkspace(workspaceId);
    if (!policy || policy.state !== "ACTIVE" || policy.policy_epoch !== epoch)
      fail("MGW_WORKSPACE_NOT_PRIVATE");
    return policy;
  }

  async function attach({ generationId, fence, workspaceId, epoch }) {
    requireEngineProbe(vectorDb);
    const generation = await loadGeneration(generationId);
    if (!Number.isInteger(fence) || generation.fencing_token !== fence) fail("MGW_STALE_FENCE");
    if (!["DOCUMENT_CREATED", "ATTACHING"].includes(generation.state)) fail("MGW_IMPORT_CONFLICT");
    if (!generation.vector_doc_id || !generation.document_location || !generation.operation_id)
      fail("MGW_IMPORT_RECOVERY_REQUIRED");
    if (generation.policy_epoch !== epoch) fail("MGW_WORKSPACE_NOT_PRIVATE");
    const policy = await policyFor(workspaceId, epoch);
    const stored = await readFile(generation.document_location);
    const document = stored?.document || stored;
    const containerSha256 = stored?.containerSha256 || stored?.container_sha256;
    if (!matchesProvenance(document, generation, policy, workspaceId) ||
        hashPageContent(document) !== generation.last_applied_doc_sha256 ||
        containerSha256 !== generation.container_sha256)
      fail("MGW_IMPORT_CONFLICT");

    if (typeof documents.addManagedDocument !== "function") fail("MGW_MANAGED_DOCUMENTS_UNAVAILABLE");
    const workspace = typeof documents.getWorkspace === "function"
      ? await documents.getWorkspace(workspaceId)
      : null;
    if (!workspace || workspace.id !== workspaceId)
      fail("MGW_WORKSPACE_NOT_PRIVATE");

    if (typeof store.commitGeneration !== "function") fail("MGW_GENERATION_COMMIT_UNAVAILABLE");
    await store.commitGeneration(generationId, fence, { state: "ATTACHING" });
    const association = await documents.addManagedDocument({
      workspace,
      location: generation.document_location,
      docId: generation.vector_doc_id,
      generation,
      document,
    });
    if (!association?.associated) fail("MGW_WORKSPACE_ATTACH_FAILED");
    const result = await vectorDb.addDocumentToNamespace(
      workspace.slug,
      { ...document, docId: generation.vector_doc_id },
      generation.document_location,
      true
    );
    if (!result || result.vectorized !== true) fail("MGW_DOCUMENT_IMPORT_FAILED");
    const currentPolicy = await policyFor(workspaceId, epoch);
    if (currentPolicy.owner_user_id !== policy.owner_user_id) fail("MGW_WORKSPACE_NOT_PRIVATE");
    await store.commitGeneration(generationId, fence, { state: "VERIFYING" });
    return { attached: true, vectorDocId: generation.vector_doc_id };
  }

  async function verify(generationId) {
    requireEngineProbe(vectorDb);
    const generation = await loadGeneration(generationId);
    if (!["VERIFYING", "VERIFIED"].includes(generation.state)) fail("MGW_IMPORT_CONFLICT");
    if (!generation.document_location || !generation.vector_doc_id) fail("MGW_IMPORT_RECOVERY_REQUIRED");
    const policy = await policyFor(generation.workspace_id, generation.policy_epoch);
    if (typeof documents.getWorkspace !== "function") fail("MGW_MANAGED_DOCUMENTS_UNAVAILABLE");
    const workspace = await documents.getWorkspace(generation.workspace_id);
    if (!workspace || workspace.id !== generation.workspace_id) fail("MGW_WORKSPACE_NOT_PRIVATE");
    const stored = await readFile(generation.document_location);
    const document = stored?.document || stored;
    const containerSha256 = stored?.containerSha256 || stored?.container_sha256;
    if (!matchesProvenance(document, generation, policy, generation.workspace_id) ||
        hashPageContent(document) !== generation.last_applied_doc_sha256 ||
        containerSha256 !== generation.container_sha256)
      fail("MGW_IMPORT_CONFLICT");
    if (typeof documents.getManagedDocument !== "function") fail("MGW_MANAGED_DOCUMENTS_UNAVAILABLE");
    const association = await documents.getManagedDocument({
      workspaceId: generation.workspace_id,
      location: generation.document_location,
      docId: generation.vector_doc_id,
    });
    if (!association || association.docId !== generation.vector_doc_id ||
        association.workspaceId !== generation.workspace_id || association.docpath !== generation.document_location ||
        association.vectorCount <= 0)
      fail("MGW_DOCUMENT_VERIFY_FAILED");
    if (await vectorDb.hasDocument(workspace.slug, generation.vector_doc_id) !== true)
      fail("MGW_DOCUMENT_VERIFY_FAILED");
    return { verified: true, vectorDocId: generation.vector_doc_id };
  }

  async function cleanup({ generationId, fence }) {
    requireEngineProbe(vectorDb);
    const generation = await loadGeneration(generationId);
    if (!Number.isInteger(fence) || generation.fencing_token !== fence) fail("MGW_STALE_FENCE");
    if (!["ATTACHING", "VERIFYING", "VERIFIED", "REVOKING", "PENDING_CLEANUP", "SUPERSEDED"].includes(generation.state))
      fail("MGW_REVOKE_CLEANUP_FAILED");
    if (!generation.vector_doc_id || !generation.document_location) fail("MGW_REVOKE_CLEANUP_FAILED");
    const policy = await store.policyByWorkspace(generation.workspace_id);
    const stored = await readFile(generation.document_location);
    const document = stored?.document || stored;
    const containerSha256 = stored?.containerSha256 || stored?.container_sha256;
    if (!policy || !matchesProvenance(document, generation, policy, generation.workspace_id) ||
        hashPageContent(document) !== generation.last_applied_doc_sha256 ||
        containerSha256 !== generation.container_sha256)
      fail("MGW_REVOKE_CLEANUP_FAILED");
    if (typeof documents.getWorkspace !== "function" || typeof documents.removeManagedDocument !== "function")
      fail("MGW_REVOKE_CLEANUP_FAILED");
    const workspace = await documents.getWorkspace(generation.workspace_id);
    if (!workspace || workspace.id !== generation.workspace_id) fail("MGW_REVOKE_CLEANUP_FAILED");
    const association = await documents.getManagedDocument({
      workspaceId: generation.workspace_id,
      location: generation.document_location,
      docId: generation.vector_doc_id,
    });
    if (!association || association.docId !== generation.vector_doc_id || association.docpath !== generation.document_location)
      fail("MGW_REVOKE_CLEANUP_FAILED");
    const deleted = await vectorDb.deleteDocumentFromNamespace(workspace.slug, generation.vector_doc_id);
    if (deleted !== true || await vectorDb.hasDocument(workspace.slug, generation.vector_doc_id) !== false)
      fail("MGW_REVOKE_CLEANUP_FAILED");
    const removed = await documents.removeManagedDocument({ workspace, location: generation.document_location, docId: generation.vector_doc_id, generation });
    if (removed?.removed !== true) fail("MGW_REVOKE_CLEANUP_FAILED");
    if (typeof store.commitGeneration !== "function") fail("MGW_GENERATION_COMMIT_UNAVAILABLE");
    await store.commitGeneration(generationId, fence, { state: "REMOVED" });
    return { removed: true, generation: generation.generation };
  }

  return { attach, cleanup, verify };
}

module.exports = { createManagedDocuments };

