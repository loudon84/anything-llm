# Meeting Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the APPROVED first-release Meeting Intelligence PRD in AnythingLLM, with persisted meeting lifecycle, official Tencent API, source management and grounded QA.

**Architecture:** Add an isolated `server/modules/meetings` subsystem using the existing Prisma SQLite database and authenticated Express endpoint registration. Persist source segments and embedding vectors with location metadata; use existing configured embedding/LLM providers and Workspace retrieval. A durable job dispatcher handles import, source parsing and reindexing. React pages consume the documented API and reuse existing Sidebar and private-route patterns.

**Tech Stack:** Existing Node >=18, CommonJS server, Prisma 5.3.1, Express, Jest; React 18, Vite, Tailwind. Reuse server `exceljs`, `adm-zip`, `EncryptionManager`, existing model/embedding connectors. PDF/OCR may use explicitly configured local or remote parser service returning located segments; implement text-PDF and Office parsing locally where practical. No automatic fallback.

**Spec:** `prd/PRD-AnythingLLM-Enterprise-Meeting-Intelligence-v1.0.md` (APPROVED).

**Execution:** User explicitly requests creation of plan/TODO followed by GPT-6 Luna subagents coding. Preserve that instruction; proceed after plan self-review without asking again to authorize execution. Each implementer uses `gpt-6-luna`, fresh context, no child agents; controller assigns tasks sequentially and reviews each before dependents. Review-only research may run concurrently. No push or merge into master.

## Global Constraints

- Linux fresh deployment; no legacy data migration acceptance.
- Quarterly active meetings <=200 including metadata-only drafts; cross-meeting selection <=10; transcript selection <=3 hours.
- Each file <=100 MB (decimal 100000000 bytes), per meeting <=20 active files and <=500 MB (decimal 500000000 bytes), original and supplemental combined.
- Original Tencent files read-only in DRAFT and APPROVED. Supplemental files content-unique within a meeting; delete/reupload only current DRAFT; no replace endpoint. Text supplementation cannot be directly edited.
- Drafts queryable only if AVAILABLE. Metadata-only creates DRAFT+WAITING_CONTENT, consumes quota and dedup identity; only successful effective-source indexing enables QA and approval.
- Source absence/confirmed API capability gap allows manual supplementation; runtime API/parse/index failure never degrades silently into metadata success.
- Full selected import scope succeeds or no content is exposed. Source-only supplementation failure does not invalidate existing usable content. Deletion/revision pauses retrieval until index cleanup/rebuild succeeds.
- Fixed conversation meeting/Workspace sets. Any selected meeting unavailable blocks new/reanswered questions. Historical evidence is snapshots, never fresh evidence by itself.
- No model knowledge as facts; citation IDs/quotes must correspond to retrieved evidence; conflict displayed, suggestions distinct from decisions, uncertainty prompts clarification or supplementation.
- Retain history on delete and reanswer. Delete old source then upload produces a new source ID; old snapshots remain old.
- Reuse accessible Workspaces, selected explicitly every new conversation; no real-time outside knowledge or tools.
- Existing auth remains. No new fine-grained meeting ACL scope. Admin-only connection/service configuration, never reveal secrets.
- Do not claim live API, OCR/provider or production performance verified without actual evidence; Linux/live credentials tests remain release checks.

## Review Focus

1. Concurrent duplicate import/upload or quota race: transaction and DB unique keys, not frontend-only guards (Task 1/2/3 tests).
2. Content edited/deleted while answer running: validate current source/generation before returning/persisting a successful answer; no historical context resurrection (Task 4 tests).
3. Delete last effective source then failing upload: WAITING_CONTENT or index failure stays blocked, old source never restored (Task 3 tests).
4. API only metadata vs transient failure: distinct capability status and import outcomes (Task 2 tests).
5. Parser loses location or returns empty text: do not declare successful index or generate fabricated citation; remote parser protocol validated (Task 3/4 tests).

## Shared contracts and data ownership

