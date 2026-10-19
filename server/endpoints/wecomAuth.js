const {
  COOKIE_NAME,
  SESSION_COOKIE_NAME,
} = require("../utils/meetingGateway/wecomAuth");

function readCookies(header = "") {
  const result = {};
  for (const item of String(header).split(";")) {
    const index = item.indexOf("=");
    if (index < 1) continue;
    result[item.slice(0, index).trim()] = item.slice(index + 1).trim();
  }
  return result;
}

function bearer(request) {
  const match = /^Bearer (\S+)$/.exec(request.header("Authorization") || "");
  return match?.[1] || null;
}

function cookieValue(request, name = COOKIE_NAME) {
  return readCookies(request.header("Cookie"))[name] || null;
}

function cookieProof(request, name = SESSION_COOKIE_NAME) {
  const value = cookieValue(request, name);
  const split = value?.indexOf(".") ?? -1;
  return split >= 0 ? value.slice(split + 1) : null;
}

function setCookie(response, cookie) {
  if (!cookie) return;
  const expires =
    cookie.options.expires instanceof Date
      ? cookie.options.expires.toUTCString()
      : new Date(cookie.options.expires).toUTCString();
  response.append(
    "Set-Cookie",
    `${cookie.name}=${cookie.value}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`
  );
}

function clearCookie(response, name = COOKIE_NAME) {
  response.append(
    "Set-Cookie",
    `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`
  );
}

function requestId(request) {
  const value = request.header("X-Request-ID");
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value)
    ? value
    : require("node:crypto").randomUUID();
}

function ok(response, request, data, status = 200) {
  return response
    .status(status)
    .set("Cache-Control", "no-store")
    .json({
      data,
      meta: { request_id: requestId(request), schema_version: "2.0" },
    });
}

function fail(response, request, error) {
  const code =
    typeof error?.code === "string" && /^MGW_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : "MGW_AUTH_UNAVAILABLE";
  const status = Number.isInteger(error?.status)
    ? error.status
    : code === "MGW_CSRF_REJECTED"
      ? 403
      : code === "MGW_AUTH_TRANSACTION_INVALID"
        ? 409
        : code === "MGW_BUSINESS_AUTH_REQUIRED"
          ? 401
          : 503;
  const retryable =
    code === "MGW_DEPENDENCY_NOT_READY" ||
    code === "MGW_AUTH_REDEEM_OUTCOME_UNKNOWN";
  const recovery =
    code === "MGW_AUTH_REDEEM_OUTCOME_UNKNOWN"
      ? "reload_state"
      : code === "MGW_BUSINESS_AUTH_REQUIRED"
        ? "sign_in"
        : "retry_later";
  return response
    .status(status)
    .set("Cache-Control", "no-store")
    .json({
      error: {
        code,
        message_key: code.toLowerCase(),
        retryable,
        recovery_action: recovery,
      },
      request_id: requestId(request),
    });
}

function emptyBody(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).length === 0
  );
}

