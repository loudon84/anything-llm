const { MeetingError } = require("./errors");

function createWorkspaceRetriever({
  lookupWorkspace,
  searchWorkspace,
  lookupDocument,
} = {}) {
  if (
    typeof lookupWorkspace !== "function" ||
    typeof searchWorkspace !== "function"
  ) {
    throw new TypeError(
      "createWorkspaceRetriever requires authenticated workspace lookup and search adapters"
    );
  }

  async function resolve({ workspaceIds, userId, db }) {
    const resolved = [];
    for (const id of workspaceIds) {
      let workspace;
      try {
        workspace = await lookupWorkspace({ id, userId, db });
      } catch (error) {
        throw new MeetingError(
          `Workspace access check failed: ${error.message}`,
          "WORKSPACE_ACCESS_FAILED",
          503
        );
      }
      if (!workspace || Number(workspace.id) !== Number(id)) {
        throw new MeetingError(
          "A selected Workspace is unavailable or inaccessible",
          "WORKSPACE_FORBIDDEN",
          403
        );
      }
      resolved.push(workspace);
    }
    return resolved;
  }

  async function search({ workspaceIds, userId, question, limit = 20 }) {
    const workspaces = await resolve({ workspaceIds, userId });
    const results = [];
    for (const workspace of workspaces) {
      let found;
      try {
        found = await searchWorkspace({ workspace, userId, question, limit });
      } catch (error) {
        throw new MeetingError(
          `Workspace retrieval failed: ${error.message}`,
          "WORKSPACE_RETRIEVAL_FAILED",
          502
        );
      }
      if (!Array.isArray(found)) {
        throw new MeetingError(
          "Workspace search returned an invalid evidence set",
          "INVALID_WORKSPACE_EVIDENCE",
          502
        );
      }
      for (const item of found) {
        const workspaceId = workspace.id;
        const localId = String(item?.evidenceId ?? item?.id ?? "");
        const quote = String(item?.quote ?? item?.text ?? "");
        if (!localId || !quote.trim()) continue;
        const link =
          typeof item.link === "string" && item.link.trim() ? item.link : null;
        results.push({
          evidenceId: `workspace:${workspaceId}:${localId}`,
          workspaceId,
          name: String(item.name || item.filename || "Workspace document"),
          quote,
          location: item.location ?? null,
          sourceType: "WORKSPACE",
          documentId:
            String(
              item.documentId ?? item.docId ?? item.metadata?.docId ?? ""
            ) || null,
          revision:
            item.revision ??
            item.lastUpdatedAt ??
            item.metadata?.lastUpdatedAt ??
            null,
          score: Number.isFinite(Number(item.score))
            ? Number(item.score)
            : null,
          originalUnavailable:
            item.originalAvailable === false ||
            (!link && item.originalAvailable !== true),
          ...(link ? { link } : { link: null }),
        });
      }
    }
    return results;
  }

  async function validateEvidence({ workspaceIds, userId, evidence, db } = {}) {
    const workspaces = await resolve({ workspaceIds, userId, db });
    const scoped = (evidence || []).filter(
      (item) => item.sourceType === "WORKSPACE"
    );
    if (!scoped.length) return true;
    const workspaceById = new Map(
      workspaces.map((workspace) => [Number(workspace.id), workspace])
    );
    for (const item of scoped) {
      const workspace = workspaceById.get(Number(item.workspaceId));
      if (!workspace || !item.documentId || !item.revision) return false;
      let document;
      if (typeof lookupDocument === "function") {
        document = await lookupDocument({
          workspace,
          userId,
          documentId: item.documentId,
          db,
        });
      } else if (typeof db?.workspace_documents?.findFirst === "function") {
        document = await db.workspace_documents.findFirst({
          where: {
            workspaceId: Number(item.workspaceId),
            docId: String(item.documentId),
          },
        });
      } else {
        throw new MeetingError(
          "Workspace document membership validation is not configured",
          "WORKSPACE_VALIDATION_UNAVAILABLE",
          503
        );
      }
      const currentRevision = document?.revision ?? document?.lastUpdatedAt;
      const sameRevision = (left, right) => {
        if (left == null || right == null) return false;
        const leftTime = new Date(left).getTime();
        const rightTime = new Date(right).getTime();
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime))
          return leftTime === rightTime;
        return String(left) === String(right);
      };
      if (
        !document ||
        !currentRevision ||
        !sameRevision(currentRevision, item.revision)
      )
        return false;
    }
    return true;
  }

  return { resolve, search, validateEvidence };
}

module.exports = { createWorkspaceRetriever };
