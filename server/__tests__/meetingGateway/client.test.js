const { classifyFailure } = require("../../utils/meetingGateway/errors");
const { createGatewayClient } = require("../../utils/meetingGateway/client");
const { redact } = require("../../utils/meetingGateway/redact");

describe("Meeting Gateway client boundaries", () => {
  let consoleWarnSpy;
  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => consoleWarnSpy.mockRestore());
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
