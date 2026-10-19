const SESSION_PATH = "/meeting-gateway/session";
const AUTH_USER = "anythingllm_user";
const AUTH_TOKEN = "anythingllm_authToken";
const AUTH_TIMESTAMP = "anythingllm_authTimestamp";
const TOKEN_OR_SECRET_FIELD =
  /(?:access|refresh|gateway|tencent)?_?(?:token|secret|password)/i;
const SAFE_ERROR_CODES = new Set([
  "MGW_BUSINESS_AUTH_REQUIRED",
  "MGW_CONFIG_INVALID",
  "MGW_CSRF_REJECTED",
  "MGW_INPUT_INVALID",
  "MGW_DEPENDENCY_NOT_READY",
  "MGW_LOGIN_REJECTED",
  "MGW_RATE_LIMITED",
  "MGW_IDENTITY_PROJECTION_FAILED",
  "MGW_OAUTH_ALREADY_PENDING",
  "MGW_OAUTH_CONFIRM_DENIED",
  "MGW_OAUTH_CONFIRM_IN_PROGRESS",
  "MGW_OAUTH_RECOVERY_REQUIRED",
  "MGW_OAUTH_START_REJECTED",
  "MGW_OAUTH_TRANSACTION_INVALID",
  "MGW_UPSTREAM_CONTRACT_ERROR",
  "MGW_UPSTREAM_UNAVAILABLE",
]);

function strictDto(dto, fields) {
  if (!dto || typeof dto !== "object" || Array.isArray(dto))
    throw new Error("MGW_UI_UNAVAILABLE");
  const allowed = new Set(fields);
  if (Object.keys(dto).some((key) => !allowed.has(key)))
    throw new Error("MGW_UI_UNAVAILABLE");
  return dto;
}

function sessionDto(dto) {
  strictDto(dto, ["binding_status", "expires_at", "csrf_token"]);
  if (
    !["BOUND", "AUTH_REQUIRED"].includes(dto.binding_status) ||
    typeof dto.expires_at !== "string" ||
    typeof dto.csrf_token !== "string" ||
    !dto.csrf_token.trim()
  ) {
    throw new Error("MGW_UI_UNAVAILABLE");
  }
  return dto;
}

function safeDto(dto) {
  if (!dto || typeof dto !== "object" || Array.isArray(dto))
    throw new Error("MGW_UI_UNAVAILABLE");
  if (Object.keys(dto).some((key) => TOKEN_OR_SECRET_FIELD.test(key)))
    throw new Error("MGW_UI_UNAVAILABLE");
  return dto;
}

function validIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function safeEmployeeUser(user) {
  const allowed = ["id", "username", "role", "displayName"];
  return (
    !!user &&
    typeof user === "object" &&
    !Array.isArray(user) &&
    Object.keys(user).every((key) => allowed.includes(key)) &&
    ((typeof user.id === "string" && user.id.length > 0) ||
      (Number.isSafeInteger(user.id) && user.id > 0)) &&
    typeof user.username === "string" &&
    !!user.username.trim() &&
    user.role === "default" &&
    (user.displayName === undefined || typeof user.displayName === "string")
  );
}

function employeeLoginDto(dto) {
  strictDto(dto, ["user", "localToken", "expiresAt", "remoteAccessMode"]);
  if (
    !safeEmployeeUser(dto.user) ||
    typeof dto.localToken !== "string" ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(dto.localToken) ||
    dto.localToken.startsWith("ms_") ||
    dto.localToken.startsWith("mt_") ||
    !validIsoDate(dto.expiresAt) ||
    Date.parse(dto.expiresAt) <= Date.now() ||
    dto.remoteAccessMode !== "GATEWAY_ENABLED"
  ) {
    throw new Error("MGW_UI_UNAVAILABLE");
  }
  return {
    user: {
      id: dto.user.id,
      username: dto.user.username,
      role: dto.user.role,
      ...(typeof dto.user.displayName === "string"
        ? { displayName: dto.user.displayName }
        : {}),
    },
    localToken: dto.localToken,
    expiresAt: dto.expiresAt,
    remoteAccessMode: dto.remoteAccessMode,
  };
}

export function storeEmployeeLogin(
  completion,
  storage = window.localStorage,
  now = Date.now()
) {
  const dto = employeeLoginDto(completion);
  if (!storage || typeof storage.setItem !== "function")
    throw new Error("MGW_UI_UNAVAILABLE");
  storage.setItem(AUTH_USER, JSON.stringify(dto.user));
  storage.setItem(AUTH_TOKEN, dto.localToken);
  storage.setItem(AUTH_TIMESTAMP, String(now));
  return {
    user: dto.user,
    expiresAt: dto.expiresAt,
    remoteAccessMode: dto.remoteAccessMode,
  };
}