Task 1 defines Prisma models named `meeting_connections`, `meetings`, `meeting_sources`, `meeting_chunks`, `meeting_jobs`, `meeting_conversations`, `meeting_answers`. Subsequent tasks use those models; fields below are the minimum contract. JSON structures are serialized strings because Prisma SQLite JSON support is not assumed.

- `meeting_connections`: id Int, name String, config String (encrypted credentials plus service config), createdAt/updatedAt.
- `meetings`: id Int, connectionId Int, externalId String, activeKey String? @unique (connectionId:externalId; null on deletion), title String, startTime DateTime, endTime DateTime?, quarter String, reviewStatus String DRAFT|APPROVED, retrievalStatus String WAITING_CONTENT|AVAILABLE|INDEXING|INDEX_FAILED|DELETED, summary String?, transcript String?, coverage String, generation Int default 0, deletedAt DateTime?, createdBy Int?, reviewedBy Int?, reviewedAt DateTime?, createdAt/updatedAt.
- `meeting_sources`: id Int, meetingId Int, sourceType String TENCENT_ORIGINAL|SUPPLEMENT_FILE|SUPPLEMENT_TEXT|SUMMARY|TRANSCRIPT, name String, contentHash String?, activeHash String?, bytes Int default0, filePath String?, contentText String?, segments String?, parseStatus String PENDING|PROCESSING|SUCCESS|FAILED, error String?, deletedAt DateTime?, createdBy Int?, createdAt/updatedAt; @@unique([meetingId,activeHash]).
- `meeting_chunks`: id Int, meetingId Int, sourceId Int, text String, location String, embedding String, generation Int, createdAt.
- `meeting_jobs`: id Int, kind String IMPORT|PARSE_SOURCE|REINDEX, meetingId Int?, connectionId Int?, externalId String?, activeKey String? @unique, quarter String?, payload String, status String CREATED|PROCESSING|SUCCESS|FAILED, stage String?, error String?, attempts Int default0, createdAt/updatedAt.
- `meeting_conversations`: id Int, meetingIds String, workspaceIds String, createdBy Int?, createdAt.
- `meeting_answers`: id Int, conversationId Int, question String, status String, text String?, missingInfo String?, citations String, sourceState String, previousAnswerId Int?, error String?, createdAt.

Task 1 may add indexing/relations needed for safe queries without removing these names. Lazy database imports make unit tests possible without installed Prisma; real persistence integration uses generated Prisma client. Store enums as strings and validate transitions in domain code. Use `Asia/Shanghai` as initial business timezone and date interval [from inclusive, to exclusive), document this implementation ruling.

Import scope uses `from`/`to` as elapsed millisecond offsets (zero is valid), `attachmentIds` as externalFileIds; omitted range means full transcript, omitted attachmentIds means all supported document artifacts. Validate actual bounds, not caller-provided durationMs.

Source segment shape: `{text:string, location:{type:'paragraph'|'page'|'image'|'cell'|'slide'|'transcript', paragraph?:number,page?:number,sheet?:string,cell?:string,slide?:number,startMs?:number,endMs?:number}}`. Source reference includes id, meetingId, sourceType, name, location, quote, reviewStatus, coverage.

## TODO ledger

- [x] T1 Persistence and lifecycle rules (18 tests; review clean).
- [x] T2 Tencent connector, encrypted configuration and durable import jobs (30 tests; review clean).
- [x] T3 Located parsing/OCR, source uploads, embedding index and reindex.
- [x] T4 Fixed-scope grounded QA, historical citations and reanswers.
- [ ] T5 Authenticated Express API and runtime integration. Sequential subtasks: 5a service safeguards/original retention; 5b endpoints/runtime, each reviewed.
- [ ] T6 React Meeting Center, detail, source viewer and QA pages.
- [ ] T7 End-to-end integration, review fixes, deployment and test evidence.

### Task 1: Persistence and lifecycle rules

