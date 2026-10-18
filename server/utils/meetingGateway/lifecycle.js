const IMPORT_STATES = Object.freeze([
  "PENDING",
  "FETCHING",
  "STAGED",
  "DOCUMENT_CREATED",
  "ATTACHING",
  "VERIFYING",
  "VERIFIED",
  "AUTH_REQUIRED",
  "FAILED",
  "BLOCKED_DRIFT",
  "PENDING_CLEANUP",
  "REVOKING",
  "REMOVED",
  "SUPERSEDED",
]);

const ACCESS_STATES = Object.freeze(["VALID", "AUTH_REQUIRED", "SOURCE_REVOKED", "UNVERIFIED"]);
const BINDING_STATES = Object.freeze(["BOUND", "DISABLED", "REAUTH_REQUIRED"]);
const QUERY_RUN_STATES = Object.freeze(["ACCEPTED", "RUNNING", "RETRYING", "SUCCEEDED", "FAILED", "AUTH_REQUIRED", "BLOCKED"]);
const ATTEMPT_STATES = Object.freeze(["PENDING", "RUNNING", "FAILED", "SUCCEEDED", "CLEANUP_PENDING"]);
const ATTEMPT_STAGES = Object.freeze([
  "VALIDATE",
  "FETCH",
  "STAGE",
  "DOCUMENT_CREATE",
  "WORKSPACE_ATTACH",
  "VERIFY",
  "COMMIT",
  "CLEANUP",
]);
const RESTRICTED_WORKSPACE_STATES = Object.freeze(["ACTIVE", "FROZEN", "RETIRED"]);
const OAUTH_TRANSACTION_STATES = Object.freeze(["PENDING", "CONFIRMED", "EXPIRED", "CANCELLED"]);

const TRANSITIONS = Object.freeze({
  PENDING: ["FETCHING", "AUTH_REQUIRED", "FAILED", "PENDING_CLEANUP"],
  FETCHING: ["STAGED", "AUTH_REQUIRED", "FAILED", "PENDING_CLEANUP"],
  STAGED: ["DOCUMENT_CREATED", "AUTH_REQUIRED", "FAILED", "PENDING_CLEANUP"],
  DOCUMENT_CREATED: ["ATTACHING", "AUTH_REQUIRED", "FAILED", "PENDING_CLEANUP"],
  ATTACHING: ["VERIFYING", "AUTH_REQUIRED", "FAILED", "PENDING_CLEANUP"],
  VERIFYING: ["VERIFIED", "AUTH_REQUIRED", "FAILED", "BLOCKED_DRIFT", "PENDING_CLEANUP"],
  VERIFIED: ["REVOKING", "SUPERSEDED", "AUTH_REQUIRED", "BLOCKED_DRIFT"],
  AUTH_REQUIRED: ["FETCHING", "VERIFYING", "FAILED", "REVOKING", "PENDING_CLEANUP"],
  FAILED: ["FETCHING", "PENDING_CLEANUP", "REVOKING"],
  BLOCKED_DRIFT: ["PENDING_CLEANUP", "REVOKING"],
  PENDING_CLEANUP: ["REMOVED"],
  REVOKING: ["PENDING_CLEANUP", "REMOVED"],
  REMOVED: [],
  SUPERSEDED: ["REVOKING", "PENDING_CLEANUP", "REMOVED"],
});

function assertKnownState(state) {
  if (!IMPORT_STATES.includes(state)) throw new Error("MGW_INVALID_IMPORT_STATE");
}

function nextGeneration(row) {
  if (!row) throw new Error("MGW_IMPORT_CONFLICT");
  if (row.status === "PENDING_CLEANUP" || row.cleanupDone !== true) throw new Error("MGW_CLEANUP_IN_PROGRESS");
  if (row.status !== "REMOVED") throw new Error("MGW_IMPORT_CONFLICT");
  if (!Number.isInteger(row.generation) || row.generation < 1) throw new Error("MGW_INVALID_GENERATION");
  return row.generation + 1;
}

function assertTransition(from, to) {
  assertKnownState(from);
  assertKnownState(to);
  if (from !== to && !TRANSITIONS[from].includes(to)) throw new Error("MGW_INVALID_STATE_TRANSITION");
  return true;
}

function decideResubmit(row) {
  if (!row || !IMPORT_STATES.includes(row.status)) throw new Error("MGW_INVALID_IMPORT_STATE");
  if (["PENDING_CLEANUP", "REVOKING"].includes(row.status)) return "MGW_CLEANUP_IN_PROGRESS";
  if (row.status === "VERIFIED") return "RETURN_EXISTING";
  if (["PENDING", "FETCHING", "STAGED", "DOCUMENT_CREATED", "ATTACHING", "VERIFYING"].includes(row.status))
    return "RETURN_IN_PROGRESS";
  if (row.status === "AUTH_REQUIRED") return "MGW_BUSINESS_AUTH_REQUIRED";
  if (row.status === "FAILED") return "RETRY";
  if (row.status === "REMOVED") return row.cleanupDone === true ? "NEW_GENERATION" : "MGW_CLEANUP_IN_PROGRESS";
  throw new Error("MGW_IMPORT_CONFLICT");
}

module.exports = {
  ACCESS_STATES,
  ATTEMPT_STAGES,
  ATTEMPT_STATES,
  BINDING_STATES,
  IMPORT_STATES,
  OAUTH_TRANSACTION_STATES,
  QUERY_RUN_STATES,
  RESTRICTED_WORKSPACE_STATES,
  assertTransition,
  decideResubmit,
  nextGeneration,
};
