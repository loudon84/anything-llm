const crypto = require("crypto");
const { classifyFailure, createGatewayError } = require("./errors");
const { createSafeGatewayLogger } = require("./redact");
const { validateOrigin } = require("./client");

const MAX_TIMEOUT_MS = 30_000;
const PROFILE_FIELDS = ["gatewayInstanceId", "orgId", "memberId", "userId", "issuer", "displayName", "active", "identityExpiresAt"];

function fail(code, status = 503, state = "BLOCKED") {
  const error = new Error(code);
  Object.assign(error, { code, status, state, retryPolicy: "MANUAL" });
  return error;
}

function validOpaqueString(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validUtcIso(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  if (!Number.isFinite(Date.parse(value))) return false;
  const canonical = new Date(value).toISOString();
  return canonical === value || canonical.replace(".000Z", "Z") === value;
}

function parseSafeHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) return null;
  return parsed;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function contractDigest(contract) {
  const { schemaDigest: _schemaDigest, ...schema } = contract;
  return "sha256:" + crypto.createHash("sha256").update(canonicalJson(schema)).digest("hex");
}

function normalizeContract(contract) {
  if (!contract || typeof contract !== "object" || contract.status !== "SIGNED_OFF" || contract.contractVersion !== 1 ||
      !validOpaqueString(contract.revision) || /(?:latest|mutable)/i.test(contract.revision) ||
      typeof contract.schemaDigest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(contract.schemaDigest)) return null;
  if (contractDigest(contract) !== contract.schemaDigest.toLowerCase()) return null;

  let trustedOrigin;
  try { trustedOrigin = validateOrigin(contract.origin); }
  catch (_error) { return null; }
  const origin = parseSafeHttpsUrl(contract.origin);
  if (!origin || origin.pathname !== "/" || origin.search || !validOpaqueString(contract.gatewayInstanceId)) return null;
  if (!Array.isArray(contract.allowedAuthorizationUrls) || contract.allowedAuthorizationUrls.length === 0 ||
      !Array.isArray(contract.allowedCallbackUrls) || contract.allowedCallbackUrls.length === 0) return null;
  if (!contract.authorizationUrlParameters ||
      !validOpaqueString(contract.authorizationUrlParameters.state) ||
      !validOpaqueString(contract.authorizationUrlParameters.redirectUri) ||
      Object.keys(contract.authorizationUrlParameters).some((key) => !["state", "redirectUri"].includes(key))) return null;
  const allowedAuthorizationUrls = new Set();
  for (const item of contract.allowedAuthorizationUrls) {
    const parsed = parseSafeHttpsUrl(item);
    try { if (!parsed || validateOrigin(parsed.origin) !== parsed.origin) return null; }
    catch (_error) { return null; }
    if (parsed.search || parsed.pathname === "/" || parsed.href !== item) return null;
    allowedAuthorizationUrls.add(`${parsed.origin}${parsed.pathname}`);
  }
  const allowedCallbackUrls = new Set();
  for (const item of contract.allowedCallbackUrls) {
    const parsed = parseSafeHttpsUrl(item);
    try { if (!parsed || validateOrigin(parsed.origin) !== parsed.origin) return null; }
    catch (_error) { return null; }
    if (parsed.search || parsed.pathname === "/" || parsed.href !== item) return null;
    allowedCallbackUrls.add(parsed.href);
  }

  const operations = contract.operations;
  if (!operations || typeof operations !== "object" || !operations.identitySessionResponse || typeof operations.identitySessionResponse !== "object") return null;
  for (const name of ["start", "redeem", "profile"]) {
    const operation = operations[name];
    if (!operation || !["GET", "POST"].includes(operation.method) ||
        typeof operation.path !== "string" || !operation.path.startsWith("/") || operation.path.startsWith("//") ||
        operation.path.includes("\\") || operation.path.includes("?") || operation.path.includes("#") || operation.path.includes("..") ||
        !["none", "bearer"].includes(operation.authentication) ||
        !operation.response || typeof operation.response !== "object" || Array.isArray(operation.response)) return null;
    if ((name === "profile") !== (operation.authentication === "bearer")) return null;
    if (name !== "profile" && operation.method !== "POST") return null;
    for (const [field, path] of Object.entries(operation.response)) {
      const allowed = name === "profile"
        ? PROFILE_FIELDS.filter((item) => item !== "gatewayInstanceId")
        : name === "start" ? ["transactionId", "authorizationUrl", "expiresAt"] : ["identitySession"];
      if (!allowed.includes(field)) return null;
      if (!validOpaqueString(path)) return null;
    }
  }
  for (const [field, path] of Object.entries(operations.start.response)) {
    if (!["transactionId", "authorizationUrl", "expiresAt"].includes(field) || !validOpaqueString(path)) return null;
  }
  for (const [field, path] of Object.entries(operations.redeem.response)) {
    if (field !== "identitySession" || !validOpaqueString(path)) return null;
  }
  for (const [name, required] of Object.entries({
    start: ["transactionId", "authorizationUrl", "expiresAt"],
    redeem: ["identitySession"],
    profile: PROFILE_FIELDS.filter((field) => field !== "gatewayInstanceId"),
  })) {
    const mapping = operations[name].response;
    if (required.some((field) => !validOpaqueString(mapping[field]))) return null;
  }
  for (const name of ["start", "redeem"]) {
    const request = operations[name].request;
    const required = name === "start" ? ["clientState", "codeChallenge", "redirectUri"] : ["transactionId", "resultTicket", "codeVerifier", "redirectUri"];
    if (!request || typeof request !== "object" || required.some((key) => !validOpaqueString(request[key]))) return null;
    if (Object.keys(request).some((key) => !required.includes(key))) return null;
  }
  const sessionMapping = operations.identitySessionResponse;
  if (!["accessToken", "orgId", "memberId", "userId", "issuer", "identityExpiresAt"].every((field) => validOpaqueString(sessionMapping[field])) ||
      Object.keys(sessionMapping).some((field) => !["accessToken", "orgId", "memberId", "userId", "issuer", "identityExpiresAt"].includes(field))) return null;
  return { ...contract, origin: trustedOrigin, allowedAuthorizationUrls, allowedCallbackUrls };
}

