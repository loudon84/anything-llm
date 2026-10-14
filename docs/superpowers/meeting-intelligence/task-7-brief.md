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
Prisma 5.3.1 generated SQLite client in this repo does not expose createMany for new models. Use awaited per-row create inside transactions, not unsupported bulk operations. Client generated; Task5b fresh isolated SQLite smoke applied all 43 current migrations. Tests that need real database should isolated temp copies/fixtures, not production.

## Import scope integration
Scope from/to are numeric elapsed millisecond offsets (0 valid); attachmentIds selects externalFileIds. Omitted bounds mean full transcript, omitted attachments means all supported document artifacts. Derive selected duration from actual bounds. Check T2 report for finalized adapter result fields.

## PDF hybrid same-page integration gap to verify/fix

T3 nowOCRs pages lacking native text, but scan+native header on the SAME page can still skip body-image OCR. Add real PDF fixture page with native header plus imageXObject containing scannedbody, configuredOCRstub text; assert native+OCRcontent both indexed withpage provenance. Inspect pdf.js operator/image information (localinstalledpdf-parse) to trigger image/scanned-content OCR even when nativeheaderexists. PuretextPDF must remainlocal; mixedfile same-page mustnot silentlyomit scans. Necessary parserintegrationfix inTask7scope, report/lint/retestparser/index/source coverage. Don't guess nonexistent image text; requireconfiguredOCR and validatedactualOCRoutput.

## Actual Linux runtime availability

Controller environmentprobe: docker notinstalled/onPATH; wsl --list --quiet exits1 withWSLinstallinstruction, noavailableLinuxruntime. Do not installsystemDocker/WSL aspartcoding. WindowsautomatedfreshDB/runtime/buildverification mayproceed, Linuxfreshdeployment remains explicitreleaseverification requiringexternalLinuxhost, notclaimedpassed.

## Runtime integration regressions

Use finalized task-5b-report.md and its fix/review addenda. Add integration coverage for configuration changes between operations: same-dimensional embedding model A -> B must change the actual profile, reject old indexed data as a controlled index/profile failure, then explicit single-meeting rebuild restores querying. Capture the engine/profile consistently within one operation. Also change saved OCR endpoint/token and prove the next parse job uses the new configuration with a controlled local test service; no live secret/service needed. Task5b positive QA/actual Chroma/actual resolved OpenAI abort/current Workspace original/auth-denial regressions already exist, so reuse them rather than duplicate implementation tests. Validate provider adapters against actual existing field names where the integration needs them; a mocked .model field alone does not demonstrate the real model profile contract.

## Full app / UI verification isolation

server/utils/prisma/index.js constructs PrismaClient without a datasource override, and schema datasource URL is hard-coded SQLite. DATABASE_URL/STORAGE_DIR alone does not prove database isolation for actual server/index boot. Use a test-only preload/harness which explicitly sets every shared PrismaClient datasource to a fresh test DB (all43migrations) before imports, and inject controlled embedding/LLM/remote adapters only in that test launch where no real external credentials exist. Product code must not gain automatic fake adapters. Attempt real existing frontend+server bootstrap/UI with owned unused loopback ports and own helper processes, exercise Center/Detail/sourceview/conversation/settings as possible, retain screenshot evidence if rendered. Label synthetic fixtures/external substitutes and distinguish full local UI/API execution from live provider/Linux acceptance. If native/system dependencies block boot, report exact error and available verification; don't modify/install system software or inspect genuine credentials.

## Confirmed historical-file reupload state gap (PRD180)

Controller focused contract check of sources.js ensureSupplementAllowed/persistSupplement/upload (lines123,326,330,358,396) shows upload permits APPROVED and checks only current activeHash duplicates; it does not distinguish a brand-new file from reuploading a deleted supplemental file. PRD180 requires delete AND reupload submissions both DRAFT, while brand-new additions may downgrade APPROVED. Add real integration regression: two effective sources -> delete SUPPLEMENT_FILE while DRAFT -> finish cleanup/reindex -> approve with remaining content -> upload same old content (renamed) -> reject without changing approval/generation/active sources/quota; archived old file remains retained. In DRAFT, same file reupload succeeds with new source ID; across different meeting IDs identical content remains allowed. Narrowly enforce in the source upload publication transaction using historical deleted SUPPLEMENT_FILE contentHash in the same internal meeting, while preserving approved genuinely new-file additions -> DRAFT. Retest source cleanup/temp upload/error and integration paths. No new lifecycle/downgrade endpoint or frontend hash-only authority.

## Actual UI/PRD115 attachment capacity correction

Root browser checked the isolated real app. Detail says supplementary text consumes500MB; source checkLimits uses active.reduce including SUPPLEMENT_TEXT bytes. PRD115 defines100MB/file,20attachments,500MB combined Tencent original and supplemental FILES. Correct current-file totals/check only for file uploads; text consumes neither attachment count nor attachment capacity, retains existing generic request-body constraints. No new text size policy. Add realDB boundary regressions without allocating500MB buffers; fix frontend totals/copy if needed. Replace exposed AVAILABLE/SUPPLEMENT_FILE/hash wording with plain Chinese user labels; no broad redesign. These actual frontend changes justify one final production build.

## Actual full-app UI contract defects

Root created fixed-scope conversation1 in isolated app: /meetings/conversations/1 crashed answers.slice. Real API /answers HTTP200 returns {answers:{conversation,answers}}, not the page's expected answers array. Correct actual endpoint/client envelope and preserve conversation metadata, add real API/history loading regression, restart only owned API process to test latest code. Original fileGET HTTP200 bytes/CORS works; explicit VITE_API_BASE fixed harness setup, but TXT blob iframe stayed blank. Use safe React text preview for text original; restrict generic binary previews to safe PDF/raster or safe escaped text/download-only and sandbox iframes; HTML/SVG/unknown must not execute as same-origin documents. Include actual-preview/SSR classification+escape tests and conditional no-snapshot source wording; user-facing labels in Chinese. Root owns browser proof and will report actual success after fixes.
