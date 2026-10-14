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


## Baseline build prerequisite
Existing frontend BrowserNative SpeechToText imports regenerator-runtime but frontend/package.json does not declare it; initial production build failed at that import. Add direct frontend dependency using version pinned in existing frontend/yarn.lock, preserve lockfile pattern; verify complete build. This is in your task scope. Initial piper browser-externalization warnings are baseline warnings, not caused by meetings.

## Verified database constraint
Prisma 5.3.1 generated SQLite client in this repo does not expose createMany for new models. Use awaited per-row create inside transactions, not unsupported bulk operations. Client generated, all 41 migrations applied to ignored worktree storage DB. Tests that need real database should isolated temp copies/fixtures, not production.

## Import scope integration
Scope from/to are numeric elapsed millisecond offsets (0 valid); attachmentIds selects externalFileIds. Omitted bounds mean full transcript, omitted attachments means all supported document artifacts. Derive selected duration from actual bounds. Check T2 report for finalized adapter result fields.

## Manifest discovery contract
Tencent client adds describeMeeting(externalId,{startTime,endTime}), sharing private record discovery with getContent. Public manifest exposes attachment externalFileId/name/bytes, transcriptDurationMs and recording/capability metadata, never signed URLs. API GET /meetings/remote/:externalId/manifest accepts date-window/connectionId query and returns {manifest}. UI loads before scope confirmation so user can select attachmentIds and elapsed range. Multiple recordings must normalize a shared timeline, not apply a fresh 3-hour window to each recording. See T2 report.
