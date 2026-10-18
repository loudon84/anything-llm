const SENSITIVE_KEY = /(?:authorization|password|passwd|secret|token|cookie|credential|client.?key|api.?key|auth.?code|state)/i;

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (url.search || url.hash) return `${url.origin}${url.pathname}?[REDACTED]`;
    return value;
  } catch (_error) {
    return value
      .replace(/([?&])[^\s#]+/g, "$1[REDACTED]")
      .replace(/#.*$/, "#[REDACTED]");
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(entry),
    ]));
  }
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return redactUrl(value);
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
      .replace(/(\b(?:password|secret|token|authorization)=)[^\s&]+/gi, "$1[REDACTED]");
  }
  return value;
}

module.exports = { redact };
