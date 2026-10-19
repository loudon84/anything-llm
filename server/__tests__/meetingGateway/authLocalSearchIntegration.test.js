const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const express = require("express");
const jwtLib = require("jsonwebtoken");
const { createServer } = require("node:http");
const { createWeComIdentityStore } = require("../../models/wecomIdentity");
const { createWeComAuthService, COOKIE_NAME } = require("../../utils/meetingGateway/wecomAuth");
const { createWeComAuthEndpoints } = require("../../endpoints/wecomAuth");

const ORIGIN = "https://copilot.superic.com:9999";
const SECRET = "isolated-integration-jwt-secret";
const KEYRING = { activeKeyId: "fixture-key", keys: { "fixture-key": Buffer.alloc(32, 4) }, hmacKey: Buffer.alloc(32, 5) };
const profile = {
  gatewayInstanceId: "fixture-instance", orgId: "fixture-org", memberId: "fixture-member",
  userId: "fixture-user", issuer: "fixture-issuer", displayName: "Fixture Employee",
  active: true, identityExpiresAt: "2026-10-20T00:00:00.000Z",
};

let prisma;
let store;
let tempRoot;
let now = new Date("2026-10-19T00:00:00.000Z");
const clock = () => new Date(now);
const jwt = {
  sign: (claims, seconds) => jwtLib.sign(claims, SECRET, { expiresIn: seconds }),
  verify: (token) => jwtLib.verify(token, SECRET),
};

function makeGateway({ redeemFails = false } = {}) {
  const calls = { start: 0, redeem: 0, profile: 0 };
  return {
    calls,
    getAvailability: () => ({ enabled: true, available: true, reason: null }),
    startAuthentication: async ({ clientState }) => {
      calls.start++;
      return {
        transactionId: `fixture-tx-${crypto.randomUUID()}`,
        authorizationUrl: `https://fixture.example.test/wecom?state=${clientState}`,
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };
    },
    redeemAuthentication: async () => {
      calls.redeem++;
      if (redeemFails) throw Object.assign(new Error("fixture lost redeem response"), { code: "MGW_AUTH_REDEEM_OUTCOME_UNKNOWN", status: 503 });
      return { accessToken: "fixture-private-only", subject: { orgId: profile.orgId, memberId: profile.memberId, userId: profile.userId, issuer: profile.issuer }, identityExpiresAt: profile.identityExpiresAt };
    },
    fetchAuthenticatedProfile: async () => {
      calls.profile++;
      return { ...profile };
    },
  };
}

