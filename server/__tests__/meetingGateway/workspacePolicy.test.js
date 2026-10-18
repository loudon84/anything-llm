const { canReadRestricted, createWorkspacePolicy } = require("../../utils/meetingGateway/workspacePolicy");

describe("meeting restricted workspace policy", () => {
  test("only the owner with a USER identity can read a restricted workspace", () => {
    const policy = { owner_user_id: 1, state: "ACTIVE" };
    expect(canReadRestricted(policy, { kind: "USER", userId: 1 })).toBe(true);
    expect(canReadRestricted(policy, { kind: "USER", userId: 2, role: "admin" })).toBe(false);
    expect(canReadRestricted(policy, { kind: "USER", userId: 2, role: "manager" })).toBe(false);
    expect(canReadRestricted(policy, { kind: "API_KEY", userId: 1 })).toBe(false);
    expect(canReadRestricted(policy, { kind: "ANONYMOUS", userId: 1 })).toBe(false);
    expect(canReadRestricted({ ...policy, state: "FROZEN" }, { kind: "USER", userId: 1 })).toBe(false);
  });

  test("fresh workspace, policy, and sole owner membership are created atomically", async () => {
    const calls = [];
    const tx = {
      workspaces: { create: jest.fn(async ({ data }) => { calls.push(["workspace", data]); return { id: 15, ...data }; }) },
      meeting_restricted_workspaces: { create: jest.fn(async ({ data }) => calls.push(["policy", data])) },
      workspace_users: { create: jest.fn(async ({ data }) => calls.push(["owner", data])) },
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const policy = createWorkspacePolicy({ prisma });
    const workspace = await policy.createRestricted({ userId: 1, name: "My Meetings" });

    expect(workspace.id).toBe(15);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(calls.map(([kind]) => kind)).toEqual(["workspace", "policy", "owner"]);
    expect(calls[1][1]).toEqual(expect.objectContaining({ workspace_id: 15, owner_user_id: 1, policy_epoch: 1, state: "ACTIVE" }));
    expect(calls[2][1]).toEqual({ user_id: 1, workspace_id: 15 });
  });

  test("policy mutations compare and advance policy_epoch transactionally", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      meeting_restricted_workspaces: { findUnique: jest.fn(async () => ({ workspace_id: 15, owner_user_id: 1, policy_epoch: 4, state: "ACTIVE" })) },
      $transaction: async (callback) => callback({ meeting_restricted_workspaces: { updateMany } }),
    };
    const policy = createWorkspacePolicy({ prisma });
    await expect(policy.assertMutation({ workspaceId: 15, actor: { kind: "USER", userId: 1 }, action: "rename", expectedEpoch: 4 })).resolves.toMatchObject({ policy_epoch: 5 });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspace_id: 15, policy_epoch: 4, state: "ACTIVE" }, data: { policy_epoch: { increment: 1 } } }));
    await expect(policy.assertMutation({ workspaceId: 15, actor: { kind: "USER", userId: 1 }, action: "rename", expectedEpoch: 3 })).rejects.toThrow("MGW_WORKSPACE_POLICY_CONFLICT");
  });

  test("embed creation is rejected for restricted workspaces and unchanged for ordinary ones", async () => {
    const store = {
      async findRestrictedWorkspace(id) {
        return Number(id) === 15 ? { workspace_id: 15, owner_user_id: 1, policy_epoch: 1, state: "ACTIVE" } : null;
      },
    };
    const policy = createWorkspacePolicy({ store, prisma: {} });
    await expect(policy.assertMutation({ workspaceId: 15, actor: { kind: "API_KEY" }, action: "embed.create" })).rejects.toThrow("MGW_RESOURCE_NOT_ACCESSIBLE");
    await expect(policy.assertMutation({ workspaceId: 16, actor: { kind: "API_KEY" }, action: "embed.create" })).resolves.toBeNull();
  });

  test("restricted filtering excludes admins while preserving ordinary workspaces", async () => {
    const workspaces = [{ id: 1 }, { id: 2 }];
    const store = { async findRestrictedWorkspaces(ids) { return ids.includes(1) ? [{ workspace_id: 1, owner_user_id: 1, state: "ACTIVE" }] : []; } };
    const policy = createWorkspacePolicy({ store, prisma: {} });
    await expect(policy.filterVisible(workspaces, { kind: "USER", userId: 1, role: "admin" })).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });
});
