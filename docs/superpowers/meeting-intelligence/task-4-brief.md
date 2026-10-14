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


### Task 4: Fixed-scope grounded QA and history

**Files:** Create `server/modules/meetings/qa.js`, `retrieval.js`, `grounding.js`; tests `server/__tests__/meetings/qa.test.js`, `grounding.test.js`.

**Interfaces:** `createQAService({prisma,indexer,workspaceRetriever,llm,audit})` returns `createConversation({meetingIds,workspaceIds},userId)`, `getConversation(id,userId)`, `ask(id,{question,previousAnswerId,clarification},userId)`, `history(id,userId)`. `createWorkspaceRetriever` uses existing accessible Workspace vector DB similarity search; citation can degrade to filename+snippet+file link. Adapter llm uses existing configured provider/router, one explicit provider, no fallback.

Require selected meetings 1..10 unique and AVAILABLE. Persist immutable sets; enforce conversation ownership using existing single/multiuser semantics and accessible Workspace check. On each question reretrieve selected active sources; prior answers only conversation reference, never independent evidence. LLM output validated structured JSON `{status:'ANSWERED'|'AWAITING_CLARIFICATION'|'AWAITING_SOURCES',text,missingInfo,citations:[{evidenceId,quote}]}`. Evidence IDs must belong to current retrieval and quotes substrings; answered with no citation rejected into controlled failure, never fake confidence. System instruction forbids unsupported facts, separates discussion/decision, conflict not resolved, prompts missing applicability, no exhaustiveness claim. Empty retrieval => AWAITING_SOURCES without model-call invention. Validate generations/source deletion again before publishing answer; interrupted model preserves partial text FAILED_INCOMPLETE with error. Store citation snapshots and source state; reanswer creates new row referencing previousAnswerId, never overwrite. Return stale/new-source flags from current state comparison.

- [ ] RED tests: no evidence => pending, fabricated evidence rejected, conflict prompt, scope immutable, changed/deleted source during generation blocked, metadata draft blocked, snapshot persists after delete, reanswer new row, model failure not missing sources, explicit Workspace scope and access.
- [ ] Run `npx jest server/__tests__/meetings/qa.test.js server/__tests__/meetings/grounding.test.js --runInBand`.
- [ ] Implement service/adapters; cite source locator and approval/coverage snapshots.
- [ ] GREEN and commit; report provider integration and any unresolved production verification.


## Verified database constraint
Prisma 5.3.1 generated SQLite client in this repo does not expose createMany for new models. Use awaited per-row create inside transactions, not unsupported bulk operations. Client generated, all 41 migrations applied to ignored worktree storage DB. Tests that need real database should isolated temp copies/fixtures, not production.

## Import scope integration
Scope from/to are numeric elapsed millisecond offsets (0 valid); attachmentIds selects externalFileIds. Omitted bounds mean full transcript, omitted attachments means all supported document artifacts. Derive selected duration from actual bounds. Check T2 report for finalized adapter result fields.

## Workspace original-file check
Existing Citation UI often shows only cached chunks for file sources (parseChunkSource defaults no href). Do not invent a download URL or claim raw-original availability. Inspect original retention/source metadata for actual evidence opening; if raw file is unavailable, report integration gap to controller and return explicit originalUnavailable rather than broken link. New deployment allows source-retention adaptation if needed, with Task5 ownership. Meeting originals have own new storage path and must always be locatable.

## Final Task3 integration contracts

Read task-3-report.md for current adapters. Indexer.search returns source references including id (chunk), sourceId, meetingId, sourceType, name, location, quote/text, reviewStatus, coverage, score. Reindex synchronizes summary/transcript source content and clears original transcript timing after manual revisions. Source envelope is segments JSON object or prior array: unwrap safely. Ensure publication snapshots compare active sources/hashes/updatedAt, since successful supplementary additions need not increment meeting.generation; generation alone is insufficient to detect changes during answer generation. Same applies to new-information flags. Runtime real Workspace adapter belongs Task5, but Task4 must implement a concrete adapter accepting injected authenticated workspace lookup/search and explicit raw-original availability.

## Prompt trust boundary

Retrieved documents, questions, and user clarification are data, never system instructions. Include explicit untrusted-source boundary in grounded prompt; no tools/web or provider fallback. Every claimed business conclusion must have current evidence. Deterministic ID/quote checks are necessary but do not prove semantic entailment: report this practical limit; fabricated facts and suggestions-as-approved decisions remain zero-appearance release-set cases rather than unsupported claims of automatic proof.
