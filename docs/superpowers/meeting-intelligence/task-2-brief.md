# Task brief

## Shared/global context


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

Source segment shape: `{text:string, location:{type:'paragraph'|'page'|'image'|'cell'|'slide'|'transcript', paragraph?:number,page?:number,sheet?:string,cell?:string,slide?:number,startMs?:number,endMs?:number}}`. Source reference includes id, meetingId, sourceType, name, location, quote, reviewStatus, coverage.


### Task 2: Tencent connector, configuration and durable imports

**Files:** Create `server/modules/meetings/tencent.js`, `config.js`, `jobs.js`, `importer.js`; tests `server/__tests__/meetings/tencent.test.js`, `importer.test.js`.

**Interfaces:** `createTencentClient({config,fetchImpl=fetch})` returns `listMeetings(query)`, `getContent(externalId,scope)`. Return list `{items:[{externalId,title,startTime,endTime}],nextCursor}`; content `{summary,transcript,segments,attachments:[{name,downloadUrl,externalFileId}],coverage,capabilities}`. `createMeetingConfig({prisma,encryption})` returns `getPublic()`, `save(input)`, `getPrivate()`; encrypted credentials, public output redacted, audit no secrets. `createJobRunner({prisma,handlers,pollMs=2000})` returns `start()`, `stop()`, `enqueue(kind,payload,identity)`, `retry(id)`, `runOnce()`. `createImporter({prisma,meetingService,clientFactory,sourceService})` exposes `queue(connectionId,externalId,scope,userId)`, `process(job)`.

Read official research report `prd/tencent-meeting-api-research.md` once available; verify official documentation via web if needed. Only implement documented endpoints/signature, never invent content APIs. Capabilities must distinguish supported/unsupported/unknown and per-item absence. Unverified summary/attachment capability defaults unsupported with reason and manual supplement path, while configured supported network failures propagate. Use fixed official host, bounded timeouts, no secret logging, redact credential response.

Queue import reserves duplicate identity and quarter capacity transactionally; list metadata needed before reserving. Worker gets complete selected content, prepares parsed sources via Task3 `prepareImport`, then commits meeting/sources/chunks atomically or returns FAILED with no queryable meeting. Metadata-only branch creates WAITING_CONTENT without parser. Retry reuses same job and reservation safely; reclaim PROCESSING after restart with exclusive leasing so two runners do not double-claim. Scope clipping retains whole summary; if transcript lacks timestamps reject time selection explicitly, do not invent timestamps. Download only official-returned URL and enforce byte limits before buffering.

- [ ] Write RED tests for official canonical signing fixture, redaction, pagination, metadata-only vs 500 distinction, whole-scope rollback, duplicate retry and restart recovery.
- [ ] Run `npx jest server/__tests__/meetings/tencent.test.js server/__tests__/meetings/importer.test.js --runInBand`.
- [ ] Implement connector/config/importer/runner; dependencies injectable, no real account calls in tests.
- [ ] Verify GREEN and commit; report official URLs and remaining live-account verification separately.

