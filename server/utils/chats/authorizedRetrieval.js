function denial(admission) {
  const error = new Error(admission?.code || "MGW_BUSINESS_AUTH_REQUIRED");
  error.code = admission?.code || "MGW_BUSINESS_AUTH_REQUIRED";
  return error;
}

async function authorizedRetrieval({
  admission,
  assertStillValid,
  loadPinned,
  loadParsed,
  loadHistory,
  search,
  generate,
} = {}) {
  if (!admission || admission.allowed !== true) throw denial(admission);
  if (typeof assertStillValid === "function") await assertStillValid(admission);

  const pinned = typeof loadPinned === "function" ? await loadPinned() : [];
  const parsed = typeof loadParsed === "function" ? await loadParsed() : [];
  const history = typeof loadHistory === "function" ? await loadHistory() : [];
  const results = typeof search === "function" ? await search() : [];
  const context = { pinned, parsed, history, results };

  if (typeof generate !== "function") {
    if (typeof assertStillValid === "function") await assertStillValid(admission);
    return context;
  }

  if (typeof assertStillValid === "function") await assertStillValid(admission);
  return generate({ admission, context });
}

module.exports = { authorizedRetrieval };