const { MeetingError } = require("./errors");

const MIN_QUERY_LENGTH = 2;

function getOaPeopleBaseUrl({ env = process.env } = {}) {
  const value = String(env.MEETING_OA_PEOPLE_BASE_URL || "").trim();
  return value || null;
}

function mapPerson(row) {
  if (!row || typeof row !== "object") return null;
  const fd_no = String(row.fd_no ?? row.fdNo ?? row.id ?? "").trim();
  const fd_name = String(row.fd_name ?? row.fdName ?? row.name ?? "").trim();
  const fd_department = String(
    row.fd_department ?? row.fdDepartment ?? row.department ?? ""
  ).trim();
  if (!fd_name) return null;
  return { fd_no, fd_name, fd_department };
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "people", "result", "results", "rows", "list"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

/**
 * Proxy OA people search. Never logs or returns upstream credentials.
 *
 * @param {{ query: string, baseUrl?: string|null, fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<Array<{ fd_no: string, fd_name: string, fd_department: string }>>}
 */
async function searchPeople({
  query,
  baseUrl,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const q = String(query ?? "").trim();
  if (q.length < MIN_QUERY_LENGTH) {
    throw new MeetingError(
      `OA people query must be at least ${MIN_QUERY_LENGTH} characters`,
      "INVALID_OA_QUERY",
      400
    );
  }

  const configured =
    baseUrl != null && String(baseUrl).trim()
      ? String(baseUrl).trim()
      : getOaPeopleBaseUrl({ env });
  if (!configured) {
    throw new MeetingError(
      "OA people search is not configured",
      "OA_NOT_CONFIGURED",
      503
    );
  }

  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new MeetingError(
      "OA people search is not configured",
      "OA_NOT_CONFIGURED",
      503
    );
  }
  url.searchParams.set("fd_name", q);

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new MeetingError(
      "OA people search is temporarily unavailable",
      "OA_UNAVAILABLE",
      502
    );
  }

  if (!response?.ok) {
    throw new MeetingError(
      "OA people search is temporarily unavailable",
      "OA_UNAVAILABLE",
      502
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new MeetingError(
      "OA people search returned an invalid response",
      "OA_INVALID_RESPONSE",
      502
    );
  }

  return extractRows(payload)
    .map(mapPerson)
    .filter(Boolean);
}

module.exports = {
  searchPeople,
  getOaPeopleBaseUrl,
  mapPerson,
  MIN_QUERY_LENGTH,
};
