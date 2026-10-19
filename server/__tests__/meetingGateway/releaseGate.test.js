const {
  BUSINESS_REQUIRED_IDS,
  GATE_META_IDS,
  GOLDEN_IDS,
  RELEASE_GATE_IDS,
  evaluateCandidate,
  parseCliArgs,
  runCli,
} = require('../../../scripts/meeting-gateway/release-gate.cjs');

const sourceRevisions = { anythingllm: 'a'.repeat(40), gateway: 'b'.repeat(40) };

function validInput() {
  const candidateBuildId = 'candidate-build';
  const configurationDigest = 'config-sha256';
  const candidateRunId = 'candidate-evaluation-run';
  const revisionRequirements = {
    '001': ['REQ-WORKSPACE-001', 'REQ-SEC-001'], '002': ['REQ-SEC-002'],
    '003': ['REQ-AUTH-001', 'REQ-IDENT-001'], '004': ['REQ-IMPORT-001', 'REQ-RETRY-001'],
    '005': ['REQ-STATE-001', 'REQ-REMOVE-001'], '006': ['REQ-FORMAT-001', 'REQ-STATE-001'],
    '007': ['REQ-SOURCE-003'], '008': ['REQ-OAUTH-002', 'REQ-SEC-003'],
    '009': ['REQ-TEST-001'], '010': ['REQ-OBS-001', 'REQ-RETRY-001'],
  };
  const businessEvidence = BUSINESS_REQUIRED_IDS.map((acceptance_id) => ({
    schema_version: 'meeting-prd-evidence-v1',
    acceptance_id,
    status: 'PASS',
    requirement_ids: acceptance_id.startsWith('A-REV-')
      ? revisionRequirements[acceptance_id.slice(6, 9)]
      : [`REQ-${acceptance_id.slice(2, acceptance_id.lastIndexOf('-'))}`],
    test_ids: [`TEST-${acceptance_id}`],
    command: 'jest --runInBand',
    exit_code: 0,
    oracle: { type: 'machine_assertion', expression: 'assertion', expected: 'pass', actual: 'pass' },
    source_revisions: { ...sourceRevisions },
    pre_digest: '0'.repeat(64),
    post_digest: '1'.repeat(64),
    evidence_files: [`acceptances/${acceptance_id}.json`],
    executed_at: '2026-10-18T00:00:00Z',
    run_id: `business-${acceptance_id}`,
    candidate_build_id: candidateBuildId,
    configuration_digest: configurationDigest,
  }));
  const metaEvidence = GATE_META_IDS.map((acceptance_id) => ({
    schema_version: 'meeting-prd-evidence-v1', acceptance_id, status: 'PASS',
    requirement_ids: ['REQ-TEST-001'], test_ids: [`TEST-${acceptance_id}`],
    command: 'jest --runInBand', exit_code: 0,
    oracle: { type: 'machine_assertion', expression: 'scenario assertion', expected: 'pass', actual: 'pass' },
    source_revisions: { ...sourceRevisions }, pre_digest: '0'.repeat(64), post_digest: '1'.repeat(64),
    evidence_files: [`meta/${acceptance_id}.json`],
    executed_at: '2026-10-18T00:01:00Z', run_id: 'independent-meta-run',
    candidate_build_id: candidateBuildId, configuration_digest: configurationDigest,
  }));
  const proofs = {
    'GC-01': { baseline_snapshot_id: 'before', post_snapshot_id: 'after', untouched_document_hashes_match: true },
    'GC-02': { members_distinct: true, ownership_matches: true },
    'GC-03': { consent_completed: true, connection_active: true, official_gateway_origin: true },
    'GC-04': { source_job_status: 'SUCCEEDED', complete: true, known_meeting_count: 1 },
    'GC-05': { native_content_complete: true, collector_location_verified: true, workspace_vector_hit: true },
    'GC-06': { denied_request_count: 1, leaked_bytes: 0 },
    'GC-07': { revoked_source_hits: 0 },
    'GC-08': { untouched_document_hashes_match: true, compare_translation_ok: true, oa_mutation_count: 0 },
    G0: { source_job_status: 'SUCCEEDED', complete: true, known_meeting_count: 1 },
    G1: { user_a_authenticated: true, user_b_authenticated: true, independent_member_mapping: true, true_oauth_active: true },
    G2: { all_cursors_complete: true, gateway_recording_id_verified: true, meeting_code_substitution: false },
    G3: { transcript_complete: true, native_minutes_verified: true, collector_location_verified: true, workspace_vector_hit: true },
    G4: { cross_user_reads_blocked: true, revoked_source_hits: 0, secret_hits: 0, oa_mutation_count: 0 },
  };
  const goldenEvidence = [...GOLDEN_IDS, ...RELEASE_GATE_IDS].map((id) => ({
    id, status: 'PASS', mode: 'REAL', run_id: 'golden-live-run', proof: proofs[id],
    candidate_build_id: candidateBuildId, configuration_digest: configurationDigest,
    source_revisions: { ...sourceRevisions },
  }));
  const selectedEvidenceRunIds = {
    business: Object.fromEntries(businessEvidence.map(({ acceptance_id, run_id }) => [acceptance_id, run_id])),
    meta: Object.fromEntries(metaEvidence.map(({ acceptance_id, run_id }) => [acceptance_id, run_id])),
    golden: Object.fromEntries(goldenEvidence.map(({ id, run_id }) => [id, run_id])),
  };
  return {
    manifest: {
      schema_version: 'meeting-prd-candidate-v1', candidate_build_id: candidateBuildId,
      candidate_run_id: candidateRunId, configuration_digest: configurationDigest,
      source_revisions: { ...sourceRevisions }, requiredAcceptanceIds: BUSINESS_REQUIRED_IDS,
      selectedEvidenceRunIds,
    },
    businessEvidence, metaEvidence, goldenEvidence,
  };
}

