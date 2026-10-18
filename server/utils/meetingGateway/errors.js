const FAILURE_DECISIONS = Object.freeze({
  CONFIG: {
    code: "MGW_CONFIG_INVALID",
    status: 503,
    state: "CONFIG_BLOCKED",
    retryPolicy: "MANUAL",
  },
  UNAVAILABLE: {
    code: "MGW_UPSTREAM_UNAVAILABLE",
    status: 503,
    state: "UNVERIFIED",
    accessState: "UNVERIFIED",
    retryPolicy: "BOUNDED",
    maxRetries: 3,
    backoffSeconds: [2, 4, 8],
  },
  CONTRACT: {
    code: "MGW_UPSTREAM_CONTRACT_ERROR",
    status: 503,
    state: "BLOCKED",
    accessState: "UNVERIFIED",
    retryPolicy: "MANUAL",
  },
  CONTRACT_UNAVAILABLE: {
    code: "MGW_UPSTREAM_CONTRACT_UNAVAILABLE",
    status: 503,
    state: "CONFIG_BLOCKED",
    retryPolicy: "MANUAL",
  },
  AUTH: {
    code: "MGW_BUSINESS_AUTH_REQUIRED",
    status: 401,
    state: "AUTH_REQUIRED",
    accessState: "AUTH_REQUIRED",
    retryPolicy: "MANUAL",
  },
  RATE_LIMITED: {
    code: "MGW_RATE_LIMITED",
    status: 429,
    state: "RETRYING",
    accessState: "UNVERIFIED",
    retryPolicy: "RETRY_AFTER",
    maxRetries: 3,
    fallbackSeconds: 30,
  },
  QUERY_RECOVERY: {
    code: "MGW_QUERY_RECOVERY_REQUIRED",
    status: 202,
    state: "BLOCKED",
    retryPolicy: "RECOVERY",
  },
  IMPORT_RECOVERY: {
    code: "MGW_IMPORT_RECOVERY_REQUIRED",
    status: 202,
    state: "PENDING_CLEANUP",
    retryPolicy: "RECOVERY",
  },
  INPUT: {
    code: "MGW_INPUT_INVALID",
    status: 422,
    state: "FAILED",
    retryPolicy: "NEVER",
  },
});

function createGatewayError(decision, cause) {
  const error = new Error(decision.code);
  Object.assign(error, decision);
  if (cause && cause.name === "AbortError") error.reason = "TIMEOUT";
  return error;
}

function classifyFailure({ stage, httpStatus, reason, writeOutcome = "NONE" } = {}) {
  if (writeOutcome === "UNKNOWN") {
    return stage === "QUERY" ? FAILURE_DECISIONS.QUERY_RECOVERY : FAILURE_DECISIONS.IMPORT_RECOVERY;
  }
  if (httpStatus === 401) return FAILURE_DECISIONS.AUTH;
  if (httpStatus === 429) return FAILURE_DECISIONS.RATE_LIMITED;
  if (httpStatus === 403 || httpStatus === 404) return FAILURE_DECISIONS.CONTRACT;
  if (httpStatus === 409 || httpStatus === 422) return FAILURE_DECISIONS.INPUT;
  if (httpStatus === 400) return FAILURE_DECISIONS.CONTRACT;
  if (reason === "CONFIG_INVALID") return FAILURE_DECISIONS.CONFIG;
  if (reason === "CONTRACT_UNAVAILABLE") return FAILURE_DECISIONS.CONTRACT_UNAVAILABLE;
  return FAILURE_DECISIONS.UNAVAILABLE;
}

module.exports = { classifyFailure, createGatewayError };
