# Whole-branch review — 1336d327..6a8bfc7e

Reviewer: GPT-6 Astra. Read-only whole-branch review; interrupted by usage limit then resumed at user's explicit continuation. **Ready to merge: No.** No Critical established; 12 Important and2Minor findings. Existing21backend suites222tests/26frontend/currentbuild/syntheticbrowser results accepted without repeats. All references below are relative to this worktree and refer to the reviewed revision.

## Strengths

Additive persistence, transaction quota reservations, retained history and snapshots; generation/lease/membership/availability publication checks; original identity/current Workspace membership and safe preview; realSQLite/provider stream/projection/PDFfailure fixtures; explicit external releasegates.

## Important findings

### F1 — Original files bypass content uniqueness
`server/modules/meetings/sources.js:330,1125-1128`: originals activeHash=tencent:externalFileId while supplementupload checks SHA256. Samebytes original→supplement or two originalartifacts create duplicateactive files/quota/evidence. UseconsistentcontenthashforallactiveFILEsources; preserveartifactidentityseparately. Regression actualimport→renamed identicalsupplement (oldtests supplement→supplementonly).

### F2 — Actual REINDEX runtime bypasses guarded source processing
`server/modules/meetings/runtime.js:376-385`, guardedservice `sources.js:908-957`: runtime directly indexer.reindex; embeddingfailure leavesjobFAILED/meetingINDEXING; queuedgenerationguards bypassed. Actualruntime runner focusedprobe confirmed. Dispatch op.sources.process(job); test runtimefailure andsupersededgeneration (oldintegrationmostlydirectsourceprocess).

### F3 — Omitted transcript bounds bypass3hour limit
`importer.js:34-35,170`, `tencent.js:311`: fulltranscript withomittedoffsets unvalidated; clipContent(emptyScope) returned4hourtranscript unchanged. Worker mustcheck actualfull/selectedbounds includingoutofrange/changedaftermanifest beforeparse/publication; notfrontendonly.

### F4 — Selected/excluded scope not persisted/rendered
`importer.js:487,547`, `frontend/src/pages/Meetings/MeetingsUI.jsx:109-124`, `Detail.jsx:279`: meetingcoverage onlycapabilitystatuses; jobpayloadscope notmeeting/citationcoverage. Onehour/oneattachment canlookfull, warningdisappearsafterapproval. Persistnormalizedcapabilities/selected-excludedscope, transcriptinterval, whole-summarycoverage; renderconfirmation/Detail/citations.

