# Task 5a service integration report

## Implemented service contracts

- `getPrivate` returns the latest persisted OCR settings and decrypts the token only for service use; a parser instance uses the settings injected when it is constructed. Task 5b must fetch current settings while wiring each job's parser. The token is encrypted with the other service credentials, blank updates preserve it, and public configuration reports only whether a token exists. Configuration and meeting/source/import/job audit writes execute inside their owning Prisma transaction so audit failure rolls back the state change.
- Supplemental file ingestion accepts either a buffer or a server-created `tempPath`. Stream paths require an injected `trustedUploadRoot`, are resolved against that root, and are hashed in bounded memory. New files use `<storageRoot>/<validated-quarter>/<internalMeetingId>/<generatedUUID.ext>`; the display name does not participate in the path. A failed copy is cleaned up. Archived originals remain in place when a source is deleted.
- `getArchivedSource(meetingId, sourceId)` is the read-only service seam for authorized original-download routes. Callers still need to enforce Workspace/user authorization and current document membership before resolving Workspace originals.
- Approved supplemental text can be deleted; the transaction soft-deletes its source and downgrades review status. Approved supplemental files remain protected by the DRAFT-only deletion rule. Manually supplied summary/transcript text creates or updates indexable `SUMMARY`/`TRANSCRIPT` sources; clearing it removes old text and returns a source-less meeting to `WAITING_CONTENT`.
- Chunk embeddings are stored with a profile ID. Retrieval rejects malformed vectors and incompatible profiles rather than silently returning no data. `meetingService.requestReindex(meetingId, userId, profileId)` atomically advances generation, marks indexing, and queues a deduplicated manual `REINDEX` while preserving review status. Reindex must validate the whole current chunk set before marking a meeting `AVAILABLE`.
- Workspace search evidence carries `documentId` and `revision`. `validateEvidence({ workspaceIds, userId, evidence, db })` rechecks authenticated workspace access, document membership, and current revision before QA publishes an answer.
- `CollectorApi.processDocument` retains the uploaded original before parsing, strips parser-supplied original paths, attaches generated references, and removes the retained copy on parse failure. `Document.addDocuments` binds each generated reference to its actual `{workspaceId, docId}`. `workspaceOriginals.resolve({ referenceId, workspaceId, docId })` requires that manifest binding and checks path containment; forged and cross-document references return no file.

## TDD and verification

Focused tests were first run red for missing OCR config/audit behavior, profile mismatch rejection, upload/deletion and manual text behavior, explicit profile rebuild, Workspace evidence revision validation, QA publish-time validation, and original retention/binding. Each failed at the missing contract, then passed after its service implementation. A real SQLite/Prisma test also verifies that an audit failure rolls back meeting creation.

Commands and results:

- `npx jest server/__tests__/meetings --runInBand` — 12 suites, 117 tests passed.
- `npx eslint` over the changed service and integration modules — passed. Jest test files are ignored by this repository's ESLint configuration.
- Prettier applied to changed service modules and meeting tests.

## Task 5b integration seams and limits

- Inject the authenticated multipart temporary-file root as `trustedUploadRoot` when constructing the meeting source service. The source service rejects path-based uploads without it.
- For original-source download, authorize the current user and Workspace, verify current DB membership of the document, then use the Workspace original resolver with the bound reference plus exact workspace/document IDs. Do not accept a path from document metadata.
- Adapt the configured Workspace vector provider to return stable `docId`/`documentId` and `lastUpdatedAt`/`revision` fields, provide authenticated workspace and current-document lookup adapters, and pass the configured embedding profile ID into indexing and search.
- Expose an explicit authenticated `POST /meetings/:id/reindex` that invokes `requestReindex`; no automatic rebuild of all meetings is performed after an embedding-profile change.
- Live Tencent/OCR credentials, production vector-provider behavior, Linux deployment, and acceptance against real provider services remain unverified release checks.

## Review round 1

The review fixes preserve the existing flat Collector JSON contract. `CollectorApi` retention now persists a generated trusted reference into the actual parsed document JSON; binding verifies the parsed ID, content hash, and on-disk document identity before recording Workspace membership. Independent membership records allow the same retained parse to be embedded into multiple Workspaces and removed/re-added. Duplicate concurrent binding is idempotent; vector or DB-row failures are reported, vectors are cleaned up, and successful bindings are removed when persistence fails. The resolver still requires the exact workspace/document binding and contained original path.

Embedding preparation now rejects mixed vector dimensions, and search rejects object envelopes with a missing profile ID while retaining legacy array fixtures. Reindex publishes availability only after the complete current chunk set validates. Public Tencent configuration includes appId/sdkId/operatorId. Historical Workspace citations retain their saved quote while history compares the cited document revision through authenticated workspace/document lookup; publication passes its transaction client through both document and workspace lookups.

OCR URL save-time and parser-time validation now agree on HTTP(S) `/parse` with an optional trailing slash. URL userinfo is rejected before persistence or fetch, and parser request errors use a generic message so credentials cannot leak through the captured error text. Tests cover userinfo secrets, prefixed paths, and fetch suppression.

For this review batch, new regressions were first run red: genuine flat-document persistence/binding, cross-document substitution and concurrent/repeated bindings, mixed-dimension and missing-profile vectors, historical Workspace revision staleness, public Tencent identifiers, URL credentials/path alignment, and transaction-db forwarding. The corresponding focused suites then passed:

- `npx jest server/__tests__/meetings/parser.test.js server/__tests__/meetings/retrieval.test.js server/__tests__/meetings/tencent.test.js --runInBand` — 3 suites, 32 tests passed.
- `npx jest server/__tests__/meetings/qa.test.js server/__tests__/meetings/tencent.test.js --runInBand` — 2 suites, 33 tests passed.
- `npx jest server/__tests__/meetings --runInBand` — 13 suites, 125 tests passed.
- `npx jest server/__tests__/utils/files/moveProcessedDocsToFolder.test.js server/__tests__/utils/files/isWithin.test.js server/__tests__/models/documentSyncQueue.test.js --runInBand` — 3 suites, 63 tests passed.
- Scoped ESLint for changed service modules, Prettier check for formatted changed code/tests/report, and `git diff --check` for Task 5a files — passed. The existing Tencent test file retains its prior formatting to keep the review diff limited to the new regressions.

No real credentials, provider services, or Linux acceptance were used.
