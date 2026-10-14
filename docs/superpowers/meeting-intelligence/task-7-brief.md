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


### Task 7: Integration and release evidence

**Files:** Integration tests `server/__tests__/meetings/integration.test.js`; `docs/meeting-intelligence-deployment.md`; amend only task-owned implementation gaps; update this plan TODO and execution ledger.

- [ ] Fresh Prisma migration/generate, exercise metadata import → file/text supplement → AVAILABLE → approval → new supplement DRAFT → delete source → cleanup; verify originals readonly, reanswer snapshots and duplicate/quota policies.
- [ ] Regression tests for scope/source changes during model response; full new meeting suite and frontend production build/scoped lint.
- [ ] Capture real test evidence and supported formats/services; record credentialless Tencent verification limits and unmeasured Linux/OCR/performance gates honestly.
- [ ] Final branch diff review, fix important findings via GPT-6 Luna, focused retest and review.
- [ ] Final deliverable links plan/TODO, code worktree and branch; do not claim Linux/live-release gate passed on Windows or absent credentials. Do not push/merge automatically.


## Verified database constraint
Prisma 5.3.1 generated SQLite client in this repo does not expose createMany for new models. Use awaited per-row create inside transactions, not unsupported bulk operations. Client generated, all 41 migrations applied to ignored worktree storage DB. Tests that need real database should isolated temp copies/fixtures, not production.

## Import scope integration
Scope from/to are numeric elapsed millisecond offsets (0 valid); attachmentIds selects externalFileIds. Omitted bounds mean full transcript, omitted attachments means all supported document artifacts. Derive selected duration from actual bounds. Check T2 report for finalized adapter result fields.

## PDF hybrid same-page integration gap to verify/fix

T3 nowOCRs pages lacking native text, but scan+native header on the SAME page can still skip body-image OCR. Add real PDF fixture page with native header plus imageXObject containing scannedbody, configuredOCRstub text; assert native+OCRcontent both indexed withpage provenance. Inspect pdf.js operator/image information (localinstalledpdf-parse) to trigger image/scanned-content OCR even when nativeheaderexists. PuretextPDF must remainlocal; mixedfile same-page mustnot silentlyomit scans. Necessary parserintegrationfix inTask7scope, report/lint/retestparser/index/source coverage. Don't guess nonexistent image text; requireconfiguredOCR and validatedactualOCRoutput.

## Actual Linux runtime availability

Controller environmentprobe: docker notinstalled/onPATH; wsl --list --quiet exits1 withWSLinstallinstruction, noavailableLinuxruntime. Do not installsystemDocker/WSL aspartcoding. WindowsautomatedfreshDB/runtime/buildverification mayproceed, Linuxfreshdeployment remains explicitreleaseverification requiringexternalLinuxhost, notclaimedpassed.
