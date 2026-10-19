const AUTH_TOKEN = "anythingllm_authToken";
const AUTH_USER = "anythingllm_user";
const AUTH_TIMESTAMP = "anythingllm_authTimestamp";
const SAFE_AUTH_MODES = new Set(["GATEWAY_ENABLED", "LOCAL_ONLY"]);
const SAFE_REASONS = new Set([
  "DEPENDENCY_NOT_READY",
  "CONFIG_INVALID",
  "RESULT_LOST",
  "AUTHENTICATION_REQUIRED",
  "SESSION_EXPIRED",
  "IDENTITY_UNAVAILABLE",
]);

function strictData(response, fields) {
  if (!response || typeof response.json !== "function")
    throw new Error("MGW_AUTH_UNAVAILABLE");
  return response.json().then((body) => {
    if (
      !response.ok ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !body.meta ||
      body.meta.schema_version !== "2.0" ||
      !body.data ||
      typeof body.data !== "object" ||
      Array.isArray(body.data) ||
      Object.keys(body.data).some((key) => !fields.includes(key)) ||
      fields.some((key) => !Object.hasOwn(body.data, key))
    ) {
      throw new Error(safeErrorCode(body));
    }
    return body.data;
  });
}

function safeErrorCode(body) {
  const code = body?.error?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code)
    ? code
    : "MGW_AUTH_UNAVAILABLE";
}

function isSafePublicUser(user) {
  if (!user || typeof user !== "object" || Array.isArray(user)) return false;
  const allowed = ["id", "username", "role", "displayName"];
  const validId =
    (typeof user.id === "string" && user.id.length > 0) ||
    (Number.isSafeInteger(user.id) && user.id > 0);
  return (
    Object.keys(user).every((key) => allowed.includes(key)) &&
    validId &&
    typeof user.username === "string" &&
    typeof user.role === "string" &&
    (user.displayName === undefined || typeof user.displayName === "string")
  );
}
function validIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isSafeAuthorizationUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Derives page affordances from the Consumer BFF's verified auth state.
 * This is presentation logic only; API authorization remains server-owned.
 */
export function resolveWeComView({
  authenticated = false,
  remoteAccessMode,
  available = false,
  reason = null,
} = {}) {
  const isAuthenticated = authenticated === true;
  const localOnly = isAuthenticated && remoteAccessMode === "LOCAL_ONLY";
  const gatewayEnabled =
    isAuthenticated && remoteAccessMode === "GATEWAY_ENABLED";
  // Null is the explicit legacy password/SimpleSSO mode. Keep its existing
  // meeting affordances; only Gateway modes receive new Gateway semantics.
  const legacySession = isAuthenticated && remoteAccessMode === null;
  const safeReason = SAFE_REASONS.has(reason) ? reason : null;

  let message = null;
  let nextAction = null;
  if (localOnly) {
    message = "认证结果丢失，仅可检索本地已有会议数据；重新扫码后恢复远端访问";
    nextAction = "RESCAN";
  } else if (!isAuthenticated && !available) {
    message =
      safeReason === "CONFIG_INVALID"
        ? "企业微信扫码登录配置无效，请联系系统管理员"
        : "企业微信扫码登录暂不可用：认证服务尚未就绪";
    nextAction = "RETRY_LATER";
  } else if (!isAuthenticated) {
    message = "请使用企业微信扫码登录后访问会议数据";
    nextAction = "LOGIN";
  }

  return {
    canSearchLocal:
      isAuthenticated &&
      (SAFE_AUTH_MODES.has(remoteAccessMode) || legacySession),
    canFetchRemote: gatewayEnabled || legacySession,
    canStartWeCom: available === true,
    message,
    nextAction,
    authorizationUrl: null,
  };
}

export function storeWeComCompletion(completion, storage, now = Date.now()) {
  const user = completion?.user;
  const validUserId =
    (typeof user?.id === "string" && user.id.length > 0) ||
    (Number.isSafeInteger(user?.id) && user.id > 0);
  if (
    completion?.state !== "AUTHENTICATED" ||
    completion?.remoteAccessMode !== "GATEWAY_ENABLED" ||
    typeof completion?.localToken !== "string" ||
    completion.localToken.length === 0 ||
    !validIsoDate(completion?.expiresAt) ||
    Date.parse(completion.expiresAt) <= now ||
    !user ||
    !validUserId ||
    typeof user.username !== "string" ||
    !user.username.trim() ||
    user.role !== "default" ||
    !storage ||
    typeof storage.setItem !== "function"
  ) {
    throw new Error("MGW_AUTH_UNAVAILABLE");
  }

  const safeUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    ...(typeof user.displayName === "string"
      ? { displayName: user.displayName }
      : {}),
  };
  storage.setItem(AUTH_USER, JSON.stringify(safeUser));
  storage.setItem(AUTH_TOKEN, completion.localToken);
  storage.setItem(AUTH_TIMESTAMP, String(now));
  return { user: safeUser, expiresAt: completion.expiresAt };
}

