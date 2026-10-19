const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { meetingBridge, readBridgeCookie } = require("../utils/middleware/meetingBridge");
const { COOKIE_NAME } = require("../utils/meetingGateway/sessions");
const workspacePolicy = require("../utils/meetingGateway/workspacePolicy").createWorkspacePolicy();

function setBridgeCookie(response, cookie) {
  const expires = cookie.options.expires.toUTCString();
  response.setHeader("Set-Cookie", COOKIE_NAME + "=" + cookie.value + "; Path=/; Expires=" + expires + "; HttpOnly; Secure; SameSite=Strict");
}
function clearBridgeCookie(response) {
  response.setHeader("Set-Cookie", COOKIE_NAME + "=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict");
}
function createBoundedRateLimiter({ windowMs = 60_000, maxAttempts = 10, maxEntries = 10_000, clock = () => Date.now() } = {}) {
  if (![windowMs, maxAttempts, maxEntries].every((value) => Number.isInteger(value) && value > 0) || typeof clock !== "function")
    throw new TypeError("Invalid rate limiter configuration");
  const attempts = new Map();
  let operations = 0;
  function pruneExpired(now) {
    for (const [key, entry] of attempts) if (now - entry.startedAt >= windowMs) attempts.delete(key);
  }
  return {
    consume(key) {
      if (typeof key !== "string" || !key) return false;
      const now = clock();
      const current = attempts.get(key);
      if (current && now - current.startedAt < windowMs) {
        if (current.count >= maxAttempts) return false;
        current.count++;
      } else {
        if ((++operations % 256) === 0 || attempts.size >= maxEntries) pruneExpired(now);
        if (attempts.size >= maxEntries) return false;
        attempts.set(key, { startedAt: now, count: 1 });
      }
      return true;
    },
    get size() { return attempts.size; },
  };
}

