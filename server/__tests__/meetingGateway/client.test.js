const { classifyFailure } = require("../../utils/meetingGateway/errors");
const { createGatewayClient } = require("../../utils/meetingGateway/client");
const { redact } = require("../../utils/meetingGateway/redact");

function jsonResponse(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return data; },
  };
}

describe("Meeting Gateway client boundaries", () => {
  let consoleWarnSpy;
  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => consoleWarnSpy.mockRestore());
  test("uses the actor token for the exact Gateway OAuth and connection routes without query-contract evidence", async () => {
    const fetchImpl = jest.fn(async (url, options) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/oauth/authorizations") return jsonResponse({ code: 0, error_code: 0, data: { authorization_url: "https://meeting.tencent.com/marketplace/authorize.html", transaction_id: "tx-a", expires_at: "2026-10-20T00:05:00Z" } }, 201);
      if (path === "/api/v1/me/connections") return jsonResponse({ code: 0, error_code: 0, data: { items: [{ id: "conn-a", application_id: "app-a", name: "Tencent", kind: "THIRD_PARTY_OAUTH", status: "PENDING_CONFIRMATION", owner_member_id: "member-a" }] } });
      return jsonResponse({ code: 0, error_code: 0, data: { id: "conn-a", status: "ACTIVE" } });
    });
    const client = createGatewayClient({
      origin: "https://gateway.example.test", originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/api/v1/oauth/authorizations", "/api/v1/me/connections", "/api/v1/connections/:connectionId/confirm"],
      fetchImpl, enabled: true,
    });
    await expect(client.startAuthorization({ gatewayAccessToken: "mt_employee", applicationId: "app-a", returnTo: "https://consumer.example/return" }))
      .resolves.toEqual({ authorizationUrl: "https://meeting.tencent.com/marketplace/authorize.html", transactionId: "tx-a", expiresAt: "2026-10-20T00:05:00Z" });
    await expect(client.listConnections({ gatewayAccessToken: "mt_employee" })).resolves.toEqual([
      { connectionId: "conn-a", applicationId: "app-a", memberId: "member-a", type: "THIRD_PARTY_OAUTH", name: "Tencent", status: "PENDING_CONFIRMATION" },
    ]);
    await client.confirmConnection({ gatewayAccessToken: "mt_employee" }, "conn-a");
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/api/v1/oauth/authorizations", "/api/v1/me/connections", "/api/v1/connections/conn-a/confirm",
    ]);
    expect(fetchImpl.mock.calls.every(([, options]) => options.headers.Authorization === "Bearer mt_employee")).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ application_id: "app-a", return_to: "https://consumer.example/return" });
  });
  test("preserves empty application_id when selecting Gateway's ENV-owned OAuth application", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ code: 0, error_code: 0, data: {
      authorization_url: "https://meeting.tencent.com/marketplace/authorize.html?corp_id=c&sdk_id=s&redirect_uri=https%3A%2F%2Fg.example%2Fcallbacks%2Ftencent%2Foauth%2Fs&state=st",
      transaction_id: "tx", expires_at: "2026-10-20T00:05:00Z",
    } }, 201));
    const client = createGatewayClient({ origin: "https://gateway.example.test", originAllowlist: ["https://gateway.example.test"], allowlist: ["/api/v1/oauth/authorizations"], fetchImpl, enabled: true });
    await client.startAuthorization({ gatewayAccessToken: "mt_employee", applicationId: "", returnTo: "https://consumer.example/api/meeting-gateway/oauth/return" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ application_id: "", return_to: "https://consumer.example/api/meeting-gateway/oauth/return" });
  });
  test("TEST-A-REV-008-01: refuses transport until contract evidence is confirmed", async () => {
    const fetchImpl = jest.fn();
    const client = createGatewayClient({
      origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/explicit/path"],
      fetchImpl,
          enabled: true,
    });

    await expect(client.requestForSubject({ bridge: "bridge", path: "/explicit/path" }))
      .rejects.toMatchObject({ code: "MGW_UPSTREAM_CONTRACT_UNAVAILABLE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("TEST-A-SEC-003-02: rejects unsafe origins and paths before network access", async () => {
    const fetchImpl = jest.fn();
    expect(() => createGatewayClient({ origin: "http://169.254.169.254/latest/meta-data", allowlist: ["/explicit/path"], fetchImpl }))
      .toThrow("MGW_CONFIG_INVALID");
    const client = createGatewayClient({ origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"], allowlist: ["/explicit/path"], fetchImpl });

    await expect(client.requestForSubject({ bridge: "bridge", path: "//169.254.169.254/latest/meta-data" }))
      .rejects.toMatchObject({ code: "MGW_CONFIG_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("TEST-A-REV-008-02: applies a bounded timeout and refuses redirects", async () => {
    const fetchImpl = jest.fn(async (_url, options) => {
      expect(options.redirect).toBe("error");
      expect(options.signal).toBeDefined();
      return { status: 302, headers: { get: () => "https://attacker.example" } };
    });
    const client = createGatewayClient({
      origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/explicit/path"],
      fetchImpl,
      enabled: true,
      contractEvidence: { confirmed: true },
      timeoutMs: 20,
    });

    await expect(client.requestForSubject({ bridge: "opaque", path: "/explicit/path" }))
      .rejects.toMatchObject({ code: "MGW_UPSTREAM_UNAVAILABLE" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });

  test("TEST-A-REV-008-02: times out a stalled upstream request", async () => {
    const fetchImpl = jest.fn((_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const client = createGatewayClient({
      origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/explicit/path"],
      fetchImpl,
      enabled: true,
      contractEvidence: { confirmed: true },
      timeoutMs: 10,
    });

    await expect(client.requestForSubject({ bridge: "opaque", path: "/explicit/path" }))
      .rejects.toMatchObject({ code: "MGW_UPSTREAM_UNAVAILABLE" });
  });

  test("TEST-A-OBS-001-01: classifies auth and throttling failures deterministically", () => {
    expect(classifyFailure({ stage: "VERIFY", httpStatus: 401, writeOutcome: "NONE" }))
      .toMatchObject({ code: "MGW_BUSINESS_AUTH_REQUIRED", status: 401, state: "AUTH_REQUIRED", accessState: "AUTH_REQUIRED", retryPolicy: "MANUAL" });
    expect(classifyFailure({ stage: "QUERY", httpStatus: 429, reason: "busy", writeOutcome: "NONE" }))
      .toMatchObject({ code: "MGW_RATE_LIMITED", status: 429, state: "RETRYING", accessState: "UNVERIFIED", retryPolicy: "RETRY_AFTER" });
  });

  test("TEST-A-REV-010-01: unknown external write outcome requires recovery", async () => {
    expect(classifyFailure({ stage: "AUTHORIZATION", reason: "timeout", writeOutcome: "UNKNOWN" }))
      .toMatchObject({ code: "MGW_OAUTH_RECOVERY_REQUIRED", status: 202, state: "PENDING", retryPolicy: "RECOVERY" });
    expect(classifyFailure({ stage: "IMPORT", reason: "timeout", writeOutcome: "UNKNOWN" }))
      .toMatchObject({ code: "MGW_IMPORT_RECOVERY_REQUIRED", status: 202, state: "PENDING_CLEANUP", retryPolicy: "RECOVERY" });
    const client = createGatewayClient({
      origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/explicit/path"],
      fetchImpl: jest.fn(() => Promise.reject(new Error("connection lost"))),
      enabled: true,
      contractEvidence: { confirmed: true },
    });
    await expect(client.requestForSubject({ bridge: "opaque", path: "/explicit/path", method: "POST", stage: "QUERY" }))
      .rejects.toMatchObject({ code: "MGW_QUERY_RECOVERY_REQUIRED", status: 202, state: "BLOCKED", retryPolicy: "RECOVERY" });
  });

  test("TEST-A-SEC-003-01: redacts secrets from nested records and URLs", () => {
    expect(redact({
      authorization: "Bearer gateway-canary",
      password: "pw-canary",
      url: "https://gateway.example.test/path?access_token=token-canary&safe=1",
      nested: { client_secret: "secret-canary" },
      message: "authorization=string-canary access_token=access-canary",
    })).toEqual({
      authorization: "[REDACTED]",
      password: "[REDACTED]",
      url: "https://gateway.example.test/path?[REDACTED]",
      nested: { client_secret: "[REDACTED]" },
      message: "authorization=[REDACTED] access_token=[REDACTED]",
    });
  });

  test("TEST-A-CONF-001-02: disabled client performs zero business calls", async () => {
    const fetchImpl = jest.fn();
    const client = createGatewayClient({ origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"], allowlist: ["/explicit/path"], fetchImpl, enabled: false });

    await expect(client.accountLogin({ username: "user", password: "pw" })).rejects.toMatchObject({ code: "MGW_CONFIG_INVALID" });
    await expect(client.exchange({ msToken: "token" })).rejects.toMatchObject({ code: "MGW_CONFIG_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("account login unwraps the Gateway envelope and drops Backend credentials", async () => {
    const logger = { warn: jest.fn() };
    const fetchImpl = jest.fn(async () => jsonResponse({
      code: 0, error_code: 0,
      data: {
        session_token: "ms_employee_session", token_type: "bearer", expires_in: 600,
        org_id: "org-1",
        user: { user_id: "user-1", member_id: "member-1", name: "Ada", member_role: "member" },
        access_token: "backend-jwt-canary", refresh_token: "backend-refresh-canary",
      },
    }));
    const client = createGatewayClient({
      origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/api/v1/auth/account-login", "/api/v1/auth/exchange"],
      fetchImpl, enabled: true, gatewayInstanceId: "gateway-instance-1",
      resource: "https://gateway.example.test/api", logger,
      clock: () => 1_792_368_000_000,
    });

    const result = await client.accountLogin({ account: "ada", password: "password-canary" });

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://gateway.example.test/api/v1/auth/account-login"),
      expect.objectContaining({
        method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "ada", password: "password-canary" }),
      })
    );
    expect(result).toEqual({
      sessionToken: "ms_employee_session",
      expiresAt: "2026-10-19T00:09:55.000Z",
      binding: {
        gatewayInstanceId: "gateway-instance-1", orgId: "org-1", memberId: "member-1",
        userId: "user-1", memberRole: "MEMBER", issuer: "account-login-v1", displayName: "Ada", active: true,
        identityExpiresAt: "2026-10-19T00:09:55.000Z",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/backend-jwt-canary|backend-refresh-canary|password-canary/);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/password-canary|backend-jwt-canary|backend-refresh-canary/);
  });

  test("exchange sends only an ms_ subject token and verifies the REST resource response", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({
      code: 0, error_code: 0,
      data: {
        access_token: "mt_employee_api", token_type: "Bearer", expires_in: 300,
        refresh_token: "mr_employee_refresh", scope: "meeting.read meeting.query",
        resource: "https://gateway.example.test/api",
      },
    }));
    const client = createGatewayClient({
      origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/api/v1/auth/exchange"], fetchImpl, enabled: true,
      clientId: "registered-client", clientSecret: "client-secret-canary",
      scopes: ["meeting.read", "meeting.query"],
      resource: "https://gateway.example.test/api", clock: () => 1_792_368_000_000,
    });

    const result = await client.exchange("ms_employee_session");

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://gateway.example.test/api/v1/auth/exchange"),
      expect.objectContaining({
        method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "registered-client", client_secret: "client-secret-canary",
          subject_token: "ms_employee_session", scopes: ["meeting.read", "meeting.query"],
          resource: "https://gateway.example.test/api",
        }),
      })
    );
    expect(result).toEqual({
      accessToken: "mt_employee_api", refreshToken: "mr_employee_refresh",
      expiresAt: "2026-10-19T00:04:55.000Z", scope: "meeting.read meeting.query",
      resource: "https://gateway.example.test/api",
    });
    await expect(client.exchange("backend-jwt-canary")).rejects.toMatchObject({ code: "MGW_BUSINESS_AUTH_REQUIRED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test("allows only the explicit AUTHORIZATION write stage for OAuth operations", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ code: 0, error_code: 0, data: { accepted: true } }));
    const client = createGatewayClient({
      origin: "https://gateway.example.test", originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/api/v1/oauth/authorizations"], fetchImpl, enabled: true,
      contractEvidence: { confirmed: true }, headersForSubject: (bridge) => ({ Authorization: `Bearer ${bridge}` }),
    });
    await expect(client.requestForSubject({ bridge: "mt_actor", path: "/api/v1/oauth/authorizations", method: "POST", stage: "AUTHORIZATION", body: "{}" }))
      .resolves.toMatchObject({ status: 200 });
    await expect(client.requestForSubject({ bridge: "mt_actor", path: "/api/v1/oauth/authorizations", method: "POST", stage: "LOGIN", body: "{}" }))
      .rejects.toMatchObject({ code: "MGW_CONFIG_INVALID" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects account-login identities that are not Gateway members", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ code: 0, error_code: 0, data: {
      session_token: "ms_employee_session", expires_in: 600, org_id: "org-1",
      user: { user_id: "user-1", member_id: "member-1", name: "Ada", member_role: "admin" },
    } }));
    const client = createGatewayClient({
      origin: "https://gateway.example.test", originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/api/v1/auth/account-login"], fetchImpl, enabled: true,
      gatewayInstanceId: "gateway-instance-1", clock: () => 1_792_368_000_000,
    });
    await expect(client.accountLogin({ account: "ada", password: "secret" }))
      .rejects.toMatchObject({ code: "MGW_UPSTREAM_CONTRACT_ERROR" });
  });
  test("TEST-A-SEC-003-03: origin must match an exact trusted origin", () => {
    const fetchImpl = jest.fn();
    expect(() => createGatewayClient({
      origin: "https://attacker.example.test",
      originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/explicit/path"],
      fetchImpl,
      enabled: true,
      contractEvidence: { confirmed: true },
    })).toThrow("MGW_CONFIG_INVALID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("TEST-A-REV-010-02: definitive write responses keep their status classification", async () => {
    expect(classifyFailure({ stage: "IMPORT", httpStatus: 401, responseReceived: true, writeOutcome: "UNKNOWN" }))
      .toMatchObject({ code: "MGW_BUSINESS_AUTH_REQUIRED", status: 401, state: "AUTH_REQUIRED" });
    expect(classifyFailure({ stage: "QUERY", httpStatus: 429, responseReceived: true, writeOutcome: "UNKNOWN" }))
      .toMatchObject({ code: "MGW_RATE_LIMITED", status: 429, state: "RETRYING" });
    expect(classifyFailure({ stage: "IMPORT", httpStatus: 422, responseReceived: true, writeOutcome: "UNKNOWN" }))
      .toMatchObject({ code: "MGW_INPUT_INVALID", status: 422, state: "FAILED" });
    expect(classifyFailure({ stage: "IMPORT", httpStatus: 503, responseReceived: true, writeOutcome: "UNKNOWN" }))
      .toMatchObject({ code: "MGW_IMPORT_RECOVERY_REQUIRED", status: 202 });
    expect(classifyFailure({ stage: "IMPORT", httpStatus: 503, responseReceived: true, writeOutcome: "NONE" }))
      .toMatchObject({ code: "MGW_UPSTREAM_UNAVAILABLE", status: 503 });
    const client = createGatewayClient({
      origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/explicit/path"],
      fetchImpl: jest.fn(async () => ({ status: 401, ok: false })),
      enabled: true,
      contractEvidence: { confirmed: true },
    });
    await expect(client.requestForSubject({ bridge: "opaque", path: "/explicit/path", method: "POST", stage: "IMPORT" }))
      .rejects.toMatchObject({ code: "MGW_BUSINESS_AUTH_REQUIRED", status: 401, state: "AUTH_REQUIRED" });
  });

  test("TEST-A-SEC-003-04: safe failure logs omit headers, body, URL query, and error text", async () => {
    const logger = { warn: jest.fn() };
    const client = createGatewayClient({
      origin: "https://gateway.example.test",
      originAllowlist: ["https://gateway.example.test"],
      allowlist: ["/explicit/path"],
      fetchImpl: jest.fn(() => Promise.reject(new Error("https://gateway.example.test/path?access_token=query-canary body-canary"))),
      enabled: true,
      contractEvidence: { confirmed: true },
      logger,
      headersForSubject: () => ({ authorization: "Bearer header-canary" }),
    });
    await expect(client.requestForSubject({ bridge: "bridge-canary", path: "/explicit/path" }))
      .rejects.toMatchObject({ code: "MGW_UPSTREAM_UNAVAILABLE" });
    const serialized = JSON.stringify(logger.warn.mock.calls);
    for (const canary of ["query-canary", "body-canary", "header-canary", "bridge-canary", "access_token"]) {
      expect(serialized).not.toContain(canary);
    }
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      event: "meeting_gateway.request_failed",
      code: "MGW_UPSTREAM_UNAVAILABLE",
      stage: "REQUEST",
    }));
  });
});
