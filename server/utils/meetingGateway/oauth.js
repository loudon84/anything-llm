const { randomUUID } = require("crypto");

const CONTRACT_ERROR = "MGW_UPSTREAM_CONTRACT_ERROR";
const START_REJECTED = "MGW_OAUTH_START_REJECTED";
const CONFIRM_DENIED = "MGW_OAUTH_CONFIRM_DENIED";

function validateAuthorizationConfig(config) {
  if (!config || ![config.corpId, config.sdkId, config.callbackUri].every((v) => typeof v === "string" && v.trim())) throw new Error(CONTRACT_ERROR);
  let callback;
  let consumerReturn;
  try {
    callback = new URL(config.callbackUri);
    consumerReturn = new URL(config.returnTo);
  } catch (_error) { throw new Error(CONTRACT_ERROR); }
  if (!config.applicationId || callback.protocol !== "https:" || callback.username || callback.password || callback.search || callback.hash ||
      callback.pathname !== `/callbacks/tencent/oauth/${encodeURIComponent(config.applicationId)}` || consumerReturn.protocol !== "https:" ||
      consumerReturn.username || consumerReturn.password || consumerReturn.search || consumerReturn.hash || consumerReturn.pathname !== "/api/meeting-gateway/oauth/return")
    throw new Error(CONTRACT_ERROR);
}

function validateAuthorizationUrl(value, { allowedPaths, config } = {}) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0)
    throw new Error(CONTRACT_ERROR);
  validateAuthorizationConfig(config);
  let url;
  try { url = new URL(value); } catch (_error) { throw new Error(START_REJECTED); }
  const queryEntries = Array.from(url.searchParams.entries());
  const queryKeys = queryEntries.map(([key]) => key);
  const allowedQueryKeys = new Set(["corp_id", "sdk_id", "redirect_uri", "state"]);
  const corps = url.searchParams.getAll("corp_id");
  const states = url.searchParams.getAll("state");
  const sdkIds = url.searchParams.getAll("sdk_id");
  const redirectUris = url.searchParams.getAll("redirect_uri");
  if (url.protocol !== "https:" || url.hostname !== "meeting.tencent.com" || url.username || url.password || url.port ||
      url.hash || !allowedPaths.includes(url.pathname) || queryEntries.length !== 4 || queryKeys.some((key) => !allowedQueryKeys.has(key)) || states.length !== 1 || !states[0].trim() ||
      corps.length !== 1 || corps[0] !== config.corpId || sdkIds.length !== 1 || sdkIds[0] !== config.sdkId ||
      redirectUris.length !== 1 || redirectUris[0] !== config.callbackUri) {
    throw new Error(START_REJECTED);
  }
  return value;
}

