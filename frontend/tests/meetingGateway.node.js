import test from "node:test";
import assert from "node:assert/strict";
import {
  createMeetingGatewayClient,
  openTencentAuthorization,
  parseTencentConnectionReturn,
  resolveGatewayConnectionState,
  storeEmployeeLogin,
} from "../src/models/meetingGateway.js";

test("session bootstrap keeps CSRF in memory and sends it only to BFF mutations", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/session")) {
      return jsonResponse({
        binding_status: "BOUND",
        expires_at: "2030-01-01T00:00:00.000Z",
        csrf_token: "csrf-in-memory",
      });
    }
    return jsonResponse({
      authorization_url: "https://meeting.tencent.com/oauth?state=ephemeral",
      transaction_id: "tx-1",
      expires_at: "2030-01-01T00:01:00.000Z",
    });
  };
  const client = createMeetingGatewayClient({
    fetchImpl,
    getAuthHeaders: () => ({ Authorization: "Bearer anythingllm-session" }),
  });

  await client.startOAuth();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/meeting-gateway/session");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[1].url, "/api/meeting-gateway/oauth/start");
  assert.equal(calls[1].options.headers["X-Meeting-CSRF"], "csrf-in-memory");
  assert.equal(calls[1].options.headers.Authorization, "Bearer anythingllm-session");
  assert.equal(calls[1].options.body, "{}");
});

test("employee login sends transient credentials only to the same-origin BFF and returns safe local auth", async () => {
  const calls = [];
  const client = createMeetingGatewayClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        user: { id: 41, username: "employee-41", role: "default", displayName: "Employee 41" },
        localToken: "local.jwt.signature",
        expiresAt: "2030-01-01T00:00:00.000Z",
        remoteAccessMode: "GATEWAY_ENABLED",
      });
    },
  });

  const result = await client.employeeLogin("employee", "one-time-password");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/meeting-gateway/employee-login");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    account: "employee",
    password: "one-time-password",
  });
  assert.equal(result.localToken, "local.jwt.signature");
  assert.equal("accessToken" in result, false);
  assert.equal("refreshToken" in result, false);
});

test("employee login rejects Gateway credential fields from the BFF response", async () => {
  const client = createMeetingGatewayClient({
    fetchImpl: async () =>
      jsonResponse({
        user: { id: 41, username: "employee-41", role: "default" },
        localToken: "local.jwt.signature",
        expiresAt: "2030-01-01T00:00:00.000Z",
        remoteAccessMode: "GATEWAY_ENABLED",
        gatewayAccessToken: "mt_secret",
      }),
  });

  await assert.rejects(client.employeeLogin("employee", "password"), {
    message: "MGW_UI_UNAVAILABLE",
  });
});

