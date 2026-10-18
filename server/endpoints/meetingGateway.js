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
function meetingGatewayEndpoints(apiRouter, { sessions = null, oauth = null, enabled = false, contractConfirmed = false } = {}) {
  const oauthReady = enabled === true && contractConfirmed === true && oauth?.contractConfirmed === true;
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
  const hasEmptyJsonObject = (body) => body !== null && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
  const oauthContext = (_request, response) => ({
    ownerUserId: Number(response.locals.user?.id),
    bridgeSessionId: response.locals.meetingBridge.bridgeId,
    bridgeExpiresAt: response.locals.meetingBridge.expiresAt,
  });
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
    try {
      const connections = await oauth.listConnections(oauthContext(request, response));
      return response.json({ items: connectionItemsDto(connections) });
    } catch (error) { return oauthError(error, response); }
  });
  apiRouter.post("/meeting-gateway/oauth/start", [validatedRequest, meetingBridge({ sessions, mutation: true })], async (request, response) => {
    if (!oauthReady) return oauthUnavailable(request, response);
    if (!hasEmptyJsonObject(request.body)) return response.status(422).json({ error: "MGW_INPUT_INVALID" });
    try {
      const result = await oauth.start(oauthContext(request, response));
      if (!result || typeof result.authorizationUrl !== "string" || typeof result.transactionId !== "string" || typeof result.expiresAt !== "string")
        throw new Error("MGW_UPSTREAM_CONTRACT_ERROR");
      return response.status(200).json({ authorization_url: result.authorizationUrl, transaction_id: result.transactionId, expires_at: result.expiresAt });
    } catch (error) { return oauthError(error, response); }
  });
  apiRouter.post("/meeting-gateway/connections/:connectionId/confirm", [validatedRequest, meetingBridge({ sessions, mutation: true })], async (request, response) => {
    if (!oauthReady) return oauthUnavailable(request, response);
    if (!hasEmptyJsonObject(request.body)) return response.status(422).json({ error: "MGW_INPUT_INVALID" });
    try {
      const connection = await oauth.confirm(oauthContext(request, response), request.params.connectionId);
      if (connection?.status !== "ACTIVE") throw new Error("MGW_OAUTH_CONFIRM_DENIED");
      return response.json({ status: "ACTIVE" });
    } catch (error) { return oauthError(error, response); }
  });
}
module.exports = { meetingGatewayEndpoints };
