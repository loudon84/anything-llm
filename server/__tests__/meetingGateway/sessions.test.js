const { createSessionModule, computeDeadline } = require("../../utils/meetingGateway/sessions");

const NOW = 1_800_000_000;
const KEY = Buffer.alloc(32, 7);
const JWT = (sub, exp) => `jwt-${sub}-${exp}`;

function fixture({ gatewayAvailable = true } = {}) {
  const sessions = new Map();
  const bindings = new Map();
  const store = {
    async createBridgeSession(row) {
      if (row.oldBridgeBindingHmac) {
        for (const session of sessions.values()) if (session.session_binding_hmac === row.oldBridgeBindingHmac) session.revoked_at = new Date(NOW * 1000);
      }
      sessions.set(row.id, { ...row });
      bindings.set(row.anything_user_id, { ...row.binding, status: "BOUND" });
      return row;
    },
    async findBridgeSessionByBinding(binding) {
      return [...sessions.values()].find((row) => row.session_binding_hmac === binding) || null;
    },
    async revokeBridgeSession(id, at) {
      const row = sessions.get(id);
      if (row) row.revoked_at = at;
    },
    async revokeBridgeSessionsForUser(userId, at) {
      for (const row of sessions.values()) if (row.anything_user_id === userId) row.revoked_at = at;
    },
    async saveBinding(row) { bindings.set(row.anything_user_id, { ...row }); return row; },
    async getBinding(userId) { return bindings.get(userId) || null; },
    async revokeBinding(userId, at) {
      const binding = bindings.get(userId);
      if (binding) { binding.status = "REVOKED"; binding.updated_at = at; }
    },
  };
  const gateway = {
    transportAvailable: gatewayAvailable,
    async accountLogin() { return { accessToken: "ms-secret", expiresAt: NOW + 800, binding: { orgId: "org-1", memberId: "member-1", userId: "gateway-user-1" } }; },
    async exchange() { return { accessToken: "mt-secret", expiresAt: NOW + 700 }; },
  };
  const keyring = { activeKeyId: "k1", keys: { k1: KEY }, hmacKey: KEY };
  const session = createSessionModule({
    store, gateway, keyring, clock: () => NOW,
    origin: "https://anything.example",
    verifyJwt: (token) => {
      const [, id, exp] = token.split("-");
      return { id: Number(id), exp: Number(exp) };
    },
  });
  const user = { id: 11, password: "bcrypt-hash", suspended: false };
  return { session, gateway, sessions, bindings, user, JWT };
}

test("bridge cannot outlive any credential or the 15 minute cap", () => {
  expect(computeDeadline({ now: 0, msExpiry: 1000, mtExpiry: 800, jwtExpiry: 700 })).toBe(700);
  expect(computeDeadline({ now: 0, msExpiry: 10000, mtExpiry: 9000, jwtExpiry: 8000 })).toBe(900);
  expect(computeDeadline({ now: 100, msExpiry: 5000, mtExpiry: 6000, jwtExpiry: 7000 })).toBe(1000);
  expect(() => computeDeadline({ now: 0, msExpiry: 1000, mtExpiry: NaN, jwtExpiry: 500 })).toThrow("MGW_BUSINESS_AUTH_REQUIRED");
});

