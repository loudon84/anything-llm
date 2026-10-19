'use strict';

const fs = require('node:fs');

const BUSINESS_REQUIREMENT_PREFIXES = [
  'CONF-001', 'IDENT-001', 'AUTH-001', 'AUTH-002',
  'OAUTH-001', 'OAUTH-002', 'OAUTH-003', 'UI-001',
  'SOURCE-001', 'SOURCE-002', 'SOURCE-003', 'SOURCE-004',
  'CONTENT-001', 'CONTENT-002', 'FORMAT-001', 'IMPORT-001',
  'WORKSPACE-001', 'STATE-001', 'RETRY-001', 'SEC-001', 'SEC-002',
  'SEC-003', 'OBS-001', 'REMOVE-001', 'COMPAT-001',
];
const BUSINESS_REQUIRED_IDS = Object.freeze([
  ...BUSINESS_REQUIREMENT_PREFIXES.flatMap((prefix) => [
    `A-${prefix}-01`,
    `A-${prefix}-02`,
  ]),
  ...Array.from({ length: 10 }, (_, index) => {
    const revision = String(index + 1).padStart(3, '0');
    return [`A-REV-${revision}-01`, `A-REV-${revision}-02`];
  }).flat(),
]);
const GATE_META_IDS = Object.freeze(['A-TEST-001-01', 'A-TEST-001-02']);
const GOLDEN_IDS = Object.freeze(Array.from({ length: 8 }, (_, index) => `GC-${String(index + 1).padStart(2, '0')}`));
const RELEASE_GATE_IDS = Object.freeze(['G0', 'G1', 'G2', 'G3', 'G4']);
const EXPECTED_SCHEMA_VERSION = 'meeting-prd-evidence-v1';

function fail(code, detail) {
  return `${code}${detail ? `: ${detail}` : ''}`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256Digest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function addFailure(failures, condition, code, detail) {
  if (!condition) failures.push(fail(code, detail));
}

function exactIdSet(actual, expected, label, failures) {
  if (!Array.isArray(actual)) {
    failures.push(fail('MGW_GATE_INVALID_ID_LIST', `${label} must be an array`));
    return;
  }
  const duplicates = actual.filter((id, index) => actual.indexOf(id) !== index);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((id) => !actualSet.has(id));
  const unexpected = [...actualSet].filter((id) => !expectedSet.has(id));
  if (duplicates.length || missing.length || unexpected.length || actual.length !== expected.length) {
    failures.push(fail('MGW_GATE_ID_SET_MISMATCH', `${label}; missing=${missing.join(',') || 'none'}; duplicate=${[...new Set(duplicates)].join(',') || 'none'}; unexpected=${unexpected.join(',') || 'none'}`));
  }
}

function validateCandidateIdentity(manifest, failures) {
  addFailure(failures, isNonEmptyString(manifest.candidate_build_id), 'MGW_GATE_MANIFEST_INVALID', 'candidate_build_id is required');
  addFailure(failures, isNonEmptyString(manifest.candidate_run_id), 'MGW_GATE_MANIFEST_INVALID', 'candidate_run_id is required');
  addFailure(failures, isNonEmptyString(manifest.configuration_digest), 'MGW_GATE_MANIFEST_INVALID', 'configuration_digest is required');
  addFailure(failures, isNonEmptyString(manifest.schema_version), 'MGW_GATE_MANIFEST_INVALID', 'schema_version is required');
  addFailure(failures, manifest.source_revisions &&
    isNonEmptyString(manifest.source_revisions.anythingllm) &&
    isNonEmptyString(manifest.source_revisions.gateway), 'MGW_GATE_MANIFEST_INVALID', 'both source revisions are required');
}

function expectedRequirementsForAcceptance(id) {
  const revisionMatch = /^A-REV-(\d{3})-0[12]$/.exec(id);
  if (!revisionMatch) {
    const baseMatch = /^A-([A-Z]+-\d{3})-0[12]$/.exec(id);
    return baseMatch ? [`REQ-${baseMatch[1]}`] : [];
  }
  const requirementsByRevision = {
    '001': ['REQ-WORKSPACE-001', 'REQ-SEC-001'],
    '002': ['REQ-SEC-002'],
    '003': ['REQ-AUTH-001', 'REQ-IDENT-001'],
    '004': ['REQ-IMPORT-001', 'REQ-RETRY-001'],
    '005': ['REQ-STATE-001', 'REQ-REMOVE-001'],
    '006': ['REQ-FORMAT-001', 'REQ-STATE-001'],
    '007': ['REQ-SOURCE-003'],
    '008': ['REQ-OAUTH-002', 'REQ-SEC-003'],
    '009': ['REQ-TEST-001'],
    '010': ['REQ-OBS-001', 'REQ-RETRY-001'],
  };
  return requirementsByRevision[revisionMatch[1]] || [];
}

function exactStringSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    new Set(actual).size === expected.length && expected.every((value) => actual.includes(value));
}

