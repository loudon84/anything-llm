const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const contained = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

function createWorkspaceOriginals({ hotdirPath, storageRoot } = {}) {
  if (!hotdirPath || !storageRoot)
    throw new TypeError(
      "Workspace original retention requires hotdirPath and storageRoot"
    );
  const hotdir = path.resolve(hotdirPath);
  const originalsRoot = path.resolve(storageRoot, "workspace-originals");

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
    const stat = await fs.stat(realSource);
    if (!stat.isFile())
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
    const manifestPath = path.join(originalsRoot, `${referenceId}.json`);
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        referenceId,
        fileName: safeName,
        extension: safeExtension,
        fileId: referenceId,
        workspaceId: null,
        docId: null,
      }),
      { flag: "wx", mode: 0o600 }
    );
    const additionalManifests = new Set();
    const cleanup = async () => {
      await Promise.all([
        fs.rm(destination, { force: true }),
        fs.rm(manifestPath, { force: true }),
        ...[...additionalManifests].map((item) => fs.rm(item, { force: true })),
      ]);
    };
    const attach = async (documents) =>
      Promise.all(
        (documents || []).map(async (document) => {
          const documentReference = crypto.randomUUID();
          const documentManifestPath = path.join(
            originalsRoot,
            `${documentReference}.json`
          );
          await fs.writeFile(
            documentManifestPath,
            JSON.stringify({
              referenceId: documentReference,
              fileName: safeName,
              extension: safeExtension,
              fileId: referenceId,
              workspaceId: null,
              docId: null,
            }),
            { flag: "wx", mode: 0o600 }
          );
          additionalManifests.add(documentManifestPath);
          const metadata = { ...(document?.metadata || {}) };
          delete metadata.originalFile;
          delete metadata.workspaceOriginal;
          delete metadata.workspaceOriginalId;
          delete metadata.originalHref;
          return {
            ...document,
            metadata: { ...metadata, workspaceOriginalId: documentReference },
          };
        })
      );
    return { referenceId, attach, cleanup };
  }

  async function bind({ referenceId, workspaceId, docId } = {}) {
    const manifestPath = manifestFor(referenceId);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (manifest.referenceId !== referenceId)
      throw new Error("Invalid retained original reference");
    const numericWorkspace = Number(workspaceId);
    if (
      !Number.isSafeInteger(numericWorkspace) ||
      numericWorkspace <= 0 ||
      !String(docId || "")
    )
      throw new Error(
        "A Workspace and document identity are required to bind an original"
      );
    if (manifest.workspaceId !== null || manifest.docId !== null)
      throw new Error("Retained original is already bound to another document");
    const temp = `${manifestPath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(
      temp,
      JSON.stringify({
        ...manifest,
        workspaceId: numericWorkspace,
        docId: String(docId),
      }),
      { flag: "wx", mode: 0o600 }
    );
    await fs.rename(temp, manifestPath);
  }

  async function resolve({ referenceId, workspaceId, docId } = {}) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(referenceId || "")
      )
    )
      return null;
    let manifest;
    try {
      manifest = JSON.parse(
        await fs.readFile(manifestFor(referenceId), "utf8")
      );
    } catch {
      return null;
    }
    if (
      manifest.referenceId !== referenceId ||
      manifest.workspaceId !== Number(workspaceId) ||
      manifest.docId !== String(docId)
    )
      return null;
    const filePath = path.resolve(
      originalsRoot,
      `${manifest.fileId}${manifest.extension || ""}`
    );
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(manifest.fileId || "")
      ) ||
      (manifest.extension && !/^\.[a-z0-9]{1,10}$/i.test(manifest.extension))
    )
      return null;
    if (!contained(originalsRoot, filePath)) return null;
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
    if (!/^[0-9a-f-]{36}$/i.test(String(referenceId || "")))
      throw new Error("Invalid retained original reference");
    const target = path.resolve(originalsRoot, `${referenceId}.json`);
    if (!contained(originalsRoot, target))
      throw new Error("Retained original manifest escaped its storage root");
    return target;
  }

  return { retain, bind, resolve, originalsRoot };
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
