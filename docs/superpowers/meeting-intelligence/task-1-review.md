# Task 1 review

## Verdicts

- **Spec compliance: Needs correction.** `createMetadata` accepts a caller-supplied quarter without checking it against `startTime`, allowing metadata to be assigned outside its Asia/Shanghai quarter and bypass the 200-meeting cap.
- **Code quality: Needs correction.** The active identity key is assembled from an unnormalized connection ID, so equivalent IDs can evade duplicate detection. The tests also do not provide evidence for concurrent duplicate or quota-race behavior.

## Findings

1. **[P1] Validate the supplied quarter or derive it only from the start time** — `server/modules/meetings/meetingService.js:38`. Trigger: call `createMetadata` with a valid start time in a full quarter and pass a different `data.quarter`. The row is counted in the supplied quarter, so the per-quarter limit can be bypassed and quarter reporting becomes incorrect.

2. **[P2] Normalize connection ID before constructing the unique key** — `server/modules/meetings/meetingService.js:39,56`. Trigger: call once with `connectionId: "01"` and once with `connectionId: 1`, for the same external ID. The keys differ (`01:…` versus `1:…`) although both rows persist connection ID `1`, allowing duplicate active imports. Convert and validate the ID before building `activeKey`.

3. **[P2] Concurrency guarantees lack test evidence** — `server/__tests__/meetings/lifecycle.test.js:47` and `server/modules/meetings/meetingService.js:41-53`. The fake `$transaction` runs the callback directly and the fake delegate does not enforce unique indexes. Existing tests therefore do not exercise concurrent duplicate creation, database uniqueness, or simultaneous quota reservations. The production code does use a transaction and the schema defines a unique active key, but the report's RED/GREEN results do not establish these race invariants.

## Evidence and scope

The report records 2 focused Jest suites / 11 tests passing and Prisma schema validation passing. I did not rerun tests. The live migration application is intentionally deferred to Task 7 and is not treated as a defect here. The review covered the requested Task 1 brief, report, diff, lifecycle and policy code, schema, migration, and focused tests.
