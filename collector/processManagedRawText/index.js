const { createManagedStore, canonicalJson, sha256 } = require("../utils/managedDocumentStore");
const { tokenizeString } = require("../utils/tokenizer");

const ALLOWED_METADATA_KEYS = new Set(["title", "url", "docAuthor", "description", "docSource", "chunkSource", "published"]);

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("MGW_INPUT_INVALID");
  const normalized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key) || (value !== null && typeof value !== "string" && typeof value !== "number"))
      throw new Error("MGW_INPUT_INVALID");
    if (value !== undefined) normalized[key] = value;
  }
  if (typeof normalized.title !== "string" || !normalized.title.trim()) throw new Error("MGW_INPUT_INVALID");
  return normalized;
}

function buildPayloadHash(input) {
  return sha256(canonicalJson({
    operation_id: input.operation_id,
    import_id: input.import_id,
    generation: input.generation,
    owner_user_id: input.owner_user_id,
    workspace_id: input.workspace_id,
    textContent: input.textContent,
    metadata: input.metadata,
  }));
}

async function processManagedRawText(input, { store = createManagedStore(), clock = () => new Date() } = {}) {
  if (!input || typeof input.textContent !== "string" || input.textContent.length === 0)
    throw new Error("MGW_INPUT_INVALID");
  const metadata = normalizeMetadata(input.metadata);
  const payload = { ...input, metadata };
  const payloadHash = buildPayloadHash(payload);
  if (input.payload_sha256 !== payloadHash) throw new Error("MGW_INPUT_INVALID");
  const journal = await store.prepare({
    operationId: input.operation_id,
    payloadHash,
    ownerUserId: input.owner_user_id,
    importId: input.import_id,
    generation: input.generation,
    workspaceId: input.workspace_id,
    metadata,
    textContent: input.textContent,
    preparedAt: clock().toISOString(),
  });
  if (journal.state === "COMMITTED") return { success: true, documents: [{ location: journal.location }], operationState: "COMMITTED" };

  const url = typeof metadata.url === "string" && /^https?:\/\//i.test(metadata.url)
    ? `web://${metadata.url.toLowerCase()}.website`
    : `file://${metadata.title.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-")}.txt`;
  const pageContent = input.textContent;
  const document = {
    id: journal.documentId,
    url,
    title: metadata.title,
    docAuthor: metadata.docAuthor || "no author specified",
    description: metadata.description || "no description found",
    docSource: metadata.docSource || "no source set",
    chunkSource: metadata.chunkSource || metadata.title,
    published: metadata.published ?? journal.preparedAt,
    wordCount: pageContent.split(" ").length,
    pageContent,
    token_count_estimate: tokenizeString(pageContent),
    managedProvenance: {
      operation_id: input.operation_id,
      import_id: input.import_id,
      generation: input.generation,
      owner_user_id: input.owner_user_id,
      workspace_id: input.workspace_id,
      payload_sha256: payloadHash,
    },
  };
  const committed = await store.commit(input.operation_id, payloadHash, document);
  return { success: true, documents: [{ location: committed.location }], operationState: committed.state };
}

module.exports = { processManagedRawText, buildPayloadHash };
