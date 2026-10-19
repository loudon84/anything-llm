const { createGatewayClient } = require("../../utils/meetingGateway/client");
const { createOAuthModule } = require("../../utils/meetingGateway/oauth");

function response(data, status = 200) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; } };
}

test("Gateway start, connection-only return id and owner confirmation stay bound to one pending browser transaction", async () => {
  const calls = [];
  const existing = [{ id: "older", name: "Old", kind: "THIRD_PARTY_OAUTH", status: "ACTIVE", owner_member_id: "member-a" }];
  const authorizationUrl = "https://meeting.tencent.com/marketplace/authorize.html?corp_id=corp-a&sdk_id=sdk-a&redirect_uri=https%3A%2F%2Fgateway.example%2Fcallbacks%2Ftencent%2Foauth%2Fapp-a&state=state-from-gateway";
  const fetchImpl = jest.fn(async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method, auth: options.headers.Authorization, body: options.body });
    if (path === "/api/v1/me/connections") return response({ code: 0, error_code: 0, data: { items: existing.map((item) => ({ ...item })) } });
    if (path === "/api/v1/oauth/authorizations") {
      existing.push({ id: "new", name: "Tencent", kind: "THIRD_PARTY_OAUTH", status: "PENDING_CONFIRMATION", owner_member_id: "member-a" });
      return response({ code: 0, error_code: 0, data: { authorization_url: authorizationUrl, transaction_id: "gateway-tx", expires_at: "2026-10-20T00:05:00.000Z" } }, 201);
    }
    if (path === "/api/v1/connections/new/confirm") existing.find((item) => item.id === "new").status = "ACTIVE";
    return response({ code: 0, error_code: 0, data: { id: "new", status: "ACTIVE" } });
  });
  const gateway = createGatewayClient({
    origin: "https://gateway.example", originAllowlist: ["https://gateway.example"],
    allowlist: ["/api/v1/oauth/authorizations", "/api/v1/me/connections", "/api/v1/connections/:connectionId/confirm"],
    fetchImpl, enabled: true,
  });
  const rows = [];
  const store = {
    async getBinding() { return { status: "BOUND", gateway_member_id: "member-a" }; },
    async findPendingOAuthForBridge(bridgeId) { return rows.find((r) => r.bridgeSessionId === bridgeId && r.state === "PENDING") || null; },
    async createOAuthTransaction(row) { rows.push({ id: "local-tx", ...row }); return rows[0]; },
    async completeOAuthTransaction(id, transactionId, expiresAt) { Object.assign(rows[0], { transactionId, expiresAt }); return rows[0]; },
    async getOAuthTransactionForBridge(transactionId, bridgeId, ownerId) { return rows.find((r) => r.transactionId === transactionId && r.bridgeSessionId === bridgeId && r.ownerUserId === ownerId) || null; },
    async updateOAuthTransactionState(id, state) { rows[0].state = state; return rows[0]; },
  };
  const config = {
    applicationId: "app-a", corpId: "corp-a", sdkId: "sdk-a",
    callbackUri: "https://gateway.example/callbacks/tencent/oauth/app-a",
    returnTo: "https://consumer.example/api/meeting-gateway/oauth/return",
  };
  const oauth = createOAuthModule({ gateway, store, enabled: true, authorizationConfig: config, allowedAuthorizationPaths: ["/marketplace/authorize.html"], clock: () => Date.parse("2026-10-20T00:00:00.000Z") });
  const context = { ownerUserId: 1, bridgeSessionId: "bridge-a", bridgeExpiresAt: "2026-10-20T00:10:00.000Z", gatewayAccessToken: "mt_member" };

  await expect(oauth.start(context)).resolves.toMatchObject({ authorizationUrl, transactionId: "gateway-tx", expiresAt: "2026-10-20T00:05:00.000Z" });
  await expect(oauth.confirm(context, "older")).rejects.toThrow("MGW_OAUTH_CONFIRM_DENIED");
  await expect(oauth.confirm(context, "new")).resolves.toMatchObject({ connectionId: "new", status: "ACTIVE" });
  await expect(oauth.confirm(context, "new")).rejects.toThrow("MGW_OAUTH_CONFIRM_DENIED");
  expect(rows[0]).toMatchObject({ existingConnectionIds: ["older"], state: "CONFIRMED" });
  expect(calls.map((call) => call.path)).toEqual([
    "/api/v1/me/connections", "/api/v1/oauth/authorizations", "/api/v1/me/connections",
    "/api/v1/me/connections", "/api/v1/connections/new/confirm", "/api/v1/me/connections",
  ]);
  expect(calls.every((call) => call.auth === "Bearer mt_member")).toBe(true);
  expect(JSON.parse(calls[1].body)).toEqual({ application_id: "app-a", return_to: config.returnTo });
  expect(JSON.stringify(rows)).not.toContain("state-from-gateway");
});
