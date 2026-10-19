const SENSITIVE_KEY = /(?:authorization|password|passwd|secret|token|cookie|credential|client.?key|api.?key|auth.?code|state)/i;
const SAFE_STAGES = new Set(["REQUEST", "QUERY", "IMPORT", "VERIFY", "FETCH", "CLEANUP"]);
const SAFE_STATES = new Set(["CONFIG_BLOCKED", "UNVERIFIED", "BLOCKED", "AUTH_REQUIRED", "RETRYING", "PENDING_CLEANUP", "FAILED"]);
const SAFE_CODES = new Set([
  "MGW_CONFIG_INVALID", "MGW_UPSTREAM_UNAVAILABLE", "MGW_UPSTREAM_CONTRACT_ERROR",
  "MGW_BUSINESS_AUTH_REQUIRED", "MGW_RATE_LIMITED", "MGW_QUERY_RECOVERY_REQUIRED",
  "MGW_UPSTREAM_CONTRACT_UNAVAILABLE",
  "MGW_IMPORT_RECOVERY_REQUIRED", "MGW_INPUT_INVALID",
]);

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (url.search || url.hash) return `${url.origin}${url.pathname}?[REDACTED]`;
    return value;
  } catch (_error) {
    return value
      .replace(/([?&])[^\s#]+/g, "$1[REDACTED]")
      .replace(/#.*$/, "#[REDACTED]");
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(entry),
    ]));
  }
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return redactUrl(value);
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
      .replace(/(\b[a-z0-9_-]*(?:authorization|password|passwd|secret|token|cookie|credential|api[_-]?key|client[_-]?key)[a-z0-9_-]*=)[^\s&]+/gi, "$1[REDACTED]");
  }
  return value;
}

function createSafeGatewayLogger(logger = {}) {
  const sink = typeof logger.warn === "function" ? logger.warn.bind(logger) : () => {};
  return {
    failure({ stage, error } = {}) {
      const code = typeof error?.code === "string" && /^MGW_[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : "MGW_UPSTREAM_UNAVAILABLE";
      const record = {
        event: "meeting_gateway.request_failed",
        stage: SAFE_STAGES.has(stage) ? stage : "REQUEST",
        code,
        status: [202, 401, 403, 404, 409, 422, 429, 503].includes(error?.status) ? error.status : 503,
        state: SAFE_STATES.has(error?.state) ? error.state : "UNVERIFIED",
      };
      sink(record);
      return record;
    },
  };
}

module.exports = { redact, createSafeGatewayLogger };
