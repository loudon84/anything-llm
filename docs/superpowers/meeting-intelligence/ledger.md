# SDD ledger — plan: docs/superpowers/plans/2026-10-14-meeting-intelligence.md

- Worktree: C:/Users/smc-sz-hr21007/.codex/worktrees/meeting-intelligence-3204/anything-llm
- Branch: codex/meeting-intelligence
- Baseline: 1336d327f4460510b755059b15481fd94a57cef7
- Execution requested: GPT-6 Luna subagents.
- Ruling: Use approved PRD as scope authority and execute requested plan automatically after self-review — user explicitly requested planning followed by subagent coding — incorrect task decomposition remains reversible.
- Ruling: Asia/Shanghai initial business timezone; date interval [from,to) — deterministic quarter boundaries — wrong timezone changes archive assignment and needs recalculation.
- Ruling: File MB limits decimal bytes, .docx/.xlsx/.pptx and common PNG/JPEG/WebP first release — exact limits/extensions absent from PRD — broader legacy formats would need extra parser work.
- Ruling: Additional local/remote OCR parser service must return located segments; never use flat collector output as precise page evidence — preserves PRD locator requirement — deployment must provision this service.

## Preflight

- T1→T2: createMeetingService createMetadata + db.meetings/jobs share names; importer transaction capacity and unique active identity align.
- T1→T3: meeting_sources activeHash+meetingId uniqueness; generation gates and source deletion align.
- T2→T3: prepareImport(content), commitImport(tx,meeting,prepared), source PROCESS handler match runner handler contract.
- T3→T4: search(meetingIds,question,limit), source segment/location shape match citations; current generation checked.
- T4→T5: createQAService signatures map POST conversation/questions and history; immutable sets maintained.
- T5→T6: all route paths and envelopes provided; static conversation routes registered before numeric meeting IDs.
- T1: tests and policies cover quotas/current state; schema introduces additive tables only.
- T2: tests distinguish runtime failure vs confirmed capability absence; documentation research ongoing.
- T3: requires real location preservation and configured OCR; no unconditional unsupported success.
- T4: no model fallback; malformed/out-of-scope citations rejected; historical answers not independent evidence.
- T5: auth/runtime wiring and id validation owned here; upload temp cleanup specified.
- T6: client follows exact API; only designated existing app glue modified.
- T7: live Tencent credentials/Linux performance unavailable, explicitly separate release gates from automated unit integration checks.

## Tasks

- [x] T1 Persistence / lifecycle — complete (cca287a0..b1cadb8b; scoped review clean, 18 tests)
- [x] T2 Tencent / jobs — complete (3e56ec60..520c1cf9; scoped review clean, 30 tests)
- [x] T3 Parsing / sources / index — complete (a24db03b..0f4cd881; scoped review clean)
- [x] T4 Grounded QA / history — complete (aba37279..470ac235; scoped review clean)
- [x] T5 API / runtime — complete (5a + 5b scoped reviews clean, GPT-6 Luna)
- [x] T6 React pages — complete (cb52940a..5ad54b24, scoped review clean)
- [ ] T7 Integration / review — in progress (GPT-6 Luna, BASEa4d7d97d)


- Baseline setup: npm installed with lifecycle scripts disabled; Prisma client generated explicitly after baseline missing-client failure. Root selected regression rerun pending. Frontend baseline production build pending.

- Baseline frontend build failed before feature changes: existing BrowserNative imports undeclared regenerator-runtime. T6 owns adding direct dependency (version from existing yarn.lock) and build retest; existing piper browser-externalization warnings separately recorded.

- Baseline selected regression: 2 suites / 52 tests passed after Prisma generate. Test output includes existing EncryptionManager initialization log. No product code change required for that setup issue.

- T1 fix round 1/5: reviewer found caller quarter bypass, unnormalized duplicate key and missing real DB race evidence. Parent added self-reservation quota check (199 meetings + own import reservation must still finalize the 200th). Fix returned to GPT-6 Luna implementer.
- Local DB smoke: Prisma client generated; all 41 migrations applied successfully to fresh ignored worktree SQLite DB. Initial migrate failed on missing database file; Prisma connect created the empty file and deploy succeeded.

- T1 fix round1 implemented: 18 tests including real temporary SQLite concurrent duplicate and final-quarter-slot tests pass. Scoped rereview pending; generated SQLite createMany unavailable, all downstream briefs note this.


