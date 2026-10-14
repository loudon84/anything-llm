const { MeetingError } = require("./errors");

function createWorkspaceRetriever({ lookupWorkspace, searchWorkspace } = {}) {
  if (
    typeof lookupWorkspace !== "function" ||
    typeof searchWorkspace !== "function"
  ) {
    throw new TypeError(
      "createWorkspaceRetriever requires authenticated workspace lookup and search adapters"
    );
  }

  async function resolve({ workspaceIds, userId }) {
    const resolved = [];
    for (const id of workspaceIds) {
      let workspace;
      try {
        workspace = await lookupWorkspace({ id, userId });
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

  return { resolve, search };
}

module.exports = { createWorkspaceRetriever };
