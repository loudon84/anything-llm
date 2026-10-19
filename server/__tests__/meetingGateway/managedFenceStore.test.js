const { createMeetingStore } = require("../../models/meetingGateway");

function makeHarness({ beforeFenceCas = null } = {}) {
  const now = new Date("2026-10-18T00:00:00.000Z");
  const generation = {
    id: "generation-a", import_id: "import-a", generation: 1,
    state: "ATTACHING", fencing_token: 3, lease_deadline: new Date(now.getTime() + 60_000),
    policy_epoch: 7, vector_doc_id: "doc-a", document_location: "meeting-managed/doc-a.json",
  };
  const imported = { id: "import-a", workspace_id: 5, anything_user_id: 11 };
  const policy = { workspace_id: 5, owner_user_id: 11, state: "ACTIVE", policy_epoch: 7 };
  const tx = {
    $queryRawUnsafe: jest.fn(async (sql) => {
      if (sql.includes("FROM meeting_import_generations")) return [{ ...generation }];
      if (sql.includes("FROM meeting_imports")) return [{ ...imported }];
      if (sql.includes("FROM meeting_restricted_workspaces")) return [{ ...policy }];
      return [];
    }),
    $executeRawUnsafe: jest.fn(async (sql, _timestamp, id, fencingToken, leaseDeadline, policyEpoch, docId, location, workspaceId) => {
      if (!sql.includes("UPDATE meeting_import_generations")) return 1;
      if (typeof beforeFenceCas === "function") beforeFenceCas({ generation, policy });
      const leaseLive = generation.lease_deadline > leaseDeadline;
      const matches = generation.id === id && generation.fencing_token === fencingToken && leaseLive &&
        generation.policy_epoch === policyEpoch && generation.vector_doc_id === docId &&
        generation.document_location === location && imported.workspace_id === workspaceId &&
        policy.state === "ACTIVE" && policy.policy_epoch === policyEpoch && policy.owner_user_id === imported.anything_user_id;
      return matches ? 1 : 0;
    }),
  };
  const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
  const store = createMeetingStore({ prisma, clock: () => now });
  const signal = new AbortController().signal;
  const mutateAssociation = jest.fn(async (transaction) => {
    expect(transaction).toBe(tx);
    return { changed: true };
  });
  const input = {
    generationId: generation.id, fencingToken: 3, workspaceId: 5, policyEpoch: 7,
    docId: "doc-a", location: "meeting-managed/doc-a.json", signal, mutateAssociation,
  };
  return { generation, imported, policy, tx, prisma, store, input, mutateAssociation };
}

describe("meeting gateway fenced association store operations", () => {
  test("A-STATE-001-03 adds an association inside the generation fence transaction", async () => {
    const h = makeHarness();
    await expect(h.store.addManagedDocumentFenced(h.input)).resolves.toEqual({ changed: true });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.mutateAssociation).toHaveBeenCalledTimes(1);
    expect(h.tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  test("A-STATE-001-03 stale attach takeover at DB fence CAS cannot add an association", async () => {
    const h = makeHarness({ beforeFenceCas: ({ generation }) => { generation.fencing_token = 4; } });
    await expect(h.store.addManagedDocumentFenced(h.input)).rejects.toThrow("MGW_STALE_FENCE");
    expect(h.mutateAssociation).not.toHaveBeenCalled();
  });

  test("A-STATE-001-03 stale cleanup takeover at DB fence CAS cannot remove an association", async () => {
    const h = makeHarness({ beforeFenceCas: ({ generation }) => { generation.fencing_token = 4; } });
    await expect(h.store.removeManagedDocumentFenced(h.input)).rejects.toThrow("MGW_STALE_FENCE");
    expect(h.mutateAssociation).not.toHaveBeenCalled();
  });

  test("A-STATE-001-03 changed policy epoch blocks the association mutation", async () => {
    const h = makeHarness({ beforeFenceCas: ({ policy }) => { policy.policy_epoch = 8; } });
    await expect(h.store.addManagedDocumentFenced(h.input)).rejects.toThrow("MGW_STALE_FENCE");
    expect(h.mutateAssociation).not.toHaveBeenCalled();
  });
});