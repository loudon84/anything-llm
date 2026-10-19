const crypto = require('node:crypto');

const REQUIRED_CASES = ['PHASE-AUTH-01', 'PHASE-LOCAL-02', 'PHASE-SCOPE-03'];
const SPEC_SHA256 = 'ff382298a2ef1fc18d9a0dd9af1901172116c96643887fb8e1080c1f2d09cfaf';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function evidenceDigest(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const { integrity, ...payload } = evidence;
  return crypto.createHash('sha256').update(canonical(payload)).digest('hex');
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function evaluatePhaseGate({ phase, evidence } = {}) {
  if (phase !== 'AUTH_LOCAL_SEARCH' || !isRecord(evidence) || evidence.phase !== phase || !Array.isArray(evidence.cases)) {
    return { status: 'BLOCKED', reason: 'MALFORMED_OR_UNSUPPORTED_EVIDENCE', caseResults: [] };
  }

  const byId = new Map();
  for (const item of evidence.cases) {
    if (!isRecord(item) || typeof item.caseId !== 'string' || byId.has(item.caseId)) {
      return { status: 'BLOCKED', reason: 'MALFORMED_OR_DUPLICATE_CASE', caseResults: [] };
    }
    byId.set(item.caseId, item);
  }
  if (REQUIRED_CASES.some((id) => !byId.has(id))) {
    return { status: 'BLOCKED', reason: 'PHASE_CASES_MISSING', caseResults: REQUIRED_CASES.map((caseId) => ({
      caseId, status: byId.has(caseId) ? byId.get(caseId).status : 'BLOCKED',
      reason: byId.has(caseId) ? undefined : 'CASE_EVIDENCE_MISSING',
    })) };
  }

  const actualDigest = evidenceDigest(evidence);
  const rootIdentities = evidence.identities;
  const identityShapeValid = isRecord(rootIdentities)
    && ['source', 'config', 'build', 'spec'].every((key) => typeof rootIdentities[key] === 'string' && rootIdentities[key].length > 0)
    && rootIdentities.spec.replace(/^sha256:/, '') === SPEC_SHA256;

  const caseResults = REQUIRED_CASES.map((caseId) => {
    const item = byId.get(caseId);
    let reason;
    let status = ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'].includes(item.status) ? item.status : 'BLOCKED';
    if (status === 'PASS' && (!isRecord(item.execution) || typeof item.execution.command !== 'string'
      || !item.execution.command.trim() || item.execution.exitCode !== 0)) {
      status = 'FAIL'; reason = 'EXECUTION_COMMAND_OR_EXIT_CODE_INVALID';
    }
    if (status === 'PASS' && (!identityShapeValid || canonical(item.identities) !== canonical(rootIdentities))) {
      status = 'FAIL'; reason = 'SOURCE_CONFIG_BUILD_OR_SPEC_MISMATCH';
    }
    if (status === 'PASS' && caseId === 'PHASE-AUTH-01') {
      const a = item.assertions;
      if (item.mode !== 'real' || !isRecord(a) || a.realWeCom !== true
        || a.gatewayOrigin !== 'https://copilot.superic.com:9999'
        || !nonempty(a.contractEvidenceRef) || !nonempty(a.profileEvidenceRef)
        || a.profileMatchesSubject !== true || a.profileActive !== true
        || a.projectionPersisted !== true || a.localSessionIssued !== true) {
        status = 'BLOCKED'; reason = 'REAL_GATEWAY_AUTH_EVIDENCE_REQUIRED';
      } else {
        // No trusted evidence provenance verifier exists in this repository. Caller-supplied
        // fields and hashes cannot prove that a real WeCom login/profile was observed.
        status = 'BLOCKED'; reason = 'REAL_AUTH_PROVENANCE_TRUST_UNAVAILABLE';
      }
    }
    if (status === 'PASS' && caseId === 'PHASE-LOCAL-02') {
      const a = item.assertions;
      if (!isRecord(a) || !Number.isInteger(a.localOnlyOutboundCount) || a.localOnlyOutboundCount < 0) {
        status = 'BLOCKED'; reason = 'LOCAL_ONLY_OUTBOUND_COUNT_MISSING';
      } else if (a.localOnlyOutboundCount !== 0) {
        status = 'FAIL'; reason = 'LOCAL_ONLY_OUTBOUND_REQUESTS_OBSERVED';
      } else if (a.localSearchAuthorized !== true) {
        status = 'FAIL'; reason = 'LOCAL_SEARCH_AUTHORIZATION_NOT_PROVEN';
      }
    }
    if (status === 'PASS' && caseId === 'PHASE-SCOPE-03') {
      if (!isRecord(item.assertions) || item.assertions.deferredImportDisposition !== 'DEFERRED_CURRENT_PHASE') {
        status = 'FAIL'; reason = 'DEFERRED_IMPORT_SCOPE_MISREPRESENTED';
      }
    }
    return { caseId, status, ...(reason ? { reason } : {}) };
  });

  const failed = caseResults.some((item) => item.status === 'FAIL');
  const allPassed = caseResults.every((item) => item.status === 'PASS');
  return {
    status: failed ? 'FAIL' : allPassed ? 'PASS' : 'BLOCKED',
    reason: failed ? 'PHASE_ASSERTION_FAILED' : allPassed ? null :
      caseResults.find((item) => item.status === 'BLOCKED' || item.status === 'SKIPPED').reason || 'REQUIRED_PHASE_CASE_NOT_PASSED',
    caseResults,
    deferredScope: { A_IMPORT: 'DEFERRED_CURRENT_PHASE', status: 'NOT_REQUIRED' },
    evidenceDigest: actualDigest,
  };
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = { evaluatePhaseGate, evidenceDigest, REQUIRED_CASES };
