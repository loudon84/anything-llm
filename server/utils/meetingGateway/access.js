const AUTH_REQUIRED = "MGW_BUSINESS_AUTH_REQUIRED";
const ACCESS_UNAVAILABLE = "MGW_ACCESS_STATE_UNAVAILABLE";
const ACCESS_INVALID = "MGW_ACCESS_STATE_INVALID";

function epochSeconds(value) {
  if (value instanceof Date) return value.getTime() / 1000;
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return number > 1e12 ? number / 1000 : number;
}

function ownerId(policy) {
  return Number(policy?.owner_user_id ?? policy?.ownerUserId);
}

function userId(actor) {
  return Number(actor?.userId ?? actor?.id);
}

function createAccessModule({ store, gateway = null, sessions, clock = () => Date.now() } = {}) {
  if (!store || typeof store.policyByWorkspace !== "function") throw new Error("MGW_ACCESS_CONFIG_INVALID");

  function nowSeconds() {
    return epochSeconds(clock());
  }

  async function loadWorkspaceState(workspaceId) {
    if (typeof store.getWorkspaceImports !== "function") throw new Error(ACCESS_UNAVAILABLE);
    const imports = await store.getWorkspaceImports(Number(workspaceId));
    if (!Array.isArray(imports)) throw new Error(ACCESS_UNAVAILABLE);
    if (imports.some((item) => !item || item.access_state !== "VALID")) throw new Error(ACCESS_INVALID);
  }

  async function assertBridge(actor, bridge) {
    const actorUserId = userId(actor);
    if (!Number.isInteger(actorUserId) || actorUserId < 1 || actor?.kind !== "USER" ||
        !bridge || bridge.allowed !== true || typeof bridge.bridgeId !== "string" || !bridge.bridgeId ||
        (bridge.userId !== undefined && Number(bridge.userId) !== actorUserId) ||
        epochSeconds(bridge.expiresAt) <= nowSeconds()) throw new Error(AUTH_REQUIRED);
    if (typeof sessions?.isBridgeCurrent !== "function") throw new Error(AUTH_REQUIRED);
    if (await sessions.isBridgeCurrent({ actor, bridge }) !== true) throw new Error(AUTH_REQUIRED);
    return actorUserId;
  }

  async function evaluate({ actor, workspaceId, bridge }) {
    const id = Number(workspaceId);
    if (!Number.isInteger(id) || id < 1) return { allowed: false, restricted: false, code: "MGW_WORKSPACE_NOT_FOUND" };
    let policy;
    try {
      policy = await store.policyByWorkspace(id);
    } catch (_error) {
      return { allowed: false, restricted: true, code: ACCESS_UNAVAILABLE };
    }
    if (!policy) return { allowed: true, restricted: false, workspaceId: id };
    if (policy.state !== "ACTIVE") return { allowed: false, restricted: true, code: ACCESS_INVALID };
    let actorUserId;
    try {
      actorUserId = await assertBridge(actor, bridge);
    } catch (_error) {
      return { allowed: false, restricted: true, code: AUTH_REQUIRED };
    }
    if (ownerId(policy) !== actorUserId) return { allowed: false, restricted: true, code: "MGW_RESOURCE_NOT_ACCESSIBLE" };
    try {
      await loadWorkspaceState(id);
    } catch (error) {
      return { allowed: false, restricted: true, code: error.message === ACCESS_INVALID ? ACCESS_INVALID : ACCESS_UNAVAILABLE };
    }
    return {
      allowed: true,
      restricted: true,
      workspaceId: id,
      ownerUserId: actorUserId,
      policyEpoch: Number(policy.policy_epoch ?? policy.policyEpoch),
      bridgeId: bridge.bridgeId,
      expiresAt: epochSeconds(bridge.expiresAt),
    };
  }

  async function admit(input) {
    return evaluate(input);
  }

  async function assertStillValid(admission) {
    if (!admission || admission.allowed !== true) throw new Error(admission?.code || AUTH_REQUIRED);
    if (!admission.restricted) return admission;
    const current = await evaluate({
      actor: { kind: "USER", userId: admission.ownerUserId },
      workspaceId: admission.workspaceId,
      bridge: { allowed: true, bridgeId: admission.bridgeId, expiresAt: admission.expiresAt },
    });
    if (!current.allowed || current.policyEpoch !== admission.policyEpoch || current.bridgeId !== admission.bridgeId)
      throw new Error(current.code || ACCESS_INVALID);
    return current;
  }

  return { admit, assertStillValid };
}

module.exports = { createAccessModule, ACCESS_INVALID, ACCESS_UNAVAILABLE };