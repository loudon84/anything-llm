const crypto = require("crypto");
const { createWeComGatewayClient } = require("../../utils/meetingGateway/wecomClient");

const ORIGIN = "https://gateway.example.test";
const CALLBACK = "https://consumer.example.test/api/auth/wecom/callback";
const AUTHORIZATION_URL = "https://login.example.test/connect";
const NOW = Date.parse("2026-10-19T00:00:00.000Z");

function contract(overrides = {}) {
  const value = {
    status: "SIGNED_OFF",
    contractVersion: 1,
    revision: "test-contract/1",
    schemaDigest: `sha256:${"a".repeat(64)}`,
    origin: ORIGIN,
    gatewayInstanceId: "instance-A",
    allowedAuthorizationUrls: [AUTHORIZATION_URL],
    authorizationUrlParameters: { state: "state", redirectUri: "redirect_uri" },
    allowedCallbackUrls: [CALLBACK],
    operations: {
      start: {
        method: "POST",
        path: "/fixture/start",
        authentication: "none",
        request: { clientState: "state", codeChallenge: "code_challenge", redirectUri: "redirect_uri" },
        response: { transactionId: "transaction_id", authorizationUrl: "authorization_url", expiresAt: "expires_at" },
      },
      redeem: {
        method: "POST",
        path: "/fixture/redeem",
        authentication: "none",
        request: { transactionId: "transaction_id", resultTicket: "result_ticket", codeVerifier: "code_verifier", redirectUri: "redirect_uri" },
        response: { identitySession: "identity_session" },
      },
      identitySessionResponse: {
        accessToken: "access_token",
        orgId: "subject.org_id",
        memberId: "subject.member_id",
        userId: "subject.user_id",
        issuer: "subject.issuer",
        identityExpiresAt: "expires_at",
      },
      profile: {
        method: "GET",
        path: "/fixture/profile",
        authentication: "bearer",
        response: {
          orgId: "org_id",
          memberId: "member_id",
          userId: "user_id",
          issuer: "issuer",
          displayName: "display_name",
          active: "active",
          identityExpiresAt: "expires_at",
        },
      },
    },
    ...overrides,
  };
  const { schemaDigest: _schemaDigest, ...schema } = value;
  const canonical = (item) => Array.isArray(item) ? `[${item.map(canonical).join(",")}]`
    : item && typeof item === "object" ? `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`
      : JSON.stringify(item);
  value.schemaDigest = `sha256:${crypto.createHash("sha256").update(canonical(schema)).digest("hex")}`;
  return value;
}

function identitySession(overrides = {}) {
  return {
    accessToken: "private-session-token",
    subject: { orgId: "org-A", memberId: "member-A", userId: "user-A", issuer: "gateway-issuer" },
    identityExpiresAt: "2026-10-19T01:00:00.000Z",
    ...overrides,
  };
}

function gatewayProfile(overrides = {}) {
  return {
    instance_id: "instance-A",
    org_id: "org-A",
    member_id: "member-A",
    user_id: "user-A",
    issuer: "gateway-issuer",
    display_name: "Ada Employee",
    active: true,
    expires_at: "2026-10-19T01:00:00.000Z",
    ...overrides,
  };
}

function clientForProfile(body, options = {}) {
  const calls = [];
  const transport = options.transport || {
    async request(request) {
      calls.push(request);
      return { status: 200, body };
    },
  };
  return {
    calls,
    client: createWeComGatewayClient({
      contract: options.contract === undefined ? contract() : options.contract,
      transport,
      clock: () => options.now === undefined ? NOW : options.now,
    }),
  };
}

