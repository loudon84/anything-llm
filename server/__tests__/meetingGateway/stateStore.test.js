const { nextGeneration, assertTransition, decideResubmit } = require("../../utils/meetingGateway/lifecycle");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { PrismaClient } = require("@prisma/client");
const { createMeetingStore } = require("../../models/meetingGateway");

describe("meeting gateway SQLite state store", () => {
  let prisma;
  let tempDirectory;
  let now;

  beforeAll(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mgw-state-store-"));
    const databaseFile = path.join(tempDirectory, "state.db").replace(/\\/g, "/");
    prisma = new PrismaClient({ datasources: { db: { url: `file:${databaseFile}` } } });
    await prisma.$executeRawUnsafe("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    await prisma.$executeRawUnsafe("CREATE TABLE workspaces (id INTEGER PRIMARY KEY)");
    await prisma.$executeRawUnsafe("CREATE TABLE legacy_documents (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    await prisma.$executeRawUnsafe("INSERT INTO users (id) VALUES (1)");
    await prisma.$executeRawUnsafe("INSERT INTO workspaces (id) VALUES (7)");
    await prisma.$executeRawUnsafe("INSERT INTO legacy_documents (id, name) VALUES (1, 'keep-me')");

    const migration = fs.readFileSync(
      path.join(__dirname, "../../prisma/migrations/20261018000100_meeting_gateway_adapter/migration.sql"),
      "utf8"
    );
    for (const statement of migration.split(";").map((sql) => sql.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
    const bridgeBindingsMigration = fs.readFileSync(
      path.join(__dirname, "../../prisma/migrations/20261018000200_meeting_bridge_bindings/migration.sql"),
      "utf8"
    );
    for (const statement of bridgeBindingsMigration.split(";").map((sql) => sql.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
    const oauthSnapshotMigration = fs.readFileSync(
      path.join(__dirname, "../../prisma/migrations/20261020000100_meeting_oauth_connection_snapshot/migration.sql"),
      "utf8"
    );
    for (const statement of oauthSnapshotMigration.split(";").map((sql) => sql.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
    now = new Date("2026-10-18T00:00:00.000Z");
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (tempDirectory) fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  function newStore() {
    return createMeetingStore({ prisma, clock: () => new Date(now) });
  }

  function identity(overrides = {}) {
    return {
      anything_user_id: 1,
      gateway_org_id: "org-a",
      gateway_member_id: "member-a",
      gateway_user_id: "gateway-user-a",
      connection_ref: "connection-a",
      gateway_meeting_id: "meeting-a",
      gateway_recording_id: "recording-a",
      gateway_asset_id: "asset-a",
      content_type: "transcript",
      source_version: "v1",
      content_sha256: "a".repeat(64),
      workspace_slug: "private-a",
      workspace_id: 7,
      identity_key: "identity-a",
      ...overrides,
    };
  }

  test("A-STATE-001-01 additive migration creates all ledger tables and preserves existing documents", async () => {
    const tables = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table'");
    const names = tables.map((table) => table.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "meeting_gateway_bindings",
        "meeting_bridge_sessions",
        "meeting_query_runs",
        "meeting_imports",
        "meeting_import_attempts",
        "meeting_import_audits",
        "meeting_restricted_workspaces",
        "meeting_oauth_transactions",
        "meeting_import_generations",
      ])
    );
    const documents = await prisma.$queryRawUnsafe("SELECT id, name FROM legacy_documents");
    expect(documents).toEqual([{ id: 1, name: "keep-me" }]);
  });

  test("A-STATE-001-02 a bridge cannot hold two pending OAuth transactions", async () => {
    await prisma.$executeRawUnsafe(
      "INSERT INTO meeting_bridge_sessions (id, anything_user_id, session_binding_hmac, ciphertext, nonce, key_id, gateway_expiry, created_at) VALUES ('bridge-1', 1, 'hmac-1', ?, ?, 'test-key', ?, ?)",
      Buffer.from("ciphertext"),
      Buffer.from("nonce"),
      new Date("2026-10-18T00:15:00.000Z"),
      now
    );
    await prisma.$executeRawUnsafe(
      "INSERT INTO meeting_oauth_transactions (id, transaction_id, owner_user_id, bridge_session_id, expires_at, state, created_at) VALUES ('oauth-1', 'transaction-1', 1, 'bridge-1', ?, 'PENDING', ?)",
      new Date("2026-10-18T00:05:00.000Z"),
      now
    );
    await expect(
      prisma.$executeRawUnsafe(
        "INSERT INTO meeting_oauth_transactions (id, transaction_id, owner_user_id, bridge_session_id, expires_at, state, created_at) VALUES ('oauth-2', 'transaction-2', 1, 'bridge-1', ?, 'PENDING', ?)",
        new Date("2026-10-18T00:05:00.000Z"),
        now
      )
    ).rejects.toThrow();
    await prisma.$executeRawUnsafe("UPDATE meeting_oauth_transactions SET state = 'CONFIRMED' WHERE id = 'oauth-1'");
    await prisma.$executeRawUnsafe(
      "INSERT INTO meeting_oauth_transactions (id, transaction_id, owner_user_id, bridge_session_id, expires_at, state, created_at) VALUES ('oauth-3', 'transaction-3', 1, 'bridge-1', ?, 'PENDING', ?)",
      new Date("2026-10-18T00:05:00.000Z"),
      now
    );
  });

  test("persists the pre-authorization connection id snapshot with its one-use pending transaction", async () => {
    await prisma.$executeRawUnsafe(
      "INSERT INTO meeting_bridge_sessions (id, anything_user_id, session_binding_hmac, ciphertext, nonce, key_id, gateway_expiry, created_at) VALUES ('oauth-snapshot-bridge', 1, 'hmac-snapshot', ?, ?, 'test-key', ?, ?)",
      Buffer.from("ciphertext"), Buffer.from("nonce"), new Date("2026-10-18T00:15:00.000Z"), now
    );
    const store = newStore();
    const row = await store.createOAuthTransaction({
      transactionId: "oauth-snapshot-transaction", ownerUserId: 1, bridgeSessionId: "oauth-snapshot-bridge",
      expiresAt: new Date("2026-10-18T00:05:00.000Z"), state: "PENDING", existingConnectionIds: ["prior-connection"],
    });
    expect(row.existingConnectionIds).toEqual(["prior-connection"]);
    expect((await store.findPendingOAuthForBridge("oauth-snapshot-bridge")).existingConnectionIds).toEqual(["prior-connection"]);
  });

  test("A-STATE-001-01 concurrent duplicate identity reservations keep one row", async () => {
    const store = newStore();
    const input = identity();
    const [first, second] = await Promise.all([store.reserveIdentity(input), store.reserveIdentity(input)]);
    expect(first.id).toBe(second.id);
    expect(await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM meeting_imports")).toEqual([{ count: 1n }]);
  });

  test("A-STATE-001-02 a fresh identity reservation can be retried idempotently", async () => {
    const store = newStore();
    const input = identity({ gateway_asset_id: "asset-c", identity_key: "identity-c" });
    const first = await store.reserveIdentity(input);
    const retry = await store.reserveIdentity(input);
    expect(first.id).toBe(retry.id);
  });

  test("A-STATE-001-02 another owner cannot claim an existing identity key", async () => {
    const store = newStore();
    await prisma.$executeRawUnsafe("INSERT INTO users (id) VALUES (2)");
    await expect(
      store.reserveIdentity(identity({ anything_user_id: 2 }))
    ).rejects.toThrow("MGW_IDENTITY_BINDING_CONFLICT");
    expect(await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM meeting_imports")).toEqual([{ count: 2n }]);
  });

  async function ensurePolicy() {
    await prisma.$executeRawUnsafe(
      "INSERT INTO meeting_restricted_workspaces (workspace_id, owner_user_id, policy_epoch, state, created_at, updated_at) VALUES (7, 1, 1, 'ACTIVE', ?, ?) ON CONFLICT(workspace_id) DO NOTHING",
      now,
      now
    );
  }

  test("A-REV-005-01 cleanup completes before reserving a later generation", async () => {
    const store = newStore();
    await ensurePolicy();
    const row = await store.reserveIdentity(identity());
    const first = await store.claimGeneration(row.id);
    const lease = await store.acquireLease(first.id, "cleanup-worker");
    await store.commitGeneration(first.id, lease.fencing_token, { state: "PENDING_CLEANUP" });
    await store.commitGeneration(first.id, lease.fencing_token, { state: "REMOVED" });
    const second = await store.claimGeneration(row.id);
    expect(second.generation).toBe(2);
  });

  test("A-REV-005-02 a second worker cannot take a live lease and stale fencing tokens cannot commit", async () => {
    const store = newStore();
    await ensurePolicy();
    const row = await store.reserveIdentity(identity({ gateway_asset_id: "asset-b", identity_key: "identity-b" }));
    const generation = await store.claimGeneration(row.id);
    const lease = await store.acquireLease(generation.id, "worker-a");
    await expect(store.acquireLease(generation.id, "worker-b")).rejects.toThrow("MGW_LEASE_HELD");
    now = new Date(now.getTime() + 61_000);
    const renewed = await store.acquireLease(generation.id, "worker-b");
    expect(renewed.fencing_token).toBe(lease.fencing_token + 1);
    await expect(store.commitGeneration(generation.id, lease.fencing_token, { state: "FETCHING" })).rejects.toThrow(
      "MGW_STALE_FENCE"
    );
  });

  test("A-REV-010-01 policy and access updates are persisted as explicit state", async () => {
    const store = newStore();
    const row = await store.reserveIdentity(identity());
    await store.markAccess(row.id, "AUTH_REQUIRED");
    const imports = await prisma.$queryRawUnsafe("SELECT access_state FROM meeting_imports WHERE id = ?", row.id);
    expect(imports[0].access_state).toBe("AUTH_REQUIRED");
    expect(await store.policyByWorkspace(99)).toBeNull();
    await ensurePolicy();
    expect(await store.policyByWorkspace(7)).toMatchObject({ workspace_id: 7, owner_user_id: 1, policy_epoch: 1 });
  });

  test("A-REV-010-02 unknown access states fail closed", async () => {
    const store = newStore();
    const row = await store.reserveIdentity(identity());
    await expect(store.markAccess(row.id, "ACCESS_UNKNOWN")).rejects.toThrow("MGW_INVALID_ACCESS_STATE");
  });
});

describe("meeting gateway lifecycle", () => {
  test("A-REV-005-01 REMOVED starts the next generation after cleanup", () => {
    expect(nextGeneration({ status: "REMOVED", generation: 2, cleanupDone: true })).toBe(3);
  });

  test("A-REV-005-02 cleanup and drift states cannot start another generation", () => {
    expect(() => nextGeneration({ status: "PENDING_CLEANUP", generation: 2, cleanupDone: false })).toThrow(
      "MGW_CLEANUP_IN_PROGRESS"
    );
    expect(() => nextGeneration({ status: "BLOCKED_DRIFT", generation: 2, cleanupDone: true })).toThrow(
      "MGW_IMPORT_CONFLICT"
    );
    expect(() => nextGeneration({ status: "REMOVED", generation: 2, cleanupDone: false })).toThrow(
      "MGW_CLEANUP_IN_PROGRESS"
    );
  });

  test("A-STATE-001-02 illegal state transitions are rejected", () => {
    expect(() => assertTransition("REMOVED", "VERIFIED")).toThrow("MGW_INVALID_STATE_TRANSITION");
  });

  test("A-REV-010-01 VERIFIED identity is returned without resubmission", () => {
    expect(decideResubmit({ status: "VERIFIED" })).toBe("RETURN_EXISTING");
  });

  test("A-REV-010-02 cleanup states block resubmission", () => {
    expect(decideResubmit({ status: "PENDING_CLEANUP" })).toBe("MGW_CLEANUP_IN_PROGRESS");
    expect(decideResubmit({ status: "REVOKING" })).toBe("MGW_CLEANUP_IN_PROGRESS");
  });
});