function valueAtPath(object, path) {
  if (!object || typeof object !== "object" || !path) return undefined;
  return path.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, object);
}

function mappedValues(body, mapping) {
  const result = {};
  for (const [field, path] of Object.entries(mapping)) result[field] = valueAtPath(body, path);
  return result;
}

function invalidIdentity() {
  return fail("MGW_IDENTITY_ASSERTION_INVALID", 401, "AUTH_REQUIRED");
}

function authOutcomeUnknown(operationName) {
  const prefix = operationName === "start" ? "MGW_AUTH_START" : "MGW_AUTH_REDEEM";
  const error = fail(`${prefix}_OUTCOME_UNKNOWN`, 202, "BLOCKED");
  error.retryPolicy = "RECOVERY";
  return error;
}

function createWeComGatewayClient({ contract, transport, clock = () => Date.now(), timeoutMs = 10_000, logger = console } = {}) {
  const normalized = normalizeContract(contract);
  const safeLogger = createSafeGatewayLogger(logger);
  const timeout = Math.min(Math.max(Number(timeoutMs) || 10_000, 1), MAX_TIMEOUT_MS);
  const available = Boolean(normalized && transport && typeof transport.request === "function");
  const reason = available ? null : "DEPENDENCY_NOT_READY";

  function requireAvailable() {
    if (!available) throw fail("MGW_DEPENDENCY_NOT_READY", 503, "CONFIG_BLOCKED");
  }

  function validateCallback(callbackUrl) {
    const parsed = parseSafeHttpsUrl(callbackUrl);
    if (!parsed || parsed.href !== callbackUrl || !normalized.allowedCallbackUrls.has(parsed.href)) {
      throw fail("MGW_CONFIG_INVALID", 503, "CONFIG_BLOCKED");
    }
    return parsed.href;
  }

  function validateRequestInputs(fields) {
    if (!fields || Object.values(fields).some((value) => !validOpaqueString(value))) throw fail("MGW_CONFIG_INVALID", 503, "CONFIG_BLOCKED");
    if (fields.redirectUri) fields.redirectUri = validateCallback(fields.redirectUri);
  }

  async function request(operationName, fields, credential) {
    const operation = normalized.operations[operationName];
    validateRequestInputs(fields);
    const requestBody = operation.method === "POST"
      ? Object.fromEntries(Object.entries(operation.request).map(([key, path]) => [path, fields[key]]))
      : undefined;
    const url = new URL(operation.path, normalized.origin);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const headers = { accept: "application/json" };
    if (requestBody) headers["content-type"] = "application/json";
    if (credential) headers.authorization = `Bearer ${credential}`;
    try {
      const response = await transport.request({
        method: operation.method,
        url: url.href,
        headers,
        ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
        if (["start", "redeem"].includes(operationName) && (response?.status >= 300 || !response)) throw authOutcomeUnknown(operationName);
        throw createGatewayError(classifyFailure({ httpStatus: response?.status, responseReceived: Boolean(response), writeOutcome: operation.method === "GET" ? "NONE" : "UNKNOWN", stage: operationName === "redeem" ? "VERIFY" : "REQUEST" }));
      }
      let body = response.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); }
        catch (_error) { throw fail("MGW_UPSTREAM_CONTRACT_ERROR", 503, "BLOCKED"); }
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw fail("MGW_UPSTREAM_CONTRACT_ERROR", 503, "BLOCKED");
      return body;
    } catch (error) {
      if (typeof error.code === "string" && error.code.startsWith("MGW_")) {
        safeLogger.failure({ stage: operationName === "profile" ? "FETCH" : "VERIFY", error });
        throw error;
      }
      if (["start", "redeem"].includes(operationName)) {
        const unknown = authOutcomeUnknown(operationName);
        safeLogger.failure({ stage: "VERIFY", error: unknown });
        throw unknown;
      }
      const classified = createGatewayError(classifyFailure({
        stage: operationName === "redeem" ? "VERIFY" : "REQUEST",
        reason: error.name === "AbortError" ? "TIMEOUT" : "NETWORK",
        writeOutcome: operation.method === "GET" ? "NONE" : "UNKNOWN",
        responseReceived: false,
      }), error);
      safeLogger.failure({ stage: operationName === "profile" ? "FETCH" : "VERIFY", error: classified });
      throw classified;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function startAuthentication({ clientState, codeChallenge, redirectUri } = {}) {
    requireAvailable();
    const fields = { clientState, codeChallenge, redirectUri };
    const body = await request("start", fields);
    const mapped = mappedValues(body, normalized.operations.start.response);
    const authorization = parseSafeHttpsUrl(mapped.authorizationUrl);
    const expiresAt = mapped.expiresAt;
    const queryEntries = authorization ? [...authorization.searchParams.entries()] : [];
    const queryNames = [normalized.authorizationUrlParameters.state, normalized.authorizationUrlParameters.redirectUri];
    const queryStateMatches = authorization?.searchParams.get(normalized.authorizationUrlParameters.state) === fields.clientState;
    const queryRedirectMatches = authorization?.searchParams.get(normalized.authorizationUrlParameters.redirectUri) === fields.redirectUri;
    if (!validOpaqueString(mapped.transactionId) || !authorization ||
        !normalized.allowedAuthorizationUrls.has(`${authorization.origin}${authorization.pathname}`) ||
        queryEntries.length !== 2 || queryEntries.some(([key]) => !queryNames.includes(key)) || !queryStateMatches || !queryRedirectMatches ||
        !validUtcIso(expiresAt) || Date.parse(expiresAt) <= clock()) {
      throw fail("MGW_UPSTREAM_CONTRACT_ERROR", 503, "BLOCKED");
    }
    return { transactionId: mapped.transactionId, authorizationUrl: authorization.href, expiresAt };
  }

  async function redeemAuthentication({ transactionId, resultTicket, codeVerifier, redirectUri } = {}) {
    requireAvailable();
    const fields = { transactionId, resultTicket, codeVerifier, redirectUri };
    const body = await request("redeem", fields);
    const sessionRaw = valueAtPath(body, normalized.operations.redeem.response.identitySession);
    if (!sessionRaw || typeof sessionRaw !== "object" || Array.isArray(sessionRaw)) throw fail("MGW_UPSTREAM_CONTRACT_ERROR", 503, "BLOCKED");
    const identitySessionResponse = normalized.operations.identitySessionResponse;
    const session = mappedValues(sessionRaw, identitySessionResponse);
    if (!["accessToken", "orgId", "memberId", "userId", "issuer"].every((key) => validOpaqueString(session[key])) ||
        !validUtcIso(session.identityExpiresAt) || Date.parse(session.identityExpiresAt) <= clock()) {
      throw invalidIdentity();
    }
    return {
      accessToken: session.accessToken,
      subject: { orgId: session.orgId, memberId: session.memberId, userId: session.userId, issuer: session.issuer },
      identityExpiresAt: session.identityExpiresAt,
    };
  }

  async function fetchAuthenticatedProfile({ identitySession } = {}) {
    requireAvailable();
    if (!identitySession || !validOpaqueString(identitySession.accessToken) || !identitySession.subject ||
        !["orgId", "memberId", "userId", "issuer"].every((key) => validOpaqueString(identitySession.subject[key])) ||
        !validUtcIso(identitySession.identityExpiresAt) || Date.parse(identitySession.identityExpiresAt) <= clock()) throw invalidIdentity();
    const response = await request("profile", {}, identitySession.accessToken);
    const profile = mappedValues(response, normalized.operations.profile.response);
    const idsPresent = PROFILE_FIELDS.filter((key) => key !== "active" && key !== "identityExpiresAt" && key !== "gatewayInstanceId")
      .every((key) => validOpaqueString(profile[key]));
    const expiryValid = validUtcIso(profile.identityExpiresAt) && Date.parse(profile.identityExpiresAt) > clock() &&
      Date.parse(profile.identityExpiresAt) <= Date.parse(identitySession.identityExpiresAt);
    const sameSubject = profile.orgId === identitySession.subject.orgId && profile.memberId === identitySession.subject.memberId &&
      profile.userId === identitySession.subject.userId && profile.issuer === identitySession.subject.issuer;
    if (!idsPresent || !expiryValid || !sameSubject || profile.active !== true) throw invalidIdentity();
    profile.gatewayInstanceId = normalized.gatewayInstanceId;
    return Object.fromEntries(PROFILE_FIELDS.map((key) => [key, profile[key]]));
  }

  return {
    getAvailability: () => ({ enabled: available, available, reason }),
    startAuthentication,
    redeemAuthentication,
    fetchAuthenticatedProfile,
  };
}

module.exports = { createWeComGatewayClient };