describe('evaluateCandidate', () => {
  test('missing evidence cannot pass', () => {
    expect(evaluateCandidate({
      manifest: { requiredAcceptanceIds: ['A-REV-001-01'] },
      businessEvidence: [],
      metaEvidence: [],
      goldenEvidence: [],
    })).toMatchObject({ status: 'FAIL_OR_BLOCKED', exitCode: 1 });
  });

  test('rejects GATE_META evidence generated by the candidate run itself', () => {
    const input = validInput();
    input.manifest.candidate_run_id = input.metaEvidence[0].run_id;

    const result = evaluateCandidate(input);

    expect(result.status).toBe('FAIL_OR_BLOCKED');
    expect(result.failures).toContain('MGW_GATE_SELF_REFERENCE: candidate run cannot supply GATE_META evidence');
  });

  test('passes only with exact business IDs, independent meta evidence, and complete real G0-G4/GC proof', () => {
    const input = validInput();
    const before = JSON.stringify(input);
    expect(evaluateCandidate(input)).toEqual({ status: 'PASS', exitCode: 0, failures: [] });
    expect(JSON.stringify(input)).toBe(before);
  });

  test('rejects stale revision or configuration evidence and fixture-backed consumer proof', () => {
    const staleRevision = validInput();
    staleRevision.businessEvidence[0].source_revisions.anythingllm = 'old-revision';
    expect(evaluateCandidate(staleRevision).status).toBe('FAIL_OR_BLOCKED');

    const staleConfiguration = validInput();
    staleConfiguration.businessEvidence[0].configuration_digest = 'old-config';
    expect(evaluateCandidate(staleConfiguration).failures.join(' ')).toMatch(/CONFIG_MISMATCH/);

    const fixture = validInput();
    fixture.goldenEvidence.find(({ id }) => id === 'GC-04').mode = 'SYNTHETIC';
    expect(evaluateCandidate(fixture).failures.join(' ')).toMatch(/REAL_CONSUMER_REQUIRED/);
  });

  test('rejects PASS evidence without pre/post digests or whose oracle actual differs from expected', () => {
    const missingDigest = validInput();
    delete missingDigest.businessEvidence[0].pre_digest;
    expect(evaluateCandidate(missingDigest).failures.join(' ')).toMatch(/pre_digest/);

    const failedOracle = validInput();
    failedOracle.businessEvidence[0].oracle.actual = 'fail';
    expect(evaluateCandidate(failedOracle).failures.join(' ')).toMatch(/oracle/);
  });

  test('malformed evidence containers block without throwing', () => {
    const input = validInput();
    input.businessEvidence = { acceptance_id: 'A-CONF-001-01' };
    expect(() => evaluateCandidate(input)).not.toThrow();
    expect(evaluateCandidate(input)).toMatchObject({ status: 'FAIL_OR_BLOCKED', exitCode: 1 });
  });
});

describe('parseCliArgs', () => {
  test('requires exactly one input path', () => {
    expect(() => parseCliArgs([])).toThrow('MGW_GATE_INPUT_REQUIRED');
    expect(() => parseCliArgs(['--manifest', 'a.json', '--manifest', 'b.json']))
      .toThrow('MGW_GATE_INVALID_ARGUMENTS');
  });

  test('accepts the planned manifest file option', () => {
    expect(parseCliArgs(['--manifest', 'candidate.json'])).toEqual({ manifestPath: 'candidate.json' });
  });

  test('CLI adapter reports malformed input as a blocked nonzero result', () => {
    const writes = [];
    const exitCode = runCli(['--manifest', 'candidate.json'], {
      readFile: () => '{not json',
      write: (value) => writes.push(JSON.parse(value)),
    });

    expect(exitCode).toBe(1);
    expect(writes[0]).toMatchObject({ status: 'FAIL_OR_BLOCKED', exitCode: 1 });
  });
});