export function resolveGatewayConnectionState({
  employeeAuthenticated = false,
  remoteAccessMode = null,
  connections = [],
  pendingExpiresAt = null,
  error = false,
  now = Date.now(),
} = {}) {
  let connectionStatus = "NOT_CONNECTED";
  if (error) connectionStatus = "FAILED";
  else if (remoteAccessMode !== "GATEWAY_ENABLED")
    connectionStatus = "AUTH_REQUIRED";
  else {
    const statuses = Array.isArray(connections)
      ? connections.map((item) => String(item?.status || "").toUpperCase())
      : [];
    if (statuses.includes("ACTIVE")) connectionStatus = "ACTIVE";
    else if (
      statuses.some((status) =>
        ["PENDING", "PENDING_CONFIRMATION", "AUTHORIZING"].includes(status)
      )
    )
      connectionStatus = "PENDING";
    else if (statuses.some((status) => ["EXPIRED", "TIMEOUT"].includes(status)))
      connectionStatus = "EXPIRED";
    else if (
      statuses.some((status) => ["CANCELLED", "CANCELED"].includes(status))
    )
      connectionStatus = "CANCELLED";
    else if (statuses.includes("FAILED")) connectionStatus = "FAILED";
    else if (
      pendingExpiresAt &&
      Number.isFinite(Date.parse(pendingExpiresAt))
    ) {
      connectionStatus =
        Date.parse(pendingExpiresAt) <= now ? "EXPIRED" : "PENDING";
    }
  }
  return {
    employeeAuthenticated: employeeAuthenticated === true,
    connectionStatus,
  };
}

export function parseTencentConnectionReturn(search = "") {
  try {
    const params = new URLSearchParams(search);
    if (
      [...params.keys()].length !== 1 ||
      params.getAll("connection_id").length !== 1
    )
      return null;
    const connectionId = params.get("connection_id");
    return /^[A-Za-z0-9_-]{1,128}$/.test(connectionId || "")
      ? connectionId
      : null;
  } catch {
    return null;
  }
}

function safeTencentAuthorizationUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const entries = [...url.searchParams.entries()];
    const keys = entries.map(([key]) => key);
    return (
      url.protocol === "https:" &&
      url.origin === "https://meeting.tencent.com" &&
      url.pathname === "/marketplace/authorize.html" &&
      !url.username &&
      !url.password &&
      keys.length === 4 &&
      new Set(keys).size === 4 &&
      ["corp_id", "sdk_id", "redirect_uri", "state"].every((key) =>
        url.searchParams.get(key)?.trim()
      )
    );
  } catch {
    return false;
  }
}

/** Opens a Gateway-provided Tencent authorization URL in the employee's browser. */
export async function openTencentAuthorization({
  startOAuth,
  browser = window,
} = {}) {
  if (typeof startOAuth !== "function" || !browser)
    throw new Error("MGW_UI_UNAVAILABLE");
  // Reserve the user-gesture popup before awaiting the same-origin BFF.
  const popup =
    typeof browser.open === "function"
      ? browser.open(
          "about:blank",
          "meeting-gateway-authorization",
          "popup,width=520,height=720"
        )
      : null;
  if (!popup) throw new Error("MGW_POPUP_BLOCKED");
  try {
    const result = await startOAuth();
    if (!safeTencentAuthorizationUrl(result?.authorization_url))
      throw new Error("MGW_UI_UNAVAILABLE");
    if (popup.closed) throw new Error("MGW_POPUP_BLOCKED");
    popup.location.replace(result.authorization_url);
    return { opened: true, popup, expiresAt: result.expires_at };
  } catch (error) {
    if (popup && !popup.closed) popup.close?.();
    throw error;
  }
}

/**
 * Browser client for the same-origin AnythingLLM BFF. CSRF state deliberately
 * lives in this client instance only and is recovered from the BFF on refresh.
 */