function validateAcEvidence(item, id, kind, manifest, failures) {
  const label = `${kind} ${id}`;
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    failures.push(fail('MGW_GATE_EVIDENCE_INVALID', `${label} must be an object`));
    return;
  }

  addFailure(failures, item.schema_version === EXPECTED_SCHEMA_VERSION, 'MGW_GATE_EVIDENCE_INVALID', `${label} schema_version`);
  addFailure(failures, item.acceptance_id === id, 'MGW_GATE_EVIDENCE_INVALID', `${label} acceptance_id`);
  addFailure(failures, item.status === 'PASS', 'MGW_GATE_EVIDENCE_NOT_PASS', `${label} status=${String(item.status)}`);
  addFailure(failures, item.exit_code === 0, 'MGW_GATE_EVIDENCE_NOT_PASS', `${label} exit_code must be 0`);
  addFailure(failures, exactStringSet(item.requirement_ids, expectedRequirementsForAcceptance(id)), 'MGW_GATE_EVIDENCE_INVALID', `${label} requirement_ids`);
  addFailure(failures, exactStringSet(item.test_ids, [`TEST-${id}`]), 'MGW_GATE_EVIDENCE_INVALID', `${label} test_ids`);
  addFailure(failures, isNonEmptyString(item.command), 'MGW_GATE_EVIDENCE_INVALID', `${label} command`);
  addFailure(failures, item.oracle && item.oracle.type === 'machine_assertion' &&
    isNonEmptyString(item.oracle.expression) && isNonEmptyString(item.oracle.expected) &&
    isNonEmptyString(item.oracle.actual) && item.oracle.actual.trim() === item.oracle.expected.trim(),
  'MGW_GATE_EVIDENCE_ORACLE_FAILED', `${label} oracle actual does not match expected`);
  addFailure(failures, isNonEmptyString(item.executed_at), 'MGW_GATE_EVIDENCE_INVALID', `${label} executed_at`);
  addFailure(failures, isSha256Digest(item.pre_digest), 'MGW_GATE_EVIDENCE_INVALID', `${label} pre_digest must be a SHA-256 hex digest`);
  addFailure(failures, isSha256Digest(item.post_digest), 'MGW_GATE_EVIDENCE_INVALID', `${label} post_digest must be a SHA-256 hex digest`);
  addFailure(failures, Array.isArray(item.evidence_files) && item.evidence_files.length > 0 &&
    item.evidence_files.every(isNonEmptyString), 'MGW_GATE_EVIDENCE_INVALID', `${label} evidence_files`);
  addFailure(failures, item.source_revisions &&
    item.source_revisions.anythingllm === manifest.source_revisions?.anythingllm &&
    item.source_revisions.gateway === manifest.source_revisions?.gateway, 'MGW_GATE_REVISION_MISMATCH', label);

  // These bindings are required at the evidence adapter boundary: §24.1 does
  // not currently define them, while §25.2 requires selected run IDs and exact
  // candidate build/configuration provenance.
  addFailure(failures, isNonEmptyString(item.run_id), 'MGW_GATE_EVIDENCE_INVALID', `${label} run_id binding`);
  addFailure(failures, item.candidate_build_id === manifest.candidate_build_id, 'MGW_GATE_BUILD_MISMATCH', label);
  addFailure(failures, item.configuration_digest === manifest.configuration_digest, 'MGW_GATE_CONFIG_MISMATCH', label);
}