**Files:** Modify `server/prisma/schema.prisma`; create an additive migration under `server/prisma/migrations`; create `server/modules/meetings/constants.js`, `errors.js`, `policy.js`, `meetingService.js`; tests `server/__tests__/meetings/policy.test.js`, `lifecycle.test.js`.

**Interfaces:** Export `MeetingError(message,code,status=400)`; `LIMITS`, `REVIEW`, `RETRIEVAL`; `quarterFor(date)`, `validateScope(scope)`, `assertQueryable(meetings)`, `assertSourceDeletion(meeting,source)`, `assertFileLimits(existing,incoming)`. `createMeetingService({prisma,audit=async()=>{}})` returns async `list(filters)`, `get(id)`, `createMetadata(data,userId)`, `approve(id,userId)`, `softDelete(id,userId)`, `revise(id,{summary,transcript},userId)`.

createMetadata checks active duplicate and quarterly quota including other active import reservations; initial WAITING_CONTENT. softDelete only DRAFT, clears activeKey, marks DELETED and soft-deletes sources/clears activeHash while retaining rows/snapshots, deletes active chunks. revise only SUMMARY/TRANSCRIPT values, increments generation, sets INDEXING and DRAFT, queues REINDEX; no full-content versions. approve requires AVAILABLE and no unresolved source/job processing errors. Each mutation checks current state inside transaction and audits.

- [x] Write failing tests for 201st-quarter meeting rejection, 11 selected meetings, >3h scope, byte/count limits, original deletion rejection, approved supplemental deletion rejection, metadata-only cannot approve, delete/reimport new ID, revision queues indexing.
- [x] Run `npx jest server/__tests__/meetings/policy.test.js server/__tests__/meetings/lifecycle.test.js --runInBand` and record RED.
- [x] Implement policies/service plus schema/migration; concurrent duplicates resolved by unique activeKey, quota transactions checked consistently.
- [x] Run focused tests GREEN; `server/node_modules/.bin/prisma validate --schema server/prisma/schema.prisma` from repository root (Windows use `.cmd`).
- [x] Commit task-owned code/tests/migration; write report with commands/evidence and any changes to contracts.

### Task 2: Tencent connector, configuration and durable imports

**Files:** Create `server/modules/meetings/tencent.js`, `config.js`, `jobs.js`, `importer.js`; tests `server/__tests__/meetings/tencent.test.js`, `importer.test.js`.

**Interfaces:** `createTencentClient({config,fetchImpl=fetch})` returns `listMeetings(query)`, `describeMeeting(externalId,{startTime,endTime})`, `getContent(externalId,scope)`. Return list `{items:[{externalId,title,startTime,endTime}],nextCursor}`; content `{summary,transcript,segments,attachments:[{name,downloadUrl,externalFileId}],coverage,capabilities}`. `createMeetingConfig({prisma,encryption})` returns `getPublic()`, `save(input)`, `getPrivate()`; encrypted credentials, public output redacted, audit no secrets. `createJobRunner({prisma,handlers,pollMs=2000})` returns `start()`, `stop()`, `enqueue(kind,payload,identity)`, `retry(id)`, `runOnce()`. `createImporter({prisma,meetingService,clientFactory,sourceService})` exposes `queue(connectionId,externalId,scope,userId)`, `process(job)`.

Read official research report `prd/tencent-meeting-api-research.md` once available; verify official documentation via web if needed. Only implement documented endpoints/signature, never invent content APIs. Capabilities must distinguish supported/unsupported/unknown and per-item absence. Unverified summary/attachment capability defaults unsupported with reason and manual supplement path, while configured supported network failures propagate. Use fixed official host, bounded timeouts, no secret logging, redact credential response.

Queue import reserves duplicate identity and quarter capacity transactionally; list metadata needed before reserving. Worker gets complete selected content, prepares parsed sources via Task3 `prepareImport`, then commits meeting/sources/chunks atomically or returns FAILED with no queryable meeting. Metadata-only branch creates WAITING_CONTENT without parser. Retry reuses same job and reservation safely; reclaim PROCESSING after restart with exclusive leasing so two runners do not double-claim. Scope clipping retains whole summary; if transcript lacks timestamps reject time selection explicitly, do not invent timestamps. Download only official-returned URL and enforce byte limits before buffering.

