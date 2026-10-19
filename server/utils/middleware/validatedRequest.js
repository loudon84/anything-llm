const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");
const { EncryptionManager } = require("../EncryptionManager");
const { decodeJWT } = require("../http");
const { UserMetaCache } = require("../userLocale");
const EncryptionMgr = new EncryptionManager();

async function validatedRequest(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;
  const authorization = request.header("Authorization");
  const signedClaims = decodeJWT(
    authorization ? authorization.split(" ")[1] : null
  );
  if (signedClaims?.session_id && !multiUserMode) {
    response.status(401).json({ error: "Invalid auth token." });
    return;
  }
  if (multiUserMode)
    return await validateMultiUserRequest(request, response, next);

  // When in development passthrough auth token for ease of development.
  // Or if the user simply did not set an Auth token or JWT Secret
  if (
    process.env.NODE_ENV === "development" ||
    !process.env.AUTH_TOKEN ||
    !process.env.JWT_SECRET
  ) {
    if (authorization && !(signedClaims?.id || signedClaims?.p)) {
      response.status(401).json({ error: "Invalid auth token." });
      return;
    }
    UserMetaCache.setFromRequest(request);
    response.locals.meetingAuthState = {
      authenticated: true,
      kind: "LEGACY_SINGLE_USER",
      actor: null,
      session: null,
      remoteAccessMode: null,
    };
    next();
    return;
  }

  if (!process.env.AUTH_TOKEN) {
    response.status(401).json({
      error: "You need to set an AUTH_TOKEN environment variable.",
    });
    return;
  }

  const auth = request.header("Authorization");
  const token = auth ? auth.split(" ")[1] : null;

  if (!token) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  const bcrypt = require("bcryptjs");
  const { p } = decodeJWT(token);

  if (p === null || !/\w{32}:\w{32}/.test(p)) {
    response.status(401).json({
      error: "Token expired or failed validation.",
    });
    return;
  }

  // Since the blame of this comment we have been encrypting the `p` property of JWTs with the persistent
  // encryptionManager PEM's. This prevents us from storing the `p` unencrypted in the JWT itself, which could
  // be unsafe. As a consequence, existing JWTs with invalid `p` values that do not match the regex
  // in ln:44 will be marked invalid so they can be logged out and forced to log back in and obtain an encrypted token.
  // This kind of methodology only applies to single-user password mode.
  if (
    !bcrypt.compareSync(
      EncryptionMgr.decrypt(p),
      bcrypt.hashSync(process.env.AUTH_TOKEN, 10)
    )
  ) {
    response.status(401).json({
      error: "Invalid auth credentials.",
    });
    return;
  }

  UserMetaCache.setFromRequest(request);
  response.locals.meetingAuthState = {
    authenticated: true,
    kind: "LEGACY_SINGLE_USER",
    actor: null,
    session: null,
    remoteAccessMode: null,
  };
  next();
}

async function validateMultiUserRequest(request, response, next) {
  const auth = request.header("Authorization");
  const token = auth ? auth.split(" ")[1] : null;

  if (!token) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  const valid = decodeJWT(token);
  if (!valid || !valid.id) {
    response.status(401).json({
      error: "Invalid auth token.",
    });
    return;
  }

  const user = await User.get({ id: valid.id });
  if (!user) {
    response.status(401).json({
      error: "Invalid auth for user.",
    });
    return;
  }

  if (user.suspended) {
    response.status(401).json({
      error: "User is suspended from system",
    });
    return;
  }

  if (valid.session_id) {
    const authService = request.app?.locals?.meetingWecomAuth;
    const tokenProof = requestCookie(request, "__Host-meeting_session");
    const proof = tokenProof?.slice((tokenProof || "").indexOf(".") + 1);
    if (!authService || !proof) {
      response.status(401).json({ error: "Invalid auth token." });
      return;
    }
    try {
      response.locals.meetingAuthState =
        await authService.getValidatedSessionActor({
          sessionId: valid.session_id,
          userId: Number(valid.id),
          credentialEpoch: valid.credential_epoch,
          browserProof: proof,
        });
    } catch {
      response.status(401).json({ error: "Invalid auth token." });
      return;
    }
  } else {
    response.locals.meetingAuthState = {
      authenticated: true,
      kind: "LEGACY_MULTI_USER",
      actor: { id: Number(user.id), userId: Number(user.id) },
      session: null,
      remoteAccessMode: null,
    };
  }

  response.locals.user = user;
  UserMetaCache.setFromRequest(request, user.id);
  next();
}

function requestCookie(request, name) {
  for (const part of String(request.header("Cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name)
      return part.slice(index + 1).trim();
  }
  return null;
}

module.exports = {
  validatedRequest,
};