export function createMeetingGatewayClient({
  apiBase = "/api",
  fetchImpl = fetch,
  getAuthHeaders = () => ({}),
} = {}) {
  // Production callers pass the app's existing Bearer headers. This module
  // never reads, stores, or returns a Gateway/Tencent credential.
  let csrfToken = null;

  async function request(
    path,
    { method = "GET", body, requiresCsrf = false } = {}
  ) {
    if (requiresCsrf && !csrfToken) await bootstrapSession();

    let requestUrl = `${apiBase}${path}`;
    const currentOrigin = globalThis.window?.location?.origin;
    if (currentOrigin) {
      try {
        const resolved = new URL(requestUrl, currentOrigin);
        if (resolved.origin !== currentOrigin)
          throw new Error("MGW_UI_UNAVAILABLE");
        requestUrl = `${resolved.pathname}${resolved.search}`;
      } catch {
        throw new Error("MGW_UI_UNAVAILABLE");
      }
    }

    const headers = {
      ...getAuthHeaders(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(requiresCsrf ? { "X-Meeting-CSRF": csrfToken } : {}),
    };
    const response = await fetchImpl(requestUrl, {
      method,
      credentials: "same-origin",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const dto = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (requiresCsrf && [401, 403].includes(response.status))
        csrfToken = null;
      const code = SAFE_ERROR_CODES.has(dto?.error)
        ? dto.error
        : "MGW_UI_UNAVAILABLE";
      const error = new Error(code);
      error.status = response.status;
      throw error;
    }
    return dto;
  }

  async function bootstrapSession() {
    csrfToken = null;
    const dto = sessionDto(await request(SESSION_PATH));
    if (
      dto?.binding_status !== "BOUND" ||
      typeof dto?.csrf_token !== "string" ||
      !dto.csrf_token
    ) {
      csrfToken = null;
      return { binding_status: dto.binding_status, expires_at: dto.expires_at };
    }
    csrfToken = dto.csrf_token;
    return { binding_status: dto.binding_status, expires_at: dto.expires_at };
  }

  return Object.freeze({
    bootstrapSession,
    employeeLoginStatus: async () => {
      const dto = safeDto(
        await request("/meeting-gateway/employee-login/status")
      );
      strictDto(dto, ["available"]);
      if (typeof dto.available !== "boolean")
        throw new Error("MGW_UI_UNAVAILABLE");
      return { available: dto.available };
    },
    employeeLogin: async (account, password) => {
      if (typeof account !== "string" || typeof password !== "string")
        throw new Error("MGW_INPUT_INVALID");
      return employeeLoginDto(
        await request("/meeting-gateway/employee-login", {
          method: "POST",
          body: { account, password },
        })
      );
    },
    login: async (account, password) => {
      if (typeof account !== "string" || typeof password !== "string")
        throw new Error("MGW_INPUT_INVALID");
      const dto = sessionDto(
        await request(SESSION_PATH, {
          method: "POST",
          body: { account, password },
        })
      );
      csrfToken = dto.csrf_token;
      return { binding_status: dto.binding_status, expires_at: dto.expires_at };
    },
    listConnections: async () => {
      const dto = safeDto(await request("/meeting-gateway/connections"));
      if (!Array.isArray(dto.items)) throw new Error("MGW_UI_UNAVAILABLE");
      const items = dto.items.map((item) => {
        strictDto(item, ["id", "name", "status"]);
        if (
          typeof item.id !== "string" ||
          typeof item.name !== "string" ||
          typeof item.status !== "string"
        ) {
          throw new Error("MGW_UI_UNAVAILABLE");
        }
        return { id: item.id, name: item.name, status: item.status };
      });
      return { items };
    },
    startOAuth: async () => {
      const dto = safeDto(
        await request("/meeting-gateway/oauth/start", {
          method: "POST",
          body: {},
          requiresCsrf: true,
        })
      );
      strictDto(dto, ["authorization_url", "transaction_id", "expires_at"]);
      if (
        typeof dto.authorization_url !== "string" ||
        typeof dto.transaction_id !== "string" ||
        typeof dto.expires_at !== "string"
      ) {
        throw new Error("MGW_UI_UNAVAILABLE");
      }
      return {
        authorization_url: dto.authorization_url,
        transaction_id: dto.transaction_id,
        expires_at: dto.expires_at,
      };
    },
    confirmConnection: async (connectionId) => {
      const dto = safeDto(
        await request(
          `/meeting-gateway/connections/${encodeURIComponent(connectionId)}/confirm`,
          { method: "POST", body: {}, requiresCsrf: true }
        )
      );
      strictDto(dto, ["status"]);
      if (dto.status !== "ACTIVE") throw new Error("MGW_UI_UNAVAILABLE");
      return { status: dto.status };
    },
    revokeSession: async () => {
      const dto = safeDto(
        await request(SESSION_PATH, { method: "DELETE", requiresCsrf: true })
      );
      strictDto(dto, ["binding_status"]);
      if (dto.binding_status !== "AUTH_REQUIRED")
        throw new Error("MGW_UI_UNAVAILABLE");
      csrfToken = null;
      return { binding_status: dto.binding_status };
    },
    revokeBinding: async () => {
      const dto = safeDto(
        await request("/meeting-gateway/binding", {
          method: "DELETE",
          requiresCsrf: true,
        })
      );
      strictDto(dto, ["binding_status"]);
      if (dto.binding_status !== "AUTH_REQUIRED")
        throw new Error("MGW_UI_UNAVAILABLE");
      csrfToken = null;
      return { binding_status: dto.binding_status };
    },
  });
}
