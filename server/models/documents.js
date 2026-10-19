const { v4: uuidv4 } = require("uuid");
const { getVectorDbClass } = require("../utils/helpers");
const prisma = require("../utils/prisma");
const { Telemetry } = require("./telemetry");
const { EventLogs } = require("./eventLogs");
const { safeJsonParse } = require("../utils/http");
const { getModelTag } = require("../endpoints/utils");

const MANAGED_PROVENANCE_FIELDS = ["operation_id", "import_id", "generation", "owner_user_id", "workspace_id", "payload_sha256"];
function sameManagedProvenance(existing, incoming) {
  if (!existing || !incoming) return false;
  const existingFields = Object.keys(existing).sort();
  const incomingFields = Object.keys(incoming).sort();
  const expectedFields = [...MANAGED_PROVENANCE_FIELDS].sort();
  if (JSON.stringify(existingFields) !== JSON.stringify(expectedFields) ||
      JSON.stringify(incomingFields) !== JSON.stringify(expectedFields)) return false;
  return MANAGED_PROVENANCE_FIELDS.every((field) => existing[field] === incoming[field]);
}

const Document = {
  writable: ["pinned", "watched", "lastUpdatedAt"],
  /**
   * @param {import("@prisma/client").workspace_documents} document - Document PrismaRecord
   * @returns {{
   *  metadata: (null|object),
   *  type: import("./documentSyncQueue.js").validFileType,
   *  source: string
   * }}
   */
  parseDocumentTypeAndSource: function (document) {
    const metadata = safeJsonParse(document.metadata, null);
    if (!metadata) return { metadata: null, type: null, source: null };

    // Parse the correct type of source and its original source path.
    const idx = metadata.chunkSource.indexOf("://");
    const [type, source] = [
      metadata.chunkSource.slice(0, idx),
      metadata.chunkSource.slice(idx + 3),
    ];
    return { metadata, type, source: this._stripSource(source, type) };
  },

  forWorkspace: async function (workspaceId = null) {
    if (!workspaceId) return [];
    return await prisma.workspace_documents.findMany({
      where: { workspaceId },
    });
  },

  isManagedPath: function (path) {
    return typeof path === "string" && path.replace(/\\/g, "/").split("/").includes("meeting-managed");
  },

  assertNoManagedPaths: function (paths = []) {
    if (paths.some((path) => this.isManagedPath(path)))
      throw new Error("MGW_MANAGED_DOCUMENT_REQUIRES_CLEANUP");
  },

  assertNoManagedDocuments: async function (clause = {}) {
    const documents = await prisma.workspace_documents.findMany({ where: clause });
    if (documents.some((document) => this.isManagedPath(document.docpath)))
      throw new Error("MGW_MANAGED_DOCUMENT_REQUIRES_CLEANUP");
    return true;
  },

  delete: async function (clause = {}) {
    await this.assertNoManagedDocuments(clause);
    try {
      await prisma.workspace_documents.deleteMany({ where: clause });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  get: async function (clause = {}) {
    try {
      const document = await prisma.workspace_documents.findFirst({
        where: clause,
      });
      return document || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (
    clause = {},
    limit = null,
    orderBy = null,
    include = null,
    select = null
  ) {
    try {
      const results = await prisma.workspace_documents.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
        ...(include !== null ? { include } : {}),
        ...(select !== null ? { select: { ...select } } : {}),
      });
      return results;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  addDocuments: async function (
    workspace,
    additions = [],
    userId = null,
    { originalRetention = null } = {}
  ) {
    if (additions.length === 0) return { failed: [], embedded: [] };
    this.assertNoManagedPaths(additions);
    const VectorDb = getVectorDbClass();
    let workspaceOriginals = originalRetention;
    const { fileData } = require("../utils/files");
    const { emitProgress } = require("../utils/EmbeddingWorkerManager");
    const embedded = [];
    const failedToEmbed = [];
    const errors = new Set();

    emitProgress(workspace.slug, {
      type: "batch_starting",
      workspaceSlug: workspace.slug,
      userId,
      filenames: additions,
      totalDocs: additions.length,
    });

    for (const [index, path] of additions.entries()) {
      const docProgress = {
        workspaceSlug: workspace.slug,
        userId,
        filename: path,
        docIndex: index,
        totalDocs: additions.length,
      };

      const data = await fileData(path);
      if (!data) {
        emitProgress(workspace.slug, {
          type: "doc_failed",
          ...docProgress,
          error: "Failed to load file data",
        });
        continue;
      }

      const docId = uuidv4();
      const { pageContent: _pageContent, ...metadata } = data;
      const newDoc = {
        docId,
        filename: path.split(/[/\\]/).pop(),
        docpath: path,
        workspaceId: workspace.id,
        metadata: JSON.stringify(metadata),
      };

      emitProgress(workspace.slug, { type: "doc_starting", ...docProgress });

      global.__embeddingProgress = {
        workspaceSlug: workspace.slug,
        filename: path,
        userId,
      };

      const { vectorized, error } = await VectorDb.addDocumentToNamespace(
        workspace.slug,
        { ...data, docId },
        path
      );

      if (!vectorized) {
        console.error(
          "Failed to vectorize",
          metadata?.title || newDoc.filename
        );
        failedToEmbed.push(metadata?.title || newDoc.filename);
        errors.add(error);
        emitProgress(workspace.slug, {
          type: "doc_failed",
          ...docProgress,
          error: error || "Unknown error",
        });
        continue;
      }

      let originalBound = false;
      try {
        if (typeof data.workspaceOriginalId === "string") {
          workspaceOriginals ||= require("../utils/workspaceOriginals").getWorkspaceOriginals();
          await workspaceOriginals.bind({
            referenceId: data.workspaceOriginalId,
            workspaceId: workspace.id,
            docId,
            parsedDocumentId: data.id,
            documentPath: path,
            contentHash: require("crypto")
              .createHash("sha256")
              .update(String(data.pageContent || ""))
              .digest("hex"),
          });
          originalBound = true;
        }
        await prisma.workspace_documents.create({ data: newDoc });
        embedded.push(path);
        emitProgress(workspace.slug, {
          type: "doc_complete",
          ...docProgress,
        });
      } catch (error) {
        console.error(error.message);
        failedToEmbed.push(metadata?.title || newDoc.filename);
        errors.add(error.message || "Failed to save document record");
        if (originalBound)
          await workspaceOriginals
            .unbind({
              referenceId: data.workspaceOriginalId,
              workspaceId: workspace.id,
              docId,
            })
            .catch((cleanupError) => console.error(cleanupError.message));
        try {
          await VectorDb.deleteDocumentFromNamespace(workspace.slug, docId);
        } catch (cleanupError) {
          console.error(cleanupError.message);
        }
        try {
          await prisma.document_vectors.deleteMany({ where: { docId } });
        } catch (cleanupError) {
          console.error(cleanupError.message);
        }
        emitProgress(workspace.slug, {
          type: "doc_failed",
          ...docProgress,
          error: "Failed to save document record",
        });
      }
    }

    global.__embeddingProgress = null;

    emitProgress(workspace.slug, {
      type: "all_complete",
      workspaceSlug: workspace.slug,
      userId,
      totalDocs: additions.length,
      embedded: embedded.length,
      failed: failedToEmbed.length,
    });

    await Telemetry.sendTelemetry("documents_embedded_in_workspace", {
      LLMSelection: process.env.LLM_PROVIDER || "openai",
      Embedder: process.env.EMBEDDING_ENGINE || "inherit",
      VectorDbSelection: process.env.VECTOR_DB || "lancedb",
      TTSSelection: process.env.TTS_PROVIDER || "native",
      LLMModel: getModelTag(),
    });
    await EventLogs.logEvent(
      "workspace_documents_added",
      {
        workspaceName: workspace?.name || "Unknown Workspace",
        numberOfDocumentsAdded: additions.length,
      },
      userId
    );
    return { failedToEmbed, errors: Array.from(errors), embedded };
  },

  addManagedDocument: async function ({ tx = null, workspace, location, docId, document }) {
    if (!workspace?.id || !location || !docId || document?.id !== docId ||
        !location.replace(/\\/g, "/").split("/").includes("meeting-managed") ||
        typeof document.pageContent !== "string" || !document.managedProvenance)
      throw new Error("MGW_MANAGED_DOCUMENT_INVALID");

    const db = tx || prisma;
    const existing = await db.workspace_documents.findFirst({
      where: { docId },
    });
    if (existing) {
      const existingMetadata = safeJsonParse(existing.metadata, null);
      if (existing.workspaceId !== workspace.id || existing.docpath !== location ||
          !sameManagedProvenance(existingMetadata?.managedProvenance, document.managedProvenance))
        throw new Error("MGW_IMPORT_CONFLICT");
    }
    if (!existing) {
      const { pageContent: _pageContent, ...metadata } = document;
      await db.workspace_documents.create({
        data: {
          docId,
          filename: location.split(/[/\\]/).pop(),
          docpath: location,
          workspaceId: workspace.id,
          metadata: JSON.stringify(metadata),
        },
      });
    }
    return { associated: true, docId };
  },

  getManagedDocument: async function ({ workspaceId, location, docId }) {
    const document = await prisma.workspace_documents.findFirst({
      where: { docId, workspaceId, docpath: location },
    });
    if (!document) return null;
    const vectorCount = await prisma.document_vectors.count({ where: { docId } });
    return { docId: document.docId, workspaceId: document.workspaceId, docpath: document.docpath, vectorCount };
  },

  getManagedDocumentByDocId: async function ({ docId }) {
    const document = await prisma.workspace_documents.findFirst({ where: { docId } });
    if (!document) return null;
    const metadata = safeJsonParse(document.metadata, null);
    const vectorCount = await prisma.document_vectors.count({ where: { docId } });
    return {
      docId: document.docId,
      workspaceId: document.workspaceId,
      docpath: document.docpath,
      managedProvenance: metadata?.managedProvenance || null,
      vectorCount,
    };
  },

  getWorkspace: async function (workspaceId) {
    const { Workspace } = require("./workspace");
    return Workspace.get({ id: workspaceId });
  },

  removeManagedDocument: async function ({ tx = null, workspace, location, docId }) {
    const db = tx || prisma;
    const document = await db.workspace_documents.findFirst({
      where: { docId, workspaceId: workspace?.id, docpath: location },
    });
    if (!document) return { removed: false };
    if (tx) {
      await tx.document_vectors.deleteMany({ where: { docId } });
      await tx.workspace_documents.delete({ where: { id: document.id } });
    } else {
      await prisma.$transaction([
        prisma.document_vectors.deleteMany({ where: { docId } }),
        prisma.workspace_documents.delete({ where: { id: document.id } }),
      ]);
    }
    return { removed: true, docId };
  },

  removeDocuments: async function (
    workspace,
    removals = [],
    userId = null,
    { originalRetention = null } = {}
  ) {
    if (removals.length === 0) return;
    this.assertNoManagedPaths(removals);
    const VectorDb = getVectorDbClass();
    let workspaceOriginals = originalRetention;

    for (const path of removals) {
      const document = await this.get({
        docpath: path,
        workspaceId: workspace.id,
      });
      if (!document) continue;
      await VectorDb.deleteDocumentFromNamespace(
        workspace.slug,
        document.docId
      );

      try {
        await prisma.workspace_documents.delete({
          where: { id: document.id, workspaceId: workspace.id },
        });
        const metadata = safeJsonParse(document.metadata, {});
        if (typeof metadata.workspaceOriginalId === "string") {
          workspaceOriginals ||= require("../utils/workspaceOriginals").getWorkspaceOriginals();
          await workspaceOriginals.unbind({
            referenceId: metadata.workspaceOriginalId,
            workspaceId: workspace.id,
            docId: document.docId,
          });
        }
        await prisma.document_vectors.deleteMany({
          where: { docId: document.docId },
        });
      } catch (error) {
        console.error(error.message);
      }
    }

    await EventLogs.logEvent(
      "workspace_documents_removed",
      {
        workspaceName: workspace?.name || "Unknown Workspace",
        numberOfDocuments: removals.length,
      },
      userId
    );
    return true;
  },

  count: async function (clause = {}, limit = null) {
    try {
      const count = await prisma.workspace_documents.count({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
      });
      return count;
    } catch (error) {
      console.error("FAILED TO COUNT DOCUMENTS.", error.message);
      return 0;
    }
  },
  update: async function (id = null, data = {}) {
    if (!id) throw new Error("No workspace document id provided for update");

    const validKeys = Object.keys(data).filter((key) =>
      this.writable.includes(key)
    );
    if (validKeys.length === 0)
      return { document: { id }, message: "No valid fields to update!" };

    try {
      const document = await prisma.workspace_documents.update({
        where: { id },
        data,
      });
      return { document, message: null };
    } catch (error) {
      console.error(error.message);
      return { document: null, message: error.message };
    }
  },
  _updateAll: async function (clause = {}, data = {}) {
    try {
      await prisma.workspace_documents.updateMany({
        where: clause,
        data,
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },
  content: async function (docId) {
    if (!docId) throw new Error("No workspace docId provided!");
    const document = await this.get({ docId: String(docId) });
    if (!document) throw new Error(`Could not find a document by id ${docId}`);

    const { fileData } = require("../utils/files");
    const data = await fileData(document.docpath);
    return { title: data.title, content: data.pageContent };
  },
  contentByDocPath: async function (docPath) {
    const { fileData } = require("../utils/files");
    const data = await fileData(docPath);
    return { title: data.title, content: data.pageContent };
  },

  // Some data sources have encoded params in them we don't want to log - so strip those details.
  _stripSource: function (sourceString, type) {
    if (["confluence", "github"].includes(type)) {
      const _src = new URL(sourceString);
      _src.search = ""; // remove all search params that are encoded for resync.
      return _src.toString();
    }

    return sourceString;
  },

  /**
   * Functions for the backend API endpoints - not to be used by the frontend or elsewhere.
   * @namespace api
   */
  api: {
    /**
     * Process a document upload from the API and upsert it into the database. This
     * functionality should only be used by the backend /v1/documents/upload endpoints for post-upload embedding.
     * @param {string} wsSlugs - The slugs of the workspaces to embed the document into, will be comma-separated list of workspace slugs
     * @param {string} docLocation - The location/path of the document that was uploaded
     * @returns {Promise<boolean>} - True if the document was uploaded successfully, false otherwise
     */
    uploadToWorkspace: async function (wsSlugs = "", docLocation = null) {
      if (!docLocation)
        return console.log(
          "No document location provided for embedding",
          docLocation
        );

      const slugs = wsSlugs
        .split(",")
        .map((slug) => String(slug)?.trim()?.toLowerCase());
      if (slugs.length === 0)
        return console.log(`No workspaces provided got: ${wsSlugs}`);

      const { Workspace } = require("./workspace");
      const workspaces = await Workspace.where({ slug: { in: slugs } });
      if (workspaces.length === 0)
        return console.log("No valid workspaces found for slugs: ", slugs);

      // Upsert the document into each workspace - do this sequentially
      // because the document may be large and we don't want to overwhelm the embedder, plus on the first
      // upsert we will then have the cache of the document - making n+1 embeds faster. If we parallelize this
      // we will have to do a lot of extra work to ensure that the document is not embedded more than once.
      for (const workspace of workspaces) {
        const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
          workspace,
          [docLocation]
        );
        if (failedToEmbed.length > 0)
          return console.log(
            `Failed to embed document into workspace ${workspace.slug}`,
            errors
          );
        console.log(`Document embedded into workspace ${workspace.slug}...`);
      }

      return true;
    },
  },
};

module.exports = { Document };