### F5 — Official Tencent nested errors undecoded
`tencent.js:145`: reads top-levelerror_code/code, official error_info.error_code unrecognized; documentedabsence30001/30002/4049 becomesfailurewithnullapiCode instead ofgenuineabsence/manualsupplement. Focusedprobe confirms. Parseofficialenvelope, safegenericpublicmessages; absence/generation-progress/permission/transient fixtures. Official [errorcontract](https://cloud.tencent.com/document/product/1095/42699) and [transcriptcodes](https://cloud.tencent.com/document/product/1095/65111).

### F6 — Unknown silently treated as confirmed unsupported; plan conflict
`tencent.js:315-350,565-615`, Settings.jsx241 andTask2plan: savedunknown called runtimedetection, no actualcontentprobe, returnsunsupported. Probeonly/v1/records thenunsupportedall3. Metadata-only success requiresgenuineconfirmedabsence; planunverified→unsupported conflictsAPPROVEDPRD. Preserveunknown; appropriateofficialprobe or explicitverifiedunsupported policy, otherwise blockmetadata-success. CorrectSettings/plan/runbook.

### F7 — PPTX slide provenance uses part names instead of presentation order
`parser.js:153-164`: sorts slideN.xml andusesN; presentation.xml/relationships defineactualorder. Reordered/deletedslidesretainpartnames. ActualminimalPPTXprobe order2→1 yieldedwrongcitations. Resolveorderedrelationships, assignone-baseddisplaypositions totext+imageOCR. Testreorderwithrealorderedpresentationmetadata.

### F8 — OCR no deadline stalls only worker indefinitely
`parser.js:338-360`, `jobs.js:107,249-257`: fetch/bodyreadingunbounded, leasekeepsrenewing andticking blocksallnextjobs. Configurableboundeddeadline mustcoverheaders/fullbody includingtrickle; abortandcontrolledfailure, teststalledheaders/body andretryprogress.

### F9 — Missing Workspace namespace becomes no evidence
`runtime.js:32-55`; Lanceunchangeddependency `server/utils/vectorDbProviders/lance/index.js:429-436`: empty sources+messageignored; actualadapterprobe[] fornamespaceabsent withoutdocumentmembershipcheck. SelectedWorkspacewithpersisteddocuments+missingindex cananswerfrommeetingsalone/AWAITING_SOURCES. Validateproviderresults; genuinelyemptyWorkspacelegal, missing/unusablepersistedindexfailclosed. Testactualprovider-shapederrors/nohits/emptiness/currentACL.

### F10 — Citation meeting title/date not frozen
`indexer.js:286-298`, `qa.js:279-290`, Conversation.jsx387-388: retrieved/saved evidenceomitmeetingtitle/date, currentDetailrejectsdeletedmeeting, historicalcitationmislabelsworkspace/timeunknown; modelalsohasnomeetingdateforconflicts. Includeinretrievedevidence/frozencitationmetadata; savedfallbackoncurrentunavailable; actualaftersoftdelete regression (oldUItestinjectedlivemeetingprop).

### F11 — No saved conversation discovery or singlemeeting Detail entry
`frontend/src/pages/Meetings/index.jsx:271-275`, Detail.jsx205-213; endpoints/meetings.js320-355: onlynewconversations/knownID; closingpage losesdiscoverablehistory/pendingrecords; DetailreturnsCenterautoallselection. Addownerfilteredlist/reopeninglinks includingdeletedmeetinghistories; Detailcreateonly[current.id] withWorkspaceexplicitnonebydefaultandselection.

### F12 — Import failure error hidden by stage, no real stages
Center index.jsx448; importer.js306; jobs.js145-152: stageRESERVED persistsFAILED, UIstage||error hideserror. Recordrealfetch/parse-OCR/index/publicationtransitions; FAILEDshowerrorsindependently, renderregressionstage+error.

## Minor

M1 Settings.jsx168-194 expectscredentialHints.secretIdPresent/secretKeyPresent butconfig.js200-205 emitsmaskedsecretId/secretKey; savedalwaysunconfigured. Alignexplicitpresencebooleans/no actualsecretreturn.

M2 Deferredidenticalkey originalbindingEEXIST canreadpartialwrite, workspaceOriginals.js235-239. OrdinaryDocument.addDocuments mintfreshUUID129, nodemonstratedroutinemultiWorkspacecase; staysMinor. Atomicpublication orboundedcompletedwriteretry hardening.

## Declined to judge

- LiveTencentauthorization/tenantcapability/STSrenewal/productiondownloads: noauthorizedtenanttest; officialcontractnotacceptance.
- ProductionOCR/model/vector, semanticgrounding/promptinjection/retrievalcompleteness: synthetic/structuralvalidationnotqualityproof.
- Linux/restartonactualhost,3h/100MBworkload/10userperformance: notargetenvironment/measures.
- MeetingfineACL,oldmigration/recovery,fullversions,legacyOffice,translation/comparison/OA: explicitlyoutofscope.
- EveryOffice/PDFvariant: code/fixture+focusedreorderprobeonly, actualformatacceptance separate.
- Unknownpolicy asacceptedplan: expresslynotdeclined; F6PRDconflict reported.

Read-only additionalprobes: actualruntimeREINDEXfailure, PPTXorder, Tencentunknown/nestederror, omittedfulltranscriptbounds, Workspaceerrorprojection. NamedLanceprovidercontract andofficialTencenthistory/transcript/minuteschecked. No unchangedsuites/build, mutations/credentials/tenantservices.

Fixesrequired forcleanwholebranchapproval; stillseparateLinux/live/semantic/performancegatesafterfix.
