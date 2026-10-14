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

## Import scope integration
Scope from/to are numeric elapsed millisecond offsets (0 valid); attachmentIds selects externalFileIds. Omitted bounds mean full transcript, omitted attachments means all supported document artifacts. Derive selected duration from actual bounds. Check T2 report for finalized adapter result fields.

## Manifest discovery contract
Tencent client adds describeMeeting(externalId,{startTime,endTime}), sharing private record discovery with getContent. Public manifest exposes attachment externalFileId/name/bytes, transcriptDurationMs and recording/capability metadata, never signed URLs. API GET /meetings/remote/:externalId/manifest accepts date-window/connectionId query and returns {manifest}. UI loads before scope confirmation so user can select attachmentIds and elapsed range. Multiple recordings must normalize a shared timeline, not apply a fresh 3-hour window to each recording. See T2 report.

## Transactional audit integration
Existing EventLogs.logEvent uses global Prisma and catches errors. Do not call it from inside an open SQLite transaction callback (separate write can deadlock). Prefer extend domain audit callback to accept current db transaction and write db.event_logs.create there; or audit after commit without losing/error-swallowing evidence. Record critical changes with actor/time/result and sanitized metadata, never credentials. Any integration edits to domain callback signature must be small and retest affected lifecycle/source tests.

## Final Task2 runtime contract
Read task-2-report.md and actual exported signatures: importer clientFactory receives {connection,config}, not raw ID; sourceService.prepareImport gets downloaded buffers, commitImport writes inside importer transaction. configService has getPublic/save/getPrivate. meeting_jobs schema now has leaseOwner/leaseUntil; migration42 included. Runtime must honor job handlers and leases, and use same normalized active identity. GET manifest uses client.describeMeeting and never returns signed URLs.

## Task3 adapter update
Indexer uses embedDocuments(texts)/embedQuery(question); wrap existing embedder.embedChunks(texts)/embedTextInput(question) explicitly. Source service persists jobs inside its own tx; runtime runner polls without an enqueue callback that writes separately. OCR services.ocr.url is the full /parse endpoint, not base URL; admin UI and config validation must agree with Task3 report. Approval must ignore resolved historical jobs for deleted/superseded sources without rewriting failure history.


## Final Task3 fix interfaces

Indexer.reindex(meetingId, {job}) accepts runner durable lease job; sourceService.process(job) uses this. commitImport(tx,meeting,prepared,{onRollback}) registers filesystem cleanup with importer outer transaction; importer implemented registration. Runtime need not wrap separate transactions. Source getSource returns current retained source, segments envelope may be object with provenance. New source/index publication checks job lease and exact active source state. Keep job lease renewal enabled during long OCR/embedding.

## Streaming upload handoff

SourceService.upload currently accepts buffer; endpoint disk multipart alone would still allocate 100MB/request if it reads into buffers before background processing. Extend narrowly to accept trusted temporary filePath+name, stream SHA256 and copy into generated contained storage paths, then queue asynchronous parsing. Keep buffer variant for importer/tests. Never accept arbitrary paths from JSON/body; only server-issued multipart paths. Tests must cover rejected temp cleanup and buffered/streamed duplicate equivalence. Report integration edits and rerun source tests.

## Config completion owned Task5

Current T2 config allowlist only Tencent fields; getPublic does not yet expose appId/sdkId/operatorId nor parser services. Extend config.js narrowly: public nonsecret settings needed by admin UI, services.ocr full /parse URL plus configured/token-presence hint; OCR bearer token encrypted with credentials and retained on blank update, never returned raw. Runtime must obtain current service config after saves (not capture boot-time empty parser). Validate configured URL scheme/endpoint without treating runtime service errors as capability absence. Add save/getPrivate/getPublic token-redaction regression with synthetic token, preserve originalTencent config tests.

## Embedding runtime error boundary

Controller inspection found indexer.cosine returns -1 for dimension/invalid/zero-vector mismatch then search drops it as irrelevant. At minimum distinguish incompatible/corrupt index vectors from valid negative similarity: throw controlled INDEX/EMBEDDING failure (not empty evidence -> AWAITING_SOURCES); validate document vector dimensions consistently and reject zero vectors. Narrow indexer.js integration change + regression permitted under Task5. Track embedding profile/model changes explicitly or document controlled rebuild requirement with a detectable profile identity; never silently compare incompatible embedding models.

