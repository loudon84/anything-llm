const { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } = require("crypto");
const COOKIE_NAME = "__Host-meeting_bridge";
const AUTH_ERROR = "MGW_BUSINESS_AUTH_REQUIRED";
const CONTRACT_ERROR = "MGW_UPSTREAM_CONTRACT_ERROR";
function epochSeconds(value) {
  if (value instanceof Date) return value.getTime() / 1000;
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return number > 1e12 ? number / 1000 : number;
}
function computeDeadline({ now, msExpiry, mtExpiry, jwtExpiry }) {
  const values = [now, msExpiry, mtExpiry, jwtExpiry].map(epochSeconds);
  if (!values.every(Number.isFinite)) throw new Error(AUTH_ERROR);
  const [current, ms, mt, jwt] = values;
  const deadline = Math.min(current + 900, ms, mt, jwt);
  if (deadline <= current) throw new Error(AUTH_ERROR);
  return deadline;
}
function createSessionModule({ store, gateway, keyring, clock = () => Date.now(), origin, verifyJwt } = {}) {
  if (!store || !keyring || (typeof keyring.hmacKey !== "string" && !Buffer.isBuffer(keyring.hmacKey))) throw new Error("MGW_SESSION_CONFIG_INVALID");
  const activeKeyId = keyring.activeKeyId;
  const encryptionKey = keyring.keys && keyring.keys[activeKeyId];
  if (!activeKeyId || !Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32 || Buffer.byteLength(keyring.hmacKey) < 32) throw new Error("MGW_SESSION_CONFIG_INVALID");
  const nowSeconds = () => epochSeconds(clock());
  function mac(purpose, value) {
    return createHmac("sha256", keyring.hmacKey).update("meeting-gateway:" + purpose + ":", "utf8").update(value, "utf8").digest("hex");
  }
  function safeEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const a = Buffer.from(left, "hex"); const b = Buffer.from(right, "hex");
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  }
  function jwtClaims(jwt) {
    try {
      const claims = verifyJwt ? verifyJwt(jwt) : require("jsonwebtoken").verify(jwt, process.env.JWT_SECRET);
      if (!claims || !claims.id || !Number.isFinite(Number(claims.exp))) throw new Error(AUTH_ERROR);
      return claims;
    } catch (_error) { throw new Error(AUTH_ERROR); }
  }
  function assertOrigin(value) {
    if (typeof value !== "string" || !origin || value !== origin) throw new Error("MGW_CSRF_REJECTED");
  }
  function encrypt(payload, userId, opaque, keyId) {
    const nonce = randomBytes(12); const aad = Buffer.from(userId + ":" + opaque + ":" + keyId, "utf8");
    const cipher = createCipheriv("aes-256-gcm", keyring.keys[keyId], nonce); cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final(), cipher.getAuthTag()]);
    return { nonce, ciphertext };
  }
  function decrypt(row, opaque) {
    const key = keyring.keys[row.key_id]; if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error(AUTH_ERROR);
    const bytes = Buffer.from(row.ciphertext); if (bytes.length < 17) throw new Error(AUTH_ERROR);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.nonce));
    decipher.setAAD(Buffer.from(row.anything_user_id + ":" + opaque + ":" + row.key_id, "utf8"));
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString("utf8"));
  }
  function browserDto(row, csrfToken) {
    return { binding_status: "BOUND", expires_at: new Date(epochSeconds(row.session_expiry || row.gateway_expiry) * 1000).toISOString(), csrf_token: csrfToken };
  }
  async function persistBridgeSession(row) {
    try {
      return await store.createBridgeSession(row);
    } catch (error) {
      try { await store.revokeBridgeSession(row.id, new Date(nowSeconds() * 1000)); } catch (_cleanupError) {}
      throw error;
    }
  }
  async function login({ user, jwt, oldBridge, credentials, origin: requestOrigin } = {}) {
    assertOrigin(requestOrigin);
    if (!user || !Number.isInteger(Number(user.id)) || user.suspended || (typeof user.password !== "string" && user.password !== null && user.password !== undefined)) throw new Error(AUTH_ERROR);
    const claims = jwtClaims(jwt); if (Number(claims.id) !== Number(user.id)) throw new Error(AUTH_ERROR);
    if (!gateway || gateway.transportAvailable !== true || typeof gateway.accountLogin !== "function" || typeof gateway.exchange !== "function") throw new Error(CONTRACT_ERROR);
    const account = await gateway.accountLogin(credentials);
    const tokenExpiry = account && (account.expiresAt ?? account.expires_at);
    const msToken = account && (account.sessionToken ?? account.accessToken ?? account.access_token); const identity = account && account.binding;
    if (typeof msToken !== "string" || !msToken.startsWith("ms_") || !identity || !identity.orgId || !identity.memberId || !identity.userId || identity.memberRole !== "MEMBER") throw new Error(CONTRACT_ERROR);
    const existingBinding = await store.getBinding(user.id);
    if (existingBinding && (existingBinding.status !== "BOUND" || existingBinding.gateway_instance_id !== identity.gatewayInstanceId || existingBinding.gateway_org_id !== identity.orgId || existingBinding.gateway_member_id !== identity.memberId || existingBinding.gateway_user_id !== identity.userId)) throw new Error("MGW_IDENTITY_BINDING_CONFLICT");
    const rest = await gateway.exchange(msToken); const mtToken = rest && (rest.accessToken ?? rest.access_token);
    const mtExpiry = rest && (rest.expiresAt ?? rest.expires_at); if (typeof mtToken !== "string" || !mtToken.startsWith("mt_") || rest.resource !== gateway.resource || !rest.resource) throw new Error(CONTRACT_ERROR);
    const deadline = computeDeadline({ now: nowSeconds(), msExpiry: tokenExpiry, mtExpiry, jwtExpiry: claims.exp });
    const opaque = randomBytes(32).toString("base64url"); const csrfToken = mac("csrf-token", opaque);
    const binding = { anything_user_id: Number(user.id), gateway_instance_id: identity.gatewayInstanceId || null, gateway_org_id: String(identity.orgId), gateway_member_id: String(identity.memberId), gateway_user_id: String(identity.userId), identity_issuer: identity.issuer || "account-login-v1" };
    const encrypted = encrypt({ msToken, mtToken, refreshToken: rest.refreshToken || null, resource: rest.resource, scope: rest.scope, msExpiry: epochSeconds(tokenExpiry), mtExpiry: epochSeconds(mtExpiry), identity }, user.id, opaque, activeKeyId);
    const row = {
      id: randomUUID(), anything_user_id: Number(user.id), binding,
      session_binding_hmac: mac("bridge-id", opaque), jwt_binding_hmac: mac("jwt-binding", jwt),
      csrf_hmac: mac("csrf-value", csrfToken), credential_binding_hmac: mac("credential-binding", user.password || ""),
      ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, key_id: activeKeyId,
      ms_expiry: new Date(epochSeconds(tokenExpiry) * 1000), mt_expiry: new Date(epochSeconds(mtExpiry) * 1000),
      jwt_expiry: new Date(epochSeconds(claims.exp) * 1000), session_expiry: new Date(deadline * 1000),
      gateway_expiry: new Date(Math.min(epochSeconds(tokenExpiry), epochSeconds(mtExpiry)) * 1000),
      oldBridgeBindingHmac: oldBridge ? mac("bridge-id", oldBridge) : null,
    };
    await persistBridgeSession(row);
    return { cookie: { name: COOKIE_NAME, value: opaque, options: { httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: row.session_expiry } }, dto: browserDto(row, csrfToken) };
  }
  async function bindProjected({ user, jwt, oldBridge, account, rest, origin: requestOrigin } = {}) {
    assertOrigin(requestOrigin);
    if (!user || !Number.isInteger(Number(user.id)) || user.suspended || (typeof user.password !== "string" && user.password !== null && user.password !== undefined)) throw new Error(AUTH_ERROR);
    const claims = jwtClaims(jwt); if (Number(claims.id) !== Number(user.id)) throw new Error(AUTH_ERROR);
    const tokenExpiry = account && (account.expiresAt ?? account.expires_at);
    const msToken = account && (account.sessionToken ?? account.accessToken ?? account.access_token);
    const identity = account && account.binding;
    const mtToken = rest && (rest.accessToken ?? rest.access_token);
    const mtExpiry = rest && (rest.expiresAt ?? rest.expires_at);
    if (typeof msToken !== "string" || !msToken.startsWith("ms_") || typeof mtToken !== "string" || !mtToken.startsWith("mt_") ||
      !identity || !identity.gatewayInstanceId || !identity.orgId || !identity.memberId || !identity.userId || identity.memberRole !== "MEMBER" ||
      !rest || rest.resource !== gateway.resource || !rest.resource) throw new Error(CONTRACT_ERROR);
    const deadline = computeDeadline({ now: nowSeconds(), msExpiry: tokenExpiry, mtExpiry, jwtExpiry: claims.exp });
    const opaque = randomBytes(32).toString("base64url"); const csrfToken = mac("csrf-token", opaque);
    const binding = { anything_user_id: Number(user.id), gateway_instance_id: identity.gatewayInstanceId, gateway_org_id: String(identity.orgId), gateway_member_id: String(identity.memberId), gateway_user_id: String(identity.userId), identity_issuer: identity.issuer || "account-login-v1" };
    const encrypted = encrypt({ msToken, mtToken, refreshToken: rest.refreshToken || null, msExpiry: epochSeconds(tokenExpiry), mtExpiry: epochSeconds(mtExpiry), identity, resource: rest.resource, scope: rest.scope }, user.id, opaque, activeKeyId);
    const row = {
      id: randomUUID(), anything_user_id: Number(user.id), binding,
      session_binding_hmac: mac("bridge-id", opaque), jwt_binding_hmac: mac("jwt-binding", jwt),
      csrf_hmac: mac("csrf-value", csrfToken), credential_binding_hmac: mac("credential-binding", user.password || ""),
      ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, key_id: activeKeyId,
      ms_expiry: new Date(epochSeconds(tokenExpiry) * 1000), mt_expiry: new Date(epochSeconds(mtExpiry) * 1000),
      jwt_expiry: new Date(epochSeconds(claims.exp) * 1000), session_expiry: new Date(deadline * 1000),
      gateway_expiry: new Date(Math.min(epochSeconds(tokenExpiry), epochSeconds(mtExpiry)) * 1000),
      oldBridgeBindingHmac: oldBridge ? mac("bridge-id", oldBridge) : null,
    };
    await persistBridgeSession(row);
    return { cookie: { name: COOKIE_NAME, value: opaque, options: { httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: row.session_expiry } }, dto: browserDto(row, csrfToken) };
  }
  async function requireBridge({ user, jwt, cookie, csrf, origin: requestOrigin, mutation = false } = {}) {
    try {
      if (!user || user.suspended || (typeof user.password !== "string" && user.password !== null && user.password !== undefined) || typeof cookie !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return { allowed: false, code: AUTH_ERROR };
      const claims = jwtClaims(jwt); if (Number(claims.id) !== Number(user.id) || claims.exp <= nowSeconds()) return { allowed: false, code: AUTH_ERROR };
      if (mutation) assertOrigin(requestOrigin);
      const row = await store.findBridgeSessionByBinding(mac("bridge-id", cookie));
      if (!row || row.revoked_at || Number(row.anything_user_id) !== Number(user.id)) return { allowed: false, code: AUTH_ERROR };
      const deadline = epochSeconds(row.session_expiry || row.gateway_expiry); if (!Number.isFinite(deadline) || deadline <= nowSeconds()) return { allowed: false, code: AUTH_ERROR };
      if (!safeEqual(row.jwt_binding_hmac, mac("jwt-binding", jwt)) || !safeEqual(row.credential_binding_hmac, mac("credential-binding", user.password || ""))) return { allowed: false, code: AUTH_ERROR };
      const binding = await store.getBinding(user.id);
      if (!binding || binding.status !== "BOUND") return { allowed: false, code: AUTH_ERROR };
      const csrfToken = mac("csrf-token", cookie);
      if (!safeEqual(row.csrf_hmac, mac("csrf-value", csrfToken))) return { allowed: false, code: AUTH_ERROR };
      if (mutation && !safeEqual(row.csrf_hmac, mac("csrf-value", csrf || ""))) return { allowed: false, code: "MGW_CSRF_REJECTED" };
      const payload = decrypt(row, cookie);
      if (!payload.identity || payload.identity.gatewayInstanceId !== binding.gateway_instance_id || payload.identity.orgId !== binding.gateway_org_id || payload.identity.memberId !== binding.gateway_member_id || payload.identity.userId !== binding.gateway_user_id) return { allowed: false, code: AUTH_ERROR };
      return { allowed: true, code: null, bridgeId: row.id, expiresAt: deadline, csrfToken };
    } catch (error) { return { allowed: false, code: error.message === "MGW_CSRF_REJECTED" ? error.message : AUTH_ERROR }; }
  }
  async function credentialsForBridge({ user, jwt, cookie, csrf, origin: requestOrigin, mutation = false } = {}) {
    const access = await requireBridge({ user, jwt, cookie, csrf, origin: requestOrigin, mutation });
    if (!access.allowed) throw new Error(access.code || AUTH_ERROR);
    const row = await store.findBridgeSessionByBinding(mac("bridge-id", cookie));
    if (!row || row.revoked_at || Number(row.anything_user_id) !== Number(user.id)) throw new Error(AUTH_ERROR);
    const payload = decrypt(row, cookie);
    const mtExpiry = epochSeconds(payload.mtExpiry);
    if (!payload.identity || payload.identity.memberRole !== "MEMBER" || typeof payload.mtToken !== "string" || !payload.mtToken.startsWith("mt_") ||
      payload.resource !== gateway?.resource || !payload.resource || !Number.isFinite(mtExpiry) || mtExpiry <= nowSeconds()) throw new Error(AUTH_ERROR);
    return {
      accessToken: payload.mtToken,
      refreshToken: payload.refreshToken || null,
      expiresAt: new Date(mtExpiry * 1000).toISOString(),
      resource: payload.resource,
      scope: payload.scope,
      member: { gatewayInstanceId: payload.identity.gatewayInstanceId, orgId: payload.identity.orgId, memberId: payload.identity.memberId, userId: payload.identity.userId },
    };
  }
  async function revokeCurrent(cookie) {
    if (typeof cookie !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return false;
    const row = await store.findBridgeSessionByBinding(mac("bridge-id", cookie)); if (!row) return false;
    await store.revokeBridgeSession(row.id, new Date(nowSeconds() * 1000)); return true;
  }
  async function revokeUser(userId) {
    if (!Number.isInteger(Number(userId)) || Number(userId) < 1) return false;
    await store.revokeBinding(Number(userId), new Date(nowSeconds() * 1000)); return true;
  }
  return { bindProjected, browserDto, credentialsForBridge, login, requireBridge, revokeCurrent, revokeUser };
}
module.exports = { COOKIE_NAME, computeDeadline, createSessionModule };
