# Task 6 scoped re-review — round 1

## Finding Verdicts

1. **Remote list API integration — ADDRESSED.** The page sends `startTime/endTime`, validates/unpacks `{meetings:{items,nextCursor}}`, appends subsequent pages, and retains a discovery window in the import scope (`frontend/src/pages/Meetings/index.jsx:160`, `:166`, `:167`, `:239`; `frontend/src/models/meetingRules.js:41`). The actual-envelope regression covers that shape (`frontend/src/models/meetings.node-test.mjs:63`).

2. **Object-shaped coverage crashes cited answers — ADDRESSED.** Actual Citation now uses the shared CoverageBadge, which renders structured coverage as text (`frontend/src/pages/Meetings/Conversation.jsx:393`; `frontend/src/pages/Meetings/MeetingsUI.jsx:96`). The SSR test imports and renders the real Citation with the backend-shaped object and resolved meeting metadata (`frontend/src/models/meetings.node-test.mjs:227`).

3. **Approved-meeting action matrix — ADDRESSED.** DRAFT and APPROVED permit content revisions and new file/text additions; supplemental FILE deletion stays DRAFT-only and supplemental TEXT deletion accepts both states. Detail uses those separate capabilities (`frontend/src/models/meetingRules.js:19`, `:30`; `frontend/src/pages/Meetings/Detail.jsx:374`, `:408`, `:443`). The corrected approved action regression explicitly allows new files and forbids approved file deletion (`frontend/src/models/meetings.node-test.mjs:73`, `:95`).

4. **No-transcript imports demand fictitious offsets — ADDRESSED.** Only a supported transcript triggers duration/range validation; absent/unsupported transcript permits omitted offsets and the dialog explains that state (`frontend/src/models/meetingRules.js:48`, `:85`; `frontend/src/pages/Meetings/index.jsx:221`, `:597`). Metadata-only and supported-range regressions exercise these branches (`frontend/src/models/meetings.node-test.mjs:103`, `:158`).

5. **Citation provenance/current-source change contract — NOT ADDRESSED (Important; Workspace portion remains).** Meeting title/date now resolve from the meeting record, and meeting originals compare the saved cited-source hashes/updatedAt with the archived source (`frontend/src/pages/Meetings/Conversation.jsx:385`, `:421`; `frontend/src/pages/Meetings/SourceViewer.jsx:87`). However, the Workspace link's changed snapshot payload sends only quote/name/location/citedSource, omitting answer freshness (`Conversation.jsx:437`, `:442`), while the viewer only shows a change warning for `snapshot.freshness.stale` and still reads the nonexistent `snapshot.sourceRevision` (`SourceViewer.jsx:121`, `:131`). The saved Workspace `citedSource.revision` is not displayed or compared, and no unverifiable-current-state notice is shown in the Workspace branch. A stale Workspace answer therefore opens a viewer with no source-change warning or saved revision. Pass freshness for Workspace snapshots, use the real saved revision, and explicitly label current Workspace change/deletion/unavailability where known; when current revision cannot be read, state that comparison is unavailable. Overall answer.stale may provide historical context, but must not be presented as proof that this particular document changed. The meeting fingerprint test and citation SSR test do not cover this Workspace path (`frontend/src/models/meetings.node-test.mjs:178`, `:227`).

6. **Polling overwrites user edits/date scope — ADDRESSED.** Detail preserves the contentDraft ref during background reads and updates it on typing; explicit successful save performs content synchronization. Center polls the applied quarter/date query rather than reverting to the quarter default (`frontend/src/pages/Meetings/Detail.jsx:59`, `:286`; `frontend/src/pages/Meetings/index.jsx:131`, `:145`; `frontend/src/models/meetingRules.js:141`). Focused draft/query regressions cover the new helper contracts (`frontend/src/models/meetings.node-test.mjs:279`, `:300`).

7. **Upload rejection is cleared by refresh — NOT ADDRESSED (Important; next polling refresh still clears it).** The immediate post-upload refresh now passes `clearError:false` and partial batches retain a successful count (`frontend/src/pages/Meetings/Detail.jsx:158`, `:167`). But the same refresh defaults to `clearError:true` and calls `setError("")` (`:51`, `:54`), while the active parse/index interval calls `refresh(false)` without overriding that default (`:84`). After one file queues successfully and a later file fails, the PENDING source activates polling, which erases the rejection on the next 3-second tick. Background polling must preserve operation errors, with intentional clearing on a new user operation. The new feedback test verifies only the pure message helper and does not execute this refresh/poll path (`frontend/src/models/meetings.node-test.mjs:290`).

8. **Import attachment limits omitted — ADDRESSED.** Validation checks selected count, known per-file decimal sizes, and known combined bytes before submission; the UI labels null sizes as pending download-time confirmation, with backend enforcement remaining authoritative (`frontend/src/models/meetingRules.js:66`, `:67`, `:79`; `frontend/src/pages/Meetings/index.jsx:222`, `:593`). Count/per-file/aggregate regressions cover all three limits (`frontend/src/models/meetings.node-test.mjs:124`).

9. **Latest-answer reanswer does not restore the saved question — ADDRESSED.** Checkbox and history-card actions both populate question/clarification/reanswer ID through getReanswerDraft (`frontend/src/pages/Meetings/Conversation.jsx:213`, `:279`; `frontend/src/models/meetingRules.js:133`). The saved-field regression covers the helper (`frontend/src/models/meetings.node-test.mjs:192`).

## New Breakage in the Fix Diff

- None beyond the incomplete original findings above.

## Out-of-Scope Observations

- The controller-assigned historical FILE delete → approve → same-hash reupload backend gap remains Task 7 integration work; no backend code changed here. It does not block this frontend gate independently.
- Full browser interactions, live external services, and Linux acceptance remain Task 7/release checks; this fix report makes no full-UI claim (`docs/superpowers/meeting-intelligence/task-6-report.md:42`).

## Verdict

**Fix round: Findings remain open — Important #5 (Workspace provenance/freshness) and #7 (polling clears upload rejection).**

## Checks

- Read the supplied fix package once for `cb52940acf144be174fe63290bd942b853631f73` → `d382f1b38c2353f01a05f855488d75f6dd30fa67`, displaying its stored output in bounded sections; inspected both fix commits and the latest two report addenda. No separate changed-source reads, outside-code expansion, code/index/HEAD mutation, commits, or subagents.
- Reviewed the reported 17/17 focused tests, scoped lint/format checks, and successful production build against the added tests and page wiring (`docs/superpowers/meeting-intelligence/task-6-report.md:36`, `:50`). No previously passing test/build was rerun. The two remaining issues are directly established by the shown callback/default and snapshot payload, so no additional probe was needed.
- Known Piper/static-dynamic-import/chunk-size warnings remain documented baseline output, not new noise (`docs/superpowers/meeting-intelligence/task-6-report.md:42`, `:53`).