function validateEvidenceGroup({ items, expectedIds, selectedRunIds, kind, manifest, failures }) {
  exactIdSet(Array.isArray(items) ? items.map((item) => item?.acceptance_id) : items, expectedIds, `${kind} evidence`, failures);
  exactIdSet(Object.keys(selectedRunIds || {}), expectedIds, `${kind} selectedEvidenceRunIds`, failures);

  const byId = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !expectedIds.includes(item.acceptance_id)) continue;
    if (byId.has(item.acceptance_id)) continue;
    byId.set(item.acceptance_id, item);
    validateAcEvidence(item, item.acceptance_id, kind, manifest, failures);
  }

  for (const id of expectedIds) {
    const item = byId.get(id);
    const selectedRunId = selectedRunIds?.[id];
    addFailure(failures, isNonEmptyString(selectedRunId), 'MGW_GATE_RUN_SELECTION_INVALID', `${kind} ${id} selected run_id`);
    if (item && selectedRunId) {
      addFailure(failures, item.run_id === selectedRunId, 'MGW_GATE_RUN_SELECTION_MISMATCH', `${kind} ${id}`);
    }
  }
}

function validateGoldenEvidence(goldenEvidence, manifest, failures) {
  const expectedIds = [...GOLDEN_IDS, ...RELEASE_GATE_IDS];
  exactIdSet(Array.isArray(goldenEvidence) ? goldenEvidence.map((item) => item?.id) : goldenEvidence,
    expectedIds, 'GC and release gate evidence', failures);
  const byId = new Map();
  for (const item of Array.isArray(goldenEvidence) ? goldenEvidence : []) {
    if (!item || !expectedIds.includes(item.id)) continue;
    if (byId.has(item.id)) continue;
    byId.set(item.id, item);
    const label = item.id;
    addFailure(failures, item.status === 'PASS', 'MGW_GATE_LIVE_EVIDENCE_NOT_PASS', `${label} status=${String(item.status)}`);
    addFailure(failures, item.mode === 'REAL', 'MGW_GATE_REAL_CONSUMER_REQUIRED', `${label} must be real evidence`);
    addFailure(failures, isNonEmptyString(item.run_id), 'MGW_GATE_LIVE_EVIDENCE_INVALID', `${label} run_id`);
    addFailure(failures, item.candidate_build_id === manifest.candidate_build_id, 'MGW_GATE_BUILD_MISMATCH', label);
    addFailure(failures, item.configuration_digest === manifest.configuration_digest, 'MGW_GATE_CONFIG_MISMATCH', label);
    addFailure(failures, item.source_revisions &&
      item.source_revisions.anythingllm === manifest.source_revisions?.anythingllm &&
      item.source_revisions.gateway === manifest.source_revisions?.gateway, 'MGW_GATE_REVISION_MISMATCH', label);
    addFailure(failures, goldenProofPasses(item.id, item.proof), 'MGW_GATE_LIVE_ORACLE_FAILED', `${label} proof does not satisfy its oracle`);
  }

  const selected = manifest.selectedEvidenceRunIds?.golden;
  exactIdSet(Object.keys(selected || {}), expectedIds, 'golden selectedEvidenceRunIds', failures);
  for (const id of expectedIds) {
    const item = byId.get(id);
    addFailure(failures, isNonEmptyString(selected?.[id]), 'MGW_GATE_RUN_SELECTION_INVALID', `${id} selected run_id`);
    if (item && selected?.[id]) addFailure(failures, item.run_id === selected[id], 'MGW_GATE_RUN_SELECTION_MISMATCH', id);
  }
}

function goldenProofPasses(id, proof) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return false;
  switch (id) {
    case 'GC-01':
      return isNonEmptyString(proof.baseline_snapshot_id) && isNonEmptyString(proof.post_snapshot_id) && proof.untouched_document_hashes_match === true;
    case 'GC-02':
      return proof.members_distinct === true && proof.ownership_matches === true;
    case 'GC-03':
      return proof.consent_completed === true && proof.connection_active === true && proof.official_gateway_origin === true;
    case 'GC-04':
      return proof.source_job_status === 'SUCCEEDED' && proof.complete === true && Number.isInteger(proof.known_meeting_count) && proof.known_meeting_count > 0;
    case 'GC-05':
      return proof.native_content_complete === true && proof.collector_location_verified === true && proof.workspace_vector_hit === true;
    case 'GC-06':
      return Number.isInteger(proof.denied_request_count) && proof.denied_request_count > 0 && proof.leaked_bytes === 0;
    case 'GC-07':
      return proof.revoked_source_hits === 0;
    case 'GC-08':
      return proof.untouched_document_hashes_match === true && proof.compare_translation_ok === true && proof.oa_mutation_count === 0;
    case 'G0':
      return proof.source_job_status === 'SUCCEEDED' && proof.complete === true && Number.isInteger(proof.known_meeting_count) && proof.known_meeting_count > 0;
    case 'G1':
      return proof.user_a_authenticated === true && proof.user_b_authenticated === true && proof.independent_member_mapping === true && proof.true_oauth_active === true;
    case 'G2':
      return proof.all_cursors_complete === true && proof.gateway_recording_id_verified === true && proof.meeting_code_substitution === false;
    case 'G3':
      return proof.transcript_complete === true && proof.native_minutes_verified === true && proof.collector_location_verified === true && proof.workspace_vector_hit === true;
    case 'G4':
      return proof.cross_user_reads_blocked === true && proof.revoked_source_hits === 0 && proof.secret_hits === 0 && proof.oa_mutation_count === 0;
    default:
      return false;
  }
}

