const jwt = require("jsonwebtoken");
const express = require("express");
const { createServer } = require("node:http");
const { COOKIE_NAME, SESSION_COOKIE_NAME, createWeComAuthService } = require("../../utils/meetingGateway/wecomAuth");
const { createWeComAuthEndpoints } = require("../../endpoints/wecomAuth");

const ORIGIN = "https://copilot.superic.com:9999";
const KEYRING = { activeKeyId: "k1", keys: { k1: Buffer.alloc(32, 7) }, hmacKey: Buffer.alloc(32, 8) };
const iso = (ms) => new Date(ms).toISOString();

function fixture({ available = false, successfulLogin = false } = {}) {
  let now = Date.parse("2026-10-19T00:00:00.000Z");
  const sessions = new Map();
  const transactions = new Map();
  const counts = { start: 0, redeem: 0, profile: 0, projected: 0 };
  const gateway = {
    getAvailability: () => ({ enabled: available, available, reason: available ? null : "DEPENDENCY_NOT_READY" }),
    startAuthentication: async ({ clientState, redirectUri }) => {
      counts.start++;
      if (!available) throw Object.assign(new Error("MGW_DEPENDENCY_NOT_READY"), { code: "MGW_DEPENDENCY_NOT_READY" });
      return { transactionId: "gateway-tx-1", authorizationUrl: `https://login.example.test/wecom?state=${clientState}&redirect_uri=${encodeURIComponent(redirectUri)}`, expiresAt: iso(now + 300000) };
    },
    redeemAuthentication: async () => {
      counts.redeem++;
      if (!successfulLogin) throw Object.assign(new Error("MGW_AUTH_REDEEM_OUTCOME_UNKNOWN"), { code: "MGW_AUTH_REDEEM_OUTCOME_UNKNOWN" });
      return { accessToken: "private-gateway-token", subject: { orgId: "org1", memberId: "member1", userId: "gw-user-1", issuer: "issuer1" }, identityExpiresAt: iso(now + 3600000) };
    },
    fetchAuthenticatedProfile: async () => {
      counts.profile++;
      return { gatewayInstanceId: "instance1", orgId: "org1", memberId: "member1", userId: "gw-user-1", issuer: "issuer1", displayName: "Person", active: true, identityExpiresAt: iso(now + 3600000) };
    },
  };
  const store = {
    createLoginTransaction: async (row) => {
      const dbRow = {
        transaction_id: row.transactionId, client_state_hash: row.clientStateHash, browser_proof_hash: row.browserProofHash,
        verifier_ciphertext: row.verifierCiphertext, verifier_nonce: row.verifierNonce, crypto_key_id: row.cryptoKeyId,
        expires_at: row.expiresAt, local_session_id: row.localSessionId, remote_access_mode: row.remoteAccessMode,
        ticket_ciphertext: null, ticket_nonce: null, state: "PENDING",
      };
      transactions.set(row.transactionId, dbRow); return dbRow;
    },
    getLoginTransaction: async ({ transactionId }) => transactions.get(transactionId) || null,
    storeLoginResultTicket: async ({ transactionId, ticketCiphertext, ticketNonce }) => {
      const row = transactions.get(transactionId);
      if (!row || row.state !== "PENDING" || row.ticket_ciphertext) return false;
      row.ticket_ciphertext = ticketCiphertext; row.ticket_nonce = ticketNonce; return true;
    },
    consumeLoginTransaction: async ({ transactionId }) => {
      const row = transactions.get(transactionId);
      if (!row || row.state !== "PENDING" || !row.ticket_ciphertext) return null;
      row.state = "CONSUMED"; return { ...row };
    },
    markLocalOnly: async ({ localSessionId }) => { const row = sessions.get(localSessionId); if (!row) return false; row.remote_access_mode = "LOCAL_ONLY"; return true; },
    upsertGatewayUserProjection: async () => { counts.projected++; return { user: { id: 99, username: "mgw_x", role: "default" }, binding: { id: "b99", display_name: "Person" } }; },
    createLocalSession: async ({ userId, bindingId, identityExpiresAt, browserProofHash }) => {
      const row = { id: "s" + userId, user_id: userId, binding_id: bindingId, credential_epoch: 0, expires_at: new Date(identityExpiresAt), identity_expires_at: new Date(identityExpiresAt), remote_access_mode: "GATEWAY_ENABLED", browser_proof_hash: browserProofHash };
      sessions.set(row.id, row); return { id: row.id, userId, credentialEpoch: 0, expiresAt: row.expires_at, remoteAccessMode: row.remote_access_mode };
    },
    getLocalSession: async ({ sessionId, userId }) => {
      const row = sessions.get(sessionId);
      if (!row || row.user_id !== userId) return null;
      return { ...row, revoked_at: row.revoked_at || null, current_binding_epoch: 0, binding_status: "BOUND", gateway_active: 1, user_suspended: 0 };
    },
    revokeLocalSession: async ({ sessionId, userId }) => { const row = sessions.get(sessionId); if (!row || row.user_id !== userId) return false; row.revoked_at = new Date(now); return true; },
  };
  return { get now() { return now; }, advance(ms) { now += ms; }, gateway, store, counts };
}

