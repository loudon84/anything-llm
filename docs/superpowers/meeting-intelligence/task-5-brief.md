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


### Task 5: Authenticated API and runtime wiring

**Files:** Create `server/endpoints/meetings.js`, `server/modules/meetings/runtime.js`; modify `server/index.js`; tests `server/__tests__/meetings/endpoints.test.js`.

**Interfaces:** All responses JSON errors `{error,code}`, success shapes stable; prefix `/api/meetings` (endpoint function registered on apiRouter). Use existing validatedRequest/flexUserRoleValid and userFromSession. Admin configuration routes protected by admin checks.

API:
- GET/PUT `/meetings/config`: public redacted config / admin-save; includes Tencent and parser/OCR service settings, uses existing configured LLM/embedder.
- GET `/meetings/remote`: query list and cursor.
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


## Verified database constraint
Prisma 5.3.1 generated SQLite client in this repo does not expose createMany for new models. Use awaited per-row create inside transactions, not unsupported bulk operations. Client generated, all 41 migrations applied to ignored worktree storage DB. Tests that need real database should isolated temp copies/fixtures, not production.
