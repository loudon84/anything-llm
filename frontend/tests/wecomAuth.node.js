import test from "node:test";
import assert from "node:assert/strict";
import {
  createWeComAuthClient,
  isSafeAuthorizationUrl,
  resolveWeComView,
  storeWeComCompletion,
} from "../src/models/wecomAuth.js";

test("unavailable WeCom config resolves to a disabled CTA without a QR or success state", () => {
  const view = resolveWeComView({
    authenticated: false,
    available: false,
    reason: "DEPENDENCY_NOT_READY",
  });
  assert.equal(view.canStartWeCom, false);
  assert.equal(view.message, "企业微信扫码登录暂不可用：认证服务尚未就绪");
  assert.equal(view.authorizationUrl, null);
});

test("start navigates only to a validated HTTPS authorization URL returned by the BFF", async () => {
  const calls = [];
  const navigations = [];
  const client = createWeComAuthClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({
        data: {
          authorizationUrl: "https://login.example.test/authorize?state=opaque",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
        meta: { request_id: "r1", schema_version: "2.0" },
      });
    },
    navigate: (url) => navigations.push(url),
  });

  await client.start();

  assert.deepEqual(navigations, [
    "https://login.example.test/authorize?state=opaque",
  ]);
  assert.equal(calls[0].url, "/api/auth/wecom/start");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.body, "{}");
});

test("start refuses an unsafe authorization URL instead of navigating to it", async () => {
  const navigations = [];
  const client = createWeComAuthClient({
    fetchImpl: async () =>
      response({
        data: {
          authorizationUrl: "http://evil.test/authorize",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
        meta: { request_id: "r1", schema_version: "2.0" },
      }),
    navigate: (url) => navigations.push(url),
  });

  await assert.rejects(client.start(), { message: "MGW_AUTH_UNAVAILABLE" });
  assert.deepEqual(navigations, []);
});

test("authorization URL validation blocks script and data protocols", () => {
  assert.equal(isSafeAuthorizationUrl("javascript:alert(1)"), false);
  assert.equal(isSafeAuthorizationUrl("data:text/html,login"), false);
  assert.equal(isSafeAuthorizationUrl("https://login.example.test/auth"), true);
});

test("LOCAL_ONLY permits authenticated local search and disables remote access with approved copy", () => {
  const view = resolveWeComView({
    authenticated: true,
    remoteAccessMode: "LOCAL_ONLY",
  });
  assert.equal(view.canSearchLocal, true);
  assert.equal(view.canFetchRemote, false);
  assert.equal(
    view.message,
    "认证结果丢失，仅可检索本地已有会议数据；重新扫码后恢复远端访问"
  );
  assert.equal(view.nextAction, "RESCAN");
});

test("local meeting access is unavailable until the BFF confirms an authenticated session", () => {
  assert.equal(
    resolveWeComView({ authenticated: false, remoteAccessMode: null })
      .canSearchLocal,
    false
  );
  assert.equal(
    resolveWeComView({
      authenticated: true,
      remoteAccessMode: "GATEWAY_ENABLED",
    }).canSearchLocal,
    true
  );
  assert.equal(
    resolveWeComView({
      authenticated: true,
      remoteAccessMode: "GATEWAY_ENABLED",
    }).canFetchRemote,
    true
  );
});

test("legacy password sessions keep existing meeting access when WeCom is unavailable", () => {
  const view = resolveWeComView({
    authenticated: true,
    remoteAccessMode: null,
    available: false,
    reason: "DEPENDENCY_NOT_READY",
  });
  assert.equal(view.canSearchLocal, true);
  assert.equal(view.canFetchRemote, true);
  assert.equal(view.canStartWeCom, false);
});

test("unauthenticated and authenticated sessions with an invalid mode fail closed", () => {
  assert.equal(
    resolveWeComView({ authenticated: false, remoteAccessMode: null }).canSearchLocal,
    false
  );
  assert.equal(
    resolveWeComView({ authenticated: false, remoteAccessMode: null }).canFetchRemote,
    false
  );
  assert.equal(
    resolveWeComView({ authenticated: true, remoteAccessMode: "UNKNOWN" })
      .canSearchLocal,
    false
  );
});

test("BFF accepts a valid legacy password session with null access mode", async () => {
  const client = createWeComAuthClient({
    fetchImpl: async () =>
      response({
        data: {
          authenticated: true,
          remoteAccessMode: null,
          reason: null,
          expiresAt: null,
          user: { id: 4, username: "legacy", role: "default" },
          csrfToken: "legacy-csrf",
        },
        meta: { request_id: "r-legacy", schema_version: "2.0" },
      }),
  });
  assert.deepEqual(await client.getState(), {
    authenticated: true,
    remoteAccessMode: null,
    reason: null,
    expiresAt: null,
    user: { id: 4, username: "legacy", role: "default" },
  });
});

test("single-user legacy BFF state authenticates meeting access without an enterprise user", async () => {
  const client = createWeComAuthClient({
    fetchImpl: async () =>
      response({
        data: {
          authenticated: true,
          remoteAccessMode: null,
          reason: null,
          expiresAt: null,
          user: null,
          csrfToken: null,
        },
        meta: { request_id: "r-single-user", schema_version: "2.0" },
      }),
  });

  const state = await client.getState();
  assert.equal(state.authenticated, true);
  assert.equal(state.remoteAccessMode, null);
  assert.equal(state.user, null);
  const view = resolveWeComView({
    authenticated: state.authenticated,
    remoteAccessMode: state.remoteAccessMode,
    available: false,
  });
  assert.equal(view.canSearchLocal, true);
  assert.equal(view.canFetchRemote, true);
});

test("authenticated Gateway state still requires a safe user", async () => {
  const client = createWeComAuthClient({
    fetchImpl: async () =>
      response({
        data: {
          authenticated: true,
          remoteAccessMode: "GATEWAY_ENABLED",
          reason: null,
          expiresAt: "2030-01-01T00:00:00.000Z",
          user: null,
          csrfToken: "csrf",
        },
        meta: { request_id: "r-gateway-empty-user", schema_version: "2.0" },
      }),
  });

  await assert.rejects(client.getState(), { message: "MGW_AUTH_UNAVAILABLE" });
});

test("logout can revoke a legacy password session using its BFF CSRF token", async () => {
  const calls = [];
  const client = createWeComAuthClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/state"))
        return response({
          data: {
            authenticated: true,
            remoteAccessMode: null,
            reason: null,
            expiresAt: null,
            user: { id: 4, username: "legacy", role: "default" },
            csrfToken: "legacy-csrf",
          },
          meta: { request_id: "r-legacy", schema_version: "2.0" },
        });
      return response({
        data: { revoked: true },
        meta: { request_id: "r-logout", schema_version: "2.0" },
      });
    },
  });

  assert.equal(await client.logout(), true);
  assert.equal(calls[1].url, "/api/auth/logout");
  assert.equal(calls[1].options.headers["X-MGW-CSRF"], "legacy-csrf");
});