- [x] Write RED tests for official canonical signing fixture, redaction, pagination, metadata-only vs 500 distinction, whole-scope rollback, duplicate retry and restart recovery.
- [x] Run `npx jest server/__tests__/meetings/tencent.test.js server/__tests__/meetings/importer.test.js --runInBand`.
- [x] Implement connector/config/importer/runner; dependencies injectable, no real account calls in tests.
- [x] Verify GREEN and commit; report official URLs and remaining live-account verification separately.

### Task 3: Sources, located parsing and embedding index

**Files:** Create `server/modules/meetings/parser.js`, `indexer.js`, `sources.js`; tests `server/__tests__/meetings/parser.test.js`, `sources.test.js`, `indexer.test.js`; add only justified parser dependency and fixtures if needed.

**Interfaces:** `createParser({services,fetchImpl})` exposes `parse({name,buffer}) -> segments`; `createIndexer({prisma,embedder})` exposes `prepare(segments)`, `reindex(meetingId)`, `search(meetingIds,question,limit=20)`. `createSourceService({prisma,parser,indexer,storageRoot,enqueue,audit})` exposes `upload(meetingId,{name,buffer},userId)`, `addText(meetingId,{name,text},userId)`, `remove(meetingId,sourceId,userId)`, `retry(sourceId)`, `process(job)`, `prepareImport(content)`, `commitImport(tx,meeting,prepared)` and `getSource(meetingId,sourceId)`.

Local TXT/MD paragraphs, DOCX/PPTX OOXML text + paragraph/slide location using adm-zip, XLSX exceljs cell values/cache, text PDF page extraction. Scanned PDFs/images and slide-image OCR use explicit configured OCR/document parser service; accept located segment response validated against shared shape. With no required parser/OCR config fail clearly, not fake content. Support `.docx,.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.pptx,.md,.txt`; reject unsupported formats. OCR response retains exact page/image/slide provenance; no automatic fallback. Remote service interface: multipart file POST to configured base URL, bearer token encrypted with meeting config, JSON `{segments:[...]}`; document for enterprise-local service implementation. Local parsing must not return SUCCESS on empty content. Use configured embedding engine; missing/calling failure explicit. Store chunk embeddings and compute cosine over selected current meeting chunks, never old/deleted chunks. Chunk/split within source/locator, stable reference IDs.

Uploads persisted under opaque generated name in storage/meetings, never original name as path. Limits plus SHA-256 active uniqueness checked transactionally; original files read-only, delete and reupload current DRAFT only, text no edit. Delete queues REINDEX immediately, last-source after cleanup => WAITING_CONTENT. New-upload failure retains existing index; deletion rebuild failure remains INDEX_FAILED. Reindex selects active SUCCESS sources and current revised summary/transcript, updates chunks and state atomically against generation; late worker cannot resurrect deleted source/meeting. New supplements downgrade APPROVED to DRAFT. Histories mark changed sources/new-source availability.

- [x] RED tests for rename duplicate, concurrent duplicate, original forbidden delete, last-source deletion, failed first supplement, failed upload after deletion, traversal name safe path, empty parser response, DOCX/PPTX/Excel locations and OCR config failure.
- [x] Run `npx jest server/__tests__/meetings/parser.test.js server/__tests__/meetings/sources.test.js server/__tests__/meetings/indexer.test.js --runInBand`.
- [x] Implement located parser, source jobs and embeddings; preserve source errors and snapshots.
- [x] Verify GREEN with real format fixture tests; commit and document local/remote service setup.

### Task 4: Fixed-scope grounded QA and history

**Files:** Create `server/modules/meetings/qa.js`, `retrieval.js`, `grounding.js`; tests `server/__tests__/meetings/qa.test.js`, `grounding.test.js`.

