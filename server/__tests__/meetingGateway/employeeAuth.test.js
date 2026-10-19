const { createEmployeeAuthService } = require("../../utils/meetingGateway/employeeAuth");

function fixture(overrides = {}) {
  const calls = [];
  const gateway = {
    resource: "https://gateway.example.test/api", transportAvailable: true,
    async accountLogin(credentials) { calls.push(["login", credentials]); return { sessionToken: "ms_secret", expiresAt: "2026-10-19T01:00:00.000Z", binding: {
      gatewayInstanceId: "gateway-one", orgId: "org-one", memberId: "member-one", userId: "gateway-user-one", memberRole: "MEMBER", issuer: "account-login-v1", displayName: "Ada", active: true, identityExpiresAt: "2026-10-19T01:00:00.000Z",
    } }; },
    async exchange(token) { calls.push(["exchange", token]); return { accessToken: "mt_secret", refreshToken: "mr_secret", expiresAt: "2026-10-19T00:30:00.000Z", resource: this.resource, scope: "meeting.read" }; },
  };
  const identityStore = {
    async upsertGatewayUserProjection(input) { calls.push(["projection", input]); return { user: { id: 55, username: "mgw_user", role: "default", password: null }, binding: { id: "binding-55", display_name: "Ada" } }; },
    async createLocalSession(input) { calls.push(["local-session", input]); return { id: "session-55", userId: 55, credentialEpoch: 1, expiresAt: "2026-10-19T00:30:00.000Z" }; },
    async revokeLocalSession(input) { calls.push(["revoke", input]); },
  };
  const sessions = { async bindProjected(input) { calls.push(["bridge", input]); return { cookie: { name: "__Host-meeting_bridge", value: "opaque", options: { expires: new Date("2026-10-19T00:15:00.000Z"), sameSite: "strict" } }, dto: {} }; } };
  const jwt = { sign(claims, expiry) { calls.push(["jwt", claims, expiry]); return "local-jwt"; } };
  return { auth: createEmployeeAuthService({ gateway, identityStore, sessions, jwt, origin: "https://app.example.test", clock: () => new Date("2026-10-19T00:00:00.000Z"), ...overrides }), calls, gateway, identityStore };
}

test("employee login projects first-time member, issues local session, and returns no Gateway credentials", async () => {
  const { auth, calls } = fixture();
  const result = await auth.login({ credentials: { account: "ada", password: "password-canary" }, origin: "https://app.example.test" });
  expect(calls.map(([name]) => name)).toEqual(["login", "exchange", "projection", "local-session", "jwt", "bridge"]);
  expect(calls.find(([name]) => name === "local-session")[1]).toMatchObject({ userId: 55, bindingId: "binding-55", authMethod: "gateway_account" });
  expect(result.user).toEqual({ id: 55, username: "mgw_user", role: "default", displayName: "Ada" });
  expect(result.localToken).toBe("local-jwt");
  expect(result.sessionCookie).toMatchObject({ name: "__Host-meeting_session", options: { httpOnly: true, secure: true, sameSite: "lax" } });
  expect(JSON.stringify(result)).not.toMatch(/ms_secret|mt_secret|mr_secret|password-canary/);
});

test("employee login rejects a cross-origin request before account login", async () => {
  const { auth, calls } = fixture();
  await expect(auth.login({ credentials: { account: "ada", password: "p" }, origin: "https://attacker.example" })).rejects.toMatchObject({ code: "MGW_CSRF_REJECTED" });
  expect(calls).toEqual([]);
});

test("failed bridge persistence revokes the just-created local login session", async () => {
  const { auth, calls } = fixture({ sessions: { async bindProjected() { throw new Error("store down"); } } });
  await expect(auth.login({ credentials: { account: "ada", password: "p" }, origin: "https://app.example.test" })).rejects.toThrow("store down");
  expect(calls.some(([name]) => name === "revoke")).toBe(true);
});

test("employee login is unavailable in legacy single-user mode", async () => {
  const { auth, calls } = fixture({ isMultiUserMode: async () => false });
  await expect(auth.login({ credentials: { account: "ada", password: "p" }, origin: "https://app.example.test" })).rejects.toMatchObject({ code: "MGW_DEPENDENCY_NOT_READY" });
  expect(calls).toEqual([]);
});