function createWeComAuthEndpoints(apiRouter, { auth = null } = {}) {
  const startAttempts = new Map();
  apiRouter.get("/auth/wecom/config", (request, response) => {
    const config = auth
      ? auth.getConfig()
      : { enabled: false, available: false, reason: "DEPENDENCY_NOT_READY" };
    return ok(response, request, config);
  });

  apiRouter.get("/auth/wecom/state", async (request, response) => {
    try {
      const token = bearer(request);
      const state = auth
        ? await auth.getState({
            localToken: token,
            browserProof: token ? cookieProof(request) : null,
            preloginCookie: cookieValue(request),
          })
        : {
            authenticated: false,
            remoteAccessMode: null,
            reason: "DEPENDENCY_NOT_READY",
            expiresAt: null,
            user: null,
            csrfToken: null,
          };
      return ok(response, request, state);
    } catch (error) {
      return fail(response, request, error);
    }
  });

  apiRouter.post("/auth/wecom/start", async (request, response) => {
    if (!emptyBody(request.body))
      return fail(
        response,
        request,
        Object.assign(new Error("MGW_INPUT_INVALID"), {
          code: "MGW_INPUT_INVALID",
          status: 422,
        })
      );
    try {
      if (auth) auth.assertSameOrigin(request.header("Origin"));
      const now = Date.now();
      const key = String(
        request.ip || request.socket?.remoteAddress || "unknown"
      );
      const current = startAttempts.get(key);
      if (!current || now - current.startedAt >= 60_000)
        startAttempts.set(key, { startedAt: now, count: 1 });
      else if (current.count >= 10)
        throw Object.assign(new Error("MGW_RATE_LIMITED"), {
          code: "MGW_RATE_LIMITED",
          status: 429,
        });
      else current.count++;
      if (!auth)
        throw Object.assign(new Error("MGW_DEPENDENCY_NOT_READY"), {
          code: "MGW_DEPENDENCY_NOT_READY",
          status: 503,
        });
      const state = bearer(request)
        ? await auth.getState({
            localToken: bearer(request),
            browserProof: cookieProof(request),
          })
        : null;
      const claims = bearer(request)
        ? require("../utils/http").decodeJWT(bearer(request))
        : null;
      const started = await auth.start({
        origin: request.header("Origin"),
        currentLocalSession:
          state?.authenticated && claims?.session_id
            ? { id: claims.session_id, userId: Number(claims.id) }
            : null,
        browserProof: state?.authenticated ? cookieProof(request) : null,
      });
      setCookie(response, started.cookie);
      return ok(response, request, {
        authorizationUrl: started.authorizationUrl,
        expiresAt: started.expiresAt,
      });
    } catch (error) {
      return fail(response, request, error);
    }
  });

  apiRouter.get("/auth/wecom/callback", async (request, response) => {
    try {
      if (!auth)
        throw Object.assign(new Error("MGW_DEPENDENCY_NOT_READY"), {
          code: "MGW_DEPENDENCY_NOT_READY",
          status: 503,
        });
      if (
        Object.keys(request.query || {}).some(
          (key) => !["state", "resultTicket"].includes(key)
        )
      )
        throw Object.assign(new Error("MGW_AUTH_TRANSACTION_INVALID"), {
          code: "MGW_AUTH_TRANSACTION_INVALID",
          status: 409,
        });
      const result = await auth.callback({
        cookie: cookieValue(request),
        clientState: request.query.state,
        resultTicket: request.query.resultTicket,
      });
      response
        .set("Cache-Control", "no-store")
        .set("Referrer-Policy", "no-referrer");
      return response.redirect(303, result.location);
    } catch (error) {
      clearCookie(response);
      return fail(response, request, error);
    }
  });

  apiRouter.post("/auth/wecom/complete", async (request, response) => {
    if (!emptyBody(request.body))
      return fail(
        response,
        request,
        Object.assign(new Error("MGW_INPUT_INVALID"), {
          code: "MGW_INPUT_INVALID",
          status: 422,
        })
      );
    try {
      if (!auth)
        throw Object.assign(new Error("MGW_DEPENDENCY_NOT_READY"), {
          code: "MGW_DEPENDENCY_NOT_READY",
          status: 503,
        });
      const result = await auth.complete({
        origin: request.header("Origin"),
        cookie: cookieValue(request),
        csrf: request.header("X-MGW-CSRF"),
      });
      setCookie(response, result.sessionCookie);
      clearCookie(response, COOKIE_NAME);
      const { sessionCookie: _cookie, ...dto } = result;
      return ok(response, request, dto);
    } catch (error) {
      return fail(response, request, error);
    }
  });

  apiRouter.post("/auth/logout", async (request, response) => {
    if (!emptyBody(request.body))
      return fail(
        response,
        request,
        Object.assign(new Error("MGW_INPUT_INVALID"), {
          code: "MGW_INPUT_INVALID",
          status: 422,
        })
      );
    try {
      if (!auth)
        throw Object.assign(new Error("MGW_DEPENDENCY_NOT_READY"), {
          code: "MGW_DEPENDENCY_NOT_READY",
          status: 503,
        });
      const result = await auth.logout({
        localToken: bearer(request),
        browserProof: cookieProof(request),
        csrf: request.header("X-MGW-CSRF"),
        origin: request.header("Origin"),
      });
      clearCookie(response, SESSION_COOKIE_NAME);
      const { clearCookie: _cookieName, ...dto } = result;
      return ok(response, request, dto);
    } catch (error) {
      return fail(response, request, error);
    }
  });
}

module.exports = {
  COOKIE_NAME,
  SESSION_COOKIE_NAME,
  createWeComAuthEndpoints,
  readCookies,
};