export function createWeComAuthClient({
  fetchImpl = (...args) => fetch(...args),
  getAuthHeaders = () => ({}),
  navigate = (url) => window.location.assign(url),
  apiBase = "/api",
} = {}) {
  let csrfToken = null;
  const root = `${apiBase}/auth/wecom`;

  function request(path, { method = "GET", headers = {}, body } = {}) {
    return fetchImpl(`${root}/${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...getAuthHeaders(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body } : {}),
    });
  }

  return {
    async getConfig() {
      const data = await strictData(await request("config"), [
        "enabled",
        "available",
        "reason",
      ]);
      if (
        typeof data.enabled !== "boolean" ||
        typeof data.available !== "boolean" ||
        (data.reason !== null && typeof data.reason !== "string")
      ) {
        throw new Error("MGW_AUTH_UNAVAILABLE");
      }
      return data;
    },
    async start() {
      const data = await strictData(
        await request("start", { method: "POST", body: "{}" }),
        ["authorizationUrl", "expiresAt"]
      );
      if (
        !isSafeAuthorizationUrl(data.authorizationUrl) ||
        !validIsoDate(data.expiresAt)
      ) {
        throw new Error("MGW_AUTH_UNAVAILABLE");
      }
      navigate(data.authorizationUrl);
      return data;
    },
    async getState() {
      const data = await strictData(await request("state"), [
        "authenticated",
        "remoteAccessMode",
        "reason",
        "expiresAt",
        "user",
        "csrfToken",
      ]);
      if (
        typeof data.authenticated !== "boolean" ||
        (data.remoteAccessMode !== null &&
          !SAFE_AUTH_MODES.has(data.remoteAccessMode)) ||
        (data.reason !== null && typeof data.reason !== "string") ||
        (data.expiresAt !== null && !validIsoDate(data.expiresAt)) ||
        (data.csrfToken !== null && typeof data.csrfToken !== "string") ||
        (data.user !== null && !isSafePublicUser(data.user)) ||
        (data.authenticated &&
          (!data.user ||
            (data.remoteAccessMode !== null &&
              !SAFE_AUTH_MODES.has(data.remoteAccessMode))))
      ) {
        throw new Error("MGW_AUTH_UNAVAILABLE");
      }
      csrfToken = data.csrfToken;
      const { csrfToken: _csrf, ...publicState } = data;
      return publicState;
    },
    async completeFromCallback({ storage = window.localStorage } = {}) {
      let before;
      try {
        before = await this.getState();
      } catch {
        return {
          success: false,
          state: null,
          errorCode: "MGW_AUTH_UNAVAILABLE",
        };
      }
      if (!csrfToken)
        return {
          success: false,
          state: before,
          errorCode: "MGW_CSRF_REJECTED",
        };
      try {
        const data = await strictData(
          await request("complete", {
            method: "POST",
            headers: { "X-MGW-CSRF": csrfToken },
            body: "{}",
          }),
          ["state", "user", "localToken", "expiresAt", "remoteAccessMode"]
        );
        const saved = storeWeComCompletion(data, storage);
        return { success: true, state: data, ...saved };
      } catch {
        // The BFF may have consumed the one-time ticket before the response was
        // lost. Refresh state once; never resubmit completion or clear local auth.
        csrfToken = null;
        const state = await this.getState().catch(() => before);
        return { success: false, state, errorCode: "COMPLETION_FAILED" };
      }
    },
    async logout() {
      try {
        await this.getState();
        if (!csrfToken) return false;
        const response = await fetchImpl(`${apiBase}/auth/logout`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            ...getAuthHeaders(),
            "Content-Type": "application/json",
            "X-MGW-CSRF": csrfToken,
          },
          body: "{}",
        });
        csrfToken = null;
        return response.ok;
      } catch {
        csrfToken = null;
        return false;
      }
    },
  };
}
