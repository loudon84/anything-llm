const crypto = require("crypto");
const fs = require("fs");
const path = require("path");


function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function writeFileDurable(filePath, contents, exclusive = true) {
  const fd = fs.openSync(filePath, exclusive ? "wx" : "w");
  try {
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDirectory(directory) {
  try {
    const fd = fs.openSync(directory, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch (error) {
    if (!["EINVAL", "EPERM", "EISDIR", "EACCES"].includes(error.code)) throw error;
  }
}

function writeExclusive(filePath, contents) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileDurable(temp, contents);
  try {
    fs.linkSync(temp, filePath);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}
function atomicJson(filePath, value) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileDurable(temp, `${JSON.stringify(value)}\n`);
  try {
    fs.renameSync(temp, filePath);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

function createManagedStore({
  root = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, "../../server/storage"), "meeting-managed"),
  documentsRoot = null,
  afterPrepare = async () => {},
  afterDocumentWrite = async () => {},
  afterCommit = async () => {},
} = {}) {
  const journalRoot = path.resolve(root, "operations");
  const resolvedDocumentsRoot = path.resolve(documentsRoot || (process.env.NODE_ENV === "development" ? path.join(__dirname, "../../server/storage/documents") : path.join(process.env.STORAGE_DIR || "", "documents")));
  const managedDocsRoot = path.resolve(resolvedDocumentsRoot, "meeting-managed");
  fs.mkdirSync(journalRoot, { recursive: true });
  fs.mkdirSync(managedDocsRoot, { recursive: true });

  function journalPath(operationId) {
    if (typeof operationId !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(operationId))
      throw new Error("MGW_INPUT_INVALID");
    return path.join(journalRoot, `${operationId}.json`);
  }

  function getSync(operationId) {
    const file = journalPath(operationId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  async function prepare(input) {
    const { operationId, payloadHash, ownerUserId, importId, generation, workspaceId, metadata, textContent } = input || {};
    const file = journalPath(operationId);
    const payload = { operation_id: operationId, import_id: importId, generation, owner_user_id: ownerUserId, workspace_id: workspaceId, textContent, metadata };
    const computedHash = sha256(canonicalJson(payload));
    if (typeof textContent !== "string" || textContent.length === 0 ||
      !Number.isInteger(ownerUserId) || !Number.isInteger(generation) || generation < 1 ||
      !importId || !workspaceId || !metadata || typeof metadata.title !== "string" || !metadata.title.trim() ||
      !/^[a-f0-9]{64}$/i.test(payloadHash || "") || payloadHash.toLowerCase() !== computedHash)
      throw new Error("MGW_INPUT_INVALID");

    let journal = getSync(operationId);
    if (journal) {
      if (journal.payloadHash !== computedHash || canonicalJson(journal.payload) !== canonicalJson(payload))
        throw new Error("MGW_IMPORT_CONFLICT");
      return journal;
    }

    journal = {
      version: 1,
      state: "PREPARED",
      operationId,
      payloadHash: computedHash,
      payload,
      documentId: crypto.randomUUID(),
      preparedAt: input.preparedAt || new Date().toISOString(),
      ownerUserId,
      importId,
      generation,
      workspaceId,
      location: null,
    };
    journal.location = `meeting-managed/${journal.documentId}.json`;
    try {
      writeExclusive(file, `${JSON.stringify(journal)}\n`);
      await afterPrepare(journal);
      return journal;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = getSync(operationId);
      if (!existing || existing.payloadHash !== computedHash || canonicalJson(existing.payload) !== canonicalJson(payload))
        throw new Error("MGW_IMPORT_CONFLICT");
      return existing;
    }
  }

  async function commit(operationId, payloadHash, document) {
    const file = journalPath(operationId);
    const journal = getSync(operationId);
    if (!journal || journal.payloadHash !== payloadHash) throw new Error("MGW_IMPORT_CONFLICT");
    if (journal.state === "COMMITTED") return journal;
    const target = path.resolve(resolvedDocumentsRoot, journal.location);
    const relative = path.relative(managedDocsRoot, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("MGW_DOCUMENT_PATH_INVALID");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const serialized = `${JSON.stringify(document)}\n`;

    if (fs.existsSync(target)) {
      const existingBytes = fs.readFileSync(target, "utf8");
      const existing = JSON.parse(existingBytes);
      if (existing?.managedProvenance?.operation_id !== operationId ||
        existing?.managedProvenance?.payload_sha256 !== payloadHash ||
        existing?.managedProvenance?.owner_user_id !== journal.ownerUserId ||
        existingBytes !== serialized)
        throw new Error("MGW_IMPORT_RECOVERY_REQUIRED");
    } else {
      const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
      writeFileDurable(temp, serialized);
      try {
        try { fs.linkSync(temp, target); } catch (error) {
          if (error.code !== "EEXIST") throw error;
          const existingBytes = fs.readFileSync(target, "utf8");
      const existing = JSON.parse(existingBytes);
          if (existing?.managedProvenance?.operation_id !== operationId || existing?.managedProvenance?.payload_sha256 !== payloadHash || fs.readFileSync(target, "utf8") !== serialized)
            throw new Error("MGW_IMPORT_RECOVERY_REQUIRED");
        }
      } finally {
        if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
      }
      await afterDocumentWrite(journal);
    }

    const committed = { ...journal, state: "COMMITTED", container_sha256: sha256(serialized), committedAt: journal.preparedAt };
    atomicJson(file, committed);
    await afterCommit(committed);
    return committed;
  }

  async function get(operationId, payloadHash) {
    const journal = getSync(operationId);
    if (!journal) return null;
    if (payloadHash && journal.payloadHash !== payloadHash) throw new Error("MGW_IMPORT_CONFLICT");
    return journal;
  }

  return { prepare, commit, get, documentsRoot, managedDocsRoot, canonicalJson, sha256 };
}

module.exports = { createManagedStore, canonicalJson, sha256 };
