const { createJobRunner } = require("../../modules/meetings/jobs");

test("worker admission runs before any job handler and can deny queued work", async () => {
  const row = {
    id: 1,
    kind: "IMPORT",
    payload: JSON.stringify({ authContext: { kind: "GATEWAY_SESSION", sessionId: "s1", userId: 1, credentialEpoch: 2 } }),
    status: "CREATED",
    attempts: 0,
    leaseOwner: null,
    leaseUntil: null,
  };
  const jobs = {
    findMany: async () => row.status === "CREATED" ? [row] : [],
    updateMany: async ({ where, data }) => {
      if (row.id !== where.id || row.status !== where.status) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    findUnique: async () => row,
  };
  const db = { meeting_jobs: jobs, $transaction: async (callback) => callback(db) };
  const handler = jest.fn();
  const authorizeJob = jest.fn(async () => {
    const error = new Error("local only");
    error.code = "MGW_REMOTE_ACCESS_REQUIRED";
    throw error;
  });
  const runner = createJobRunner({ prisma: db, handlers: { IMPORT: handler }, authorizeJob });

  await expect(runner.runOnce()).rejects.toMatchObject({ code: "MGW_REMOTE_ACCESS_REQUIRED" });
  expect(authorizeJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "IMPORT" }));
  expect(handler).not.toHaveBeenCalled();
});
