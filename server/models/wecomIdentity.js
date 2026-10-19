const crypto = require("node:crypto");

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const LOGIN_TRANSACTION_MAX_AGE_MS = 5 * 60 * 1000;

function error(code) {
  const result = new Error(code);
  result.code = code;
  return result;
}

function dateFromClock(clock) {
  const value = clock();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw error("MGW_INVALID_CLOCK");
  return date;
}

function opaque(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validIso(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const canonical = new Date(timestamp).toISOString();
  return value === canonical || value === canonical.replace(".000Z", "Z");
}

function validateProfile(profile, now) {
  const required = ["gatewayInstanceId", "orgId", "memberId", "userId", "issuer", "displayName"];
  if (!profile || required.some((key) => !opaque(profile[key])) || profile.active !== true ||
      !validIso(profile.identityExpiresAt) || Date.parse(profile.identityExpiresAt) <= now.getTime()) {
    throw error("MGW_IDENTITY_ASSERTION_INVALID");
  }
}

function digestTuple(profile) {
  return crypto.createHash("sha256")
    .update(JSON.stringify([profile.gatewayInstanceId, profile.orgId, profile.memberId]))
    .digest("hex");
}

function createWeComIdentityStore({ prisma, clock = () => new Date() } = {}) {
  if (!prisma || typeof prisma.$transaction !== "function") throw error("MGW_PRISMA_REQUIRED");
  const now = () => dateFromClock(clock);

  async function projectionInTransaction(tx, profile, timestamp) {
    const rows = await tx.$queryRawUnsafe(
      `SELECT b.*, u.password, u.role, u.suspended
       FROM meeting_gateway_bindings b
       JOIN users u ON u.id = b.anything_user_id
       WHERE b.gateway_instance_id = ? AND b.gateway_org_id = ? AND b.gateway_member_id = ?
       LIMIT 1`,
      profile.gatewayInstanceId, profile.orgId, profile.memberId
    );
    const existing = rows[0];
    if (existing) {
      if (Number(existing.suspended) !== 0 || existing.status !== "BOUND" || existing.gateway_active === false || Number(existing.gateway_active) === 0) {
        throw error("MGW_LOCAL_ACCOUNT_SUSPENDED");
      }
      if (existing.gateway_user_id !== profile.userId || existing.identity_issuer !== profile.issuer) {
        throw error("MGW_IDENTITY_BINDING_CONFLICT");
      }
      await tx.$executeRawUnsafe(
        `UPDATE meeting_gateway_bindings
         SET display_name = ?, gateway_active = 1, verified_at = ?, updated_at = ?
         WHERE id = ?`,
        profile.displayName, timestamp, timestamp, existing.id
      );
      const refreshed = await tx.$queryRawUnsafe(
        `SELECT b.*, u.id AS user_id, u.username, u.password, u.role, u.suspended
         FROM meeting_gateway_bindings b JOIN users u ON u.id = b.anything_user_id WHERE b.id = ?`,
        existing.id
      );
      return { user: userDto(refreshed[0]), binding: bindingDto(refreshed[0]), created: false };
    }

    const localHandle = `mgw_${digestTuple(profile).slice(0, 56)}`;
    await tx.$executeRawUnsafe(
      `INSERT INTO users (username, password, role, suspended, bio, createdAt, lastUpdatedAt)
       VALUES (?, NULL, 'default', 0, '', ?, ?)`,
      localHandle, timestamp, timestamp
    );
    const userRows = await tx.$queryRawUnsafe("SELECT id, username, password, role, suspended FROM users WHERE username = ? LIMIT 1", localHandle);
    const user = userRows[0];
    if (!user) throw error("MGW_IDENTITY_PROJECTION_FAILED");
    const bindingId = crypto.randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO meeting_gateway_bindings (
         id, anything_user_id, gateway_instance_id, gateway_org_id, gateway_member_id,
         gateway_user_id, identity_issuer, display_name, gateway_active, status,
         verified_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'BOUND', ?, ?, ?)`,
      bindingId, user.id, profile.gatewayInstanceId, profile.orgId, profile.memberId,
      profile.userId, profile.issuer, profile.displayName, timestamp, timestamp, timestamp
    );
    const bindingRows = await tx.$queryRawUnsafe(
      `SELECT b.*, u.id AS user_id, u.username, u.password, u.role, u.suspended
       FROM meeting_gateway_bindings b JOIN users u ON u.id = b.anything_user_id WHERE b.id = ?`,
      bindingId
    );
    return { user: userDto(bindingRows[0]), binding: bindingDto(bindingRows[0]), created: true };
  }

  async function upsertGatewayUserProjection({ profile } = {}) {
    const timestamp = now();
    validateProfile(profile, timestamp);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await prisma.$transaction((tx) => projectionInTransaction(tx, profile, timestamp));
      } catch (cause) {
        const existing = await findBindingByTuple(profile);
        if (existing) {
          if (Number(existing.suspended) !== 0 || existing.status !== "BOUND" || existing.gateway_active === false || Number(existing.gateway_active) === 0) {
            throw error("MGW_LOCAL_ACCOUNT_SUSPENDED");
          }
          if (existing.gateway_user_id !== profile.userId || existing.identity_issuer !== profile.issuer) throw error("MGW_IDENTITY_BINDING_CONFLICT");
          if (attempt === 2) return await prisma.$transaction((tx) => projectionInTransaction(tx, profile, timestamp));
          continue;
        }
        if (cause?.code === "MGW_LOCAL_ACCOUNT_SUSPENDED" || cause?.code === "MGW_IDENTITY_BINDING_CONFLICT" || cause?.code === "MGW_IDENTITY_ASSERTION_INVALID") throw cause;
        if (attempt === 2) throw cause;
      }
    }
    throw error("MGW_IDENTITY_PROJECTION_FAILED");
  }

  async function findBindingByTuple(profile) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT b.*, u.id AS user_id, u.username, u.password, u.role, u.suspended
       FROM meeting_gateway_bindings b JOIN users u ON u.id = b.anything_user_id
       WHERE b.gateway_instance_id = ? AND b.gateway_org_id = ? AND b.gateway_member_id = ? LIMIT 1`,
      profile.gatewayInstanceId, profile.orgId, profile.memberId
    );
    return rows[0] || null;
  }

  async function createLocalSession({ userId, bindingId, identityExpiresAt, authMethod, tokenHash = null, browserProofHash = null } = {}) {
    const timestamp = now();
    const identityExpiry = identityExpiresAt instanceof Date ? identityExpiresAt : new Date(identityExpiresAt);
    if (!Number.isInteger(userId) || !opaque(bindingId) || Number.isNaN(identityExpiry.getTime()) || identityExpiry <= timestamp || !opaque(authMethod)) {
      throw error("MGW_LOCAL_SESSION_INVALID");
    }
    const expiresAt = new Date(Math.min(timestamp.getTime() + SESSION_MAX_AGE_MS, identityExpiry.getTime()));
    const id = crypto.randomUUID();
    let credentialEpoch;
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe(
        `SELECT b.id, b.gateway_active, b.credential_epoch, b.status, u.suspended
         FROM meeting_gateway_bindings b JOIN users u ON u.id = b.anything_user_id
         WHERE b.id = ? AND b.anything_user_id = ? LIMIT 1`, bindingId, userId
      );
      const binding = rows[0];
      if (!binding || binding.status !== "BOUND" || Number(binding.suspended) !== 0 || Number(binding.gateway_active) !== 1) {
        throw error("MGW_LOCAL_ACCOUNT_SUSPENDED");
      }
      credentialEpoch = Number(binding.credential_epoch);
      await tx.$executeRawUnsafe(
        `INSERT INTO meeting_login_sessions (
          id, user_id, binding_id, credential_epoch, token_hash, browser_proof_hash,
          identity_expires_at, expires_at, remote_access_mode, auth_method, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GATEWAY_ENABLED', ?, ?)`,
        id, userId, bindingId, credentialEpoch, tokenHash, browserProofHash, identityExpiry, expiresAt, authMethod, timestamp
      );
    });
    return { id, userId, credentialEpoch, expiresAt, remoteAccessMode: "GATEWAY_ENABLED" };
  }

  async function getLocalSession({ sessionId, userId } = {}) {
    if (!opaque(sessionId) || !Number.isInteger(userId)) return null;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT s.*, b.credential_epoch AS current_binding_epoch, b.status AS binding_status,
              b.gateway_active, b.gateway_instance_id, b.gateway_org_id, b.gateway_member_id,
              b.gateway_user_id, b.identity_issuer, b.display_name, u.suspended AS user_suspended
       FROM meeting_login_sessions s
       JOIN meeting_gateway_bindings b ON b.id = s.binding_id
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.user_id = ? LIMIT 1`, sessionId, userId
    );
    return rows[0] || null;
  }

  async function markLocalOnly({ localSessionId, preloginTransactionId, reason = "AUTH_RESULT_LOST" } = {}) {
    if (!opaque(reason)) throw error("MGW_LOCAL_SESSION_INVALID");
    const timestamp = now();
    return prisma.$transaction(async (tx) => {
      let updated = 0;
      if (localSessionId) {
        updated += await tx.$executeRawUnsafe(
          `UPDATE meeting_login_sessions SET remote_access_mode = 'LOCAL_ONLY', local_only_reason = ?
           WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`, reason, localSessionId, timestamp
        );
      }
      if (preloginTransactionId) {
        updated += await tx.$executeRawUnsafe(
          `UPDATE meeting_sso_transactions SET remote_access_mode = 'LOCAL_ONLY', local_only_reason = ?
           WHERE transaction_id = ? AND state = 'PENDING' AND expires_at > ?`, reason, preloginTransactionId, timestamp
        );
      }
      return updated > 0;
    });
  }

  async function revokeLocalSession({ sessionId, userId } = {}) {
    if (!opaque(sessionId) || !Number.isInteger(userId)) return false;
    const timestamp = now();
    const updated = await prisma.$executeRawUnsafe(
      "UPDATE meeting_login_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
      timestamp, sessionId, userId
    );
    return updated === 1;
  }

  async function createLoginTransaction({
    transactionId,
    clientStateHash,
    browserProofHash,
    verifierCiphertext,
    verifierNonce,
    ticketCiphertext = null,
    ticketNonce = null,
    cryptoKeyId,
    expiresAt,
    localSessionId = null,
    remoteAccessMode = "GATEWAY_ENABLED",
  } = {}) {
    const timestamp = now();
    const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (![transactionId, clientStateHash, browserProofHash, cryptoKeyId].every(opaque) ||
        !Buffer.isBuffer(verifierCiphertext) || verifierCiphertext.length === 0 || !Buffer.isBuffer(verifierNonce) || verifierNonce.length !== 12 ||
        (ticketCiphertext !== null && (!Buffer.isBuffer(ticketCiphertext) || ticketCiphertext.length === 0)) ||
        (ticketNonce !== null && (!Buffer.isBuffer(ticketNonce) || ticketNonce.length !== 12)) ||
        (ticketCiphertext === null) !== (ticketNonce === null) ||
        !["GATEWAY_ENABLED", "LOCAL_ONLY"].includes(remoteAccessMode) || Number.isNaN(expiry.getTime()) ||
        expiry <= timestamp || expiry.getTime() > timestamp.getTime() + LOGIN_TRANSACTION_MAX_AGE_MS ||
        (localSessionId !== null && !opaque(localSessionId))) {
      throw error("MGW_SSO_TRANSACTION_INVALID");
    }
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO meeting_sso_transactions (
         id, transaction_id, local_session_id, client_state_hash, browser_proof_hash,
         verifier_ciphertext, verifier_nonce, ticket_ciphertext, ticket_nonce, crypto_key_id,
         expires_at, state, remote_access_mode, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      id, transactionId, localSessionId, clientStateHash, browserProofHash,
      verifierCiphertext, verifierNonce, ticketCiphertext, ticketNonce, cryptoKeyId,
      expiry, remoteAccessMode, timestamp
    );
    const rows = await prisma.$queryRawUnsafe("SELECT * FROM meeting_sso_transactions WHERE id = ? LIMIT 1", id);
    return rows[0] || null;
  }

  async function storeLoginResultTicket({ transactionId, ticketCiphertext, ticketNonce } = {}) {
    if (!opaque(transactionId) || !Buffer.isBuffer(ticketCiphertext) || ticketCiphertext.length === 0 || !Buffer.isBuffer(ticketNonce) || ticketNonce.length !== 12) throw error("MGW_SSO_TRANSACTION_INVALID");
    const timestamp = now();
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE meeting_sso_transactions SET ticket_ciphertext = ?, ticket_nonce = ?
       WHERE transaction_id = ? AND state = 'PENDING' AND expires_at > ? AND ticket_ciphertext IS NULL`,
      ticketCiphertext, ticketNonce, transactionId, timestamp
    );
    return updated === 1;
  }

  async function getLoginTransaction({ transactionId } = {}) {
    if (!opaque(transactionId)) return null;
    const rows = await prisma.$queryRawUnsafe("SELECT * FROM meeting_sso_transactions WHERE transaction_id = ? LIMIT 1", transactionId);
    return rows[0] || null;
  }

  async function consumeLoginTransaction({ transactionId } = {}) {
    if (!opaque(transactionId)) return null;
    const timestamp = now();
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE meeting_sso_transactions SET state = 'EXPIRED'
         WHERE transaction_id = ? AND state = 'PENDING' AND expires_at <= ?`, transactionId, timestamp
      );
      const updated = await tx.$executeRawUnsafe(
        `UPDATE meeting_sso_transactions SET state = 'CONSUMED', consumed_at = ?
         WHERE transaction_id = ? AND state = 'PENDING' AND expires_at > ? AND ticket_ciphertext IS NOT NULL`,
        timestamp, transactionId, timestamp
      );
      if (updated !== 1) return null;
      const rows = await tx.$queryRawUnsafe("SELECT * FROM meeting_sso_transactions WHERE transaction_id = ? LIMIT 1", transactionId);
      return rows[0] || null;
    });
  }

  return {
    consumeLoginTransaction,
    createLocalSession,
    createLoginTransaction,
    getLocalSession,
    getLoginTransaction,
    markLocalOnly,
    revokeLocalSession,
    storeLoginResultTicket,
    upsertGatewayUserProjection,
  };
}

function userDto(row) {
  return {
    id: Number(row.user_id ?? row.id),
    username: row.username,
    password: row.password ?? null,
    role: row.role,
    suspended: Number(row.suspended),
  };
}

function bindingDto(row) {
  return {
    id: row.id,
    anything_user_id: Number(row.anything_user_id),
    gateway_instance_id: row.gateway_instance_id,
    gateway_org_id: row.gateway_org_id,
    gateway_member_id: row.gateway_member_id,
    gateway_user_id: row.gateway_user_id,
    identity_issuer: row.identity_issuer,
    display_name: row.display_name,
    gateway_active: row.gateway_active,
    credential_epoch: Number(row.credential_epoch),
    status: row.status,
  };
}

module.exports = { createWeComIdentityStore };
