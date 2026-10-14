# Task 5a service integration report

## Implemented service contracts

- OCR settings are read at job execution time. The token is encrypted with the other service credentials, blank updates preserve it, and public configuration reports only whether a token exists. Configuration and meeting/source/import/job audit writes execute inside their owning Prisma transaction so audit failure rolls back the state change.
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