## Workspace raw-original retention gap

Controller verified collector/utils/files.trashFile deletes uploads after parsing; parsed JSON is retained but binary originals are gone. PRD requires opening original Workspace file with filename+snippet downgrade, fresh deployment means add retention for new uploads. Narrow shared hook in CollectorApi.processDocument is permitted: before collector parse copy hotdir file safely to generated UUID beneath STORAGE_DIR/workspace-originals; after successful parse append trusted original reference to each returned document JSON (preserve moves/metadata); cleanup copy on failures. Do not trust arbitrary metadata.originalFile from users. This central hook covers GUI/API ordinary Workspace imports without duplicating uploads. Runtime retrieval resolves current Document membership and retained file; endpoint GET /meetings/workspaces/:workspaceId/sources/:documentId/file requires existingWorkspaceaccess and document membership, safe path/headers. Original missing older/link sources get explicit originalUnavailable or genuine HTTP(S) source URL, never fictitious local link. Add retention/authorizedview tests with injected Collector mock; collector dependencies need not be installed. Task6 consumes originalHref/availability from citations. Do not add unrelated knowledge management UI.

## Required audit reliability

PRD10/13 requires critical operation audit. Propagate transaction db as optional second parameter from all transactional lifecycle/source/import/QA hooks; audit adapter writes sanitized event inside same tx. Do not silently swallow audit failures for state-changing critical operations (can roll back); background job completion/failure still retains durable status/error. Existing QA best-effort catches must be removed or adjusted for critical answer/creation records. Test injected audit failure does not return successful unlogged critical mutation. No raw source text/credentials in audit metadata.

## Workspace current-source publication guard

Actual document model is workspace_documents with workspaceId, docId, metadata,lastUpdatedAt. Real Workspaceretriever must verify each evidence document still belongs to selected accessible Workspace, including immediately before successful answer publication; delete/unembed or access revocation during generation must block new successful answer rather than reuse old retrieved text. Coordinate Task4 adapter validation/snapshot contract as needed, pass transactiondb for atomicmembership reads. Do not guess docId from source filename: inspect actual vector source metadata and Document.add paths. Historical snapshots remain old evidence and open-original ACL checks remain current.

## Archived-source read-only behavior

Current source remove physically removes supplemental original files after soft-deleting row; meeting deletion retains original files. PRD REQ-MEETING-005 says historical supplemental materials retained, so retain originals of soft-deleted sources consistently as archives, no currentquota/hash/retrieval eligibility. Only rejected/staged failed upload cleanup removes files physically. Add a narrowly scoped archived read-only source accessor (or includeArchived option used only GETfile/segments), permitting historical citation opening for deleted meetings/sources with explicitdeleted flags; mutations and indexer keep rejecting them. Test delete/source/newretrieval blocked while oldfile/textsnapshot read accessible. Retained histories do not auto-link to reimported meeting/source ID.

## Approved supplemental-text deletion correction

Task3 source remove currently checks DRAFT before classifying source; that wrongly blocks SUPPLEMENT_TEXT deletion on APPROVED. PRD explicit: approved supplementary text deletion allowed then returns DRAFT and pauses/reindexes; supplementary FILE deletion only currentDRAFT and rejection mustnotchange reviewstatus. Remove blanketDRAFT guard, use centralized assertSourceDeletion(meeting,source) supplement-only policy, update approved-text meeting toDRAFT in same tx. Add regressions bothapprovedtextallowed+downgrade andapprovedfiledenied+statusunchanged; keep summary/transcript/originaltype deleteforbidden.

## Empty/missing summary and transcript integration

