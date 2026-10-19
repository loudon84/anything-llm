const net = require("net");
const { classifyFailure, createGatewayError } = require("./errors");
const { createSafeGatewayLogger } = require("./redact");

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

function isUnsafeHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (ipVersion === 6) return true;
  return false;
}

function validateOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_error) {
    throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || isUnsafeHost(parsed.hostname)) {
    throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
  }
  return parsed.origin;
}

function normalizeOriginAllowlist(originAllowlist) {
  if (!Array.isArray(originAllowlist) || originAllowlist.length === 0) {
    throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
  }
  return new Set(originAllowlist.map(validateOrigin));
}

function normalizeAllowlist(allowlist) {
  if (!Array.isArray(allowlist)) throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
  const normalized = new Set();
  for (const entry of allowlist) {
    if (typeof entry !== "string" || !entry.startsWith("/") || entry.startsWith("//") || entry.includes("?") || entry.includes("#") || entry.includes("\\")) {
      throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    }
    let parsed;
    try {
      parsed = new URL(entry, "https://allowlist.invalid");
    } catch (_error) {
      throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    }
    if (parsed.origin !== "https://allowlist.invalid" || parsed.pathname !== entry || entry.includes("..")) {
      throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    }
    normalized.add(entry);
  }
  return normalized;
}

