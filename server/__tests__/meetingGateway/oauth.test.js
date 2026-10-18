jest.mock("../../utils/middleware/validatedRequest", () => ({ validatedRequest: jest.fn() }));
jest.mock("../../utils/middleware/meetingBridge", () => ({ meetingBridge: () => jest.fn(), readBridgeCookie: () => null }));
jest.mock("../../utils/meetingGateway/sessions", () => ({ COOKIE_NAME: "__Host-meeting_bridge" }));
jest.mock("../../utils/meetingGateway/workspacePolicy", () => ({ createWorkspacePolicy: () => ({}) }));
const { createOAuthModule, validateAuthorizationUrl } = require("../../utils/meetingGateway/oauth");
const { meetingGatewayEndpoints } = require("../../endpoints/meetingGateway");

const AUTH_URL = "https://meeting.tencent.com/oauth?state=secret-state&sdk_id=33510141629&redirect_uri=https%3A%2F%2Fcopilot.superic.com%3A9999%2Fcallbacks%2Ftencent%2Foauth%2F33510141629";
const AUTH_PATH = "/oauth";

function fixture() {
  const rows = [];
  const calls = [];
  let connectionStatus = "PENDING_CONFIRMATION";
  const store = {
    async getBinding() { return { status: "BOUND", gateway_member_id: "member-a" }; },
    async findPendingOAuthForBridge(bridgeSessionId) {
      return rows.find((row) => row.bridgeSessionId === bridgeSessionId && row.state === "PENDING") || null;
    },
    async createOAuthTransaction(row) {
      if (rows.some((candidate) => candidate.bridgeSessionId === row.bridgeSessionId && candidate.state === "PENDING"))
        throw new Error("MGW_OAUTH_ALREADY_PENDING");
      rows.push({ id: "local-id", ...row });
      return rows[rows.length - 1];
    },
    async completeOAuthTransaction(id, transactionId, expiresAt) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row || row.state !== "PENDING") throw new Error("MGW_OAUTH_TRANSACTION_INVALID");
      row.transactionId = transactionId;
      row.expiresAt = expiresAt;
      return row;
    },    async getOAuthTransactionForBridge(transactionId, bridgeSessionId, ownerUserId) {
      return rows.find((row) => row.transactionId === transactionId && row.bridgeSessionId === bridgeSessionId && row.ownerUserId === ownerUserId) || null;
    },
    async updateOAuthTransactionState(id, state) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row || row.state !== "PENDING") throw new Error("MGW_OAUTH_TRANSACTION_INVALID");
      row.state = state;
      return row;
    },
  };
  const gateway = {
    async startAuthorization() {
      calls.push("start");
      return { authorizationUrl: AUTH_URL, transactionId: "gateway-transaction", expiresAt: "2026-10-18T00:05:00.000Z" };
    },
    async listConnections() {
      calls.push("list");
      return [{ connectionId: "connection-a", memberId: "member-a", type: "THIRD_PARTY_OAUTH", status: connectionStatus }];
    },
    async confirmConnection() { calls.push("confirm"); connectionStatus = "ACTIVE"; },
  };
  const oauth = createOAuthModule({ gateway, store, clock: () => new Date("2026-10-18T00:00:00.000Z"), allowedAuthorizationPaths: [AUTH_PATH], contractEvidence: { confirmed: true }, enabled: true });
  return { oauth, rows, calls, store, gateway };
}

const ctx = { ownerUserId: 1, bridgeSessionId: "bridge-a", gatewayMemberId: "member-a", bridgeExpiresAt: new Date("2026-10-18T00:02:00.000Z") };

