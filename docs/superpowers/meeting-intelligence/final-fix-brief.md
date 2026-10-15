# Final whole-branch fix wave

Implementer must use GPT-6 Luna, one sequential complete wave, no other agents. Root owns plan/TODO/ledger/reviews/final-verification and never edits code. Read APPROVED PRD, current plan, final-review.md (all12Important+2Minor), relevant task reports/contracts as needed. Verify each finding against actual code/dependency; if technically wrong explain concrete evidence before declining, do not silently omit any. Use TDD/systematic debugging and receiving-code-review. Work only in this managed branch/worktree; no master writes/merge/push, real credentials, external tenant/provider calls, system installs or unavailable Linux claims.

Exact scope files: `prd/PRD-AnythingLLM-Enterprise-Meeting-Intelligence-v1.0.md` and `docs/superpowers/plans/2026-10-14-meeting-intelligence.md`. APPROVED is the PRD status, not a filename; do not invent `APPROVED-PRD.md` or `plan.md`.

## Complete finding list and boundaries

Address F1-F12 together. Each needs meaningful actual-path coverage, not tests of a copied predicate or wrong API envelopes.

- F1 share SHA-based activeFILE uniqueness between original and supplemental sources, preserve Tencent external identity separately with minimal additive metadata/schema if necessary; original remains immutable. Test actual import→samebytes/rename supplement, duplicate original artifacts, crossmeeting allowed, current draft historical reupload rules unchanged.
- F2 use guarded source-process for runtimeREINDEX; test actual runner failing embedding and supersededgeneration so stale jobs cannot publish/mark currentfailed incorrectly. Retain controlled meeting status/jobs/retry behavior.
- F3 validate actual selected/full transcript bounds during worker execution before parse/publication, max3h even omitted offsets; reject outofrange/changeaftermanifest. No frontendonly authority; no-summary/transcript metadata paths remainlegal.
- F4 normalizepersistedcoverage: capabilitystatus, actual requestedselectedinterval/full-or-partial, selected/excludedattachmentids/names, whole-summarycoverage. No signedURLs/secrets. Confirmation/Center/Detail/citation snapshots retainwarning afterapproval; sourcechanges cannotrewriteoldcitationcoverage. Metadata-only and manualsupplement coverage describedhonestly.
- F5 officialerror_info envelope, explicitabsence/progress/permission/transient tests; genericpublicmessages andtoken/URLredaction intact. Reuseofficial research and currentofficialdocs ifneeded, neverinvent endpoints.
- F6 correctPRDpolicy: UNKNOWN staysUNKNOWN, appropriateofficialprobe or explicitverifiedUNSUPPORTEDadmin decision required; UNKNOWN alonecannot authorize metadata-success. If absentrequiredcapability/probeconfiguration preventsverification, failclearly ratherthanpretend unsupported. Settings mustdescribeactualpolicy and runbookupdated. RootalreadycorrectedTask2plan/ruling.
- F7 actual presentation.xml ordered relationships determine one-basedPPTpositions fornativeandimageOCR; realreordered ZIPfixture, no filename-order fallback presenting fabricated slidepositions.
- F8 admin/configurableboundedOCR deadline coveringrequestandfullbody, abort onexpiry, controlleddurablefailure/workeradvancement. Testheaders/body stall andnextjob ableprogress. Preserveencryptedtoken, currentconfigsnextoperation. Chooseconservativedefault/bounds, recordchoiceandcostinreport forrootruling; no productionperformanceclaim.
- F9 validate actualWorkspaceproviderresultshape/errors/indexreadiness; persistedmembership/currentACL, emptyWorkspace or genuineno-hits legal, missingnamespace/unusableindexwithpersisteddocuments controlledretrievalfailure. Test actualLance-shapedmissingnamespaceerror andlegitimateempty/no-hit, notfakeproviders-only optimism.
- F10 carrytitle/startdate in currentretrieved evidence plus frozen citation/source metadata, includingmodelprompt; historicaldeletedmeeting citation usesstoredmeetingkind/name/datewithoutcurrentDetail. Actualstoredansweraftersoftdelete regression pluscomponentrender. No fullcontentversions or meetingfineACL.
- F11 ownerfiltereddiscoverableconversationAPI/client/Centerlinks withdeleted/unavailable scopesstillhistoricallyreopenable. SinglemeetingDetail entry alwaysscope[current.id], explicitWorkspacechoice defaultnone, sameexistingauth/currentACL andblockedunavailable rules; no accidental allmeeting selection.
- F12 real durableimportphase transitions fetch→parse/OCR→index→publication andstatus; erroralwaysvisibleindependentretainedstage. Lease/generationchecksnotweakened; failurestage+erroractualrenderregression, plaintextChineselabels.
- M1 explicitredactedcredentialpresencebooleans alignadminSettings, neversecretreadback, employeestatus projectionstilllimited.
- M2 remainsMinor but sensible narrow atomic publication/completedwriteretry allowed iffitswave; testifchanged. Otherwise explicitlyreportdeferred withoriginalreason, notsilentforgetting.

Retain allapprovedlifecycle/quota/retrieval safeguards.100000000bytes/file,20FILEs/500000000total includingoriginals nottext; 200activequarter inclmetadata/reservations; atmost10fixedmeetings; draftsqueryableonlyAVAILABLE. Originalread-only; FILE delete/historicalreupload currentDRAFTonly; genuinelynew approvedFILEadditiondowngrades; retainedsnapshots/archive/quota release; no prioranswerfresh evidence. Existingauth onallroutes, ownerconversation access, currentWorkspaceACL/fileaccess; no newmeetingACL.

## Verification and reporting

Run RED→GREEN for each issue; stageonlyownedcode/tests/fixtures/additivemigrations/deploymentrunbook and a new `final-fix-report.md`. Do not stage rootdocuments/diffpackages orblockedtempdirectory. Minimal midwave commits allowed; rootcapturesonecombinedfixrange. Do not do review yourself asanotheragent.

UseisolatedrealPrisma migration tests with explicitdatasource (productionURLhardcoded; envDATABASE_URL aloneinsufficient), includingnewmigrationcountif schema changed; actualruntime runner paths andfrontendactualSSR/APIcontracts. No fakeadapters inproductdefaults. Do not restarttestUI unlessneeded; ownedhelper processesonly, boundedloopback/tests andreportcleanup. Current222backend/26frontend/buildpassedoldcode; changesjustifyappropriatefreshfullmeeting+boot+3adjacent finalpassandfrontendbuild. Avoidrerunningunchangedsuitesfor everyitem; one combinedfinalpass afterfixes plus targetedperissue.

Report eachF1-F12/M1/M2 disposition, exactfiles/commits, testresults/commands/limits, chosenpolicies(defaulttimeouts/schema/effectoncapabilityworkflow) anddeclineditemswithevidence. Sendmeaningfulintermediatefindings/progress to root. Commitcodeandreport, rootdispatchesonescopedrereviewofcompletewave. ExternalLinux/Tencent/OCR/provider/semantic/performanceacceptance unverified; code merge-readiness is separate.

ExistingTask7temp `server/prisma/task7-isolated-102c2410f89148b08c2fdfaedafef1ed/` hasonlyschema+migrations, toolblockedrecursivecleanup; no alternate deletion. Oldtesthelpersstopped andold5bsmokeSQLitealreadyremoved.