function service(fx, overrides = {}) {
  return createWeComAuthService({
    gateway: fx.gateway, store: fx.store, origin: ORIGIN,
    clock: () => new Date(fx.now), cryptoConfig: KEYRING,
    jwt: { sign: (claims, expiry) => jwt.sign(claims, "local-test-secret", { expiresIn: expiry }), verify: (token) => jwt.verify(token, "local-test-secret") },
    ...overrides,
  });
}

describe("WeCom BFF auth service", () => {
  test("reports unavailable and creates no pretend authorization URL when contract is absent", async () => {
    const fx = fixture(); const auth = service(fx);
    expect(auth.getConfig()).toEqual({ enabled: false, available: false, reason: "DEPENDENCY_NOT_READY" });
    await expect(auth.start({ origin: ORIGIN })).rejects.toMatchObject({ code: "MGW_DEPENDENCY_NOT_READY" });
    expect(fx.counts.start).toBe(0);
  });

  test("rejects foreign origins before changing login state", async () => {
    const fx = fixture(); const auth = service(fx);
    await expect(auth.start({ origin: "https://attacker.example" })).rejects.toMatchObject({ code: "MGW_CSRF_REJECTED" });
    expect(fx.counts.start).toBe(0);
  });

  test("creates a five minute browser-bound transaction with PKCE", async () => {
    const fx = fixture({ available: true }); const auth = service(fx, { callbackUri: ORIGIN + "/api/auth/wecom/callback" });
    const started = await auth.start({ origin: ORIGIN });
    expect(Date.parse(started.expiresAt) - fx.now).toBe(300000);
    expect(started.cookie.name).toBe("__Host-meeting_login");
    expect(started.cookie.name).toBe(COOKIE_NAME);
    expect(SESSION_COOKIE_NAME).toBe("__Host-meeting_session");
    expect(started.cookie.name).not.toBe(SESSION_COOKIE_NAME);
    expect(started.cookie.options).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", path: "/" });
    expect(started).not.toHaveProperty("codeVerifier");
  });

  test("an uncertain redemption makes only the current local session local-only", async () => {
    const fx = fixture({ available: true }); const auth = service(fx, { callbackUri: ORIGIN + "/api/auth/wecom/callback" });
    await fx.store.createLocalSession({ userId: 1, bindingId: "b1", identityExpiresAt: iso(fx.now + 3600000), authMethod: "wecom", browserProofHash: auth.hashBrowserProof("proof-a") });
    await fx.store.createLocalSession({ userId: 2, bindingId: "b2", identityExpiresAt: iso(fx.now + 3600000), authMethod: "wecom", browserProofHash: auth.hashBrowserProof("proof-b") });
    const localTokenA = jwt.sign({ id: 1, username: "a", session_id: "s1", credential_epoch: 0 }, "local-test-secret", { expiresIn: "1h" });
    const localTokenB = jwt.sign({ id: 2, username: "b", session_id: "s2", credential_epoch: 0 }, "local-test-secret", { expiresIn: "1h" });
    const started = await auth.start({ origin: ORIGIN, currentLocalSession: { id: "s1", userId: 1 }, browserProof: "proof-a" });
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    await auth.callback({ origin: ORIGIN, cookie: started.cookie.value, clientState: state, resultTicket: "one-time-ticket" });
    await expect(auth.complete({ origin: ORIGIN, cookie: started.cookie.value, browserProof: "proof-a", csrf: started.csrfToken }))
      .rejects.toMatchObject({ code: "MGW_AUTH_REDEEM_OUTCOME_UNKNOWN" });
    const stateA = await auth.getState({ localToken: localTokenA, browserProof: "proof-a" });
    const stateB = await auth.getState({ localToken: localTokenB, browserProof: "proof-b" });
    expect(stateA.remoteAccessMode).toBe("LOCAL_ONLY");
    expect(stateB.remoteAccessMode).toBe("GATEWAY_ENABLED");
    expect(fx.counts.redeem).toBe(1);
    await expect(auth.complete({ origin: ORIGIN, cookie: started.cookie.value, browserProof: "proof-a", csrf: started.csrfToken }))
      .rejects.toMatchObject({ code: "MGW_AUTH_TRANSACTION_INVALID" });
    expect(fx.counts.redeem).toBe(1);
  });

  test("a lost first login cannot fabricate an employee or local session", async () => {
    const fx = fixture({ available: true }); const auth = service(fx, { callbackUri: ORIGIN + "/api/auth/wecom/callback" });
    const started = await auth.start({ origin: ORIGIN });
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    await auth.callback({ cookie: started.cookie.value, clientState: state, resultTicket: "one-time-ticket" });
    const csrf = (await auth.getState({ preloginCookie: started.cookie.value })).csrfToken;
    await expect(auth.complete({ origin: ORIGIN, cookie: started.cookie.value, csrf })).rejects.toMatchObject({ code: "MGW_AUTH_REDEEM_OUTCOME_UNKNOWN" });
    expect(fx.counts.projected).toBe(0);
    expect(fx.counts.redeem).toBe(1);
    expect(await auth.getState({})).toMatchObject({ authenticated: false, remoteAccessMode: null, user: null });
  });

  test("an explicit successful rescan issues a fresh gateway-enabled session while the old local-only session stays scoped", async () => {
    const fx = fixture({ available: true, successfulLogin: true });
    const auth = service(fx, { callbackUri: ORIGIN + "/api/auth/wecom/callback" });
    await fx.store.createLocalSession({ userId: 1, bindingId: "b1", identityExpiresAt: iso(fx.now + 3600000), authMethod: "wecom", browserProofHash: auth.hashBrowserProof("proof-a") });
    await fx.store.markLocalOnly({ localSessionId: "s1", reason: "AUTH_RESULT_LOST" });
    const started = await auth.start({ origin: ORIGIN, currentLocalSession: { id: "s1", userId: 1 }, browserProof: "proof-a" });
    expect(started.cookie.name).toBe(COOKIE_NAME);
    expect(started.cookie.name).not.toBe(SESSION_COOKIE_NAME);
    const oldToken = jwt.sign({ id: 1, username: "a", session_id: "s1", credential_epoch: 0 }, "local-test-secret", { expiresIn: "1h" });
    const stateDuringRescan = await auth.getState({ localToken: oldToken, browserProof: "proof-a", preloginCookie: started.cookie.value });
    expect(stateDuringRescan.remoteAccessMode).toBe("LOCAL_ONLY");
    expect(stateDuringRescan.csrfToken).toBe(started.csrfToken);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    await auth.callback({ cookie: started.cookie.value, clientState: state, resultTicket: "new-ticket" });
    const csrf = (await auth.getState({ preloginCookie: started.cookie.value })).csrfToken;
    const recovered = await auth.complete({ origin: ORIGIN, cookie: started.cookie.value, csrf });
    expect(recovered.remoteAccessMode).toBe("GATEWAY_ENABLED");
    const proof = recovered.sessionCookie.value.slice(recovered.sessionCookie.value.indexOf(".") + 1);
    expect(await auth.getState({ localToken: recovered.localToken, browserProof: proof })).toMatchObject({ authenticated: true, remoteAccessMode: "GATEWAY_ENABLED" });
    expect(await auth.getState({ localToken: oldToken, browserProof: "proof-a" })).toMatchObject({ authenticated: true, remoteAccessMode: "LOCAL_ONLY" });
  });

  test("rejects a changed session epoch and revoked or suspended registry rows", async () => {
    const fx = fixture(); const auth = service(fx);
    await fx.store.createLocalSession({ userId: 1, bindingId: "b1", identityExpiresAt: iso(fx.now + 3600000), authMethod: "wecom" });
    const token = jwt.sign({ id: 1, username: "a", session_id: "s1", credential_epoch: 0 }, "local-test-secret", { expiresIn: "1h" });
    const row = fx.store.getLocalSession;
    fx.store.getLocalSession = async (args) => ({ ...(await row(args)), current_binding_epoch: 1 });
    await expect(auth.getState({ localToken: token, browserProof: "proof" })).rejects.toMatchObject({ code: "MGW_BUSINESS_AUTH_REQUIRED" });
    await expect(auth.getValidatedSessionActor({ sessionId: "s1", userId: 1, credentialEpoch: 0 })).rejects.toMatchObject({ code: "MGW_BUSINESS_AUTH_REQUIRED" });
  });

  test("internal worker lookup denies suspended, inactive, revoked, and expired registry sessions", async () => {
    const fx = fixture(); const auth = service(fx);
    await fx.store.createLocalSession({ userId: 1, bindingId: "b1", identityExpiresAt: iso(fx.now + 3600000), authMethod: "wecom" });
    const original = fx.store.getLocalSession;
    for (const override of [
      { user_suspended: 1 },
      { binding_status: "REVOKED" },
      { gateway_active: 0 },
      { revoked_at: new Date(fx.now) },
    ]) {
      fx.store.getLocalSession = async (args) => ({ ...(await original(args)), ...override });
      await expect(auth.getValidatedSessionActor({ sessionId: "s1", userId: 1 })).rejects.toMatchObject({ code: "MGW_BUSINESS_AUTH_REQUIRED" });
    }
    fx.store.getLocalSession = original;
    fx.advance(3600001);
    await expect(auth.getValidatedSessionActor({ sessionId: "s1", userId: 1 })).rejects.toMatchObject({ code: "MGW_BUSINESS_AUTH_REQUIRED" });
  });

  test("internal request auth state distinguishes gateway, legacy, and unauthenticated callers", async () => {
    const fx = fixture(); const auth = service(fx);
    await fx.store.createLocalSession({ userId: 1, bindingId: "b1", identityExpiresAt: iso(fx.now + 3600000), authMethod: "wecom", browserProofHash: auth.hashBrowserProof("proof") });
    const gatewayToken = jwt.sign({ id: 1, username: "a", session_id: "s1", credential_epoch: 0 }, "local-test-secret", { expiresIn: "1h" });
    expect(await auth.getRequestAuthState({ localToken: gatewayToken, browserProof: "proof" })).toMatchObject({ kind: "GATEWAY_SESSION", session: { remoteAccessMode: "GATEWAY_ENABLED" } });
    const legacyToken = jwt.sign({ p: "legacy-encrypted-password" }, "local-test-secret", { expiresIn: "1h" });
    expect(await auth.getRequestAuthState({ localToken: legacyToken })).toMatchObject({ authenticated: true, kind: "LEGACY_SINGLE_USER", actor: null, remoteAccessMode: null });
    expect(await auth.getRequestAuthState({})).toMatchObject({ authenticated: false, kind: "UNAUTHENTICATED", actor: null, session: null });
  });

  test("completes only after profile projection and issues a local registry JWT", async () => {
    const fx = fixture({ available: true, successfulLogin: true });
    const auth = service(fx, { callbackUri: ORIGIN + "/api/auth/wecom/callback", resultUri: ORIGIN + "/sso/wecom/result" });
    const started = await auth.start({ origin: ORIGIN });
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const callback = await auth.callback({ cookie: started.cookie.value, clientState: state, resultTicket: "result-ticket" });
    expect(callback).toEqual({ status: 303, location: ORIGIN + "/sso/wecom/result" });
    const before = await auth.getState({ preloginCookie: started.cookie.value });
    const completed = await auth.complete({ origin: ORIGIN, cookie: started.cookie.value, csrf: before.csrfToken });
    expect(fx.counts).toMatchObject({ redeem: 1, profile: 1, projected: 1 });
    expect(completed).toMatchObject({ state: "AUTHENTICATED", remoteAccessMode: "GATEWAY_ENABLED", user: { id: 99, role: "default", displayName: "Person" } });
    expect(completed.localToken).toBeTruthy();
    expect(completed).not.toHaveProperty("accessToken");
    expect(completed.sessionCookie.name).toBe(SESSION_COOKIE_NAME);
    const proof = completed.sessionCookie.value.slice(completed.sessionCookie.value.indexOf(".") + 1);
    expect(await auth.getState({ localToken: completed.localToken, browserProof: proof })).toMatchObject({ authenticated: true, remoteAccessMode: "GATEWAY_ENABLED" });
  });

  test("serves the frozen response envelope and enforces request Origin over HTTP", async () => {
    const fx = fixture(); const auth = service(fx);
    const app = express(); app.use(express.json()); createWeComAuthEndpoints(app, { auth });
    const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/auth/wecom/config`;
      const configResponse = await fetch(url);
      expect(configResponse.headers.get("cache-control")).toBe("no-store");
      expect(await configResponse.json()).toMatchObject({ data: { enabled: false, available: false, reason: "DEPENDENCY_NOT_READY" }, meta: { schema_version: "2.0" } });
      const rejected = await fetch(url.replace("/config", "/start"), { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: "{}" });
      expect(rejected.status).toBe(403);
      expect((await rejected.json()).error.code).toBe("MGW_CSRF_REJECTED");
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  test("runs callback, completion, state, and logout DTOs over HTTP with one ticket redemption", async () => {
    const fx = fixture({ available: true, successfulLogin: true });
    const auth = service(fx, { callbackUri: ORIGIN + "/api/auth/wecom/callback", resultUri: ORIGIN + "/sso/wecom/result" });
    const app = express(); app.use(express.json()); createWeComAuthEndpoints(app, { auth });
    const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const root = `http://127.0.0.1:${server.address().port}/auth/wecom`;
      const startResponse = await fetch(root + "/start", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
      const startBody = await startResponse.json();
      expect(startResponse.status).toBe(200);
      expect(startResponse.headers.get("set-cookie")).toContain("__Host-meeting_login=");
      const loginCookie = startResponse.headers.get("set-cookie").split(";")[0];
      const loginCookieValue = loginCookie.slice(loginCookie.indexOf("=") + 1);
      const stateResponse = await fetch(root + "/state", { headers: { cookie: loginCookie } });
      const preloginState = (await stateResponse.json()).data;
      expect(preloginState).toMatchObject({ authenticated: false, remoteAccessMode: null });
      expect(preloginState.csrfToken).toBeTruthy();

      const clientState = new URL(startBody.data.authorizationUrl).searchParams.get("state");
      const callbackUrl = new URL(root + "/callback"); callbackUrl.searchParams.set("state", clientState); callbackUrl.searchParams.set("resultTicket", "one-time");
      const wrongCookie = loginCookie.replace(/.$/, loginCookie.endsWith("a") ? "b" : "a");
      const wrongCallback = await fetch(callbackUrl, { headers: { cookie: wrongCookie }, redirect: "manual" });
      expect(wrongCallback.status).toBe(409);
      const callback = await fetch(callbackUrl, { headers: { cookie: loginCookie }, redirect: "manual" });
      expect(callback.status).toBe(303);
      expect(callback.headers.get("location")).toBe(ORIGIN + "/sso/wecom/result");
      expect(callback.headers.get("location")).not.toContain("resultTicket");

      const badOrigin = await fetch(root + "/complete", { method: "POST", headers: { origin: "https://attacker.example", cookie: loginCookie, "content-type": "application/json", "X-MGW-CSRF": preloginState.csrfToken }, body: "{}" });
      expect(badOrigin.status).toBe(403);
      const badCsrf = await fetch(root + "/complete", { method: "POST", headers: { origin: ORIGIN, cookie: loginCookie, "content-type": "application/json", "X-MGW-CSRF": "wrong" }, body: "{}" });
      expect(badCsrf.status).toBe(403);
      const completedResponse = await fetch(root + "/complete", { method: "POST", headers: { origin: ORIGIN, cookie: loginCookie, "content-type": "application/json", "X-MGW-CSRF": preloginState.csrfToken }, body: "{}" });
      const completed = (await completedResponse.json()).data;
      expect(completedResponse.status).toBe(200);
      expect(completed).toMatchObject({ state: "AUTHENTICATED", remoteAccessMode: "GATEWAY_ENABLED", user: { id: 99 } });
      expect(completedResponse.headers.get("set-cookie")).toContain("__Host-meeting_session=");
      expect(fx.counts.redeem).toBe(1);

      const sessionCookie = completedResponse.headers.get("set-cookie").split(";")[0];
      const authenticatedStateResponse = await fetch(root + "/state", { headers: { authorization: `Bearer ${completed.localToken}`, cookie: sessionCookie } });
      const authenticatedState = (await authenticatedStateResponse.json()).data;
      expect(authenticatedState).toMatchObject({ authenticated: true, remoteAccessMode: "GATEWAY_ENABLED" });
      const logoutResponse = await fetch("http://127.0.0.1:" + server.address().port + "/auth/logout", { method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${completed.localToken}`, cookie: sessionCookie, "content-type": "application/json", "X-MGW-CSRF": authenticatedState.csrfToken }, body: "{}" });
      expect(logoutResponse.status).toBe(200);
      const revoked = await fetch(root + "/state", { headers: { authorization: `Bearer ${completed.localToken}`, cookie: sessionCookie } });
      expect(revoked.status).toBe(401);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