test("employee credentials never leave the current origin when API_BASE points elsewhere", async () => {
  const previousWindow = globalThis.window;
  const calls = [];
  globalThis.window = { location: { origin: "https://consumer.example.test" } };
  try {
    const client = createMeetingGatewayClient({
      apiBase: "https://other.example.test/api",
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return jsonResponse({
          user: { id: 41, username: "employee-41", role: "default" },
          localToken: "local.jwt.signature",
          expiresAt: "2030-01-01T00:00:00.000Z",
          remoteAccessMode: "GATEWAY_ENABLED",
        });
      },
    });
    await assert.rejects(client.employeeLogin("employee", "password"), {
      message: "MGW_UI_UNAVAILABLE",
    });
    assert.deepEqual(calls, []);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("employee login stores only the local session and safe user DTO", () => {
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
  };
  const result = storeEmployeeLogin(
    {
      user: { id: 41, username: "employee-41", role: "default", displayName: "Employee 41" },
      localToken: "local.jwt.signature",
      expiresAt: "2030-01-01T00:00:00.000Z",
      remoteAccessMode: "GATEWAY_ENABLED",
    },
    storage,
    1_700_000_000_000
  );

  assert.equal(values.get("anythingllm_authToken"), "local.jwt.signature");
  assert.equal(values.get("anythingllm_user"), JSON.stringify(result.user));
  assert.equal(values.get("anythingllm_authTimestamp"), "1700000000000");
  assert.equal(JSON.stringify([...values]), JSON.stringify([
    ["anythingllm_user", JSON.stringify(result.user)],
    ["anythingllm_authToken", "local.jwt.signature"],
    ["anythingllm_authTimestamp", "1700000000000"],
  ]));
});

test("employee authentication does not imply an ACTIVE Tencent connection", () => {
  assert.deepEqual(
    resolveGatewayConnectionState({
      employeeAuthenticated: true,
      remoteAccessMode: "GATEWAY_ENABLED",
      connections: [],
    }),
    { employeeAuthenticated: true, connectionStatus: "NOT_CONNECTED" }
  );
});

test("only server-listed ACTIVE connections produce an ACTIVE connection state", () => {
  assert.deepEqual(
    resolveGatewayConnectionState({
      employeeAuthenticated: true,
      remoteAccessMode: "GATEWAY_ENABLED",
      connections: [{ id: "c1", name: "Work", status: "ACTIVE" }],
    }),
    { employeeAuthenticated: true, connectionStatus: "ACTIVE" }
  );
});

test("a started authorization remains pending only until the server-provided expiry", () => {
  assert.equal(
    resolveGatewayConnectionState({
      employeeAuthenticated: true,
      remoteAccessMode: "GATEWAY_ENABLED",
      pendingExpiresAt: "2030-01-01T00:00:00.000Z",
      now: Date.parse("2029-12-31T23:59:00.000Z"),
    }).connectionStatus,
    "PENDING"
  );
  assert.equal(
    resolveGatewayConnectionState({
      employeeAuthenticated: true,
      remoteAccessMode: "GATEWAY_ENABLED",
      pendingExpiresAt: "2030-01-01T00:00:00.000Z",
      now: Date.parse("2030-01-01T00:00:00.000Z"),
    }).connectionStatus,
    "EXPIRED"
  );
});

test("Tencent return accepts only one connection_id and ignores neither duplicates nor extra parameters", () => {
  assert.equal(parseTencentConnectionReturn("?connection_id=conn_1"), "conn_1");
  assert.equal(parseTencentConnectionReturn("?connection_id=conn_1&token=secret"), null);
  assert.equal(parseTencentConnectionReturn("?connection_id=conn_1&connection_id=conn_2"), null);
});

test("Tencent authorization opens a validated browser URL without fetching it", async () => {
  const calls = [];
  const browser = {
    open: () => ({
      location: { replace: (url) => calls.push({ navigation: url }) },
      closed: false,
    }),
    location: { assign: (url) => calls.push({ navigation: url }) },
  };
  const authorization = await openTencentAuthorization({
    startOAuth: async () => ({
      authorization_url: "https://meeting.tencent.com/marketplace/authorize.html?corp_id=c1&sdk_id=s1&redirect_uri=https%3A%2F%2Fgateway.example%2Fcallback&state=short-lived",
    }),
    browser,
  });

  assert.equal(authorization.opened, true);
  assert.deepEqual(calls, [
    { navigation: "https://meeting.tencent.com/marketplace/authorize.html?corp_id=c1&sdk_id=s1&redirect_uri=https%3A%2F%2Fgateway.example%2Fcallback&state=short-lived" },
  ]);
});

test("blocked popups do not create a pending authorization or leave the app", async () => {
  let started = false;
  const browser = {
    open: () => null,
    location: { assign: () => assert.fail("same-tab navigation bypasses the opener verification flow") },
  };
  await assert.rejects(
    openTencentAuthorization({
      startOAuth: async () => {
        started = true;
        return { authorization_url: "https://meeting.tencent.com/marketplace/authorize.html?corp_id=c&sdk_id=s&redirect_uri=https%3A%2F%2Fg.example%2Fcb&state=short" };
      },
      browser,
    }),
    { message: "MGW_POPUP_BLOCKED" }
  );
  assert.equal(started, false);
});

test("Tencent callback completion bootstraps the session then asks the BFF to verify connection status", async () => {
  const calls = [];
  const client = createMeetingGatewayClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/session"))
        return jsonResponse({
          binding_status: "BOUND",
          expires_at: "2030-01-01T00:00:00.000Z",
          csrf_token: "csrf-in-memory",
        });
      return jsonResponse({ status: "ACTIVE" });
    },
  });

  const result = await client.confirmConnection("connection-1");

  assert.deepEqual(result, { status: "ACTIVE" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/meeting-gateway/session");
  assert.equal(calls[1].url, "/api/meeting-gateway/connections/connection-1/confirm");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls.some(({ url }) => url.includes("tencent.com")), false);
});

test("refresh starts without cached CSRF and bootstraps from the BFF", async () => {
  const calls = [];
  const client = createMeetingGatewayClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        binding_status: "BOUND",
        expires_at: "2030-01-01T00:00:00.000Z",
        csrf_token: "new-page-csrf",
      });
    },
    getAuthHeaders: () => ({}),
  });

  const session = await client.bootstrapSession();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.deepEqual(session, {
    binding_status: "BOUND",
    expires_at: "2030-01-01T00:00:00.000Z",
  });
});

test("connection DTO rejects unexpected credential fields", async () => {
  const client = createMeetingGatewayClient({
    fetchImpl: async () =>
      jsonResponse({
        items: [{ id: "c1", name: "Work", status: "ACTIVE", gateway_token: "secret" }],
      }),
    getAuthHeaders: () => ({}),
  });

  await assert.rejects(client.listConnections(), { message: "MGW_UI_UNAVAILABLE" });
});

test("login rejects an empty CSRF token with the same unavailable state as bootstrap", async () => {
  const client = createMeetingGatewayClient({
    fetchImpl: async () =>
      jsonResponse({
        binding_status: "BOUND",
        expires_at: "2030-01-01T00:00:00.000Z",
        csrf_token: "",
      }),
    getAuthHeaders: () => ({}),
  });

  await assert.rejects(client.login("employee", "password"), {
    message: "MGW_UI_UNAVAILABLE",
  });
});

test("unrecognized BFF errors are reduced to a safe adapter code", async () => {
  const client = createMeetingGatewayClient({
    fetchImpl: async () => jsonResponse({ error: "token=upstream-secret" }, 503),
    getAuthHeaders: () => ({}),
  });

  await assert.rejects(client.listConnections(), {
    message: "MGW_UI_UNAVAILABLE",
  });
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