function evaluateCandidate(input) {
  const failures = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { status: 'FAIL_OR_BLOCKED', exitCode: 1, failures: ['MGW_GATE_INPUT_INVALID'] };
  }
  const manifest = input.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { status: 'FAIL_OR_BLOCKED', exitCode: 1, failures: ['MGW_GATE_MANIFEST_INVALID'] };
  }

  validateCandidateIdentity(manifest, failures);
  exactIdSet(manifest.requiredAcceptanceIds, BUSINESS_REQUIRED_IDS, 'manifest requiredAcceptanceIds', failures);

  const selected = manifest.selectedEvidenceRunIds || {};
  validateEvidenceGroup({ items: input.businessEvidence, expectedIds: BUSINESS_REQUIRED_IDS,
    selectedRunIds: selected.business, kind: 'business', manifest, failures });
  validateEvidenceGroup({ items: input.metaEvidence, expectedIds: GATE_META_IDS,
    selectedRunIds: selected.meta, kind: 'GATE_META', manifest, failures });
  validateGoldenEvidence(input.goldenEvidence, manifest, failures);

  const metaRuns = Array.isArray(input.metaEvidence) ? input.metaEvidence.map((item) => item?.run_id).filter(Boolean) : [];
  const businessRuns = Array.isArray(input.businessEvidence) ? input.businessEvidence.map((item) => item?.run_id).filter(Boolean) : [];
  addFailure(failures, isNonEmptyString(manifest.candidate_run_id) && !metaRuns.includes(manifest.candidate_run_id),
    'MGW_GATE_SELF_REFERENCE', 'candidate run cannot supply GATE_META evidence');
  addFailure(failures, !metaRuns.some((runId) => businessRuns.includes(runId)),
    'MGW_GATE_META_NOT_INDEPENDENT', 'GATE_META run must be independent from BUSINESS_REQUIRED runs');

  return failures.length
    ? { status: 'FAIL_OR_BLOCKED', exitCode: 1, failures: [...new Set(failures)] }
    : { status: 'PASS', exitCode: 0, failures: [] };
}

function parseCliArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('MGW_GATE_INVALID_ARGUMENTS');
  let manifestPath;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--manifest' || manifestPath || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(manifestPath ? 'MGW_GATE_INVALID_ARGUMENTS' : 'MGW_GATE_INPUT_REQUIRED');
    }
    manifestPath = argv[index + 1];
    index += 1;
  }
  if (!manifestPath) throw new Error('MGW_GATE_INPUT_REQUIRED');
  return { manifestPath };
}

function runCli(argv, { readFile = fs.readFileSync, write = (value) => process.stdout.write(`${value}\n`) } = {}) {
  try {
    const { manifestPath } = parseCliArgs(argv);
    const input = JSON.parse(readFile(manifestPath, 'utf8'));
    const result = evaluateCandidate(input);
    write(JSON.stringify(result));
    return result.exitCode;
  } catch (error) {
    const result = { status: 'FAIL_OR_BLOCKED', exitCode: 1, failures: [error.message || 'MGW_GATE_INPUT_INVALID'] };
    write(JSON.stringify(result));
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}

module.exports = {
  BUSINESS_REQUIRED_IDS,
  GATE_META_IDS,
  GOLDEN_IDS,
  RELEASE_GATE_IDS,
  evaluateCandidate,
  parseCliArgs,
  runCli,
};
