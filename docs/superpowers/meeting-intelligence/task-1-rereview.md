# Task 1 scoped re-review

## Verdicts

- **Spec compliance: Approved for the scoped findings.** Quarter assignment, normalized identity, reservation accounting, and file-versus-text deletion behavior now match the reviewed contracts.
- **Code quality: Approved for the scoped findings.** The added tests exercise real SQLite transactions for duplicate and quota races; report records 18 passing tests in three consecutive runs. I did not rerun them.

## Finding status

1. **Quarter derivation — ADDRESSED.** `server/modules/meetings/meetingService.js:49-53` derives the quarter from the Shanghai start-time helper and rejects a conflicting caller value. A database-backed test covers the mismatch at `server/__tests__/meetings/lifecycle.test.js:156-160`.

2. **Normalized active identity — ADDRESSED.** `server/modules/meetings/meetingService.js:43-55` validates the positive integer connection ID, trims the external ID, and builds the key from normalized values. Tests cover equivalent connection ID representations and invalid IDs at `server/__tests__/meetings/lifecycle.test.js:162-180`.

3. **Concurrent duplicate and quota race evidence — ADDRESSED.** Tests use Prisma transactions against an isolated SQLite database and verify one winner for concurrent duplicate creation and concurrent allocation of the final slot at `server/__tests__/meetings/lifecycle.test.js:194-217`. The report records three consecutive GREEN runs.

4. **Own import reservation double-count — ADDRESSED.** `server/modules/meetings/meetingService.js:65-70` excludes a reservation whose active key matches the meeting being created. The 199-meeting plus own-reservation case is covered at `server/__tests__/meetings/lifecycle.test.js:183-192`.

5. **File-versus-text deletion — ADDRESSED.** `server/modules/meetings/policy.js:46-55` keeps approved file supplements immutable while permitting typed-text supplement deletion; original and non-supplement sources remain blocked. Policy tests cover those cases at `server/__tests__/meetings/policy.test.js:47-63`.

The implementation report records schema validation and the parent’s migration deployment. No live production migration or runtime acceptance was assessed in this scoped review.
