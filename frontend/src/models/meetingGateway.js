const SESSION_PATH = "/meeting-gateway/session";
const TOKEN_OR_SECRET_FIELD = /(?:access|refresh|gateway|tencent)?_?(?:token|secret|password)/i;
const SAFE_ERROR_CODES = new Set([
  "MGW_BUSINESS_AUTH_REQUIRED",
  "MGW_CONFIG_INVALID",
  "MGW_CSRF_REJECTED",
  "MGW_INPUT_INVALID",
  "MGW_LOGIN_REJECTED",
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

    const headers = {
      ...getAuthHeaders(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(requiresCsrf ? { "X-Meeting-CSRF": csrfToken } : {}),
    };
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      credentials: "same-origin",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const dto = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (requiresCsrf && [401, 403].includes(response.status)) csrfToken = null;
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
