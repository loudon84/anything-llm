export function buildBaseHeaders(token, timezone, language) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-Timezone": timezone,
    "X-Language": language,
  };
}
