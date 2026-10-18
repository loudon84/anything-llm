const { randomUUID } = require("crypto");

const POLICY_CONFLICT = "MGW_WORKSPACE_POLICY_CONFLICT";
const NOT_OWNER = "MGW_RESOURCE_NOT_ACCESSIBLE";
const MUTATION_DENIED = "MGW_WORKSPACE_POLICY_DENIED";

function ownerId(policy) {
  return policy?.owner_user_id ?? policy?.ownerUserId ?? policy?.owner_user?.id ?? null;
}

function canReadRestricted(policy, actor) {
  if (!policy || policy.state !== "ACTIVE" || actor?.kind !== "USER") return false;
  const owner = Number(ownerId(policy));
  const user = Number(actor.userId);
  return Number.isInteger(owner) && Number.isInteger(user) && owner === user;
}

function createWorkspacePolicy({ store = null, prisma = null } = {}) {
  prisma = prisma || require("../prisma");
  const policyStore = store || {
    findRestrictedWorkspace: (workspaceId) => prisma.meeting_restricted_workspaces.findUnique({ where: { workspace_id: Number(workspaceId) } }),
    findRestrictedWorkspaces: (workspaceIds) => prisma.meeting_restricted_workspaces.findMany({ where: { workspace_id: { in: workspaceIds.map(Number) } } }),
  };

  async function findPolicy(workspaceId) {
    if (typeof policyStore.findRestrictedWorkspace === "function") return policyStore.findRestrictedWorkspace(Number(workspaceId));
    if (typeof policyStore.findRestrictedWorkspaces === "function") {
      const rows = await policyStore.findRestrictedWorkspaces([Number(workspaceId)]);
      return rows.find((row) => Number(row.workspace_id ?? row.workspaceId) === Number(workspaceId)) || null;
    }
    return null;
  }

  return {
    getPolicy: findPolicy,

    async createRestricted({ userId, name }) {
      const owner = Number(userId);
      if (!Number.isInteger(owner) || owner <= 0 || typeof name !== "string" || !name.trim()) throw new Error("MGW_INPUT_INVALID");
      const cleanName = name.trim().slice(0, 255);
      const baseSlug = cleanName.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
      const workspace = await prisma.$transaction(async (tx) => {
        const created = await tx.workspaces.create({
          data: {
            name: cleanName,
            slug: `${baseSlug}-${randomUUID()}`,
            chatMode: "automatic",
          },
        });
        await tx.meeting_restricted_workspaces.create({
          data: { workspace_id: created.id, owner_user_id: owner, policy_epoch: 1, state: "ACTIVE" },
        });
        await tx.workspace_users.create({ data: { user_id: owner, workspace_id: created.id } });
        return created;
      });
      return workspace;
    },

    async assertOwner({ workspaceId, actor }) {
      const policy = await findPolicy(workspaceId);
      if (!policy) return null;
      if (!canReadRestricted(policy, actor)) throw new Error(NOT_OWNER);
      return policy;
    },

    async assertMutation({ workspaceId, actor, action, expectedEpoch }) {
      const policy = await findPolicy(workspaceId);
      if (!policy) return null;
      if (!canReadRestricted(policy, actor)) throw new Error(NOT_OWNER);
      if (["member.create", "member.reset", "member.delete", "embed.create", "embed.update", "share", "move", "copy", "sync"].includes(action))
        throw new Error(MUTATION_DENIED);
      if (!Number.isInteger(expectedEpoch) || expectedEpoch !== policy.policy_epoch) throw new Error(POLICY_CONFLICT);
      return prisma.$transaction(async (tx) => {
        const result = await tx.meeting_restricted_workspaces.updateMany({
          where: { workspace_id: Number(workspaceId), policy_epoch: expectedEpoch, state: "ACTIVE" },
          data: { policy_epoch: { increment: 1 } },
        });
        if (result.count !== 1) throw new Error(POLICY_CONFLICT);
        return { ...policy, policy_epoch: expectedEpoch + 1 };
      });
    },

    async filterVisible(workspaces, actor) {
      if (!Array.isArray(workspaces) || !workspaces.length) return [];
      const policies = typeof policyStore.findRestrictedWorkspaces === "function"
        ? await policyStore.findRestrictedWorkspaces(workspaces.map((workspace) => workspace.id))
        : await Promise.all(workspaces.map((workspace) => findPolicy(workspace.id)));
      const byWorkspaceId = new Map(policies.filter(Boolean).map((policy) => [Number(policy.workspace_id ?? policy.workspaceId), policy]));
      return workspaces.filter((workspace) => {
        const policy = byWorkspaceId.get(Number(workspace.id));
        return !policy || canReadRestricted(policy, actor);
      });
    },
  };
}

module.exports = { createWorkspacePolicy, canReadRestricted, POLICY_CONFLICT, NOT_OWNER, MUTATION_DENIED };