describe("WeCom Gateway consumer contract", () => {
  let consoleWarnSpy;
  beforeEach(() => { consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => consoleWarnSpy.mockRestore());

  test("reports missing real Gateway contract as dependency not ready", async () => {
    const request = jest.fn();
    const client = createWeComGatewayClient({ contract: null, transport: { request } });

    expect(client.getAvailability()).toMatchObject({ enabled: false, available: false, reason: "DEPENDENCY_NOT_READY" });
    await expect(client.startAuthentication({})).rejects.toMatchObject({ code: "MGW_DEPENDENCY_NOT_READY" });
    expect(request).not.toHaveBeenCalled();
  });

  test("maps only validated profile fields and binds them to the redeemed subject", async () => {
    const { client, calls } = clientForProfile(gatewayProfile());

    await expect(client.fetchAuthenticatedProfile({ identitySession: identitySession() })).resolves.toEqual({
      gatewayInstanceId: "instance-A",
      orgId: "org-A",
      memberId: "member-A",
      userId: "user-A",
      issuer: "gateway-issuer",
      displayName: "Ada Employee",
      active: true,
      identityExpiresAt: "2026-10-19T01:00:00.000Z",
    });
    expect(calls[0]).toMatchObject({ method: "GET", url: `${ORIGIN}/fixture/profile`, redirect: "error" });
    expect(calls[0].headers.authorization).toBe("Bearer private-session-token");
  });

  test.each([
    ["organization", { org_id: "org-B" }, {}],
    ["member", { member_id: "member-B" }, {}],
    ["user", { user_id: "user-B" }, {}],
    ["issuer", { issuer: "other-issuer" }, {}],
    ["inactive profile", { active: false }, {}],
    ["expired identity", {}, { now: Date.parse("2026-10-19T01:00:00.001Z") }],
    ["missing required field", { member_id: "" }, {}],
  ])("rejects %s profile assertions", async (_label, profileOverrides, options) => {
    const { client } = clientForProfile(gatewayProfile(profileOverrides), options);

    await expect(client.fetchAuthenticatedProfile({ identitySession: identitySession() }))
      .rejects.toMatchObject({ code: "MGW_IDENTITY_ASSERTION_INVALID" });
  });

  test("rejects invalid identity session before the profile transport", async () => {
    const { client, calls } = clientForProfile(gatewayProfile());

    await expect(client.fetchAuthenticatedProfile({ identitySession: identitySession({ subject: { memberId: "member-A" } }) }))
      .rejects.toMatchObject({ code: "MGW_IDENTITY_ASSERTION_INVALID" });
    expect(calls).toHaveLength(0);
  });

  test("does not extend the verified identity expiry from the profile response", async () => {
    const { client } = clientForProfile(gatewayProfile({ expires_at: "2026-10-19T00:30:00.000Z" }));

    await expect(client.fetchAuthenticatedProfile({
      identitySession: identitySession({ identityExpiresAt: "2026-10-19T00:20:00.000Z" }),
    })).rejects.toMatchObject({ code: "MGW_IDENTITY_ASSERTION_INVALID" });
  });

  test("rejects malformed JSON and unsupported contract revisions", async () => {
    const malformed = clientForProfile("not-json");
    await expect(malformed.client.fetchAuthenticatedProfile({ identitySession: identitySession() }))
      .rejects.toMatchObject({ code: "MGW_UPSTREAM_CONTRACT_ERROR" });

    const unsupported = clientForProfile(gatewayProfile(), { contract: contract({ contractVersion: 2 }) });
    expect(unsupported.client.getAvailability()).toMatchObject({ enabled: false, available: false, reason: "DEPENDENCY_NOT_READY" });
    await expect(unsupported.client.fetchAuthenticatedProfile({ identitySession: identitySession() }))
      .rejects.toMatchObject({ code: "MGW_DEPENDENCY_NOT_READY" });
    expect(unsupported.calls).toHaveLength(0);

    const unsafeOrigin = clientForProfile(gatewayProfile(), { contract: contract({ origin: "https://127.0.0.1" }) });
    expect(unsafeOrigin.client.getAvailability()).toMatchObject({ available: false, reason: "DEPENDENCY_NOT_READY" });

    const driftedContract = contract();
    driftedContract.operations.profile.path = "/unlocked/path";
    const drifted = clientForProfile(gatewayProfile(), { contract: driftedContract });
    expect(drifted.client.getAvailability()).toMatchObject({ available: false, reason: "DEPENDENCY_NOT_READY" });
  });

  test("rejects an authorization URL outside the exact contract allowlist", async () => {
    const transport = { request: jest.fn(async () => ({
      status: 200,
      body: {
        transaction_id: "tx-1",
        authorization_url: "https://attacker.example/connect?state=s",
        expires_at: "2026-10-19T00:05:00.000Z",
      },
    })) };
    const client = createWeComGatewayClient({ contract: contract(), transport, clock: () => NOW });

    await expect(client.startAuthentication({ clientState: "state-A", codeChallenge: "challenge-A", redirectUri: CALLBACK }))
      .rejects.toMatchObject({ code: "MGW_UPSTREAM_CONTRACT_ERROR" });
  });

  test("returns the normalized start result only for the pinned authorization endpoint and callback", async () => {
    const request = jest.fn(async () => ({
      status: 200,
      body: {
        transaction_id: "tx-1",
        authorization_url: `${AUTHORIZATION_URL}?state=state-A&redirect_uri=${encodeURIComponent(CALLBACK)}`,
        expires_at: "2026-10-19T00:05:00.000Z",
      },
    }));
    const client = createWeComGatewayClient({ contract: contract(), transport: { request }, clock: () => NOW });

    await expect(client.startAuthentication({ clientState: "state-A", codeChallenge: "challenge-A", redirectUri: CALLBACK }))
      .resolves.toEqual({
        transactionId: "tx-1",
        authorizationUrl: `${AUTHORIZATION_URL}?state=state-A&redirect_uri=${encodeURIComponent(CALLBACK)}`,
        expiresAt: "2026-10-19T00:05:00.000Z",
      });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].body).toContain("code_challenge");
  });

  test("requires exact callback URL and never retries an uncertain redeem", async () => {
    const request = jest.fn(async () => { throw new Error("transport lost"); });
    const client = createWeComGatewayClient({ contract: contract(), transport: { request }, clock: () => NOW });

    await expect(client.startAuthentication({ clientState: "state-A", codeChallenge: "challenge-A", redirectUri: `${CALLBACK}?next=attacker` }))
      .rejects.toMatchObject({ code: "MGW_CONFIG_INVALID" });
    await expect(client.redeemAuthentication({ transactionId: "tx-1", resultTicket: "ticket", codeVerifier: "verifier", redirectUri: CALLBACK }))
      .rejects.toMatchObject({ code: "MGW_AUTH_REDEEM_OUTCOME_UNKNOWN", retryPolicy: "RECOVERY" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