describe("Meeting Gateway OAuth safety seams", () => {
  test("rejects missing or duplicate state and duplicate required query parameters", () => {
    const invalid = [
      AUTH_URL.replace("state=secret-state&", ""),
      AUTH_URL.replace("state=secret-state", "state=one&state=two"),
      AUTH_URL.replace("state=secret-state", "state="),
      AUTH_URL.replace("sdk_id=33510141629", "sdk_id="),
      AUTH_URL.replace("sdk_id=33510141629", "sdk_id=33510141629&sdk_id=33510141629"),
      AUTH_URL.replace(/&redirect_uri=.*/, "&redirect_uri="),
      AUTH_URL.replace("&redirect_uri=", "&redirect_uri=https%3A%2F%2Fcopilot.superic.com%3A9999%2Fcallbacks%2Ftencent%2Foauth%2F33510141629&redirect_uri="),
      AUTH_URL + "&return_to=https%3A%2F%2Fexample.com",
      AUTH_URL + "&extra=1",
    ];
    for (const value of invalid)
      expect(() => validateAuthorizationUrl(value, { allowedPaths: [AUTH_PATH] })).toThrow("MGW_OAUTH_START_REJECTED");
  });
  test("rejects authorization URLs with lookalike host, wrong redirect, or unconfirmed path", () => {
    expect(() => validateAuthorizationUrl("https://meeting.tencent.com.evil.invalid/oauth", { allowedPaths: [AUTH_PATH] })).toThrow("MGW_OAUTH_START_REJECTED");
    expect(() => validateAuthorizationUrl(AUTH_URL.replace("33510141629", "33510141628"), { allowedPaths: [AUTH_PATH] })).toThrow("MGW_OAUTH_START_REJECTED");
    expect(() => validateAuthorizationUrl(AUTH_URL)).toThrow("MGW_UPSTREAM_CONTRACT_ERROR");
  });

  test("lists only this member's third-party OAuth connections", async () => {
    const { oauth, gateway } = fixture();
    gateway.listConnections = async () => [
      { connectionId: "mine", name: "Mine", memberId: "member-a", type: "THIRD_PARTY_OAUTH", status: "ACTIVE" },
      { connectionId: "other-member", name: "Other", memberId: "member-b", type: "THIRD_PARTY_OAUTH", status: "ACTIVE" },
      { connectionId: "password", name: "Password", memberId: "member-a", type: "PASSWORD", status: "ACTIVE" },
    ];
    await expect(oauth.listConnections(ctx)).resolves.toEqual([
      { connectionId: "mine", name: "Mine", memberId: "member-a", type: "THIRD_PARTY_OAUTH", status: "ACTIVE" },
    ]);
  });  test("caps authorization expiry at the bridge deadline", async () => {
    const { oauth, gateway } = fixture();
    gateway.startAuthorization = async () => ({ authorizationUrl: AUTH_URL, transactionId: "gateway-transaction", expiresAt: "2026-10-18T00:20:00.000Z" });
    const result = await oauth.start(ctx);
    expect(result.expiresAt).toBe("2026-10-18T00:02:00.000Z");
  });

  test("keeps the reservation and requires recovery when authorization POST outcome is unknown", async () => {
    const { oauth, gateway, rows } = fixture();
    gateway.startAuthorization = async () => { throw Object.assign(new Error("MGW_UPSTREAM_UNAVAILABLE"), { writeOutcome: "UNKNOWN" }); };
    await expect(oauth.start(ctx)).rejects.toThrow("MGW_OAUTH_RECOVERY_REQUIRED");
    expect(rows[0].state).toBe("PENDING");
  });
  test("preserves Gateway state only in the one-time returned URL and persists no state", async () => {
    const { oauth, rows } = fixture();
    const result = await oauth.start(ctx);
    expect(result.authorizationUrl).toBe(AUTH_URL);
    expect(result.transactionId).toBe("gateway-transaction");
    expect(JSON.stringify(rows[0])).not.toContain("secret-state");
    expect(rows[0]).toMatchObject({ ownerUserId: 1, bridgeSessionId: "bridge-a", state: "PENDING" });
  });

  test("permits only one pending authorization per bridge", async () => {
    const { oauth, calls } = fixture();
    await oauth.start(ctx);
    await expect(oauth.start(ctx)).rejects.toThrow("MGW_OAUTH_ALREADY_PENDING");
    expect(calls).toEqual(["start"]);
  });

  test("cannot confirm a transaction from another owner or bridge", async () => {
    const { oauth, calls } = fixture();
    await oauth.start(ctx);
    await expect(oauth.confirm({ ...ctx, ownerUserId: 2 }, "connection-a")).rejects.toThrow("MGW_OAUTH_CONFIRM_DENIED");
    expect(calls).toEqual(["start"]);
  });

  test("rejects confirmation for a non third-party OAuth connection", async () => {
    const { oauth, gateway, calls } = fixture();
    await oauth.start(ctx);
    gateway.listConnections = async () => {
      calls.push("list");
      return [{ connectionId: "connection-a", memberId: "member-a", type: "PASSWORD", status: "PENDING_CONFIRMATION" }];
    };
    await expect(oauth.confirm(ctx, "connection-a")).rejects.toThrow("MGW_OAUTH_CONFIRM_DENIED");
    expect(calls).toEqual(["start", "list"]);
  });

  test("keeps the pending reservation when confirmation POST outcome is unknown", async () => {
    const { oauth, gateway, rows } = fixture();
    await oauth.start(ctx);
    gateway.confirmConnection = async () => { throw Object.assign(new Error("MGW_UPSTREAM_UNAVAILABLE"), { writeOutcome: "UNKNOWN" }); };
    await expect(oauth.confirm(ctx, "connection-a")).rejects.toThrow("MGW_OAUTH_RECOVERY_REQUIRED");
    expect(rows[0].state).toBe("PENDING");
  });
  test("does not send duplicate confirmation POSTs while one is in flight", async () => {
    const { oauth, gateway, calls } = fixture();
    await oauth.start(ctx);
    const releases = [];
    gateway.confirmConnection = async () => {
      calls.push("confirm");
      await new Promise((resolve) => releases.push(resolve));
    };
    const first = oauth.confirm(ctx, "connection-a");
    while (!calls.includes("confirm")) await new Promise((resolve) => setImmediate(resolve));
    const second = oauth.confirm(ctx, "connection-a").then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmCallsBeforeRelease = calls.filter((call) => call === "confirm").length;
    gateway.listConnections = async () => {
      calls.push("list");
      return [{ connectionId: "connection-a", memberId: "member-a", type: "THIRD_PARTY_OAUTH", status: "ACTIVE" }];
    };
    releases.forEach((release) => release());
    const results = await Promise.all([first, second]);
    expect(confirmCallsBeforeRelease).toBe(1);
    expect(results[1].status).toBe("rejected");
    expect(results[1].reason.message).toBe("MGW_OAUTH_CONFIRM_IN_PROGRESS");
  });
  test("marks the local transaction confirmed only after Gateway reports ACTIVE", async () => {
    const { oauth, rows, calls } = fixture();
    await oauth.start(ctx);
    const connection = await oauth.confirm(ctx, "connection-a");
    expect(connection.status).toBe("ACTIVE");
    expect(rows[0].state).toBe("CONFIRMED");
    expect(calls).toEqual(["start", "list", "confirm", "list"]);
  });

  test("rejects concurrent starts for the same bridge", async () => {
    const { oauth, calls } = fixture();
    const results = await Promise.allSettled([oauth.start(ctx), oauth.start(ctx)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0].reason.message).toBe("MGW_OAUTH_ALREADY_PENDING");
    expect(calls).toEqual(["start"]);
  });
  test("does not confirm a corp-mismatched connection", async () => {
    const { oauth, calls, gateway } = fixture();
    await oauth.start(ctx);
    gateway.listConnections = async () => {
      calls.push("list");
      return [{ connectionId: "connection-a", memberId: "member-a", status: "CORP_MISMATCH" }];
    };
    await expect(oauth.confirm(ctx, "connection-a")).rejects.toThrow("MGW_OAUTH_CONFIRM_DENIED");
    expect(calls).toEqual(["start", "list"]);
  });

  test("BFF routes serialize OAuth data to PRD DTO allowlists", async () => {
    const routes = new Map();
    const router = {
      get(path, _middleware, handler) { routes.set("GET " + path, handler); },
      post(path, _middleware, handler) { routes.set("POST " + path, handler); },
      delete(path, _middleware, handler) { routes.set("DELETE " + path, handler); },
    };
    const oauth = {
      contractConfirmed: true,
      async listConnections() {
        return [{ connectionId: "connection-a", name: "Tencent OAuth", status: "ACTIVE", memberId: "member-a", type: "THIRD_PARTY_OAUTH", accessToken: "secret-token", refreshToken: "secret-refresh" }];
      },
      async start() { return { authorizationUrl: AUTH_URL, transactionId: "transaction-a", expiresAt: "2026-10-18T00:02:00.000Z", accessToken: "secret-token" }; },
      async confirm() { return { connectionId: "connection-a", name: "Tencent OAuth", status: "ACTIVE", accessToken: "secret-token" }; },
    };
    meetingGatewayEndpoints(router, { enabled: true, contractConfirmed: true, oauth });
    const invoke = async (key, request = {}) => {
      const response = {
        locals: { user: { id: 1 }, meetingBridge: { bridgeId: "bridge-a", expiresAt: 1792281720 } },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await routes.get(key)(request, response);
      return response;
    };
    const list = await invoke("GET /meeting-gateway/connections");
    expect(list.body).toEqual({ items: [{ id: "connection-a", name: "Tencent OAuth", status: "ACTIVE" }] });
    const start = await invoke("POST /meeting-gateway/oauth/start", { body: {} });
    expect(start.body).toEqual({ authorization_url: AUTH_URL, transaction_id: "transaction-a", expires_at: "2026-10-18T00:02:00.000Z" });
    const confirm = await invoke("POST /meeting-gateway/connections/:connectionId/confirm", { params: { connectionId: "connection-a" }, body: {} });
    expect(confirm.body).toEqual({ status: "ACTIVE" });
  });  test("OAuth mutation routes reject malformed bodies before calling the adapter", async () => {
    const routes = new Map();
    const router = {
      get(path, _middleware, handler) { routes.set("GET " + path, handler); },
      post(path, _middleware, handler) { routes.set("POST " + path, handler); },
      delete(path, _middleware, handler) { routes.set("DELETE " + path, handler); },
    };
    const oauth = {
      contractConfirmed: true,
      start: jest.fn(),
      confirm: jest.fn(),
    };
    meetingGatewayEndpoints(router, { enabled: true, contractConfirmed: true, oauth });
    const invoke = async (key, request) => {
      const response = {
        locals: { user: { id: 1 }, meetingBridge: { bridgeId: "bridge-a", expiresAt: 1792281720 } },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await routes.get(key)(request, response);
      return response;
    };
    for (const body of [[], null, "payload", 7, { unexpected: true }, undefined]) {
      const response = await invoke("POST /meeting-gateway/oauth/start", { body });
      expect(response.statusCode).toBe(422);
      expect(response.body.error).toBe("MGW_INPUT_INVALID");
    }
    for (const body of [undefined, null, [], "payload", 7, { credential: "attacker-controlled" }, { unexpected: true }]) {
      const response = await invoke("POST /meeting-gateway/connections/:connectionId/confirm", {
        params: { connectionId: "connection-a" },
        body,
      });
      expect(response.statusCode).toBe(422);
      expect(response.body.error).toBe("MGW_INPUT_INVALID");
    }
    expect(oauth.start).not.toHaveBeenCalled();
    expect(oauth.confirm).not.toHaveBeenCalled();
  });

  test("runtime null OAuth adapter keeps routes fail-closed", async () => {
    const routes = new Map();
    const router = {
      get(path, _middleware, handler) { routes.set("GET " + path, handler); },
      post(path, _middleware, handler) { routes.set("POST " + path, handler); },
      delete(path, _middleware, handler) { routes.set("DELETE " + path, handler); },
    };
    meetingGatewayEndpoints(router, { enabled: true, contractConfirmed: true, oauth: null });
    const invoke = async (key, request) => {
      const response = {
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await routes.get(key)(request, response);
      expect(response.statusCode).toBe(503);
      expect(response.body.error).toBe("MGW_UPSTREAM_CONTRACT_ERROR");
    };
    await invoke("GET /meeting-gateway/connections", {});
    await invoke("POST /meeting-gateway/oauth/start", { body: {} });
    await invoke("POST /meeting-gateway/connections/:connectionId/confirm", { params: { connectionId: "connection-a" }, body: {} });
  });  test("BFF OAuth routes fail closed when no confirmed adapter is composed", async () => {
    const routes = new Map();
    const router = {
      get(path, _middleware, handler) { routes.set("GET " + path, handler); },
      post(path, _middleware, handler) { routes.set("POST " + path, handler); },
      delete(path, _middleware, handler) { routes.set("DELETE " + path, handler); },
    };
    const listConnections = jest.fn();
    meetingGatewayEndpoints(router, {
      enabled: true,
      contractConfirmed: true,
      oauth: { contractConfirmed: false, listConnections },
    });
    const invoke = async (key, request) => {
      const response = {
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await routes.get(key)(request, response);
      expect(response.statusCode).toBe(503);
      expect(response.body.error).toBe("MGW_UPSTREAM_CONTRACT_ERROR");
    };
    await invoke("GET /meeting-gateway/connections", {});
    await invoke("POST /meeting-gateway/oauth/start", { body: {} });
    await invoke("POST /meeting-gateway/connections/:connectionId/confirm", { params: { connectionId: "connection-a" }, body: {} });
    expect(listConnections).not.toHaveBeenCalled();
  });
  test("is disabled until the upstream contract is confirmed", async () => {
    const { oauth } = fixture();
    const disabled = createOAuthModule({ gateway: {}, store: {}, enabled: false, contractEvidence: { confirmed: false } });
    await expect(disabled.start(ctx)).rejects.toThrow("MGW_UPSTREAM_CONTRACT_ERROR");
    expect(typeof oauth.confirm).toBe("function");
  });
});
