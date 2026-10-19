const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { createMeetingStore } = require("../../models/meetingGateway");

let createWeComIdentityStore;
try {
  ({ createWeComIdentityStore } = require("../../models/wecomIdentity"));
} catch (_error) {
  // Keep the RED result an assertion about the missing store API rather than a
  // Jest module-loader error while the first test is being introduced.
}

const migrationPath = path.resolve(__dirname, "../../prisma/migrations/20261019000100_gateway_auth_local_search/migration.sql");

const now = new Date("2026-10-19T00:00:00.000Z");
const profile = (overrides = {}) => ({
  gatewayInstanceId: "gateway-one",
  orgId: "org-one",
  memberId: "member-one",
  userId: "gateway-user-one",
  issuer: "issuer-one",
  displayName: "Ada Employee",
  active: true,
  identityExpiresAt: "2026-10-19T10:00:00.000Z",
  ...overrides,
});

const legacyUsersTable = `CREATE TABLE users (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT NOT NULL,
  pfpFilename TEXT,
  role TEXT NOT NULL DEFAULT 'default',
  suspended INTEGER NOT NULL DEFAULT 0,
  seen_recovery_codes BOOLEAN DEFAULT false,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastUpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dailyMessageLimit INTEGER,
  bio TEXT DEFAULT '',
  web_push_subscription_config TEXT
)`;