meetingService.revise currently updates fields and queuesREINDEX only; reindex iterates existing SUCCESSsources, so manually filling originally absent SUMMARY/TRANSCRIPT creates no indexedsource. In revise tx create the missing source record for nonempty new text (locatedparagraphs, hash, immutableidentity), then normalreindex publishes usablechunks; narrow lifecycleintegration permitted. Clearing existing content must remove currenttext/chunks and yield WAITING_CONTENT iflasteffective, never use old storedtext when nullablefieldcleared. API validate revision values string (empty permitted) or explicitclearpolicy consistently; don't pass objects toPrisma. Tests metadata-only ->manualsummary ->AVAILABLE, revisionclear ->no oldevidence /WAITING iflast. Audit usescurrenttx. Existing fullyimported edit timing/source syncregression remainsgreen.

## Sequential execution refinement

Task5a handles service fixes and original-retention/audit/profile groundwork from this brief before this subtask. Read finalized task-5a-report.md, Task4report and actualinterfaces; reuse reviewed implementation rather than reimplement it. Task5b owns endpoints/runtime/serverbootstrap and actualWorkspace/provider wrappers, one coherentAPIreport forfrontend. Only narrow integration gaps may touch Task5a code, retest them. Task5 umbrella completes after5a/5b reviewsgreen.

## LLM runtime contract details

Task4 generate currentlyreceives system,prompt,question,clarification,evidence; add userId asneeded toselect actualrouteruser without leaking priorWorkspacechat. resolveProviderConnector accepts syntheticmeetingcontext plus chatHistoryOverride:[] and messageCountOverride:0; avoid incidental existingWorkspacehistory DBqueries. Groundingpolicy must be actualsystemrole instruction, question/retrievedJSON remain untrusteduserdata. Existing stripThinkingFromText helper canremove explicitreasoningtags before strictJSONvalidation; don't repair factualcontent or silentlyextract inventedresponse. No providerfail fallback. For stream-capable connector, use its existing streamGetChatCompletion/handleStream behind boundedSSEsink (EventEmitter-compatible), collect textResponseChunk and explicitabort/error so partialText becomesFAILED_INCOMPLETE. handleStream often resolves partialtext onerror ratherthanrejecting, inspect emittederror and don't mistakenlyacceptpartialJSONascomplete. Completion-onlyproviders cannot retainunreceivedpartialdata; reportlimit. Test synthetic partialstreamaborts, invalidcompleteJSON controlledfailure, correctprovider/user routing and nofallback. Endpoint may return completedJSON record; showfailedpartialexplicitly inclient.

## Final Task4 handoff (470ac235)

Read task-4-report.md updatedinterfaces. meeting_answers hasnullableclarification field; migration20261014020000, total43migrations. sourceState is JSONobject {manifest,citedSources}, supports priorarrayread forintermediatefixtures. CurrentgetConversation/history expose scopeState:{available,blockedReason}, separatefrom answerstale/newSources. QA's llm.generate gets system,prompt,question,clarification,evidence; provider/runtimeUserintegration mayadduserId. WorkspaceRetriever has resolve/search currently; Task5a mayadd injected source-state/evidencevalidation methods forruntime actualWorkspacefreshness, preserving currentfactory. Prioranswerquestion/missingInfo/clarification used onlyboundedconversationalreference; oldanswertext/citations never evidence. Add actualWorkspace metadata to citation snapshot whitelist forsourceid/revision/approvedoriginalhref as needed, not arbitraryfilesystempath. RuntimeTask5b consumes contracts fromTask5a report; UI uses explicitscopeState andsavedclarification ratherthanreconstructingfromsourceState.

## Configuration read visibility ruling

GETconfig is authenticated: admins receive complete redacted nonsecretsettings/hints forSettingsUI; otherusers receive onlyprimary connectionid/name/configured/capabilities status needed byCenter/manualimport, nooperatorIDs/serviceURLs/credentialhints. PUTalwaysadmin. No extraAPIneeded, response{config} stable. Backendmustapplyreadprojection notmerelyhiddenUI; testdefaultuserread vsadminread, secretneverreturned. Existing authsingle-user mode actsadmin asappdoes. Task6Center mustwork withminimalstatusconfig; Settings protectedadmin.

## Manual embedding rebuild recovery