- T2 scope refinement: elapsed from/to offsets, zero valid; selection duration from actual bounds and attachmentIds manifest. Controller detected T1 || drops from=0; T2 instructed to correct as integration regression.

- Ruling: Add manifest discovery before scope confirmation (GET remote/:externalId/manifest); PRD requires choosing actual attachments and limits, metadata list alone cannot support this — cost if wrong: extra official calls, bounded and paged.
- T2 timeline note: official transcript timestamps are offsets within each record file; normalize multiple files to one selected meeting timeline, retain record IDs and enforce overall selected-duration limit.

- T2 committed 3e56ec60: 19 tests, Prisma and scoped ESLint pass. Independent review in progress. Added meeting job lease columns via additive migration. Full parser/source prepared-result internal shape owned by T3; final contracts carried into T3/T5 briefs.

- T2 fix round1/5: independent review found transcript pagination truncation, vanished selected artifact IDs, multi-record summary/capability overwrite, malformed200 mislabeled absent, empty-artifact fallback and full-body timeout gaps. Returned all six with required regressions to same GPT-6 Luna implementer. No dependent implementation dispatched until corrected/reviewed.

- T2 fix round1 committed 520c1cf9; 30 tests/schema/lint green, six completeness/transfer findings addressed by implementer, scoped rereview pending. Summary segments now retain recording provenance; downstream T3 brief updated.


- T3 runtime handoff: explicit embedDocuments/embedQuery adapter; original AnythingLLM embedder uses embedChunks/embedTextInput. Source jobs written through transaction client (no external enqueue during tx). OCR URL full /parse endpoint. Typed text approved deletion remains original PRD rule; files only draft deletion. Approval filtering must retain historical failures while ignoring resolved deleted-source jobs.


- T3 review report written despite final reviewer model capacity error: seven actionable findings (source/chunk ownership, source-set/lease races, pending-source recovery, supplement-only deletion, outer rollback file cleanup, format-specific OCR provenance). Parent added required PPT embedded-image OCR and mixed scanned/text PDF coverage findings.
- Ruling: A single image source ID identifies whole-image provenance; no pixel bounding-box requirement — PRD only demands locating the image, shared schema has no crop fields — cost if wrong: word-level highlighting would require new OCR metadata/UI.

- Task 3: fix round 1/5 committed 98cdd44f; all ten categories addressed by implementer. Controller independently reran 7 meeting suites / 84 tests PASS; scoped rereview in progress. Reviewer initially hit capacity; replacement scoped reviewer GPT-6.1 Sol used, implementer remains GPT-6 Luna.
- Task 3: fix round 1/5 rereview ten findings addressed, one new P1 open: same scanned PDF page returns multiple OCR segments and Map keeps only the last. Fix round2 returned to GPT-6 Luna for per-page arrays/flatten and regression.

- Task 3: fix round 2/5 (PDF multi-segment loss addressed, zero open; commit0f4cd881; scoped rereview spec and quality PASS).
- Task 3: complete (commits8a7fd142..0f4cd881, review clean). Retained current source text, original locators and historical snapshots align.
- Task5 integration inspection: existing indexer drops incompatible embedding dimensions/corruption as negative similarity. Task5 must add controlled failure/profile handling; service/index failure cannot masquerade as missing evidence per PRD.
- Ruling: Retain new Workspace upload originals with a central existing collector API hook and authenticated meeting citation file route — collector currently deletes originals, PRD requires opening them on fresh deployment — cost if wrong: additional storage and a small shared-upload change; no old-file recovery claim.
- Task4 committedaba37279:96 meeting tests12focusedgreen. Independentreview5findings(availabilityrace,optionalWorkspace,followup/clarificationretrieval,clarificationpersistence,sourcehints) returned to sameGPT-6Luna fixround1/5. Minimaladditive clarification/requestcontextschema authorized; prioranswers remain non-evidence.
- Ruling: Keep soft-deleted supplementary originals as read-only archives consistently with whole-meeting deletion — PRD retains historical supplementary materials and frees activequota only — cost if wrong: archive storage grows; no hard-delete/privacy-erasure feature added.
- Task5 handoff inspection found T3 blanketdraft check before classification blocks approvedSUPPLEMENT_TEXT deletion despite centralized policy. Correct in source/audit integration, regression requested; approvedFILE remainsstrictrejection.
- Task5 integration inspection: filling absent summary/transcript fields queuesREINDEX withoutsource so never becomesqueryable; clearingnull canretainoldsource. Add missingtextsource inrevise tx and explicitclearing/validation regression duringlifecycle/APIwiring.
- Execution refinement: Task5 split sequentially into5a service integration/retention/audit/profile safeguards, then5b authenticated endpoints/runtime. Both implementersGPT-6Luna; separate task review before dependents, no parallel implementation. Keeps surfaced cross-module fixes reviewable without expanding PRDscope.
- Task7 known parsing integration gap: same PDFpage nativeheader+scannedbody bypasses currentempty-page OCRtrigger. Mandatory realfixture/assertion and minimalimageoperator-aware fix carried toTask7, not silently acceptedasrelease-ready.
- Environment read-only probe: Docker unavailable, WSLlist exits1/installinstruction. No Linux runtime available locally; actualLinuxfreshdeployment remains externalreleasegate, no systemsoftware installation performed.

