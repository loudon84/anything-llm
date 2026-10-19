const crypto = require("node:crypto");

const COOKIE_NAME = "__Host-meeting_login";
const SESSION_COOKIE_NAME = "__Host-meeting_session";
const LOGIN_TTL_MS = 5 * 60 * 1000;
const AUTH_REQUIRED = "MGW_BUSINESS_AUTH_REQUIRED";

function fail(code, status = 401) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function validOpaque(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    value.trim() === value &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function createWeComAuthService({
  gateway,
  store,
  jwt,
  getUser = null,
  isPasswordlessSingleUser = async () => false,
  clock = () => new Date(),
  origin,
  callbackUri,
  resultUri,
  cryptoConfig,
} = {}) {
  if (
    !store ||
    !gateway ||
    !jwt ||
    typeof jwt.sign !== "function" ||
    typeof jwt.verify !== "function"
  )
    throw fail("MGW_AUTH_CONFIG_INVALID", 503);
  const activeKeyId = cryptoConfig?.activeKeyId;
  const keyring = cryptoConfig?.keys;
  const cryptoReady = Boolean(
    validOpaque(activeKeyId) &&
    Buffer.isBuffer(keyring?.[activeKeyId]) &&
    keyring[activeKeyId].length === 32 &&
    Buffer.isBuffer(cryptoConfig?.hmacKey) &&
    cryptoConfig.hmacKey.length >= 32
  );
  function requireCrypto() {
    if (!cryptoReady) throw fail("MGW_DEPENDENCY_NOT_READY", 503);
  }
  const now = () => {
    const value = clock();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime()))
      throw fail("MGW_AUTH_CONFIG_INVALID", 503);
    return date;
  };
  const mac = (purpose, value) => {
    requireCrypto();
    return crypto
      .createHmac("sha256", cryptoConfig.hmacKey)
      .update(`wecom:${purpose}:`)
      .update(value)
      .digest("hex");
  };
  function assertOrigin(value) {
    if (!origin || value !== origin) throw fail("MGW_CSRF_REJECTED", 403);
  }
  function encrypt(value, aad, keyId = activeKeyId) {
    requireCrypto();
    const nonce = crypto.randomBytes(12);
    if (!Buffer.isBuffer(keyring[keyId]) || keyring[keyId].length !== 32)
      throw fail("MGW_AUTH_CONFIG_INVALID", 503);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyring[keyId], nonce);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([
      cipher.update(String(value), "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return { ciphertext, nonce };
  }
  function decrypt(ciphertext, nonce, aad, keyId) {
    requireCrypto();
    const bytes = Buffer.from(ciphertext);
    if (
      bytes.length < 17 ||
      !Buffer.isBuffer(keyring[keyId]) ||
      keyring[keyId].length !== 32
    )
      throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      keyring[keyId],
      Buffer.from(nonce)
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    try {
      return Buffer.concat([
        decipher.update(bytes.subarray(0, -16)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    }
  }
  function parsePreloginCookie(value) {
    if (!validOpaque(value)) throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    const split = value.indexOf(".");
    if (split < 1) throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    const transactionId = value.slice(0, split);
    const proof = value.slice(split + 1);
    if (!validOpaque(transactionId) || !/^[A-Za-z0-9_-]{43}$/.test(proof))
      throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    return { transactionId, proof };
  }

  async function start({
    origin: requestOrigin,
    currentLocalSession = null,
    browserProof = null,
  } = {}) {
    assertOrigin(requestOrigin);
    requireCrypto();
    const availability = gateway.getAvailability();
    if (!availability?.available || availability.enabled !== true)
      throw fail("MGW_DEPENDENCY_NOT_READY", 503);
    let localSessionId = null;
    let remoteAccessMode = "GATEWAY_ENABLED";
    if (currentLocalSession) {
      if (!validOpaque(browserProof)) throw fail(AUTH_REQUIRED);
      const local = await store.getLocalSession({
        sessionId: currentLocalSession.id,
        userId: Number(currentLocalSession.userId),
      });
      if (
        !validSessionRecord(local, Number(currentLocalSession.userId), now()) ||
        !safeEqual(local.browser_proof_hash, hash(browserProof))
      )
        throw fail(AUTH_REQUIRED);
      localSessionId = local.id;
      remoteAccessMode = local.remote_access_mode;
    }
    if (
      typeof callbackUri !== "string" ||
      !callbackUri.startsWith(origin + "/")
    )
      throw fail("MGW_AUTH_CONFIG_INVALID", 503);
    const state = crypto.randomBytes(32).toString("base64url");
    const proof = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const upstream = await gateway.startAuthentication({
      clientState: state,
      codeChallenge,
      redirectUri: callbackUri,
    });
    const timestamp = now();
    const expiresAt = new Date(
      Math.min(
        timestamp.getTime() + LOGIN_TTL_MS,
        Date.parse(upstream.expiresAt)
      )
    );
    if (
      !validOpaque(upstream.transactionId) ||
      !validOpaque(upstream.authorizationUrl) ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt <= timestamp
    )
      throw fail("MGW_UPSTREAM_CONTRACT_ERROR", 503);
    const encryptedVerifier = encrypt(
      verifier,
      upstream.transactionId + ":verifier"
    );
    const row = await store.createLoginTransaction({
      transactionId: upstream.transactionId,
      clientStateHash: hash(state),
      browserProofHash: hash(proof),
      verifierCiphertext: encryptedVerifier.ciphertext,
      verifierNonce: encryptedVerifier.nonce,
      cryptoKeyId: activeKeyId,
      expiresAt,
      localSessionId,
      remoteAccessMode,
    });
    if (!row) throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    const csrfToken = mac("csrf", upstream.transactionId + ":" + proof);
    return {
      authorizationUrl: upstream.authorizationUrl,
      expiresAt: expiresAt.toISOString(),
      csrfToken,
      browserState: state,
      cookie: {
        name: COOKIE_NAME,
        value: upstream.transactionId + "." + proof,
        options: {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          expires: expiresAt,
        },
      },
    };
  }

  async function callback({ cookie, clientState, resultTicket } = {}) {
    requireCrypto();
    const { transactionId, proof } = parsePreloginCookie(cookie);
    if (!validOpaque(clientState) || !validOpaque(resultTicket))
      throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    const transaction = await store.getLoginTransaction({ transactionId });
    if (
      !pendingTransaction(transaction, now()) ||
      !safeEqual(transaction.client_state_hash, hash(clientState)) ||
      !safeEqual(transaction.browser_proof_hash, hash(proof))
    )
      throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    const encryptedTicket = encrypt(
      resultTicket,
      transactionId + ":ticket",
      transaction.crypto_key_id
    );
    if (
      !(await store.storeLoginResultTicket({
        transactionId,
        ticketCiphertext: encryptedTicket.ciphertext,
        ticketNonce: encryptedTicket.nonce,
      }))
    )
      throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    return { status: 303, location: resultUri || origin + "/sso/wecom/result" };
  }

  async function complete({ origin: requestOrigin, cookie, csrf } = {}) {
    assertOrigin(requestOrigin);
    requireCrypto();
    const { transactionId, proof } = parsePreloginCookie(cookie);
    const expectedCsrf = mac("csrf", transactionId + ":" + proof);
    if (!safeEqual(expectedCsrf, csrf)) throw fail("MGW_CSRF_REJECTED", 403);
    const transaction = await store.consumeLoginTransaction({ transactionId });
    if (
      !consumedTransaction(transaction, now()) ||
      !transaction.ticket_ciphertext ||
      !safeEqual(transaction.browser_proof_hash, hash(proof))
    )
      throw fail("MGW_AUTH_TRANSACTION_INVALID", 409);
    const resultTicket = decrypt(
      transaction.ticket_ciphertext,
      transaction.ticket_nonce,
      transactionId + ":ticket",
      transaction.crypto_key_id
    );
    const codeVerifier = decrypt(
      transaction.verifier_ciphertext,
      transaction.verifier_nonce,
      transactionId + ":verifier",
      transaction.crypto_key_id
    );
    let identitySession;
    try {
      identitySession = await gateway.redeemAuthentication({
        transactionId,
        resultTicket,
        codeVerifier,
        redirectUri: callbackUri,
      });
    } catch (error) {
      if (transaction.local_session_id)
        await store.markLocalOnly({
          localSessionId: transaction.local_session_id,
          reason: "AUTH_RESULT_LOST",
        });
      throw error;
    }
    try {
      const profile = await gateway.fetchAuthenticatedProfile({
        identitySession,
      });
      const projected = await store.upsertGatewayUserProjection({ profile });
      const sessionProof = crypto.randomBytes(32).toString("base64url");
      const session = await store.createLocalSession({
        userId: projected.user.id,
        bindingId: projected.binding.id,
        identityExpiresAt: profile.identityExpiresAt,
        authMethod: "wecom",
        browserProofHash: hash(sessionProof),
      });
      const seconds = Math.max(
        1,
        Math.floor(
          (new Date(session.expiresAt).getTime() - now().getTime()) / 1000
        )
      );
      const localToken = jwt.sign(
        {
          id: projected.user.id,
          username: projected.user.username,
          role: projected.user.role,
          session_id: session.id,
          credential_epoch: session.credentialEpoch,
        },
        seconds
      );
      return {
        state: "AUTHENTICATED",
        user: {
          id: projected.user.id,
          username: projected.user.username,
          role: projected.user.role,
          displayName: projected.binding.display_name,
        },
        localToken,
        expiresAt: new Date(session.expiresAt).toISOString(),
        remoteAccessMode: "GATEWAY_ENABLED",
        sessionCookie: {
          name: SESSION_COOKIE_NAME,
          value: session.id + "." + sessionProof,
          options: {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            expires: new Date(session.expiresAt),
          },
        },
      };
    } catch (error) {
      if (transaction.local_session_id)
        await store.markLocalOnly({
          localSessionId: transaction.local_session_id,
          reason: "AUTH_RESULT_LOST",
        });
      throw error;
    }
  }

  async function isLegacyPasswordlessMode() {
    try {
      return (await isPasswordlessSingleUser()) === true;
    } catch {
      return false;
    }
  }

  async function getState({ localToken, browserProof, preloginCookie } = {}) {
    const preloginState = await getPreloginState(preloginCookie);
    if (!localToken) {
      if (!(await isLegacyPasswordlessMode())) return preloginState;
      return {
        ...preloginState,
        authenticated: true,
        remoteAccessMode: null,
        reason: null,
        expiresAt: null,
        user: null,
      };
    }
    let claims;
    try {
      claims = jwt.verify(localToken);
    } catch {
      return preloginState.csrfToken ? preloginState : unauthenticated();
    }
    if (!claims) return unauthenticated();
    if (claims.session_id && !cryptoReady) throw fail(AUTH_REQUIRED);
    if (!claims.session_id) {
      if (claims.id) {
        const user = getUser ? await getUser(Number(claims.id)) : null;
        if (getUser && (!user || user.suspended)) return unauthenticated();
        return {
          authenticated: true,
          remoteAccessMode: null,
          reason: null,
          expiresAt: claims.exp
            ? new Date(claims.exp * 1000).toISOString()
            : null,
          user: user
            ? { id: Number(user.id), username: user.username, role: user.role }
            : safeUser(claims),
          csrfToken: preloginState.csrfToken,
        };
      }
      if (claims.p)
        return {
          authenticated: true,
          remoteAccessMode: null,
          reason: null,
          expiresAt: claims.exp
            ? new Date(claims.exp * 1000).toISOString()
            : null,
          user: null,
          csrfToken: preloginState.csrfToken,
        };
      return unauthenticated();
    }
    const local = await store.getLocalSession({
      sessionId: claims.session_id,
      userId: Number(claims.id),
    });
    const timestamp = now();
    if (
      !validSessionRecord(local, Number(claims.id), timestamp) ||
      Number(claims.credential_epoch) !== Number(local.current_binding_epoch) ||
      !validOpaque(browserProof) ||
      !safeEqual(local.browser_proof_hash, hash(browserProof))
    ) {
      if (preloginState.csrfToken) return preloginState;
      throw fail(AUTH_REQUIRED);
    }
    let csrfToken = mac("logout", claims.session_id + ":" + browserProof);
    if (preloginCookie) {
      try {
        const pending = parsePreloginCookie(preloginCookie);
        const transaction = await store.getLoginTransaction({
          transactionId: pending.transactionId,
        });
        if (
          pendingTransaction(transaction, timestamp) &&
          safeEqual(transaction.browser_proof_hash, hash(pending.proof))
        ) {
          csrfToken = mac("csrf", pending.transactionId + ":" + pending.proof);
        }
      } catch {}
    }
    return {
      authenticated: true,
      remoteAccessMode: local.remote_access_mode,
      reason:
        local.remote_access_mode === "LOCAL_ONLY"
          ? local.local_only_reason || "AUTH_RESULT_LOST"
          : null,
      expiresAt: new Date(local.expires_at).toISOString(),
      user: safeUser(claims),
      csrfToken,
    };
  }

  async function getPreloginState(cookie) {
    if (!cookie) return unauthenticated();
    try {
      const { transactionId, proof } = parsePreloginCookie(cookie);
      const transaction = await store.getLoginTransaction({ transactionId });
      if (
        pendingTransaction(transaction, now()) &&
        safeEqual(transaction.browser_proof_hash, hash(proof))
      ) {
        return {
          ...unauthenticated(),
          csrfToken: mac("csrf", transactionId + ":" + proof),
        };
      }
    } catch {}
    return unauthenticated();
  }

  async function logout({
    localToken,
    browserProof,
    csrf,
    origin: requestOrigin,
  } = {}) {
    assertOrigin(requestOrigin);
    requireCrypto();
    let claims;
    try {
      claims = jwt.verify(localToken);
    } catch {
      throw fail(AUTH_REQUIRED);
    }
    if (!claims?.session_id || !Number.isInteger(Number(claims.id)))
      return { ...unauthenticated(), clearCookie: COOKIE_NAME };
    const local = await store.getLocalSession({
      sessionId: claims.session_id,
      userId: Number(claims.id),
    });
    if (
      !validSessionRecord(local, Number(claims.id), now()) ||
      Number(claims.credential_epoch) !== Number(local.current_binding_epoch)
    )
      throw fail(AUTH_REQUIRED);
    if (
      !validOpaque(browserProof) ||
      !safeEqual(local.browser_proof_hash, hash(browserProof))
    )
      throw fail("MGW_CSRF_REJECTED", 403);
    if (
      !csrf ||
      csrf !==
        mac("logout", claims.session_id + ":" + String(browserProof || ""))
    )
      throw fail("MGW_CSRF_REJECTED", 403);
    await store.revokeLocalSession({
      sessionId: claims.session_id,
      userId: Number(claims.id),
    });
    return {
      authenticated: false,
      remoteAccessMode: null,
      reason: null,
      expiresAt: null,
      user: null,
      csrfToken: null,
      clearCookie: COOKIE_NAME,
    };
  }

  async function getValidatedSessionActor({
    sessionId,
    userId,
    credentialEpoch,
    browserProof,
  } = {}) {
    if (!cryptoReady) throw fail(AUTH_REQUIRED);
    if (!validOpaque(sessionId) || !Number.isInteger(Number(userId)))
      throw fail(AUTH_REQUIRED);
    const local = await store.getLocalSession({
      sessionId,
      userId: Number(userId),
    });
    if (
      !validSessionRecord(local, Number(userId), now()) ||
      Number(local.credential_epoch) !== Number(local.current_binding_epoch) ||
      (browserProof !== undefined &&
        (!validOpaque(browserProof) ||
          !safeEqual(local.browser_proof_hash, hash(browserProof)))) ||
      (credentialEpoch !== undefined &&
        Number(credentialEpoch) !== Number(local.current_binding_epoch))
    )
      throw fail(AUTH_REQUIRED);
    return {
      authenticated: true,
      kind: "GATEWAY_SESSION",
      actor: {
        id: Number(userId),
        userId: Number(userId),
        username: local.username || null,
        role: local.role || "default",
      },
      session: {
        id: local.id,
        userId: Number(userId),
        credentialEpoch: Number(local.current_binding_epoch),
        expiresAt: new Date(local.expires_at).toISOString(),
        remoteAccessMode: local.remote_access_mode,
      },
    };
  }

  async function getRequestAuthState({ localToken, browserProof } = {}) {
    const state = await getState({ localToken, browserProof });
    if (!state.authenticated)
      return {
        authenticated: false,
        kind: "UNAUTHENTICATED",
        actor: null,
        session: null,
        remoteAccessMode: null,
      };
    let claims = null;
    try {
      claims = jwt.verify(localToken);
    } catch {}
    if (claims?.session_id) {
      const trusted = await getValidatedSessionActor({
        sessionId: claims.session_id,
        userId: Number(claims.id),
        credentialEpoch: claims.credential_epoch,
        browserProof,
      });
      return {
        authenticated: true,
        ...trusted,
        remoteAccessMode: trusted.session.remoteAccessMode,
      };
    }
    return {
      authenticated: true,
      kind: claims?.id ? "LEGACY_MULTI_USER" : "LEGACY_SINGLE_USER",
      actor: claims?.id
        ? { id: Number(claims.id), userId: Number(claims.id) }
        : null,
      session: null,
      remoteAccessMode: null,
    };
  }

  function getConfig() {
    const availability = gateway.getAvailability?.() || {
      available: false,
      enabled: false,
      reason: "DEPENDENCY_NOT_READY",
    };
    const ready =
      cryptoReady &&
      availability.enabled === true &&
      availability.available === true;
    return {
      enabled: cryptoReady && availability.enabled === true,
      available: ready,
      reason: ready
        ? null
        : !cryptoReady
          ? "DEPENDENCY_NOT_READY"
          : availability.reason || "DEPENDENCY_NOT_READY",
    };
  }
  function validSessionRecord(row, userId, timestamp) {
    return Boolean(
      row &&
      Number(row.user_id ?? row.userId) === userId &&
      !row.revoked_at &&
      Number(row.user_suspended) === 0 &&
      row.binding_status === "BOUND" &&
      Number(row.gateway_active) === 1 &&
      Number(row.current_binding_epoch) === Number(row.credential_epoch) &&
      ["GATEWAY_ENABLED", "LOCAL_ONLY"].includes(row.remote_access_mode) &&
      new Date(row.expires_at).getTime() > timestamp.getTime() &&
      new Date(row.identity_expires_at || row.expires_at).getTime() >
        timestamp.getTime()
    );
  }
  function pendingTransaction(row, timestamp) {
    return Boolean(
      row &&
      row.state === "PENDING" &&
      new Date(row.expires_at).getTime() > timestamp.getTime()
    );
  }
  function consumedTransaction(row, timestamp) {
    return Boolean(
      row &&
      row.state === "CONSUMED" &&
      new Date(row.expires_at).getTime() > timestamp.getTime()
    );
  }
  function safeUser(claims) {
    const user = {
      id: Number(claims.id),
      username: String(claims.username || ""),
    };
    if (typeof claims.role === "string") user.role = claims.role;
    if (typeof claims.displayName === "string")
      user.displayName = claims.displayName;
    return user;
  }
  function unauthenticated() {
    return {
      authenticated: false,
      remoteAccessMode: null,
      reason: null,
      expiresAt: null,
      user: null,
      csrfToken: null,
    };
  }

  return {
    assertSameOrigin: assertOrigin,
    callback,
    complete,
    getConfig,
    getRequestAuthState,
    getState,
    getValidatedSessionActor,
    hashBrowserProof: hash,
    logout,
    start,
  };
}

module.exports = { COOKIE_NAME, SESSION_COOKIE_NAME, createWeComAuthService };