Profilemismatch must have explicitmanualrecovery: meetingService.requestReindex(id,userId) (or report equivalent) atomic durableREINDEX job/block/dedup, preservesreviewstate ifcontentunchanged; neverautoembeddingallmeetings/providerfallback. Testoldprofilecontrolledfailure->manualrebuildnewprofile->queryable. Task5b adds POST /meetings/:id/reindex =>202job; Task6 exposesretry/rebuildaction when needed withclearjobstate. Useexistingrunner/reindex, notnewpipeline.

## Stable operation versus current configuration

Task5a indexer captures profileId atfactoryconstruction. Runtime mustcreate operation-scoped indexer/embedder from currentconfiguredengine/model/profile (request/job), not oneboot-time singleton with newenginecalls but oldprofileId. Snapshotconsistent engine+profile for oneoperation; subsequentjobs/questions honor adminconfigurationchanges. Include same-dimensional differentmodel profile regression through runtimeadapter (dimensionguardalone missesit). OAuth/Tencentsettings OCRalso readcurrentconfig asrequired. No uncontrolledoldservice continuation on subsequentcalls afterconfigsave.

## Real Workspace revision verification

workspace_documents.lastUpdatedAt is @default(now), not @updatedAt. Confirm actualDocument/syncupdate paths advance revision or replace docId; don't assume anycontentchange automaticallyupdates thisfield. Runtimeevidence revision must actuallytrack indexed/currentsource content, add contentrevision/hash adapter ifnecessary with5a comparisoncontract. Inspect realvectorprovider source shape (someparseChunkSource projectiondropsdocId) and map exactcurrentworkspace_documents membership from actual stablemetadata, nofilenameguess. Tests should use realistic provider source shapes and genuine metadata/content update lifecycle.

## External error text privacy boundary

Do notpersist/return raw SDKresponse bodies, authorizationheaders or credential-bearing URLs inpublicanswer/joberrors. Runtime externalprovider wrappers return controlledstage/code/status and scrub knownconfiguredsecretvalues; preserve partialanswertext asFAILED_INCOMPLETE separately. Use syntheticcredential-echoerror regression (neverrealcredentials). Controlleddomain messages (limits/noevidence/citationvalidation) remain useful; diagnostics cannotleak Tencent/OCR/providersecretstoemployees.

## Reviewed Task5a handoff (409e66d8)

Read task-5a-report.md finalrounds. Indexer exposes prepare/reindex/search/profileId/validateIndex; embeddingobjectenvelope{profileId,vector}, preparedimports also carryprofileId. getArchivedSource returns source plusdeleted,meetingDeleted,readOnly. Bufferedupload or{ name,tempPath } withtrustedUploadRoot; servicecleansservertempfiles safely. requestReindex(id,userId,profileId) returnsdurablejob, preserveapproval. Source segments JSONenvelope preserved. WorkspaceRetriever {lookupWorkspace,searchWorkspace,lookupDocument} resolve/search/validateEvidence; db nowforwardedtoWorkspaceACLlookup; historyWorkspacecitations validatedfreshness. CollectorflatJSON top-levelworkspaceOriginalId persisted; workspace_documents.metadata includesworkspaceOriginalId; originals.resolve({referenceId,workspaceId,docId}) returnsfilePath/fileName aftergenuineidentity+membershipbinding. SourceServiceparserstaticinjection meansruntime mustcreatefreshparserfromgetPrivate onoperation; noactualdynamic-useverifiedyet. getPublic returns savednonsecretTencent appId/sdkId/userId/operatorId/operatorIdType plusservices.ocr {url,configured,tokenPresent}, masks credentials. OCRURLexactHTTP(S)/parse(/optional), userinfoinvalidgeneric; tokenBearer encrypted. Runtimeactualprovider/Workspace wrappers areyourtask.

Realprovider sources mayuseone documentIDformultiple chunks. Return distinctevidenceIDs fromactualchunkIDs orstableinternaldocument+quotehash+ordinal, separatefromdocumentId/currentrevision; don'toverwriteevidenceMap sofirstchunkcitationisrejected. Preserveactualdocumentidentity/provenance, nofilenameguess or inventedoriginlinks. Include multi-chunk-same-doc fixture fromrealprovider projection.
