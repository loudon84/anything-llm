const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const contained = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};
const safeRelativeDocumentPath = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  return normalized;
};

function createWorkspaceOriginals({
  hotdirPath,
  storageRoot,
  documentStore,
} = {}) {
  if (!hotdirPath || !storageRoot)
    throw new TypeError(
      "Workspace original retention requires hotdirPath and storageRoot"
    );
  const hotdir = path.resolve(hotdirPath);
  const originalsRoot = path.resolve(storageRoot, "workspace-originals");
  const bindingsRoot = path.join(originalsRoot, "bindings");
  const store = documentStore || require("./files");

  async function retain(filename) {
    const safeName = String(filename || "");
    if (
      !safeName ||
      path.basename(safeName) !== safeName ||
      safeName === "." ||
      safeName === ".."
    )
      throw new Error("Invalid uploaded filename");
    const source = path.resolve(hotdir, safeName);
    if (!contained(hotdir, source))
      throw new Error("Uploaded file is outside the collector hotdir");
    const [realHotdir, realSource] = await Promise.all([
      fs.realpath(hotdir),
      fs.realpath(source),
    ]);
    if (!contained(realHotdir, realSource))
      throw new Error("Uploaded file resolves outside the collector hotdir");
    if (!(await fs.stat(realSource)).isFile())
      throw new Error("Uploaded source is not a regular file");
    const extension = path.extname(safeName);
    const safeExtension = /^\.[a-z0-9]{1,10}$/i.test(extension)
      ? extension
      : "";
    const referenceId = crypto.randomUUID();
    const destination = path.resolve(
      originalsRoot,
      `${referenceId}${safeExtension}`
    );
    if (!contained(originalsRoot, destination))
      throw new Error("Generated original path escaped its storage root");
    await fs.mkdir(originalsRoot, { recursive: true });
    await fs.copyFile(realSource, destination);
    const manifestPath = manifestFor(referenceId);
    await writeJsonExclusive(manifestPath, {
      referenceId,
      fileName: safeName,
      extension: safeExtension,
      fileId: referenceId,
      parsedDocumentId: null,
      contentHash: null,
      parsedFileName: null,
      originalLocation: null,
    });
    const additionalReferences = new Set();
    const cleanup = async () => {
      await Promise.all([
        fs.rm(destination, { force: true }),
        fs.rm(manifestPath, { force: true }),
        ...[...additionalReferences].flatMap((item) => [
          fs.rm(manifestFor(item), { force: true }),
          fs.rm(path.join(bindingsRoot, item), {
            recursive: true,
            force: true,
          }),
        ]),
      ]);
    };
    const attach = async (documents) =>
      Promise.all(
        (documents || []).map(async (document) => {
          const location = safeRelativeDocumentPath(document?.location);
          const parsedDocumentId = String(document?.id || "");
          if (
            !location ||
            !parsedDocumentId ||
            typeof document?.pageContent !== "string"
          )
            throw new Error(
              "Collector output lacks a persisted parsed-document identity"
            );
          const persisted = await store.fileData(location);
          const contentHash = hash(persisted?.pageContent);
          if (
            String(persisted?.id || "") !== parsedDocumentId ||
            typeof persisted?.pageContent !== "string" ||
            persisted.pageContent !== document.pageContent
          )
            throw new Error(
              "Collector output does not match its saved parsed document"
            );
          const documentReference = crypto.randomUUID();
          const documentManifest = {
            referenceId: documentReference,
            fileName: safeName,
            extension: safeExtension,
            fileId: referenceId,
            parsedDocumentId,
            contentHash,
            parsedFileName: path.posix.basename(location),
            originalLocation: location,
          };
          await writeJsonExclusive(
            manifestFor(documentReference),
            documentManifest
          );
          additionalReferences.add(documentReference);
          try {
            await store.updateDocumentData(location, (data) => {
              if (
                String(data?.id || "") !== parsedDocumentId ||
                hash(data.pageContent) !== contentHash
              )
                throw new Error(
                  "Saved parsed document changed while attaching its original"
                );
              const clean = { ...data };
              for (const field of [
                "originalFile",
                "workspaceOriginal",
                "workspaceOriginalId",
                "workspaceOriginalDocumentId",
                "originalHref",
              ])
                delete clean[field];
              clean.workspaceOriginalId = documentReference;
              return clean;
            });
          } catch (error) {
            additionalReferences.delete(documentReference);
            await fs.rm(manifestFor(documentReference), { force: true });
            throw error;
          }
          const clean = { ...document };
          delete clean.originalFile;
          delete clean.workspaceOriginal;
          delete clean.originalHref;
          const metadata = { ...(clean.metadata || {}) };
          delete metadata.originalFile;
          delete metadata.workspaceOriginal;
          delete metadata.workspaceOriginalId;
          delete metadata.originalHref;
          return { ...clean, metadata, workspaceOriginalId: documentReference };
        })
      );
    return { referenceId, attach, cleanup };
  }

  async function bind({
    referenceId,
    workspaceId,
    docId,
    parsedDocumentId,
    documentPath,
    contentHash,
  } = {}) {
    const manifest = await readManifest(referenceId);
    const numericWorkspace = Number(workspaceId);
    const location = safeRelativeDocumentPath(documentPath);
    if (!manifest || manifest.referenceId !== referenceId)
      throw new Error("Invalid retained original reference");
    if (
      !Number.isSafeInteger(numericWorkspace) ||
      numericWorkspace <= 0 ||
      !String(docId || "")
    )
      throw new Error(
        "A Workspace and document identity are required to bind an original"
      );
    if (
      String(parsedDocumentId || "") !== manifest.parsedDocumentId ||
      String(contentHash || "") !== manifest.contentHash ||
      !location ||
      path.posix.basename(location) !== manifest.parsedFileName
    )
      throw new Error(
        "Parsed document identity does not match the retained original"
      );
    const persisted = await store.fileData(location);
    if (
      persisted?.workspaceOriginalId !== referenceId ||
      String(persisted?.id || "") !== manifest.parsedDocumentId ||
      hash(persisted?.pageContent) !== manifest.contentHash ||
      String(persisted?.pageContent ?? "") === ""
    )
      throw new Error(
        "Document path does not contain the genuine parsed document"
      );
    const bindingPath = bindingFor(
      referenceId,
      numericWorkspace,
      String(docId)
    );
    await fs.mkdir(path.dirname(bindingPath), { recursive: true });
    const binding = {
      referenceId,
      workspaceId: numericWorkspace,
      docId: String(docId),
      parsedDocumentId: manifest.parsedDocumentId,
      contentHash: manifest.contentHash,
      documentPath: location,
    };
    try {
      await writeJsonExclusive(bindingPath, binding);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readJson(bindingPath);
      if (JSON.stringify(existing) !== JSON.stringify(binding)) throw error;
    }
  }

  async function unbind({ referenceId, workspaceId, docId } = {}) {
    const bindingPath = bindingFor(
      referenceId,
      Number(workspaceId),
      String(docId || "")
    );
    await fs.rm(bindingPath, { force: true });
  }

  async function resolve({ referenceId, workspaceId, docId } = {}) {
    if (!UUID.test(String(referenceId || ""))) return null;
    const manifest = await readManifest(referenceId);
    if (!manifest || manifest.referenceId !== referenceId) return null;
    let binding;
    try {
      binding = await readJson(
        bindingFor(referenceId, Number(workspaceId), String(docId || ""))
      );
    } catch {
      return null;
    }
    if (
      binding?.referenceId !== referenceId ||
      binding.workspaceId !== Number(workspaceId) ||
      binding.docId !== String(docId)
    )
      return null;
    const filePath = path.resolve(
      originalsRoot,
      `${manifest.fileId}${manifest.extension || ""}`
    );
    if (
      !UUID.test(String(manifest.fileId || "")) ||
      (manifest.extension && !/^\.[a-z0-9]{1,10}$/i.test(manifest.extension)) ||
      !contained(originalsRoot, filePath)
    )
      return null;
    try {
      const [realRoot, realFile] = await Promise.all([
        fs.realpath(originalsRoot),
        fs.realpath(filePath),
      ]);
      if (!contained(realRoot, realFile) || !(await fs.stat(realFile)).isFile())
        return null;
    } catch {
      return null;
    }
    return { filePath, fileName: manifest.fileName, referenceId };
  }

  function manifestFor(referenceId) {
    if (!UUID.test(String(referenceId || "")))
      throw new Error("Invalid retained original reference");
    const target = path.resolve(originalsRoot, `${referenceId}.json`);
    if (!contained(originalsRoot, target))
      throw new Error("Retained original manifest escaped its storage root");
    return target;
  }

  function bindingFor(referenceId, workspaceId, docId) {
    if (
      !UUID.test(String(referenceId || "")) ||
      !Number.isSafeInteger(workspaceId) ||
      workspaceId <= 0 ||
      !docId
    )
      throw new Error("Invalid retained original binding");
    const bindingId = hash(`${workspaceId}:${docId}`);
    const target = path.resolve(bindingsRoot, referenceId, `${bindingId}.json`);
    if (!contained(bindingsRoot, target))
      throw new Error("Retained original binding escaped its storage root");
    return target;
  }

  async function readManifest(referenceId) {
    try {
      return await readJson(manifestFor(referenceId));
    } catch {
      return null;
    }
  }

  return { retain, bind, unbind, resolve, originalsRoot };
}

async function writeJsonExclusive(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(value), {
      flag: "wx",
      mode: 0o600,
    });
    // Publish a complete file atomically without replacing an existing binding.
    // A concurrent EEXIST reader can then safely inspect the winning record.
    await fs.link(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

let defaultService = null;
function getWorkspaceOriginals() {
  if (defaultService) return defaultService;
  const { hotdirPath } = require("./files");
  const defaultStorageRoot =
    process.env.NODE_ENV === "development"
      ? path.resolve(__dirname, "../storage")
      : process.env.STORAGE_DIR || path.resolve(__dirname, "../storage");
  defaultService = createWorkspaceOriginals({
    hotdirPath,
    storageRoot: defaultStorageRoot,
  });
  return defaultService;
}

module.exports = { createWorkspaceOriginals, getWorkspaceOriginals };