function meetingGatewayEndpoints(apiRouter, { sessions = null, employeeAuth = null, oauth = null, enabled = false, contractConfirmed = false } = {}) {
  const oauthReady = enabled === true && oauth?.contractConfirmed === true;
  const employeeLoginAttempts = createBoundedRateLimiter();
  apiRouter.post("/meeting-gateway/employee-login", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["account", "password"].includes(key)) || typeof body.account !== "string" || typeof body.password !== "string")
      return response.status(422).json({ error: "MGW_INPUT_INVALID" });
    const key = String(request.ip || request.socket?.remoteAddress || "unknown");
    if (!employeeLoginAttempts.consume(key)) return response.status(429).json({ error: "MGW_RATE_LIMITED" });
    if (!employeeAuth) return response.status(503).json({ error: "MGW_DEPENDENCY_NOT_READY" });
    try {
      const result = await employeeAuth.login({
        credentials: { account: body.account, password: body.password },
        origin: request.header("Origin"), oldBridge: readBridgeCookie(request.header("Cookie")),
      });
      for (const cookie of [result.sessionCookie, result.bridgeCookie]) {
        const expires = cookie.options.expires.toUTCString();
        response.append("Set-Cookie", cookie.name + "=" + cookie.value + "; Path=/; Expires=" + expires + "; HttpOnly; Secure; SameSite=" + (cookie.options.sameSite === "lax" ? "Lax" : "Strict"));
      }
      const { sessionCookie: _sessionCookie, bridgeCookie: _bridgeCookie, bridge: _bridge, ...dto } = result;
      return response.status(200).json(dto);
    } catch (error) {
      const code = typeof error?.code === "string" && error.code.startsWith("MGW_") ? error.code : "MGW_UPSTREAM_UNAVAILABLE";
      const status = Number.isInteger(error?.status) ? error.status : code === "MGW_LOGIN_REJECTED" ? 401 : code === "MGW_CSRF_REJECTED" ? 403 : 503;
      return response.status(status).json({ error: code });
    }
  });
  apiRouter.post("/meeting-gateway/session", [validatedRequest], async (request, response) => {
    if (!sessions) return response.status(503).json({ error: "MGW_CONFIG_INVALID" });
    if (!enabled) return response.status(503).json({ error: "MGW_UPSTREAM_CONTRACT_ERROR" });
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["account", "password"].includes(key)) || typeof body.account !== "string" || typeof body.password !== "string")
      return response.status(422).json({ error: "MGW_INPUT_INVALID" });
    try {
      const result = await sessions.login({
        user: response.locals.user,
        jwt: /^Bearer (\S+)$/.exec(request.header("Authorization") || "")?.[1],
        oldBridge: readBridgeCookie(request.header("Cookie")),
        credentials: { account: body.account, password: body.password },
        origin: request.header("Origin"),
      });
      setBridgeCookie(response, result.cookie);
      return response.status(200).json(result.dto);
    } catch (error) {
      const status = error.message === "MGW_CSRF_REJECTED" ? 403 : error.message === "MGW_LOGIN_REJECTED" ? 401 : 503;
      return response.status(status).json({ error: error.message?.startsWith("MGW_") ? error.message : "MGW_UPSTREAM_UNAVAILABLE" });
    }
  });
  apiRouter.get("/meeting-gateway/session", [validatedRequest, meetingBridge({ sessions })], async (_request, response) => {
    const bridge = response.locals.meetingBridge;
    return response.json({ binding_status: "BOUND", expires_at: new Date(bridge.expiresAt * 1000).toISOString(), csrf_token: bridge.csrfToken });
  });
  apiRouter.delete("/meeting-gateway/session", [validatedRequest, meetingBridge({ sessions, mutation: true })], async (request, response) => {
    await sessions.revokeCurrent(readBridgeCookie(request.header("Cookie")));
    clearBridgeCookie(response);
    return response.json({ binding_status: "AUTH_REQUIRED" });
  });
  apiRouter.delete("/meeting-gateway/binding", [validatedRequest, meetingBridge({ sessions, mutation: true })], async (_request, response) => {
    await sessions.revokeUser(response.locals.user.id);
    clearBridgeCookie(response);
    return response.json({ binding_status: "AUTH_REQUIRED" });
  });
  apiRouter.post("/meeting-gateway/workspaces", [validatedRequest, meetingBridge({ sessions, mutation: true })], async (request, response) => {
    if (!enabled) return response.status(503).json({ error: "MGW_UPSTREAM_CONTRACT_ERROR" });
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "name") || typeof body.name !== "string" || !body.name.trim())
      return response.status(422).json({ error: "MGW_INPUT_INVALID" });
    try {
      const workspace = await workspacePolicy.createRestricted({ userId: response.locals.user.id, name: body.name });
      return response.status(201).json({ workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } });
    } catch (error) {
      return response.status(503).json({ error: error.message?.startsWith("MGW_") ? error.message : "MGW_UPSTREAM_UNAVAILABLE" });
    }
  });
  const oauthUnavailable = (_request, response) => response.status(503).json({ error: "MGW_UPSTREAM_CONTRACT_ERROR" });
  const oauthRemoteAllowed = (_request, response) => {
    const authState = response.locals.meetingAuthState;
    if (authState?.kind === "GATEWAY_SESSION" && (authState.remoteAccessMode ?? authState.session?.remoteAccessMode) !== "GATEWAY_ENABLED") {
      response.status(403).json({ error: "MGW_REMOTE_ACCESS_REQUIRED" });
      return false;
    }
    return true;
  };
  const hasEmptyJsonObject = (body) => body !== null && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
  const oauthContext = async (request, response, mutation = false) => {
    const sessionCredentials = sessions?.credentialsForBridge ? await sessions.credentialsForBridge({
      user: response.locals.user,
      jwt: /^Bearer (\S+)$/.exec(request.header("Authorization") || "")?.[1],
      cookie: readBridgeCookie(request.header("Cookie")),
      csrf: request.header("X-Meeting-CSRF"),
      origin: request.header("Origin"), mutation,
    }) : null;
    return {
      ownerUserId: Number(response.locals.user?.id),
      bridgeSessionId: response.locals.meetingBridge.bridgeId,
      bridgeExpiresAt: response.locals.meetingBridge.expiresAt,
      ...(sessionCredentials ? { gatewayAccessToken: sessionCredentials.accessToken, gatewayMemberId: sessionCredentials.member.memberId } : {}),
    };
  };
  const connectionItemsDto = (connections) => {
    if (!Array.isArray(connections)) throw new Error("MGW_UPSTREAM_CONTRACT_ERROR");
    return connections.map((connection) => {
      if (!connection || typeof connection.connectionId !== "string" || !connection.connectionId || typeof connection.name !== "string" || typeof connection.status !== "string")
        throw new Error("MGW_UPSTREAM_CONTRACT_ERROR");
      return { id: connection.connectionId, name: connection.name, status: connection.status };
    });
  };
  const oauthError = (error, response) => {
    const code = typeof error?.message === "string" && error.message.startsWith("MGW_") ? error.message : "MGW_UPSTREAM_UNAVAILABLE";
    const status = code === "MGW_BUSINESS_AUTH_REQUIRED" ? 401 :
      code === "MGW_OAUTH_CONFIRM_DENIED" || code === "MGW_CSRF_REJECTED" ? 403 :
      code === "MGW_OAUTH_START_REJECTED" ? 422 :
      code === "MGW_OAUTH_ALREADY_PENDING" || code === "MGW_OAUTH_TRANSACTION_INVALID" || code === "MGW_OAUTH_CONFIRM_IN_PROGRESS" ? 409 :
      code === "MGW_OAUTH_RECOVERY_REQUIRED" ? 202 : 503;
    return response.status(status).json(code === "MGW_OAUTH_RECOVERY_REQUIRED" ? { error: code, state: "PENDING" } : { error: code });
  };
  apiRouter.get("/meeting-gateway/connections", [validatedRequest, meetingBridge({ sessions })], async (request, response) => {
    if (!oauthReady) return oauthUnavailable(request, response);
    if (!oauthRemoteAllowed(request, response)) return;
    try {
      const connections = await oauth.listConnections(await oauthContext(request, response));
      return response.json({ items: connectionItemsDto(connections) });
    } catch (error) { return oauthError(error, response); }
  });
  apiRouter.post("/meeting-gateway/oauth/start", [validatedRequest, meetingBridge({ sessions, mutation: true })], async (request, response) => {
    if (!oauthReady) return oauthUnavailable(request, response);
    if (!oauthRemoteAllowed(request, response)) return;
    if (!hasEmptyJsonObject(request.body)) return response.status(422).json({ error: "MGW_INPUT_INVALID" });
    try {
      const result = await oauth.start(await oauthContext(request, response, true));
      if (!result || typeof result.authorizationUrl !== "string" || typeof result.transactionId !== "string" || typeof result.expiresAt !== "string")
        throw new Error("MGW_UPSTREAM_CONTRACT_ERROR");
      return response.status(200).json({ authorization_url: result.authorizationUrl, transaction_id: result.transactionId, expires_at: result.expiresAt });
    } catch (error) { return oauthError(error, response); }
  });
  apiRouter.post("/meeting-gateway/connections/:connectionId/confirm", [validatedRequest, meetingBridge({ sessions, mutation: true })], async (request, response) => {
    if (!oauthReady) return oauthUnavailable(request, response);
    if (!oauthRemoteAllowed(request, response)) return;
    if (!hasEmptyJsonObject(request.body)) return response.status(422).json({ error: "MGW_INPUT_INVALID" });
    try {
      const connection = await oauth.confirm(await oauthContext(request, response, true), request.params.connectionId);
      if (connection?.status !== "ACTIVE") throw new Error("MGW_OAUTH_CONFIRM_DENIED");
      return response.json({ status: "ACTIVE" });
    } catch (error) { return oauthError(error, response); }
  });
  apiRouter.get("/meeting-gateway/oauth/return", [], (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    let query;
    try { query = new URL(request.originalUrl || request.url, "https://consumer.invalid").searchParams; } catch (_error) { query = null; }
    if (!query || [...query.keys()].length !== 1 || query.getAll("connection_id").length !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(query.get("connection_id") || ""))
      return response.status(400).send("Invalid meeting authorization return");
    return response.redirect(303, "/sso/meeting-gateway/result?connection_id=" + encodeURIComponent(query.get("connection_id")));
  });
}
module.exports = { meetingGatewayEndpoints, createBoundedRateLimiter };
