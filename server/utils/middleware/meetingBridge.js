const { COOKIE_NAME } = require("../meetingGateway/sessions");

function readBridgeCookie(header = "") {
  const matches = String(header).split(";").map((part) => part.trim()).filter((part) => part.startsWith(COOKIE_NAME + "="));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function meetingBridge({ sessions, mutation = false } = {}) {
  return async function requireMeetingBridge(request, response, next) {
    if (!sessions) return response.status(503).json({ error: "MGW_CONFIG_INVALID" });
    const authorization = request.header("Authorization") || "";
    const jwt = /^Bearer (\S+)$/.exec(authorization)?.[1];
    const result = await sessions.requireBridge({
      user: response.locals.user,
      jwt,
      cookie: readBridgeCookie(request.header("Cookie")),
      csrf: request.header("X-Meeting-CSRF"),
      origin: request.header("Origin"),
      mutation,
    });
    if (!result.allowed) {
      const status = result.code === "MGW_CSRF_REJECTED" ? 403 : 401;
      return response.status(status).json({ error: result.code });
    }
    response.locals.meetingBridge = result;
    next();
  };
}

module.exports = { meetingBridge, readBridgeCookie };