function makeAuth(gateway) {
  return createWeComAuthService({
    gateway, store, jwt, clock, origin: ORIGIN,
    callbackUri: `${ORIGIN}/api/auth/wecom/callback`,
    resultUri: `${ORIGIN}/sso/wecom/result`, cryptoConfig: KEYRING,
  });
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

function firstCookie(response, name = COOKIE_NAME) {
  const header = response.headers.get("set-cookie");
  const match = new RegExp(`(?:^|, )${name}=([^;]+)`).exec(header || "");
  if (!match) throw new Error(`missing ${name} cookie`);
  return `${name}=${match[1]}`;
}

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mgw-auth-local-integration-"));
  const dbPath = path.join(tempRoot, "isolated.sqlite");
  const schemaPath = path.join(tempRoot, "schema.prisma");
  const clientPath = path.join(tempRoot, "generated-client");
  const source = fs.readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
  const schema = source
    .replace(/generator client \{[\s\S]*?\}/, `generator client {\n  provider = "prisma-client-js"\n  output = "${clientPath.replace(/\\/g, "/")}"\n}`)
    .replace('url      = "file:../storage/anythingllm.db"', `url      = "file:${dbPath.replace(/\\/g, "/")}"`);
  fs.writeFileSync(schemaPath, schema, "utf8");
  const serverDir = path.resolve(__dirname, "../..");
  const cli = path.resolve(serverDir, "node_modules/prisma/build/index.js");
  const commandEnv = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" };
  execFileSync(process.execPath, [cli, "generate", "--schema", schemaPath], { cwd: serverDir, env: commandEnv, stdio: "pipe", timeout: 60000 });
  const { PrismaClient: LegacyPrismaClient } = require("@prisma/client");
  const legacy = new LegacyPrismaClient({ datasources: { db: { url: `file:${dbPath.replace(/\\/g, "/")}` } } });
  await legacy.$executeRawUnsafe(`CREATE TABLE users (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT NOT NULL, pfpFilename TEXT, role TEXT NOT NULL DEFAULT 'default', suspended INTEGER NOT NULL DEFAULT 0, seen_recovery_codes BOOLEAN DEFAULT false, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, dailyMessageLimit INTEGER, bio TEXT DEFAULT '', web_push_subscription_config TEXT)`);
  await legacy.$executeRawUnsafe(`CREATE TABLE meeting_gateway_bindings (id TEXT NOT NULL PRIMARY KEY, anything_user_id INTEGER NOT NULL UNIQUE, gateway_org_id TEXT NOT NULL, gateway_member_id TEXT NOT NULL, gateway_user_id TEXT NOT NULL, identity_issuer TEXT NOT NULL DEFAULT 'account-login-v1', status TEXT NOT NULL DEFAULT 'BOUND', verified_at DATETIME NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL, FOREIGN KEY (anything_user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE)`);
  await legacy.$executeRawUnsafe("CREATE UNIQUE INDEX meeting_gateway_bindings_anything_user_id_key ON meeting_gateway_bindings(anything_user_id)");
  await legacy.$executeRawUnsafe("CREATE UNIQUE INDEX meeting_gateway_bindings_gateway_org_id_gateway_member_id_key ON meeting_gateway_bindings(gateway_org_id, gateway_member_id)");
  await legacy.$executeRawUnsafe("CREATE UNIQUE INDEX meeting_gateway_bindings_anything_user_id_gateway_org_id_key ON meeting_gateway_bindings(anything_user_id, gateway_org_id)");
  const migration = fs.readFileSync(path.resolve(serverDir, "prisma/migrations/20261019000100_gateway_auth_local_search/migration.sql"), "utf8");
  for (const statement of migration.split(";").map((item) => item.trim()).filter(Boolean)) await legacy.$executeRawUnsafe(statement);
  await legacy.$disconnect();
  const { PrismaClient } = require(clientPath);
  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath.replace(/\\/g, "/")}` } } });
  store = createWeComIdentityStore({ prisma, clock });
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
  if (tempRoot) {
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (error) { if (error.code !== "EPERM" && error.code !== "EBUSY") throw error; }
  }
});

beforeEach(async () => {
  now = new Date("2026-10-19T00:00:00.000Z");
  await prisma.meeting_sso_transactions.deleteMany();
  await prisma.meeting_login_sessions.deleteMany();
  await prisma.meeting_gateway_bindings.deleteMany();
  await prisma.users.deleteMany();
});

test("HTTP BFF success projects a stable local user and issues a registry-backed session using isolated SQLite", async () => {
  const gateway = makeGateway();
  const auth = makeAuth(gateway);
  const app = express();
  app.use(express.json());
  createWeComAuthEndpoints(app, { auth });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${server.address().port}/auth/wecom`;
  try {
    const start = await getJson(`${root}/start`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
    expect(start.response.status).toBe(200);
    const loginCookie = firstCookie(start.response);
    const stateBefore = await getJson(`${root}/state`, { headers: { cookie: loginCookie } });
    const clientState = new URL(start.body.data.authorizationUrl).searchParams.get("state");
    const callbackUrl = new URL(`${root}/callback`);
    callbackUrl.searchParams.set("state", clientState);
    callbackUrl.searchParams.set("resultTicket", "fixture-ticket");
    const callback = await fetch(callbackUrl, { headers: { cookie: loginCookie }, redirect: "manual" });
    expect(callback.status).toBe(303);
    const complete = await getJson(`${root}/complete`, { method: "POST", headers: { origin: ORIGIN, cookie: loginCookie, "x-mgw-csrf": stateBefore.body.data.csrfToken, "content-type": "application/json" }, body: "{}" });
    expect(complete.response.status).toBe(200);
    expect(complete.body.data).toMatchObject({ state: "AUTHENTICATED", remoteAccessMode: "GATEWAY_ENABLED", user: { role: "default", displayName: profile.displayName } });
    expect(complete.body.data.localToken).toBeTruthy();
    expect(complete.body.data).not.toHaveProperty("accessToken");
    const persisted = await prisma.users.findMany({ select: { id: true, username: true, password: true, role: true } });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ id: complete.body.data.user.id, password: null, role: "default" });
    const session = await prisma.meeting_login_sessions.findFirst();
    expect(session).toMatchObject({ user_id: persisted[0].id, remote_access_mode: "GATEWAY_ENABLED", revoked_at: null });
    expect(gateway.calls).toEqual({ start: 1, redeem: 1, profile: 1 });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("lost fixture redemption marks only the existing SQLite session LOCAL_ONLY and is never retried", async () => {
  const gateway = makeGateway({ redeemFails: true });
  const auth = makeAuth(gateway);
  const projected = await store.upsertGatewayUserProjection({ profile });
  const session = await store.createLocalSession({ userId: projected.user.id, bindingId: projected.binding.id, identityExpiresAt: profile.identityExpiresAt, authMethod: "wecom", browserProofHash: auth.hashBrowserProof("existing-proof") });
  const started = await auth.start({ origin: ORIGIN, currentLocalSession: { id: session.id, userId: projected.user.id }, browserProof: "existing-proof" });
  const callbackState = new URL(started.authorizationUrl).searchParams.get("state");
  await auth.callback({ cookie: started.cookie.value, clientState: callbackState, resultTicket: "fixture-ticket-lost" });
  await expect(auth.complete({ origin: ORIGIN, cookie: started.cookie.value, csrf: started.csrfToken })).rejects.toMatchObject({ code: "MGW_AUTH_REDEEM_OUTCOME_UNKNOWN" });
  expect(await auth.getState({ localToken: jwt.sign({ id: projected.user.id, username: projected.user.username, role: "default", session_id: session.id, credential_epoch: session.credentialEpoch }, "1h"), browserProof: "existing-proof" })).toMatchObject({ authenticated: true, remoteAccessMode: "LOCAL_ONLY", reason: "AUTH_RESULT_LOST" });
  expect(gateway.calls).toMatchObject({ redeem: 1, profile: 0 });
  expect((await prisma.meeting_login_sessions.findUnique({ where: { id: session.id } })).remote_access_mode).toBe("LOCAL_ONLY");
});




