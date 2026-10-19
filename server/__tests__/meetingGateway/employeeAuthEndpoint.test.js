const { meetingGatewayEndpoints } = require("../../endpoints/meetingGateway");

test("employee login BFF accepts only account/password and emits local cookies without Gateway token DTOs", async () => {
  const routes = new Map();
  const router = { post(path, ...args) { routes.set("POST " + path, args[args.length - 1]); }, get() {}, delete() {} };
  const employeeAuth = { login: jest.fn(async ({ credentials, origin, oldBridge }) => {
    expect(credentials).toEqual({ account: "ada", password: "pw" });
    expect(origin).toBe("https://app.example.test");
    expect(oldBridge).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    return {
      user: { id: 3, username: "mgw_3", role: "default", displayName: "Ada" }, localToken: "local-jwt",
      expiresAt: "2026-10-19T01:00:00.000Z", remoteAccessMode: "GATEWAY_ENABLED",
      sessionCookie: { name: "__Host-meeting_session", value: "s.proof", options: { expires: new Date("2026-10-19T01:00:00.000Z"), sameSite: "lax" } },
      bridgeCookie: { name: "__Host-meeting_bridge", value: "bridge", options: { expires: new Date("2026-10-19T00:15:00.000Z"), sameSite: "strict" } },
      bridge: { csrf_token: "internal" },
    };
  }) };
  meetingGatewayEndpoints(router, { employeeAuth });
  const handler = routes.get("POST /meeting-gateway/employee-login");
  const request = { body: { account: "ada", password: "pw" }, ip: "127.0.0.1", socket: {}, header: (name) => name === "Origin" ? "https://app.example.test" : name === "Cookie" ? "__Host-meeting_bridge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" : "" };
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, append(name, value) { this.headers[name] = [...(this.headers[name] || []), value]; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(request, response);
  expect(response.statusCode).toBe(200);
  expect(response.headers["Cache-Control"]).toBe("no-store");
  expect(response.headers["Set-Cookie"]).toHaveLength(2);
  expect(response.body).toEqual({ user: { id: 3, username: "mgw_3", role: "default", displayName: "Ada" }, localToken: "local-jwt", expiresAt: "2026-10-19T01:00:00.000Z", remoteAccessMode: "GATEWAY_ENABLED" });
  expect(JSON.stringify(response.body)).not.toMatch(/access_token|refresh_token|csrf_token/);
});

test("employee login BFF rejects extra fields before calling authentication", async () => {
  const routes = new Map();
  const router = { post(path, ...args) { routes.set(path, args[args.length - 1]); }, get() {}, delete() {} };
  const employeeAuth = { login: jest.fn() };
  meetingGatewayEndpoints(router, { employeeAuth });
  const response = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get("/meeting-gateway/employee-login")({ body: { account: "ada", password: "pw", redirect: "https://evil.test" } }, response);
  expect(response.statusCode).toBe(422);
  expect(employeeAuth.login).not.toHaveBeenCalled();
});

test("employee login limiter bounds distinct IP state, expires entries, and fails closed at capacity", () => {
  const { createBoundedRateLimiter } = require("../../endpoints/meetingGateway");
  let now = 1_000;
  const limiter = createBoundedRateLimiter({ windowMs: 60_000, maxAttempts: 2, maxEntries: 2, clock: () => now });
  expect(limiter.consume("ip-a")).toBe(true);
  expect(limiter.consume("ip-a")).toBe(true);
  expect(limiter.consume("ip-a")).toBe(false);
  expect(limiter.consume("ip-b")).toBe(true);
  expect(limiter.size).toBe(2);
  expect(limiter.consume("ip-c")).toBe(false);
  expect(limiter.size).toBe(2);
  now += 60_001;
  expect(limiter.consume("ip-c")).toBe(true);
  expect(limiter.size).toBe(1);
});