test("login returns only the opaque browser cookie and a token-free DTO", async () => {
  const { session, gateway, user, JWT } = fixture();
  const result = await session.login({ user, jwt: JWT(11, NOW + 1200), credentials: { account: "a", password: "p" }, origin: "https://anything.example" });
  expect(result.cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(result.cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  expect(result.dto).toEqual({ binding_status: "BOUND", expires_at: new Date((NOW + 700) * 1000).toISOString(), csrf_token: expect.any(String) });
  expect(JSON.stringify(result.dto)).not.toMatch(/ms-secret|mt-secret|Gateway/i);
});

test("each browser bridge is independent and a same-browser login rotates the old bridge", async () => {
  const { session, gateway, user, JWT } = fixture();
  const login = (oldBridge) => session.login({ user, jwt: JWT(11, NOW + 1200), oldBridge, credentials: { account: "a", password: "p" }, origin: "https://anything.example" });
  const first = await login();
  const second = await login(first.cookie.value);
  expect((await session.requireBridge({ user, jwt: JWT(11, NOW + 1200), cookie: first.cookie.value })).allowed).toBe(false);
  expect((await session.requireBridge({ user, jwt: JWT(11, NOW + 1200), cookie: second.cookie.value })).allowed).toBe(true);
  const otherBrowser = await login();
  expect((await session.requireBridge({ user, jwt: JWT(11, NOW + 1200), cookie: otherBrowser.cookie.value })).allowed).toBe(true);
});

test("bridge requires the current JWT and password credential", async () => {
  const { session, gateway, user, JWT } = fixture();
  const { cookie } = await session.login({ user, jwt: JWT(11, NOW + 1200), credentials: { account: "a", password: "p" }, origin: "https://anything.example" });
  expect((await session.requireBridge({ user, jwt: JWT(12, NOW + 1200), cookie: cookie.value })).allowed).toBe(false);
  expect((await session.requireBridge({ user: { ...user, password: "new-hash" }, jwt: JWT(11, NOW + 1200), cookie: cookie.value })).allowed).toBe(false);
  expect((await session.requireBridge({ user: { ...user, suspended: true }, jwt: JWT(11, NOW + 1200), cookie: cookie.value })).allowed).toBe(false);
});

test("mutations require same origin and CSRF bound to the current browser bridge", async () => {
  const { session, gateway, user, JWT } = fixture();
  const { cookie, dto } = await session.login({ user, jwt: JWT(11, NOW + 1200), credentials: { account: "a", password: "p" }, origin: "https://anything.example" });
  const request = { user, jwt: JWT(11, NOW + 1200), cookie: cookie.value, csrf: dto.csrf_token, mutation: true, origin: "https://anything.example" };
  expect((await session.requireBridge({ ...request, origin: "https://attacker.example" })).allowed).toBe(false);
  expect((await session.requireBridge({ ...request, csrf: "wrong" })).allowed).toBe(false);
  expect((await session.requireBridge(request)).allowed).toBe(true);
  const rotated = await session.login({ user, jwt: JWT(11, NOW + 1200), oldBridge: cookie.value, credentials: { account: "a", password: "p" }, origin: "https://anything.example" });
  expect((await session.requireBridge({ ...request, cookie: rotated.cookie.value })).allowed).toBe(false);
});

test("local revoke succeeds without Gateway", async () => {
  const { session, gateway, user, JWT } = fixture();
  const { cookie } = await session.login({ user, jwt: JWT(11, NOW + 1200), credentials: { account: "a", password: "p" }, origin: "https://anything.example" });
  gateway.transportAvailable = false;
  await session.revokeCurrent(cookie.value);
  expect((await session.requireBridge({ user, jwt: JWT(11, NOW + 1200), cookie: cookie.value })).allowed).toBe(false);
});

test("binding revoke makes every bridge require local reauthorization", async () => {
  const { session, user, JWT } = fixture();
  const { cookie } = await session.login({ user, jwt: JWT(11, NOW + 1200), credentials: { account: "a", password: "p" }, origin: "https://anything.example" });
  await session.revokeUser(user.id);
  expect((await session.requireBridge({ user, jwt: JWT(11, NOW + 1200), cookie: cookie.value })).allowed).toBe(false);
});
test("Gateway account login stays blocked until its contract is confirmed", async () => {
  const { session, user, JWT } = fixture({ gatewayAvailable: false });
  await expect(session.login({ user, jwt: JWT(11, NOW + 1200), credentials: { account: "a", password: "p" }, origin: "https://anything.example" })).rejects.toThrow("MGW_UPSTREAM_CONTRACT_ERROR");
});