- Task4: fixround1/5 (all5 addressed,0open; commit470ac235;18focused/102allgreen,43migrationsfreshinitializedDBpassed).
- Task4: complete(commits3955577f..470ac235, spec/qualityrereviewPASS). SourceState envelope {manifest,citedSources}, clarificationpersisted, scopeState independent; carriedthroughsubsequentbriefs.
- Ruling: Authenticated employees may read onlyprimaryconnectionstatus/id/capabilities viaGETconfig; fullredactedsettings andallconfigurationwrites adminonly — Center needsconnectionstate whilePRD assignsconfiguration toadmins — cost ifwrong: projection/API tests needadjustment, secretvaluesremainencrypted/unreturned.
- Task5a storagehandoff honorsuserexplicitquarterly archive directory: quarter/internalmeetingId/UUIDnewfiles, archivedsamequarter, reimportnewID; constraintcarriedtobrief/agent, no newquota/retentionbehavior.
- Ruling: Provide explicitmanual single-meeting reindex recovery forembedding-profilechanges — compatibilityguard otherwise canpermanentlyblockvalidcurrentcontent withoutrecovery — costifwrong: smalladditionalAPI/UIaction andmanualembeddingwork, noautoall-meetingjobs.
- Task5a committed7d80316c,117tests/12suitesgreen; independentreview6findings(twoP1 originalpipeline/authenticidentity, fourP2 multiWorkspace/reembedding/vectorvalidation/nonsecretconfig/historyWorkspacehints) returnedtoGPT-6Luna fixround1/5. MinorACLdbforwarding/OCRURLcontractalignment includednarrowly; currentOCR-on-use remainsruntimewiring obligation. No dependentTask5bdispatchuntilreviewclean.
- Task5a round1 additionalcontrollerP1: OCRconfig accepts URLuserinfo credentials; Node22syntheticprobe throwsfullcredentialURL inerror, whichparserwrap/durablepublicjoberrorwouldexpose. Requiregenericuserinfo rejectioninconfigandparser beforefetch, encryptedBearerfieldonly; regressionrequested. No realcredentials/networkusedinprobe.
- Task5a fixround1/5 committed00641182:125meetingtests/63adjacentgreen; rereview6of7mainfindingsresolvedinclURLuserinfo; remainingP2combined-index dimensions acrossseparateimport/sourcebatches. ReturnedGPT-6Luna round2 sharedpublicationvalidationregressions.
- Task5a minor(deferred): identical-key originalmembership bind EEXIST canread beforefirstwritecomplete; actualDocument callers mintdistinctdocIDs, no demonstratedordinarymultiWorkspace regression. Finalwholebranchreviewmusttriage; seeTask5a rereview.
- Task5a fixround2/5:409e66d8, F4resolved0blockingfindings;47focused/127allmeetinggreen; scoped spec/qualityPASS.
- Task5a: complete(commits925a6bc3..409e66d8, reviewclean with1deferredminorforfinalreview). Task5b startsauthenticatedAPI/runtimeactualadapters.
- Task5b committed7ee655c1:17suites/142tests green;43freshmigrations + realPrisma/Express smoke withfakeexternaladapters. AuthenticatedAPI/current-config adapters/HTTP+HTTPS runner lifecycle complete perimplementer; independentreviewpending. Live/Linux gates remain unverified.
- Task5b review:5Important findings(P1 provider-outputcontract, Workspaceoriginalresolverbootstrap, Chromaactualvectoridentity, resolvedstreamabort; P2 auth/roleJSONenvelope) returnedtooriginalGPT-6Luna fixround1/5. BoundedSSEminor includedwithstreamfix. PriorTask2/3/4/5a safeguards coveredbycompletedscopedreviews; externalLinux/live/semanticgates unchanged.
- Task5b fixround1/5 committedb1387775:5Important+boundedSSEminor addressedperimplementer; positiveactualruntimeQA/chromavector/resolvedabort/defaultoriginal/authdenial regressions. 148meetingtests/16suites green; scopedrereviewpending.
- Task5b fixround1/5:all5Important+SSEminor ADDRESSED,0open; b1387775 scoped spec/qualityrereviewPASS. Task5:complete(commits925a6bc3..b1387775,5a/5b reviews clean). Task6 startsReactpagesonfinalAPIcontracts.
- Task6 interruption/resume:provider usage cap interruptedbefore finalreport/commit; userrequestedcontinue afterreset. Existingfrontendwork preserved; sameGPT-6Luna resumedfinalverification/report, no completedtaskredispatch.
- Task6 committedcb52940a:5Nodehelpertests,scopedlint/format/fullVite+postbuildPASS. ExistingPiper/import/chunkwarningsrecorded; noappboot/screenshotsclaimed. Scopedreviewpending; finalUIexecutionownedTask7.
- Task6 review8Important(remotepage/datecontract, coverageReactobjectcrash, approvedactionmatrix, absenttranscriptrange, provenance/revisionfields, pollingstateclobber, uploaderrorcleared, importlimits)+reanswerminor returnedoriginalGPT-6Luna fixround1/5. Narrowreadonlyprovenancemetadata seam allowedifrequiredbyactualhistorycontract; no lifecycle/ACL/schema redesign. UIboot stillTask7.
- Ruling: Permit a narrow read-only meeting/citation provenance metadata seam in Task6 fixes if the existing responses cannot support deleted-history title/date/change display — PRD requires traceable metadata and retained historical citations, so frontend-only guessing is insufficient — cost if wrong: small extra response fields and regression coverage; no new lifecycle, permission or full-content version model.
- Task6 fixround1 initialcommit2066a4c1:17frontendtests/scopedlint/format/fullbuildPASS perreport. Controllerhandoffcheck reportstillstatesapprovednewFILEblocked, contradictPRD180/new-supplementrule; returnedimmediatelysamefixwave(beforeindependentrereview)forcode+actionmatrixverification/correction. Finalfixheadpending.
- Task7 confirmedintegrationgap: sources.upload transaction onlychecksactiveHash; afterdraftfiledelete→remainingcontentapprove, samehistoricalfileuploadcurrentlyacceptedonAPPROVED andautodowngraded. PRD180requiresreuploadsubmitDRAFT. Narrowhistoricalsame-meetingSUPFILEhashguard+realworkflowregressions assignedTask7; genuinelynewapprovedFILE additions remainallowed. Controllerread-onlycontractcheck,no codefix.
- Task6 fixround1 finalHEADd382f1b3(2066a4c1+d382f1b3):8Important+reanswerminor addressedperimplementer; approvedgenuinelynewFILEadditioncorrected;17tests/scopedlint/format/fullbuildPASS. Scopedrereviewpending.
- Task6 fixround1/5 rereview7of9ADDRESSED;2Importantremain(original#5 Workspacefreshness/revision/unverifiable display, #7 subsequentpollclearsuploaderror). No newbreakingfinding; returnedoriginalGPT-6Luna round2scopedfix. Meetingprovenance/coverage, remotepage/date, approvedactionmatrix, absenttranscript, filter/edits, importlimits/reanswer nowADDRESSED.
- Task6 fixround2 committed5ad54b24:remainingWorkspaceprovenance/currentversionunverifiable+subsequentpolluploaderror addressedperimplementer.20Nodecases/scopedlint/format/buildPASS; scopedrereviewpending.
- Task6 fixround2/5:bothremainingfindingsADDRESSED,0open;5ad54b24 scopedrereviewPASS. Task6:complete(commits7f73df17..5ad54b24,2fixrounds,20tests/buildPASS). ActualisolatedUIverificationcarriedTask7. Removedonlyowncompletedtaskdiffpackages(nonrecursive); retainedplan/ledger/reports andallcode.
- Task7 startedfreshGPT-6Luna atBASEa4d7d97d: realDBintegration, PDFsame-pageOCR, historicalreuploadstateguard/currentconfig, isolatedUIattempt/deployment/evidence. ParentownssubsequentTask7gate+wholebranchAstrareview+finalTODO.
- Task7 rootUIverification: actualexistingapp + isolatedPrisma/preload running; Center/Detail rendered. ConfirmedPRD115gap:sourcecheckLimits sumsTEXTbytes into500MBattachmentquota; Detail statesTEXTconsumes500MB. AssignedLuna narrowfile-onlycapacityguard/frontendcopy+realDBboundarytests, existingbodylimitsunchanged. Also actualUI rawAVAILABLE/SUPPLEMENT_FILE/hashwording assignedsmallChinesepolish; finalfrontendbuildneededfornewchanges.
- Task7 actualbrowser: Center fixed-scope dialog behaved correctly (metadata deselect, Workspaces defaultnone); creation persistedconversation1 but QApage crashed answers.slice. RealGET200 evidence:topanswers object containsconversation+answers, notarray; assignedendpoint/clienthistorycontractregression+latestownedAPIrestart toLuna. FileAPI200/76bytes/CORSgood; initialpreview Failedfetch tracedharnessAPIbase, new41875explicitbase fetchedBlob butTXTiframeblank; safeReacttextpreview assigned. Existingunsandboxed genericoriginaliframes assignedrestrictedpreviewclassification/sandbox/escape tests. No failingUIartifacts claimedaspassed.
- Task7 committed3a1c154c: real fresh43migration Prisma integration; PDF same-page native+scan, historical approved-file reupload and attachment-only quota guards corrected; actual HTTP history-envelope regression. 18suites/154backendtests and24frontendtests/build/scopedchecks PASS per report. Parent actual isolated browser Center→fixed-scope conversation→question→citation snapshot→safe TXT current preview and Settings rendered successfully; external adapters/fixtures synthetic. Chinese answer-state/copy polish finishing; task-scoped review next, no Linux/live/performance acceptance claim.
- Task7 scopedreview e78814ca:3Important(PDF maskoperators missingOCR, swallowed PDFcallbackfailure/incorrectpageprovenance, Workspace safeTXTpreview unrendered) returnedoriginalGPT-6Luna fixround1/5. Reviewer2syntheticfocusedPDFprobes reproduce defects; lifecycle/quota/config/history/meetingpreview otherwisePASS. No Critical/newscope; finalwholebranchreview waits untilscopedgateclean.
- Task7 cleanup: onlyownedAPI/Vitehelpers stopped; ports41873/41875/41874 no listeners. OwnTask5b syntheticSQLite removedafterabsolute-literalpathcheck. OwnTask7 `server/prisma/task7-isolated-102c2410f89148b08c2fdfaedafef1ed` schema+migrations copy (noDB/credentials) retaineduntracked: tool rejected `Remove-Item -Recurse -Force` with CreateProcess Rejected / rejected by policy. No alternate deletion workaround attempted; no production/original files changed.
- Task7 fixround1/5 f67163df:3ImportantADDRESSED,0open; scopedrereview spec/qualityPASS. 4focused suites54tests,26frontendtests/scopedlint/format/buildPASS. Task7 implementationgatecomplete(commitsa4d7d97d..f67163df); wholebranchAstrareview andfinalhandoffpending. Parentfinalbroader meeting+boot+3adjacent suites initiatedonf67163df; frontend26PASS, backendresultpending.
- Finalverification rootcurrentf67163df: meeting+boot+3adjacent21suites/222testsPASS exit0(55.745s); frontend26PASS exit0. Buildalreadycurrentf67163dfPASS perTask7, no unchangedrepeat. Expectednegativeidentity/databasefail logs disclosed. WholebranchAstrareview dispatchedBASE1336d327..HEAD6a8bfc7e; rootverificationrecord doesnotclaim externalreleasegates.
- Finalwholebranchreview resumedafteruserusage-limitcontinuation, HEAD6a8bfc7e:12Important(F1originaldedup,F2runtimeREINDEX,F3full3hbound,F4coverage,F5officialerrorenvelope,F6unknownpolicy,F7PPTorder,F8OCRdeadline,F9Workspaceindexfailure,F10frozenmeetingmetadata,F11historydiscovery/singlemeetingentry,F12stages/errors);2Minorcredentialpresence/identicalbindingrace. No Criticalestablished, mergeNOTapproved. SinglecompleteGPT-6Luna finalfixwave+onescopedrereviewrequired; rootwillnotcodefix.
- Ruling: Preserve unverified Tencent capabilities as unknown; only actual documented absence or administrator-confirmed verified unsupported capability may authorize metadata-only success — APPROVEDPRD overrides the Task2 plan's incorrect unknown-to-unsupported policy — cost if wrong: first import can remain blocked until capability verification/configuration; no invented capability evidence.