**Interfaces:** `createQAService({prisma,indexer,workspaceRetriever,llm,audit})` returns `createConversation({meetingIds,workspaceIds},userId)`, `getConversation(id,userId)`, `ask(id,{question,previousAnswerId,clarification},userId)`, `history(id,userId)`. `createWorkspaceRetriever` uses existing accessible Workspace vector DB similarity search; citation can degrade to filename+snippet+file link. Adapter llm uses existing configured provider/router, one explicit provider, no fallback.

Require selected meetings 1..10 unique and AVAILABLE. Persist immutable sets; enforce conversation ownership using existing single/multiuser semantics and accessible Workspace check. On each question reretrieve selected active sources; prior answers only conversation reference, never independent evidence. LLM output validated structured JSON `{status:'ANSWERED'|'AWAITING_CLARIFICATION'|'AWAITING_SOURCES',text,missingInfo,citations:[{evidenceId,quote}]}`. Evidence IDs must belong to current retrieval and quotes substrings; answered with no citation rejected into controlled failure, never fake confidence. System instruction forbids unsupported facts, separates discussion/decision, conflict not resolved, prompts missing applicability, no exhaustiveness claim. Empty retrieval => AWAITING_SOURCES without model-call invention. Validate generations/source deletion again before publishing answer; interrupted model preserves partial text FAILED_INCOMPLETE with error. Store citation snapshots and source state; reanswer creates new row referencing previousAnswerId, never overwrite. Return stale/new-source flags from current state comparison.

- [x] RED tests: no evidence => pending, fabricated evidence rejected, conflict prompt, scope immutable, changed/deleted source during generation blocked, metadata draft blocked, snapshot persists after delete, reanswer new row, model failure not missing sources, explicit Workspace scope and access.
- [x] Run `npx jest server/__tests__/meetings/qa.test.js server/__tests__/meetings/grounding.test.js --runInBand`.
- [x] Implement service/adapters; cite source locator and approval/coverage snapshots.
- [x] GREEN and commit; report provider integration and any unresolved production verification.

### Task 5: Authenticated API and runtime wiring

**Files:** Create `server/endpoints/meetings.js`, `server/modules/meetings/runtime.js`; modify `server/index.js`; tests `server/__tests__/meetings/endpoints.test.js`.

**Interfaces:** All responses JSON errors `{error,code}`, success shapes stable; prefix `/api/meetings` (endpoint function registered on apiRouter). Use existing validatedRequest/flexUserRoleValid and userFromSession. Admin configuration routes protected by admin checks.

API:
- GET/PUT `/meetings/config`: public redacted config / admin-save; includes Tencent and parser/OCR service settings, uses existing configured LLM/embedder.
- GET `/meetings/remote`: query list and cursor. GET `/meetings/remote/:externalId/manifest`: selected meeting attachment manifest, transcript duration and capability info, no signed download URLs; query includes date window and connectionId.
- POST `/meetings/import`: `{connectionId,externalId,scope}` =>202 `{job}`.
- GET `/meetings/jobs`; POST `/meetings/jobs/:id/retry`.
- GET `/meetings`: quarter/from/to filters => `{meetings}`; GET `/meetings/:id` => `{meeting,sources}`.
- PATCH `/meetings/:id/content`: summary/transcript; POST `/meetings/:id/approve`; DELETE `/meetings/:id`.
- POST `/meetings/:id/sources/file` multipart file; POST `/meetings/:id/sources/text` `{name,text}`; DELETE `/meetings/:id/sources/:sourceId`; POST same `/retry`; GET same `/file` inline/download controlled; GET same `/segments` for locator viewer.
- POST `/meetings/conversations` `{meetingIds,workspaceIds}`; GET `/meetings/conversations/:id`; POST same `/questions` `{question,previousAnswerId,clarification}`; GET same `/answers`.