test("a lost completion response refreshes state without resubmitting the one-time ticket", async () => {
  const calls = [];
  let stateCalls = 0;
  const values = new Map([["anythingllm_authToken", "existing-working-token"]]);
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
  };
  const client = createWeComAuthClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/state")) {
        stateCalls++;
        return response({
          data: {
            authenticated: true,
            remoteAccessMode: "LOCAL_ONLY",
            reason: "RESULT_LOST",
            expiresAt: "2030-01-01T00:00:00.000Z",
            user: { id: 7, username: "local-user", role: "default" },
            csrfToken: "csrf",
          },
          meta: { request_id: `r${stateCalls}`, schema_version: "2.0" },
        });
      }
      throw new Error("network disconnected after commit");
    },
  });

  const result = await client.completeFromCallback({
    search: "?token=must-not-be-used",
    storage,
  });

  assert.equal(result.state.remoteAccessMode, "LOCAL_ONLY");
  assert.equal(calls.filter(({ url }) => url.endsWith("/complete")).length, 1);
  assert.equal(calls.filter(({ url }) => url.endsWith("/state")).length, 2);
  assert.equal(calls[1].options.headers["X-MGW-CSRF"], "csrf");
  assert.equal(calls[1].options.body, "{}");
  assert.equal(JSON.stringify(calls[1]).includes("must-not-be-used"), false);
  assert.equal(values.get("anythingllm_authToken"), "existing-working-token");
});

test("only a complete authenticated BFF response stores its local token and safe user", () => {
  const values = new Map([["existing", "preserve"]]);
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
  };
  const saved = storeWeComCompletion(
    {
      state: "AUTHENTICATED",
      user: {
        id: 23,
        username: "member-handle",
        role: "default",
        displayName: "Team Member",
        password: "discard",
      },
      localToken: "local-jwt",
      expiresAt: "2030-01-01T00:00:00.000Z",
      remoteAccessMode: "GATEWAY_ENABLED",
    },
    storage,
    1000
  );

  assert.equal(saved.user.displayName, "Team Member");
  assert.equal("password" in saved.user, false);
  assert.equal(storage.getItem("anythingllm_authToken"), "local-jwt");
  assert.equal(JSON.parse(storage.getItem("anythingllm_user")).role, "default");
  assert.notEqual(storage.getItem("anythingllm_authTimestamp"), null);
  assert.equal(storage.getItem("existing"), "preserve");
});

test("incomplete or privileged fabricated completion does not modify current login storage", () => {
  const values = new Map([["anythingllm_authToken", "working-local-token"]]);
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
  };

  assert.throws(
    () => storeWeComCompletion({ state: "PENDING", localToken: "x" }, storage),
    { message: "MGW_AUTH_UNAVAILABLE" }
  );
  assert.throws(
    () =>
      storeWeComCompletion(
        {
          state: "AUTHENTICATED",
          user: { id: 1, username: "u", role: "admin" },
          localToken: "x",
          expiresAt: "2030-01-01T00:00:00.000Z",
          remoteAccessMode: "GATEWAY_ENABLED",
        },
        storage
      ),
    { message: "MGW_AUTH_UNAVAILABLE" }
  );
  assert.equal(storage.getItem("anythingllm_authToken"), "working-local-token");
});

test("logout revokes only the local BFF context with same-origin cookies and in-memory CSRF", async () => {
  const calls = [];
  const client = createWeComAuthClient({
    getAuthHeaders: () => ({ Authorization: "Bearer local-token" }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/state"))
        return response({
          data: {
            authenticated: true,
            remoteAccessMode: "GATEWAY_ENABLED",
            reason: null,
            expiresAt: "2030-01-01T00:00:00.000Z",
            user: { id: 2, username: "local", role: "default" },
            csrfToken: "csrf-memory",
          },
          meta: { request_id: "r1", schema_version: "2.0" },
        });
      return response({
        data: { revoked: true },
        meta: { request_id: "r2", schema_version: "2.0" },
      });
    },
  });

  const revoked = await client.logout();

  assert.equal(revoked, true);
  assert.equal(calls[1].url, "/api/auth/logout");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.equal(calls[1].options.headers["X-MGW-CSRF"], "csrf-memory");
  assert.equal(calls[1].options.headers.Authorization, "Bearer local-token");
  assert.equal(calls[1].options.body, "{}");
});

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
