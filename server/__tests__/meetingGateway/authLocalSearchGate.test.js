const {
  evaluatePhaseGate,
  evidenceDigest,
} = require('../../../scripts/meeting-gateway-r2/auth-local-search-gate');

function makeEvidence(overrides = {}) {
  const identities = {
    source: 'consumer:abc123',
    config: 'config-sha256:1111111111111111111111111111111111111111111111111111111111111111',
    build: 'build:abc123',
    spec: 'sha256:ff382298a2ef1fc18d9a0dd9af1901172116c96643887fb8e1080c1f2d09cfaf',
  };
  const cases = [
    {
      caseId: 'PHASE-AUTH-01', mode: 'fixture', status: 'PASS', identities,
      execution: { command: 'corepack yarn test auth', exitCode: 0 },
      assertions: { profileFixtureOnly: true },
    },
    {
      caseId: 'PHASE-LOCAL-02', mode: 'fixture', status: 'PASS', identities,
      execution: { command: 'corepack yarn test local', exitCode: 0 },
      assertions: { localOnlyOutboundCount: 0, localSearchAuthorized: true },
    },
    {
      caseId: 'PHASE-SCOPE-03', mode: 'fixture', status: 'PASS', identities,
      execution: { command: 'corepack yarn test scope', exitCode: 0 },
      assertions: { deferredImportDisposition: 'DEFERRED_CURRENT_PHASE' },
    },
  ];
  return { phase: 'AUTH_LOCAL_SEARCH', identities, cases, ...overrides };
}

describe('AUTH_LOCAL_SEARCH evidence gate', () => {
  test('missing phase cases fail closed', () => {
    const result = evaluatePhaseGate({
      phase: 'AUTH_LOCAL_SEARCH',
      evidence: makeEvidence({ cases: [] }),
    });
    expect(result).toMatchObject({ status: 'BLOCKED', reason: 'PHASE_CASES_MISSING' });
  });

  test('fixture profile evidence cannot satisfy real PHASE-AUTH-01', () => {
    const result = evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence: makeEvidence() });
    expect(result.caseResults.find((item) => item.caseId === 'PHASE-AUTH-01').status).toBe('BLOCKED');
    expect(result.status).not.toBe('PASS');
  });

  test('blocked and skipped cases are never counted as pass', () => {
    const evidence = makeEvidence({ cases: makeEvidence().cases.map((item, index) =>
      index === 1 ? { ...item, status: 'SKIPPED' } : item) });
    const result = evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence });
    expect(result.caseResults.find((item) => item.caseId === 'PHASE-LOCAL-02').status).toBe('SKIPPED');
    expect(result.status).not.toBe('PASS');
  });

  test('deferred import scope is recorded without becoming a current-phase pass', () => {
    const result = evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence: makeEvidence() });
    expect(result.deferredScope).toEqual({ A_IMPORT: 'DEFERRED_CURRENT_PHASE', status: 'NOT_REQUIRED' });
    expect(result.caseResults.some((item) => item.caseId.startsWith('A-IMPORT'))).toBe(false);
  });

  test('identity mismatch, malformed evidence, and local-only outbound calls fail closed', () => {
    const base = makeEvidence();
    const mismatch = makeEvidence({ cases: base.cases.map((item, index) => index === 2
      ? { ...item, identities: { ...item.identities, build: 'build:other' } } : item) });
    expect(evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence: mismatch }).status).not.toBe('PASS');
    expect(evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence: { cases: 'bad' } }).status).toBe('BLOCKED');
    const outbound = makeEvidence({ cases: base.cases.map((item, index) => index === 1
      ? { ...item, assertions: { ...item.assertions, localOnlyOutboundCount: 1 } } : item) });
    expect(evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence: outbound })
      .caseResults.find((item) => item.caseId === 'PHASE-LOCAL-02').status).toBe('FAIL');
  });

  test('a JSON self-claim cannot PASS without a separately configured trust anchor', () => {
    const prior = process.env.MGW_GATE_TRUSTED_EVIDENCE_SHA256;
    delete process.env.MGW_GATE_TRUSTED_EVIDENCE_SHA256;
    try {
      const evidence = makeEvidence({ integrity: { algorithm: 'sha256', digest: '0'.repeat(64) } });
      expect(evidenceDigest(evidence)).toMatch(/^[a-f0-9]{64}$/);
      expect(evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence }).status).toBe('BLOCKED');
    } finally {
      if (prior !== undefined) process.env.MGW_GATE_TRUSTED_EVIDENCE_SHA256 = prior;
    }
  });

  test('real phase evidence passes only when an independent trust anchor matches the full evidence package', () => {
    const prior = process.env.MGW_GATE_TRUSTED_EVIDENCE_SHA256;
    const evidence = makeEvidence();
    evidence.cases[0] = {
      ...evidence.cases[0], mode: 'real',
      assertions: {
        realWeCom: true,
        gatewayOrigin: 'https://copilot.superic.com:9999',
        contractEvidenceRef: 'reviewed-contract-capture:auth-start-redeem-profile',
        profileEvidenceRef: 'redacted-real-profile:sha256:profile-proof',
        profileMatchesSubject: true,
        profileActive: true,
        projectionPersisted: true,
        localSessionIssued: true,
      },
    };
    process.env.MGW_GATE_TRUSTED_EVIDENCE_SHA256 = evidenceDigest(evidence);
    try {
      expect(evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence }).status).toBe('PASS');
      evidence.cases[0].assertions.profileActive = false;
      expect(evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence }).status).not.toBe('PASS');
    } finally {
      if (prior === undefined) delete process.env.MGW_GATE_TRUSTED_EVIDENCE_SHA256;
      else process.env.MGW_GATE_TRUSTED_EVIDENCE_SHA256 = prior;
    }
  });
});