Register fixed paths before `/:id`; parse numeric IDs, no content mutations with GET. Multipart max100MB disk/stream handling (avoid 10 concurrent huge buffers), filename sanitization/storage containment, cleanup rejected temp files. Original file download only local authorized stored path, no remote arbitrary proxy. Start runner on server boot and stop on shutdown using existing boot lifecycle; handlers IMPORT/PARSE_SOURCE/REINDEX. Resolve full dependencies, use existing embedder and LLM/router. Unit endpoint tests fake auth but actual service invocation; no unprotected secret routes.

- [ ] RED tests status202 background, config redaction/admin gate, readonly originals, approved deletion rejection, 413 limits, fixed routes not captured by id, errors preserved.
- [ ] Run `npx jest server/__tests__/meetings/endpoints.test.js --runInBand`.
- [ ] Implement endpoints/runtime, test and commit; runtime smoke with generated Prisma fresh DB.

### Task 6: React meeting and QA pages

**Files:** Create `frontend/src/models/meetings.js`, `frontend/src/pages/Meetings/{index,Detail,Conversation,Settings,SourceViewer}.jsx` and focused helper/components; modify `frontend/src/main.jsx`, `frontend/src/components/Sidebar/index.jsx`, `frontend/src/utils/paths.js`; add translation entries or use Chinese initial copy consistent with requirement.

**Interfaces:** Client consumes exact Task5 API and baseHeaders; errors visible, no swallowed default empty successes. Routes `/meetings`, `/meetings/:id`, `/meetings/conversations/:id`, `/meetings/settings`; private routes, config admin route. Do not confuse conversation id with meeting id route.

Meeting Center: quarterly list, date interval auto-select then allow deselect, >10 explicit blocker, draft/approval/partial/metadata and index status badges; remote list pagination, single import dialog with selectable attachments/time scope and limit checks, no batch/refresh-import. Jobs poll while active with cleanup, close-page survives.
Detail: Summary/Transcript editing and search, review approval, draft delete, two separate attachment panels originals preview/download only; supplements upload + draft-only delete/reupload and text delete/add, displayed limits/parse errors/retry. WAITING_CONTENT visible with supplement entry, query/review disabled. Source viewer locates paragraph/page/image/cell/slide, uses segments and download/preview with encoded IDs, snapshots distinct from current modified original.
QA start dialog explicitly selects accessible Workspaces, default none, persisted immutable scope. Ask/clarify/reanswer states, disabled when scope unavailable, versions and source-change/new-source hints. Every citation displays source/meeting/date/coverage/review, opens snapshot and original locator; Workspace downgrade clearly says no precise location. Never render model text as unsafe HTML. Show service/partial failure distinct from evidence missing; supplementation target one selected meeting.

- [ ] Add testable pure selection/citation helpers and meaningful focused tests via root Jest (or Node test ESM); max10, range auto-select and source-action rules.
- [ ] Implement pages/styles following current app patterns; include keyboard labels, loading/error states and upload validation.
- [ ] Run focused tests, scoped lint, `npm run build` in frontend; commit.
- [ ] Provide screenshots if app can boot; no fake screenshot/live QA claim.

### Task 7: Integration and release evidence

**Files:** Integration tests `server/__tests__/meetings/integration.test.js`; `docs/meeting-intelligence-deployment.md`; amend only task-owned implementation gaps; update this plan TODO and execution ledger.

- [ ] Fresh Prisma migration/generate, exercise metadata import → file/text supplement → AVAILABLE → approval → new supplement DRAFT → delete source → cleanup; verify originals readonly, reanswer snapshots and duplicate/quota policies.
- [ ] Regression tests for scope/source changes during model response; full new meeting suite and frontend production build/scoped lint.
- [ ] Capture real test evidence and supported formats/services; record credentialless Tencent verification limits and unmeasured Linux/OCR/performance gates honestly.
- [ ] Final branch diff review, fix important findings via GPT-6 Luna, focused retest and review.
- [ ] Final deliverable links plan/TODO, code worktree and branch; do not claim Linux/live-release gate passed on Windows or absent credentials. Do not push/merge automatically.









