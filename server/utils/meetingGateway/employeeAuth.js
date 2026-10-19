const crypto = require("node:crypto");
const { SESSION_COOKIE_NAME } = require("./wecomAuth");

function createEmployeeAuthService({ gateway, identityStore, sessions, jwt, origin, isMultiUserMode = async () => true, clock = () => new Date() } = {}) {
  if (!gateway || !identityStore || !sessions || !jwt || typeof jwt.sign !== "function") throw new Error("MGW_AUTH_CONFIG_INVALID");
  function now() { const value = clock(); const date = value instanceof Date ? new Date(value) : new Date(value); if (Number.isNaN(date.getTime())) throw new Error("MGW_AUTH_CONFIG_INVALID"); return date; }
  async function login({ credentials, origin: requestOrigin, oldBridge } = {}) {
    if (!origin || requestOrigin !== origin) throw Object.assign(new Error("MGW_CSRF_REJECTED"), { code: "MGW_CSRF_REJECTED", status: 403 });
    if (await isMultiUserMode() !== true) throw Object.assign(new Error("MGW_DEPENDENCY_NOT_READY"), { code: "MGW_DEPENDENCY_NOT_READY", status: 503 });
    if (!credentials || typeof credentials.account !== "string" || !credentials.account.trim() || credentials.account.length > 200 || typeof credentials.password !== "string" || !credentials.password || credentials.password.length > 200) throw Object.assign(new Error("MGW_INPUT_INVALID"), { code: "MGW_INPUT_INVALID", status: 422 });
    if (gateway.transportAvailable !== true) throw Object.assign(new Error("MGW_DEPENDENCY_NOT_READY"), { code: "MGW_DEPENDENCY_NOT_READY", status: 503 });
    const account = await gateway.accountLogin(credentials);
    if (account?.binding?.memberRole !== "MEMBER" || typeof account.sessionToken !== "string" || !account.sessionToken.startsWith("ms_")) throw Object.assign(new Error("MGW_UPSTREAM_CONTRACT_ERROR"), { code: "MGW_UPSTREAM_CONTRACT_ERROR", status: 503 });
    const rest = await gateway.exchange(account.sessionToken);
    if (typeof rest?.accessToken !== "string" || !rest.accessToken.startsWith("mt_") || rest.resource !== gateway.resource) throw Object.assign(new Error("MGW_UPSTREAM_CONTRACT_ERROR"), { code: "MGW_UPSTREAM_CONTRACT_ERROR", status: 503 });
    const profile = account.binding;
    const projected = await identityStore.upsertGatewayUserProjection({ profile });
    if (!projected?.user || !Number.isInteger(Number(projected.user.id)) || !projected.binding?.id) throw Object.assign(new Error("MGW_IDENTITY_PROJECTION_FAILED"), { code: "MGW_IDENTITY_PROJECTION_FAILED", status: 503 });
    const proof = crypto.randomBytes(32).toString("base64url");
    let localSession;
    try {
      localSession = await identityStore.createLocalSession({
        userId: Number(projected.user.id), bindingId: projected.binding.id,
        identityExpiresAt: profile.identityExpiresAt, authMethod: "gateway_account",
        browserProofHash: crypto.createHash("sha256").update(proof).digest("hex"),
      });
      const expiresIn = Math.max(1, Math.floor((new Date(localSession.expiresAt).getTime() - now().getTime()) / 1000));
      const localToken = jwt.sign({
        id: projected.user.id, username: projected.user.username, role: projected.user.role,
        session_id: localSession.id, credential_epoch: localSession.credentialEpoch,
      }, expiresIn);
      const bridge = await sessions.bindProjected({ user: projected.user, jwt: localToken, oldBridge, account, rest, origin: requestOrigin });
      return {
        user: { id: projected.user.id, username: projected.user.username, role: projected.user.role, displayName: projected.binding.display_name },
        localToken, expiresAt: new Date(localSession.expiresAt).toISOString(), remoteAccessMode: "GATEWAY_ENABLED",
        sessionCookie: { name: SESSION_COOKIE_NAME, value: `${localSession.id}.${proof}`, options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: new Date(localSession.expiresAt) } },
        bridgeCookie: bridge.cookie, bridge: bridge.dto,
      };
    } catch (error) {
      if (localSession?.id) await identityStore.revokeLocalSession({ sessionId: localSession.id, userId: Number(projected.user.id) }).catch(() => {});
      throw error;
    }
  }
  return { login };
}
module.exports = { createEmployeeAuthService };