function splitSqlStatements(sql) {
  return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

describe("WeCom identity projection and local session persistence", () => {
  let prisma;
  let dbPath;
  let store;
  let schemaClient;
  let legacyBinding;
  let legacyUserPassword;
  let legacyForeignKeyErrors;
  let isolatedSchemaDir;
  let isolatedClientDir;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mgw-identity-"));
    dbPath = path.join(dir, "isolated.sqlite");
    prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath.replace(/\\/g, "/")}` } } });
    await prisma.$executeRawUnsafe(legacyUsersTable);
    await prisma.$executeRawUnsafe(`CREATE TABLE meeting_gateway_bindings (
      id TEXT NOT NULL PRIMARY KEY,
      anything_user_id INTEGER NOT NULL UNIQUE,
      gateway_org_id TEXT NOT NULL,
      gateway_member_id TEXT NOT NULL,
      gateway_user_id TEXT NOT NULL,
      identity_issuer TEXT NOT NULL DEFAULT 'account-login-v1',
      status TEXT NOT NULL DEFAULT 'BOUND',
      verified_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (anything_user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    await prisma.$executeRawUnsafe("CREATE UNIQUE INDEX meeting_gateway_bindings_anything_user_id_key ON meeting_gateway_bindings(anything_user_id)");
    await prisma.$executeRawUnsafe("CREATE UNIQUE INDEX meeting_gateway_bindings_gateway_org_id_gateway_member_id_key ON meeting_gateway_bindings(gateway_org_id, gateway_member_id)");
    await prisma.$executeRawUnsafe("CREATE UNIQUE INDEX meeting_gateway_bindings_anything_user_id_gateway_org_id_key ON meeting_gateway_bindings(anything_user_id, gateway_org_id)");
    await prisma.$executeRawUnsafe("INSERT INTO users (username, password, role) VALUES ('legacy-user', 'legacy-hash', 'default')");
    await prisma.$executeRawUnsafe(`INSERT INTO meeting_gateway_bindings (
      id, anything_user_id, gateway_org_id, gateway_member_id, gateway_user_id, identity_issuer, status, verified_at, updated_at
    ) VALUES ('legacy-binding', 1, 'legacy-org', 'legacy-member', 'legacy-gateway-user', 'account-login-v1', 'BOUND', ?, ?)`, now, now);
    if (fs.existsSync(migrationPath)) {
      const migration = fs.readFileSync(migrationPath, "utf8");
      for (const statement of splitSqlStatements(migration)) await prisma.$executeRawUnsafe(statement);
    }
    legacyBinding = (await prisma.$queryRawUnsafe("SELECT * FROM meeting_gateway_bindings WHERE id = 'legacy-binding'"))[0];
    legacyUserPassword = (await prisma.$queryRawUnsafe("SELECT password FROM users WHERE username = 'legacy-user'"))[0]?.password;

    const serverDir = path.resolve(__dirname, "../..");
    isolatedSchemaDir = path.join(serverDir, "prisma", `.task2-isolated-${process.pid}-${crypto.randomUUID()}`);
    isolatedClientDir = fs.mkdtempSync(path.join(os.tmpdir(), "mgw-prisma-client-"));
    fs.mkdirSync(isolatedSchemaDir, { recursive: true });
    const schemaPath = path.join(isolatedSchemaDir, "schema.prisma");
    const sourceSchema = fs.readFileSync(path.resolve(serverDir, "prisma/schema.prisma"), "utf8");
    const isolatedSchema = sourceSchema
      .replace(/generator client \{[\s\S]*?\}/, `generator client {\n  provider = "prisma-client-js"\n  output = "${path.join(isolatedClientDir, "generated-client").replace(/\\/g, "/")}"\n}`)
      .replace('url      = "file:../storage/anythingllm.db"', `url      = "file:${dbPath.replace(/\\/g, "/")}"`);
    fs.writeFileSync(schemaPath, isolatedSchema, "utf8");
    execFileSync(process.execPath, [path.resolve(serverDir, "node_modules/prisma/build/index.js"), "generate", "--schema", schemaPath], {
      cwd: serverDir,
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      stdio: "pipe",
      timeout: 30_000,
    });
    const { PrismaClient: IsolatedPrismaClient } = require(path.join(isolatedClientDir, "generated-client"));
    schemaClient = new IsolatedPrismaClient({ datasources: { db: { url: `file:${dbPath.replace(/\\/g, "/")}` } } });
    await schemaClient.$executeRawUnsafe(`CREATE TABLE meeting_bridge_sessions (
      id TEXT NOT NULL PRIMARY KEY, anything_user_id INTEGER NOT NULL, session_binding_hmac TEXT NOT NULL UNIQUE,
      jwt_binding_hmac TEXT NOT NULL, csrf_hmac TEXT NOT NULL, credential_binding_hmac TEXT NOT NULL,
      ciphertext BLOB NOT NULL, nonce BLOB NOT NULL, key_id TEXT NOT NULL, ms_expiry DATETIME NOT NULL, mt_expiry DATETIME NOT NULL,
      jwt_expiry DATETIME NOT NULL, session_expiry DATETIME NOT NULL, gateway_expiry DATETIME NOT NULL, created_at DATETIME NOT NULL, revoked_at DATETIME
    )`);
    legacyForeignKeyErrors = await schemaClient.$queryRawUnsafe("PRAGMA foreign_key_check");

    if (typeof createWeComIdentityStore === "function") {
      store = createWeComIdentityStore({ prisma: schemaClient, clock: () => now });
    }
  });

  afterAll(async () => {
    if (schemaClient) await schemaClient.$disconnect();
    if (prisma) await prisma.$disconnect();
    if (dbPath) fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    if (isolatedSchemaDir) fs.rmSync(isolatedSchemaDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe("DELETE FROM meeting_sso_transactions");
    await prisma.$executeRawUnsafe("DELETE FROM meeting_login_sessions");
    await prisma.$executeRawUnsafe("DELETE FROM meeting_gateway_bindings");
    await prisma.$executeRawUnsafe("DELETE FROM users");
  });

  test("exports a store factory and migration for an isolated existing database", async () => {
    expect(typeof createWeComIdentityStore).toBe("function");
    expect(fs.existsSync(migrationPath)).toBe(true);
    const rows = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('meeting_login_sessions','meeting_sso_transactions') ORDER BY name");
    expect(rows.map((row) => row.name)).toEqual(["meeting_login_sessions", "meeting_sso_transactions"]);
    expect(legacyBinding).toMatchObject({
      id: "legacy-binding",
      gateway_instance_id: null,
      gateway_org_id: "legacy-org",
      gateway_member_id: "legacy-member",
    });
    expect(legacyUserPassword).toBe("legacy-hash");
    expect(legacyForeignKeyErrors).toEqual([]);
    const passwordColumn = (await schemaClient.$queryRawUnsafe("PRAGMA table_info(users)")).find((column) => column.name === "password");
    expect(Number(passwordColumn.notnull)).toBe(0);
  });

  test("first projection creates a passwordless default user and repeat refreshes its profile without changing its ID", async () => {
    const first = await store.upsertGatewayUserProjection({ profile: profile() });
    const second = await store.upsertGatewayUserProjection({ profile: profile({ displayName: "Ada Lovelace" }) });

    expect(second.user.id).toBe(first.user.id);
    expect(first.user.password).toBeNull();
    expect(first.user.role).toBe("default");
    expect(second.binding.display_name).toBe("Ada Lovelace");
    expect(await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM users")).toEqual([{ count: 1n }]);
  });

  test("the isolated schema-generated Prisma client and User.get read passwordless users through the login read path", async () => {
    const projected = await store.upsertGatewayUserProjection({ profile: profile() });
    await expect(prisma.users.findUnique({ where: { id: projected.user.id }, select: { id: true, password: true } })).rejects.toThrow("expected non-nullable type \"String\"");
    expect(await schemaClient.users.findUnique({ where: { id: projected.user.id }, select: { id: true, password: true } })).toMatchObject({ id: projected.user.id, password: null });

    await jest.isolateModulesAsync(async () => {
      jest.doMock("../../utils/prisma", () => schemaClient);
      const { User } = require("../../models/user");
      const loaded = await User.get({ id: projected.user.id });
      expect(loaded).toMatchObject({ id: projected.user.id });
      expect(loaded.password).toBeUndefined();
    });
  });

  test("legacy R1 lookups remain null-instance scoped and cannot select or overwrite a namespaced binding", async () => {
    await schemaClient.$executeRawUnsafe("INSERT INTO users (id, username, password, role) VALUES (1, 'legacy-bound-user', 'legacy-hash', 'default')");
    await schemaClient.$executeRawUnsafe("INSERT INTO users (id, username, password, role) VALUES (2, 'projected-user', NULL, 'default')");
    await schemaClient.$executeRawUnsafe(`INSERT INTO meeting_gateway_bindings (
      id, anything_user_id, gateway_instance_id, gateway_org_id, gateway_member_id, gateway_user_id,
      identity_issuer, status, verified_at, updated_at
    ) VALUES ('legacy-row', 1, NULL, 'org-one', 'member-one', 'legacy-user', 'account-login-v1', 'BOUND', ?, ?)`, now, now);
    await schemaClient.$executeRawUnsafe(`INSERT INTO meeting_gateway_bindings (
      id, anything_user_id, gateway_instance_id, gateway_org_id, gateway_member_id, gateway_user_id,
      identity_issuer, display_name, gateway_active, status, verified_at, updated_at
    ) VALUES ('new-row', 2, 'gateway-one', 'org-one', 'member-one', 'new-user', 'issuer-one', 'Ada', 1, 'BOUND', ?, ?)`, now, now);
    const legacyStore = createMeetingStore({ prisma: schemaClient, clock: () => now });

    expect(await legacyStore.getBinding(1)).toMatchObject({ id: "legacy-row", gateway_instance_id: null });
    await legacyStore.saveBinding({
      anything_user_id: 1,
      gateway_org_id: "org-one",
      gateway_member_id: "member-one",
      gateway_user_id: "legacy-user",
    });
    expect(await legacyStore.getBinding(1)).toMatchObject({ gateway_instance_id: null, gateway_member_id: "member-one" });
    expect(await legacyStore.getBinding(2)).toMatchObject({ id: "new-row", gateway_instance_id: "gateway-one" });
    await expect(legacyStore.saveBinding({
      anything_user_id: 2,
      gateway_org_id: "org-one",
      gateway_member_id: "member-one",
      gateway_user_id: "new-user",
    })).rejects.toMatchObject({ message: "MGW_IDENTITY_BINDING_CONFLICT" });
    expect(await schemaClient.$queryRawUnsafe("SELECT gateway_instance_id FROM meeting_gateway_bindings WHERE id='new-row'")).toEqual([{ gateway_instance_id: "gateway-one" }]);
  });

  test("bridge persistence preserves the identity projection's Gateway instance binding", async () => {
    const projected = await store.upsertGatewayUserProjection({ profile: profile() });
    const meetingStore = createMeetingStore({ prisma: schemaClient, clock: () => now });
    await meetingStore.createBridgeSession({
      id: "bridge-instance-bound", anything_user_id: projected.user.id,
      binding: {
        anything_user_id: projected.user.id, gateway_instance_id: "gateway-one", gateway_org_id: "org-one",
        gateway_member_id: "member-one", gateway_user_id: "gateway-user-one", identity_issuer: "issuer-one",
      },
      session_binding_hmac: "a".repeat(64), jwt_binding_hmac: "b".repeat(64), csrf_hmac: "c".repeat(64),
      credential_binding_hmac: "d".repeat(64), ciphertext: Buffer.alloc(32, 7), nonce: Buffer.alloc(12, 8), key_id: "test",
      ms_expiry: new Date("2026-10-19T01:00:00.000Z"), mt_expiry: new Date("2026-10-19T01:00:00.000Z"),
      jwt_expiry: new Date("2026-10-19T01:00:00.000Z"), session_expiry: new Date("2026-10-19T01:00:00.000Z"),
      gateway_expiry: new Date("2026-10-19T01:00:00.000Z"),
    });
    expect(await meetingStore.getBinding(projected.user.id)).toMatchObject({
      gateway_instance_id: "gateway-one", gateway_org_id: "org-one", gateway_member_id: "member-one",
    });
    expect(await meetingStore.findBridgeSessionByBinding("a".repeat(64))).toMatchObject({ id: "bridge-instance-bound" });
  });  test("same-name identities and the same org/member in different Gateway instances remain separate", async () => {
    const sameName = await store.upsertGatewayUserProjection({ profile: profile() });
    const anotherMember = await store.upsertGatewayUserProjection({ profile: profile({ memberId: "member-two", userId: "gateway-user-two" }) });
    const otherInstance = await store.upsertGatewayUserProjection({ profile: profile({ gatewayInstanceId: "gateway-two" }) });

    expect(otherInstance.user.id).not.toBe(sameName.user.id);
    expect(anotherMember.user.id).not.toBe(sameName.user.id);
    const bindings = await prisma.$queryRawUnsafe("SELECT gateway_instance_id, gateway_org_id, gateway_member_id FROM meeting_gateway_bindings ORDER BY gateway_instance_id");
    expect(bindings).toEqual([
      { gateway_instance_id: "gateway-one", gateway_org_id: "org-one", gateway_member_id: "member-one" },
      { gateway_instance_id: "gateway-one", gateway_org_id: "org-one", gateway_member_id: "member-two" },
      { gateway_instance_id: "gateway-two", gateway_org_id: "org-one", gateway_member_id: "member-one" },
    ]);
  });

  test.each([
    ["inactive profile", { active: false }],
    ["expired profile", { identityExpiresAt: "2026-10-18T23:59:59.000Z" }],
    ["missing stable subject", { memberId: "" }],
  ])("rejects %s before creating a user", async (_name, overrides) => {
    const before = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM users");
    await expect(store.upsertGatewayUserProjection({ profile: profile(overrides) })).rejects.toMatchObject({ code: "MGW_IDENTITY_ASSERTION_INVALID" });
    const after = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM users");
    expect(after[0].count).toBe(before[0].count);
    const sessions = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM meeting_login_sessions");
    expect(sessions[0].count).toBe(0n);
  });

  test("never clears a local suspension when refreshing a valid Gateway profile", async () => {
    const projected = await store.upsertGatewayUserProjection({ profile: profile() });
    await prisma.$executeRawUnsafe("UPDATE users SET suspended = 1 WHERE id = ?", projected.user.id);

    await expect(store.upsertGatewayUserProjection({ profile: profile({ displayName: "Updated Ada" }) })).rejects.toMatchObject({ code: "MGW_LOCAL_ACCOUNT_SUSPENDED" });
    const user = await prisma.$queryRawUnsafe("SELECT suspended FROM users WHERE id = ?", projected.user.id);
    expect(user[0].suspended).toBe(1);
  });

  test("issues bounded local sessions and makes revocation and LOCAL_ONLY updates persistent", async () => {
    const projected = await store.upsertGatewayUserProjection({ profile: profile() });
    const session = await store.createLocalSession({
      userId: projected.user.id,
      bindingId: projected.binding.id,
      identityExpiresAt: profile().identityExpiresAt,
      authMethod: "WE_COM",
      tokenHash: crypto.createHash("sha256").update("jwt").digest("hex"),
      browserProofHash: crypto.createHash("sha256").update("proof").digest("hex"),
    });
    expect(session.expiresAt).toEqual(new Date("2026-10-19T08:00:00.000Z"));
    expect(session.remoteAccessMode).toBe("GATEWAY_ENABLED");
    expect(await store.getLocalSession({ sessionId: session.id, userId: projected.user.id })).toMatchObject({
      id: session.id,
      remote_access_mode: "GATEWAY_ENABLED",
      credential_epoch: 1,
      current_binding_epoch: 1,
      binding_status: "BOUND",
      gateway_instance_id: "gateway-one",
      user_suspended: 0,
    });

    await store.markLocalOnly({ localSessionId: session.id, reason: "redeem outcome lost" });
    expect(await store.getLocalSession({ sessionId: session.id, userId: projected.user.id })).toMatchObject({ remote_access_mode: "LOCAL_ONLY" });
    await store.revokeLocalSession({ sessionId: session.id, userId: projected.user.id });
    expect(await store.getLocalSession({ sessionId: session.id, userId: projected.user.id })).toMatchObject({ revoked_at: now });
  });

  test("stores encrypted prelogin material and consumes each transaction once", async () => {
    const expiresAt = new Date("2026-10-19T00:05:00.000Z");
    const created = await store.createLoginTransaction({
      transactionId: "opaque-transaction",
      clientStateHash: "state-hash",
      browserProofHash: "proof-hash",
      verifierCiphertext: Buffer.from("encrypted-verifier"),
      verifierNonce: Buffer.alloc(12, 1),
      ticketCiphertext: Buffer.from("encrypted-ticket"),
      ticketNonce: Buffer.alloc(12, 2),
      cryptoKeyId: "key-1",
      expiresAt,
      localSessionId: null,
    });
    expect(created.state).toBe("PENDING");
    expect(created.remote_access_mode).toBe("GATEWAY_ENABLED");
    const results = await Promise.all([
      store.consumeLoginTransaction({ transactionId: "opaque-transaction" }),
      store.consumeLoginTransaction({ transactionId: "opaque-transaction" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(Boolean)[0].state).toBe("CONSUMED");
  });

  test("concurrent repeated upserts resolve to one local user", async () => {
    const [left, right] = await Promise.all([
      store.upsertGatewayUserProjection({ profile: profile({ memberId: "race-member", userId: "race-user" }) }),
      store.upsertGatewayUserProjection({ profile: profile({ memberId: "race-member", userId: "race-user" }) }),
    ]);
    expect(left.user.id).toBe(right.user.id);
    const matches = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM meeting_gateway_bindings WHERE gateway_instance_id = ? AND gateway_org_id = ? AND gateway_member_id = ?", "gateway-one", "org-one", "race-member");
    expect(matches[0].count).toBe(1n);
  });
});
