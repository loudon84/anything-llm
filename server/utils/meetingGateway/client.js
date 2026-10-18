const net = require("net");
const { classifyFailure, createGatewayError } = require("./errors");

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
  if (ipVersion === 6) return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
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

function createGatewayClient({ origin, allowlist, fetchImpl = global.fetch, clock = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS, enabled = false, contractEvidence, headersForSubject = () => ({}) } = {}) {
  const configuredOrigin = origin ? validateOrigin(origin) : null;
  const allowedPaths = normalizeAllowlist(allowlist || []);
  if (typeof fetchImpl !== "function") throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
  const timeout = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
  const transportAvailable = enabled === true && contractEvidence?.confirmed === true;

  function assertEnabled() {
    if (!enabled || !configuredOrigin) throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
  }

  function assertContract() {
    if (!contractEvidence?.confirmed) throw createGatewayError(classifyFailure({ reason: "CONTRACT_UNAVAILABLE" }));
  }

  async function requestForSubject({ bridge, path: requestPath, method = "GET", body, stage } = {}) {
    assertEnabled();
    if (typeof bridge !== "string" || bridge.length === 0 || typeof requestPath !== "string" || !allowedPaths.has(requestPath) || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw createGatewayError(classifyFailure({ reason: "CONFIG_INVALID" }));
    }
    assertContract();
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
        headers: subjectHeaders,
        ...(body === undefined ? {} : { body }),
      });
      if (response.status >= 300 && response.status < 400) {
        throw createGatewayError(classifyFailure({ stage, reason: "REDIRECT_REJECTED", writeOutcome: method === "GET" ? "NONE" : "UNKNOWN" }));
      }
      if (!response.ok && response.status !== 202) {
        throw createGatewayError(classifyFailure({ stage, httpStatus: response.status, writeOutcome: method === "GET" ? "NONE" : "UNKNOWN" }));
      }
      return { status: response.status, response, elapsedMs: Math.max(0, clock() - startedAt) };
    } catch (error) {
      if (error.code) throw error;
      throw createGatewayError(classifyFailure({
        stage,
        reason: error.name === "AbortError" ? "TIMEOUT" : "NETWORK",
        writeOutcome: method === "GET" ? "NONE" : "UNKNOWN",
      }), error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function accountLogin() {
    assertEnabled();
    assertContract();
    throw createGatewayError(classifyFailure({ reason: "CONTRACT_UNAVAILABLE" }));
  }

  async function exchange() {
    assertEnabled();
    assertContract();
    throw createGatewayError(classifyFailure({ reason: "CONTRACT_UNAVAILABLE" }));
  }

  return { accountLogin, exchange, requestForSubject, transportAvailable };
}

module.exports = { createGatewayClient, validateOrigin, normalizeAllowlist };