function createGatewayClient({ origin, originAllowlist, allowlist, fetchImpl = global.fetch, clock = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS, enabled = false, contractEvidence, headersForSubject = (subjectToken) => ({ Authorization: `Bearer ${subjectToken}` }), gatewayInstanceId, clientId, clientSecret, scopes = [], resource, logger = console } = {}) {
  const trustedOrigins = normalizeOriginAllowlist(originAllowlist);
  const configuredOrigin = origin ? validateOrigin(origin) : null;
  if (!configuredOrigin || !trustedOrigins.has(configuredOrigin)) {
    throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
  }
  const allowedPaths = normalizeAllowlist(allowlist || []);
  const pathAllowed = (value) => allowedPaths.has(value) || (allowedPaths.has("/api/v1/connections/:connectionId/confirm") && /^\/api\/v1\/connections\/[A-Za-z0-9_-]{1,128}\/confirm$/.test(value));
  if (typeof fetchImpl !== "function") throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
  const timeout = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
  const safeLogger = createSafeGatewayLogger(logger);

  function assertEnabled() {
    if (!enabled) throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
  }

  function assertContract() {
    if (!contractEvidence?.confirmed) throw createGatewayError(classifyFailure({ reason: "CONTRACT_UNAVAILABLE" }));
  }

  async function requestForSubject({ bridge, path: requestPath, method = "GET", body, stage } = {}) {
    assertEnabled();
    if (typeof bridge !== "string" || bridge.length === 0 || typeof requestPath !== "string" || !pathAllowed(requestPath) || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    }
    const requestStage = stage || (method === "GET" ? "REQUEST" : undefined);
    if (method !== "GET" && !["QUERY", "IMPORT", "AUTHORIZATION"].includes(requestStage)) {
      throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    }
    if (requestStage !== "AUTHORIZATION") assertContract();
    const subjectHeaders = headersForSubject(bridge);
    if (!subjectHeaders || typeof subjectHeaders !== "object" || Array.isArray(subjectHeaders)) {
      throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    }
    const controller = new AbortController();
    const startedAt = clock();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(new URL(requestPath, configuredOrigin), {
        method,
        redirect: "error",
        signal: controller.signal,
        headers: body === undefined ? subjectHeaders : { ...subjectHeaders, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body }),
      });
      if (response.status >= 300 && response.status < 400) {
        throw createGatewayError(classifyFailure({ stage: requestStage, httpStatus: response.status, reason: "REDIRECT_REJECTED", writeOutcome: method === "GET" ? "NONE" : "UNKNOWN", responseReceived: true }));
      }
      if (!response.ok && response.status !== 202) {
        throw createGatewayError(classifyFailure({
          stage: requestStage,
          httpStatus: response.status,
          responseReceived: true,
          writeOutcome: method === "GET" ? "NONE" : "UNKNOWN",
        }));
      }
      return { status: response.status, response, elapsedMs: Math.max(0, clock() - startedAt) };
    } catch (error) {
      if (typeof error.code === "string" && error.code.startsWith("MGW_")) {
        safeLogger.failure({ stage: requestStage, error });
        throw error;
      }
      const classified = createGatewayError(classifyFailure({
        stage: requestStage,
        reason: error.name === "AbortError" ? "TIMEOUT" : "NETWORK",
        writeOutcome: method === "GET" ? "NONE" : "UNKNOWN",
        responseReceived: false,
      }), error);
      safeLogger.failure({ stage: requestStage, error: classified });
      throw classified;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function contractError() {
    return createGatewayError({ code: "MGW_UPSTREAM_CONTRACT_ERROR", status: 503, state: "BLOCKED", retryPolicy: "MANUAL" });
  }

  async function authPost(requestPath, body, stage) {
    assertEnabled();
    if (!allowedPaths.has(requestPath)) throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(new URL(requestPath, configuredOrigin), {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status >= 300 && response.status < 400)
        throw createGatewayError(classifyFailure({ stage, httpStatus: response.status, reason: "REDIRECT_REJECTED", responseReceived: true }));
      if (!response.ok)
        throw createGatewayError(classifyFailure({ stage, httpStatus: response.status, responseReceived: true }));
      let envelope;
      try { envelope = await response.json(); } catch (_error) { throw contractError(); }
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.code !== 0 || envelope.error_code !== 0 || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
        if (envelope?.code !== 0 || envelope?.error_code !== 0) {
          const error = createGatewayError(classifyFailure({ httpStatus: stage === "LOGIN" ? 401 : 401, responseReceived: true }));
          if (stage === "LOGIN") { error.code = "MGW_LOGIN_REJECTED"; error.status = 401; }
          throw error;
        }
        throw contractError();
      }
      return envelope.data;
    } catch (error) {
      if (typeof error.code === "string" && error.code.startsWith("MGW_")) {
        safeLogger.failure({ stage, error });
        throw error;
      }
      const classified = createGatewayError(classifyFailure({
        stage,
        reason: error.name === "AbortError" ? "TIMEOUT" : "NETWORK",
        responseReceived: false,
      }), error);
      safeLogger.failure({ stage, error: classified });
      throw classified;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function expiryFromSeconds(startedAt, seconds) {
    if (!Number.isInteger(seconds) || seconds <= 5 || seconds > 86_400) throw contractError();
    const deadline = Number(startedAt) + (seconds - 5) * 1000;
    if (!Number.isFinite(deadline) || deadline <= Number(startedAt)) throw contractError();
    return new Date(deadline).toISOString();
  }

  async function accountLogin(credentials) {
    assertEnabled();
    if (!credentials || typeof credentials.account !== "string" || !credentials.account.trim() || credentials.account.length > 200 || typeof credentials.password !== "string" || !credentials.password || credentials.password.length > 200 || typeof gatewayInstanceId !== "string" || !gatewayInstanceId.trim()) {
      throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    }
    const startedAt = clock();
    const data = await authPost("/api/v1/auth/account-login", { account: credentials.account, password: credentials.password }, "LOGIN");
    const sessionToken = data.session_token;
    const user = data.user;
    if (typeof sessionToken !== "string" || !sessionToken.startsWith("ms_") || !Number.isInteger(data.expires_in) || !data.org_id || !user || typeof user !== "object" || typeof user.user_id !== "string" || !user.user_id || typeof user.member_id !== "string" || !user.member_id || typeof user.name !== "string" || typeof user.member_role !== "string" || user.member_role.toUpperCase() !== "MEMBER") throw contractError();
    const expiresAt = expiryFromSeconds(startedAt, data.expires_in);
    return {
      sessionToken,
      expiresAt,
      binding: {
        gatewayInstanceId,
        orgId: String(data.org_id),
        memberId: user.member_id,
        userId: user.user_id,
        memberRole: "MEMBER",
        issuer: "account-login-v1",
        displayName: user.name,
        active: true,
        identityExpiresAt: expiresAt,
      },
    };
  }

  async function exchange(sessionToken) {
    assertEnabled();
    if (typeof sessionToken !== "string" || !sessionToken.startsWith("ms_") || sessionToken.length > 16384) {
      throw createGatewayError(classifyFailure({ httpStatus: 401 }));
    }
    if (typeof clientId !== "string" || !clientId.trim() || typeof clientSecret !== "string" || !clientSecret || !Array.isArray(scopes) || scopes.length === 0 || scopes.some((scope) => typeof scope !== "string" || !scope.trim()) || typeof resource !== "string" || !resource.trim()) {
      throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    }
    const startedAt = clock();
    const data = await authPost("/api/v1/auth/exchange", {
      client_id: clientId,
      client_secret: clientSecret,
      subject_token: sessionToken,
      scopes,
      resource,
    }, "EXCHANGE");
    if (typeof data.access_token !== "string" || !data.access_token.startsWith("mt_") || typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" || typeof data.scope !== "string" || typeof data.resource !== "string" || data.resource !== resource || (data.refresh_token !== null && data.refresh_token !== undefined && typeof data.refresh_token !== "string")) throw contractError();
    const returnedScopes = new Set(data.scope.split(/\s/).filter(Boolean));
    if (scopes.some((scope) => !returnedScopes.has(scope))) throw contractError();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: expiryFromSeconds(startedAt, data.expires_in),
      scope: data.scope,
      resource: data.resource,
    };
  }

  async function authorizationData({ token, path, method = "GET", body } = {}) {
    const result = await requestForSubject({ bridge: token, path, method, body: body === undefined ? undefined : JSON.stringify(body), stage: "AUTHORIZATION" });
    let envelope;
    try { envelope = await result.response.json(); } catch (_error) { throw contractError(); }
    if (!envelope || envelope.code !== 0 || envelope.error_code !== 0 || !envelope.data || typeof envelope.data !== "object") throw contractError();
    return envelope.data;
  }
  async function startAuthorization({ gatewayAccessToken, applicationId, returnTo } = {}) {
    if (!applicationId || !returnTo) throw contractError();
    const data = await authorizationData({ token: gatewayAccessToken, path: "/api/v1/oauth/authorizations", method: "POST", body: { application_id: applicationId, return_to: returnTo } });
    if (typeof data.authorization_url !== "string" || typeof data.transaction_id !== "string" || typeof data.expires_at !== "string") throw contractError();
    return { authorizationUrl: data.authorization_url, transactionId: data.transaction_id, expiresAt: data.expires_at };
  }
  async function listConnections({ gatewayAccessToken } = {}) {
    const data = await authorizationData({ token: gatewayAccessToken, path: "/api/v1/me/connections" });
    if (!Array.isArray(data.items)) throw contractError();
    return data.items.map((item) => {
      if (!item || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.kind !== "string" || typeof item.status !== "string" || typeof item.owner_member_id !== "string") throw contractError();
      return { connectionId: item.id, name: item.name, memberId: item.owner_member_id, type: item.kind, status: item.status };
    });
  }
  async function confirmConnection({ gatewayAccessToken } = {}, connectionId) {
    if (typeof connectionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(connectionId)) throw contractError();
    const data = await authorizationData({ token: gatewayAccessToken, path: `/api/v1/connections/${connectionId}/confirm`, method: "POST", body: {} });
    if (!data || typeof data.id !== "string" || typeof data.status !== "string") throw contractError();
    return data;
  }
  return { accountLogin, exchange, requestForSubject, startAuthorization, listConnections, confirmConnection, resource, transportAvailable: enabled === true };
}

module.exports = { createGatewayClient, validateOrigin, normalizeAllowlist, normalizeOriginAllowlist };