function createOAuthModule({ gateway, store, clock = () => Date.now(), enabled = false, allowedAuthorizationPaths, authorizationConfig } = {}) {
  const startingByBridge = new Set();
  const confirmingByTransaction = new Set();
  function nowDate() {
    const value = clock();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(typeof value === "number" ? value : value);
    if (!Number.isFinite(date.getTime())) throw new Error("MGW_INVALID_CLOCK");
    return date;
  }
  function epochMilliseconds(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string" && value.trim() && !Number.isFinite(Number(value))) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) return NaN;
    return number > 1e12 ? number : number * 1000;
  }
  function unknownWriteOutcome(error) {
    return error?.writeOutcome === "UNKNOWN" || error?.outcome === "UNKNOWN" || error?.retryPolicy === "RECOVERY";
  }
  function recoveryRequired() {
    const error = new Error("MGW_OAUTH_RECOVERY_REQUIRED");
    error.status = 202;
    error.retryPolicy = "RECOVERY";
    return error;
  }
  function assertAvailable() {
    validateAuthorizationConfig(authorizationConfig);
    if (!enabled || !authorizationConfig || !authorizationConfig.returnTo || !authorizationConfig.applicationId) throw new Error(CONTRACT_ERROR);
    if (!gateway || !store || typeof gateway.startAuthorization !== "function" ||
        typeof gateway.listConnections !== "function" || typeof gateway.confirmConnection !== "function" ||
        typeof store.getBinding !== "function" || typeof store.findPendingOAuthForBridge !== "function" || typeof store.createOAuthTransaction !== "function" ||
        typeof store.getOAuthTransactionForBridge !== "function" || typeof store.updateOAuthTransactionState !== "function" || typeof store.completeOAuthTransaction !== "function") {
      throw new Error(CONTRACT_ERROR);
    }
  }
  async function validateContext(ctx) {
    if (!ctx || !Number.isInteger(ctx.ownerUserId) || ctx.ownerUserId < 1 ||
        typeof ctx.bridgeSessionId !== "string" || !ctx.bridgeSessionId) throw new Error("MGW_BUSINESS_AUTH_REQUIRED");
    const binding = await store.getBinding(ctx.ownerUserId);
    if (!binding || binding.status !== "BOUND") throw new Error("MGW_BUSINESS_AUTH_REQUIRED");
    const gatewayMemberId = binding.gateway_member_id || binding.gatewayMemberId;
    if (typeof gatewayMemberId !== "string" || !gatewayMemberId) throw new Error("MGW_BUSINESS_AUTH_REQUIRED");
    const bridgeExpiresAt = epochMilliseconds(ctx.bridgeExpiresAt);
    if (!Number.isFinite(bridgeExpiresAt) || bridgeExpiresAt <= nowDate().getTime() || typeof ctx.gatewayAccessToken !== "string" || !ctx.gatewayAccessToken.startsWith("mt_")) throw new Error("MGW_BUSINESS_AUTH_REQUIRED");
    return { ...ctx, gatewayMemberId, bridgeDeadline: bridgeExpiresAt };
  }
  async function pendingFor(ctx, conflictCode = "MGW_OAUTH_ALREADY_PENDING") {
    const pending = await store.findPendingOAuthForBridge(ctx.bridgeSessionId);
    if (!pending) return null;
    if (pending.ownerUserId !== ctx.ownerUserId) throw new Error(conflictCode);
    const expiresAt = new Date(pending.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) throw new Error(CONTRACT_ERROR);
    if (expiresAt <= nowDate().getTime()) {
      await store.updateOAuthTransactionState(pending.id, "EXPIRED");
      return null;
    }
    return pending;
  }
  async function listConnections(ctx) {
    assertAvailable(); ctx = await validateContext(ctx);
    const connections = await gateway.listConnections({ gatewayAccessToken: ctx.gatewayAccessToken });
    if (!Array.isArray(connections)) throw new Error(CONTRACT_ERROR);
    return connections.filter((connection) => connection && connection.memberId === ctx.gatewayMemberId && connection.type === "THIRD_PARTY_OAUTH");
  }
  async function start(ctx) {
    assertAvailable(); ctx = await validateContext(ctx);
    if (startingByBridge.has(ctx.bridgeSessionId)) throw new Error("MGW_OAUTH_ALREADY_PENDING");
    startingByBridge.add(ctx.bridgeSessionId);
    try {
      if (await pendingFor(ctx)) throw new Error("MGW_OAUTH_ALREADY_PENDING");
      const existing = await gateway.listConnections({ gatewayAccessToken: ctx.gatewayAccessToken });
      if (!Array.isArray(existing)) throw new Error(CONTRACT_ERROR);
      const ownedOAuthConnections = existing.filter((item) => item?.memberId === ctx.gatewayMemberId && item?.type === "THIRD_PARTY_OAUTH");
      if (ownedOAuthConnections.length > 500 || ownedOAuthConnections.some((item) => typeof item.connectionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(item.connectionId))) throw new Error(START_REJECTED);
      const existingConnectionIds = [...new Set(ownedOAuthConnections.map((item) => item.connectionId))];
      const reservation = await store.createOAuthTransaction({
        transactionId: randomUUID(),
        ownerUserId: ctx.ownerUserId,
        bridgeSessionId: ctx.bridgeSessionId,
        expiresAt: new Date(Math.min(nowDate().getTime() + 60_000, ctx.bridgeDeadline)),
        state: "PENDING",
        existingConnectionIds,
      });
      try {
        const result = await gateway.startAuthorization({ ...ctx, applicationId: authorizationConfig.applicationId, returnTo: authorizationConfig.returnTo });
        if (!result || typeof result.authorizationUrl !== "string" || typeof result.transactionId !== "string" || !result.transactionId.trim())
          throw new Error(CONTRACT_ERROR);
        const authorizationUrl = validateAuthorizationUrl(result.authorizationUrl, { allowedPaths: allowedAuthorizationPaths, config: authorizationConfig });
        const gatewayExpiry = epochMilliseconds(result.expiresAt);
        const expiresAt = new Date(Math.min(gatewayExpiry, ctx.bridgeDeadline, nowDate().getTime() + 300_000));
        if (!Number.isFinite(gatewayExpiry) || expiresAt <= nowDate()) throw new Error(START_REJECTED);
        try {
          await store.completeOAuthTransaction(reservation.id, result.transactionId, expiresAt);
        } catch (_error) {
          throw recoveryRequired();
        }
        return { authorizationUrl, transactionId: result.transactionId, expiresAt: expiresAt.toISOString() };
      } catch (error) {
        if (unknownWriteOutcome(error)) throw recoveryRequired();
        if (error?.message === "MGW_OAUTH_RECOVERY_REQUIRED") throw error;
        await store.updateOAuthTransactionState(reservation.id, "CANCELLED").catch(() => {});
        throw error;
      }
    } finally {
      startingByBridge.delete(ctx.bridgeSessionId);
    }
  }
  async function confirm(ctx, connectionId) {
    assertAvailable(); ctx = await validateContext(ctx);
    if (typeof connectionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(connectionId)) throw new Error(CONFIRM_DENIED);
    const pending = await pendingFor(ctx, CONFIRM_DENIED);
    if (!pending) throw new Error(CONFIRM_DENIED);
    const transaction = await store.getOAuthTransactionForBridge(pending.transactionId, ctx.bridgeSessionId, ctx.ownerUserId);
    if (!transaction || transaction.state !== "PENDING" || new Date(transaction.expiresAt).getTime() <= nowDate().getTime()) throw new Error(CONFIRM_DENIED);
    if (confirmingByTransaction.has(transaction.id)) throw new Error("MGW_OAUTH_CONFIRM_IN_PROGRESS");
    confirmingByTransaction.add(transaction.id);
    try {
      const connections = await gateway.listConnections({ gatewayAccessToken: ctx.gatewayAccessToken });
      const connection = Array.isArray(connections) && connections.find((item) => item?.connectionId === connectionId);
      if (!connection || transaction.existingConnectionIds?.includes(connectionId) || connection.memberId !== ctx.gatewayMemberId || connection.type !== "THIRD_PARTY_OAUTH" || connection.status === "CORP_MISMATCH") throw new Error(CONFIRM_DENIED);
      if (connection.status === "PENDING_CONFIRMATION") {
        try {
          await gateway.confirmConnection({ gatewayAccessToken: ctx.gatewayAccessToken }, connectionId);
        } catch (error) {
          if (unknownWriteOutcome(error)) throw recoveryRequired();
          throw error;
        }
      } else if (connection.status !== "ACTIVE") {
        throw new Error(CONFIRM_DENIED);
      }
      const current = await gateway.listConnections({ gatewayAccessToken: ctx.gatewayAccessToken });
      const verified = Array.isArray(current) && current.find((item) => item?.connectionId === connectionId);
      if (!verified || verified.memberId !== ctx.gatewayMemberId || verified.type !== "THIRD_PARTY_OAUTH" || verified.status !== "ACTIVE") throw new Error(CONFIRM_DENIED);
      await store.updateOAuthTransactionState(transaction.id, "CONFIRMED");
      return verified;
    } finally {
      confirmingByTransaction.delete(transaction.id);
    }
  }
  return { contractConfirmed: enabled === true && Boolean(authorizationConfig?.returnTo && authorizationConfig?.callbackUri && authorizationConfig?.corpId && authorizationConfig?.sdkId), listConnections, start, confirm };
}

module.exports = { createOAuthModule, validateAuthorizationUrl };
