const prisma = require("../utils/prisma");
const workspacePolicy = require("../utils/meetingGateway/workspacePolicy").createWorkspacePolicy();

async function assertNoRestrictedMembershipMutation(workspaceId, action) {
  const policy = await workspacePolicy.getPolicy(workspaceId);
  if (policy) throw new Error("MGW_WORKSPACE_POLICY_DENIED");
}

const WorkspaceUser = {
  createMany: async function (userId, workspaceIds = []) {
    if (workspaceIds.length === 0) return;
    try {
      for (const workspaceId of workspaceIds) await assertNoRestrictedMembershipMutation(workspaceId, "member.create");
      await prisma.$transaction(workspaceIds.map((workspaceId) => prisma.workspace_users.create({ data: { user_id: userId, workspace_id: workspaceId } })));
    } catch (error) {
      console.error(error.message);
    }
    return;
  },

  createManyUsers: async function (userIds = [], workspaceId) {
    if (userIds.length === 0) return;
    try {
      await assertNoRestrictedMembershipMutation(workspaceId, "member.create");
      await prisma.$transaction(userIds.map((userId) => prisma.workspace_users.create({ data: { user_id: Number(userId), workspace_id: Number(workspaceId) } })));
    } catch (error) {
      console.error(error.message);
    }
    return;
  },

  create: async function (userId = 0, workspaceId = 0) {
    try {
      await assertNoRestrictedMembershipMutation(workspaceId, "member.create");
      await prisma.workspace_users.create({ data: { user_id: Number(userId), workspace_id: Number(workspaceId) } });
      return true;
    } catch (error) {
      console.error("FAILED TO CREATE WORKSPACE_USER RELATIONSHIP.", error.message);
      return false;
    }
  },

  get: async function (clause = {}) {
    try {
      const result = await prisma.workspace_users.findFirst({ where: clause });
      return result || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (clause = {}, limit = null) {
    try {
      return await prisma.workspace_users.findMany({ where: clause, ...(limit !== null ? { take: limit } : {}) });
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  count: async function (clause = {}) {
    try {
      return await prisma.workspace_users.count({ where: clause });
    } catch (error) {
      console.error(error.message);
      return 0;
    }
  },

  delete: async function (clause = {}) {
    try {
      let rows = [];
      if (clause.workspace_id != null) {
        await assertNoRestrictedMembershipMutation(clause.workspace_id, "member.delete");
      } else {
        rows = await prisma.workspace_users.findMany({ where: clause, select: { workspace_id: true } });
        for (const row of rows) await assertNoRestrictedMembershipMutation(row.workspace_id, "member.delete");
      }
      await prisma.workspace_users.deleteMany({ where: clause });
    } catch (error) {
      console.error(error.message);
    }
    return;
  },
};

module.exports.WorkspaceUser = WorkspaceUser;
