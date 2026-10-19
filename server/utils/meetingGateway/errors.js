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
  AUTHORIZATION_RECOVERY: {
    code: "MGW_OAUTH_RECOVERY_REQUIRED",
    status: 202,
    state: "PENDING",
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

function classifyFailure({ stage, httpStatus, reason, writeOutcome = "NONE", responseReceived = false } = {}) {
  // A received, definitive client/auth response describes the failed operation.
  // It must not be replaced by a generic unknown-write recovery state.
  if (httpStatus === 401) return FAILURE_DECISIONS.AUTH;
  if (httpStatus === 429) return FAILURE_DECISIONS.RATE_LIMITED;
  if (httpStatus === 403 || httpStatus === 404 || httpStatus === 400) return FAILURE_DECISIONS.CONTRACT;
  if (httpStatus === 409 || httpStatus === 422) return FAILURE_DECISIONS.INPUT;
  if (httpStatus >= 400 && httpStatus < 500) return FAILURE_DECISIONS.CONTRACT;

  // A write with no definitive result, including a transport loss or upstream 5xx,
  // requires operation-journal recovery and must never be blindly replayed.
  if (writeOutcome === "UNKNOWN" && (!responseReceived || httpStatus == null || httpStatus >= 300)) {
    return stage === "QUERY" ? FAILURE_DECISIONS.QUERY_RECOVERY : stage === "AUTHORIZATION" ? FAILURE_DECISIONS.AUTHORIZATION_RECOVERY : FAILURE_DECISIONS.IMPORT_RECOVERY;
  }
  if (reason === "CONFIG_INVALID") return FAILURE_DECISIONS.CONFIG;
  if (reason === "CONTRACT_UNAVAILABLE") return FAILURE_DECISIONS.CONTRACT_UNAVAILABLE;
  if (responseReceived && httpStatus >= 500) return FAILURE_DECISIONS.UNAVAILABLE;
  return FAILURE_DECISIONS.UNAVAILABLE;
}

module.exports = { classifyFailure, createGatewayError };
