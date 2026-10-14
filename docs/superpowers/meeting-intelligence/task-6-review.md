# Task 6 review

## Spec Compliance

- ❌ Issues found: remote import API integration, approved-meeting action matrix, metadata-only import, citation rendering/provenance, and import-limit validation do not satisfy the brief. References and corrections appear below.
- ⚠️ Cannot verify from this diff: browser/full-app interactions, live Tencent/OCR/provider behavior, Linux deployment, and production performance. Task 7 and release checks must cover these; the production build is not UI execution evidence (`task-6-report.md:18`). Unchanged backend transaction/quota/index/grounding safeguards remain outside this task gate.

## Strengths

- Selection preserves all over-limit/unavailable matches and permits deselection; start requires 1–10 AVAILABLE meetings. China-time date bounds reject reversed intervals, with focused helper coverage (`frontend/src/models/meetingRules.js:1`, `:33`; `frontend/src/models/meetings.node-test.mjs:10`, `:59`, `:80`).
- New-conversation Workspaces default empty and are explicitly selected; scope/current blockers are consumed separately from historical answer freshness. Model output and quotations are ordinary React text (`frontend/src/pages/Meetings/index.jsx:287`; `frontend/src/pages/Meetings/Conversation.jsx:70`, `:318`).
- Original/supplement/text panels are separate, Tencent files expose no delete/replace action, and both meeting and Workspace originals use encoded API-base URLs plus authenticated blob requests (`frontend/src/pages/Meetings/Detail.jsx:305`, `:328`, `:385`; `frontend/src/models/meetings.js:8`, `:173`, `:209`, `:214`).
- Secrets remain blank after save and existing secrets are not populated into form state (`frontend/src/pages/Meetings/Settings.jsx:92`).

## Issues

### Critical (Must Fix)

- None found in this scoped review.

### Important (Should Fix)

1. **Remote list cannot consume the actual API.** `frontend/src/pages/Meetings/index.jsx:175` sends `{from,to}` although the endpoint only forwards `startTime/endTime`; `:182` then treats `result.meetings` as an array. The actual response is `{meetings:{items,nextCursor}}`, so valid pages reach `rows.map` as an object and their cursor is missed at `:192`. Map date bounds to the exact request fields, unwrap/validate the page, and preserve the discovery date window in the import scope. Contract checked: `server/endpoints/meetings.js:295`, `server/modules/meetings/runtime.js:417`, `server/modules/meetings/tencent.js:232`; Task 5b report agrees.

2. **A normal cited answer crashes React rendering.** `frontend/src/pages/Meetings/Conversation.jsx:359` passes `citation.coverage` into Status, which returns the raw value as a React child at `frontend/src/pages/Meetings/MeetingsUI.jsx:91`. Meeting evidence supplies a parsed coverage object (`server/modules/meetings/indexer.js:297`), not a status string. Render the coverage structure through a shared coverage formatter/component; exercise a real object-shaped citation in a focused render probe.

3. **Approved meetings cannot perform the mandated revisions/supplement actions.** `frontend/src/pages/Meetings/Detail.jsx:83` reuses DRAFT-only `canEdit` for summary/transcript editing (`:253`, `:261`, `:265`), new file upload (`:331`), and new text (`:408`). `frontend/src/models/meetingRules.js:15` also prevents deleting supplemental text on APPROVED. The binding PRD allows all those operations on APPROVED and returns it to DRAFT; only supplemental FILE deletion/reupload is DRAFT-only. Split the action matrix by operation/source type and correct the helper test that currently asserts approved text deletion is forbidden (`frontend/src/models/meetings.node-test.mjs:33`). Focused backend confirmation: `server/modules/meetings/meetingService.js:304`, `server/modules/meetings/sources.js:358`, `:492`, `:500`, `:519`.

4. **Metadata-only and attachment/summary-only imports demand a fictitious transcript range.** `frontend/src/pages/Meetings/index.jsx:240` converts a zero/unknown transcript duration to undefined, then `:250` blocks confirmation until explicit elapsed bounds are entered, irrespective of the manifest's absent/unsupported transcript capability. A legitimate no-content manifest has duration 0 and must be importable as DRAFT+WAITING_CONTENT; users should not invent offsets to import a document-only meeting. Apply the 3-hour check to an actual selected transcript, distinguish absent/unsupported from runtime errors, and leave bounds omitted when no transcript exists. Manifest contract checked at `server/modules/meetings/tencent.js:575`, `:595`.

5. **Citation provenance and current-source change detection use fields the API does not return.** `frontend/src/pages/Meetings/Conversation.jsx:365` expects meeting title/date on each citation, but actual meeting evidence contains meetingId/name/location/review/coverage only (`server/modules/meetings/indexer.js:289`), so normal meeting citations display “工作区来源 · 时间未知”. `Conversation.jsx:393` passes `citation.sourceRevision`, while `frontend/src/pages/Meetings/SourceViewer.jsx:85` compares it with `source.revision`; meeting source revisions are saved in answer.sourceState.citedSources as hashes/updatedAt, and Workspace citations use `revision`. Consequently the current-modified notice never activates. Resolve meeting metadata, pass the actual saved cited-source snapshot and answer freshness/current status to the viewer, use real revision fields, and explicitly distinguish unchanged/modified/deleted/unavailable current originals from the saved quote. Contract checked: `server/modules/meetings/qa.js:83`, `:251`; `server/modules/meetings/retrieval.js:81`; `server/endpoints/meetings.js:202`, `:514`.

6. **Background refresh overwrites user edits and date scope.** `frontend/src/pages/Meetings/Detail.jsx:44` resets summary/transcript on every refresh, including the 3-second parse/index polling, while those draft fields remain editable. Unsaved typing is therefore discarded during normal indexing. Separately `frontend/src/pages/Meetings/index.jsx:148` always polls `{quarter}` after a date filter, replacing the selected date results and dropping out-of-quarter selections. Keep editable drafts separate from polled status, and poll the active filter rather than the quarter default.

7. **Upload errors disappear.** `frontend/src/pages/Meetings/Detail.jsx:136` sets the upload error then awaits refresh, whose first action clears it at `:39`; a successful read hides the rejection, including a failure after an earlier file succeeded. Refresh source state without clearing the upload error, and identify any partial batch success explicitly. Add a focused rejected-upload/successful-refresh check.

8. **Import scope omits the requested attachment-limit checks.** `frontend/src/pages/Meetings/index.jsx:275` submits selected attachment IDs without validating manifest attachment bytes/count: <=100,000,000 bytes each, <=20 files and <=500,000,000 bytes combined. The separate supplement upload checks do not cover import. Validate the currently selected manifest attachments before confirmation and show actionable reasons; keep backend enforcement authoritative.

### Minor (Nice to Have)

- `frontend/src/pages/Meetings/Conversation.jsx:211` labels its checkbox “基于最新回答重新回答” but changes only reanswerId, leaving question/clarification untouched; checking it with an empty question cannot submit, and checking it with a different question associates that question with the previous answer. Populate the latest saved question/clarification consistently with each history card's reanswer action, or remove the duplicate control.

## Assessment

**Task quality:** Needs fixes.

**Reasoning:** The route/client/page separation and selection helpers are useful, but actual API envelopes and source/review data shapes are not integrated correctly, and polling/error handling can erase user state. Existing five helper tests, scoped lint/Prettier, and production build were not rerun; none answer the concrete integration defects above.

## Review checks and limits

- Reviewed BASE `7f73df17e8dd92881a03c0cd8f9823e6e85093a5` to HEAD `cb52940acf144be174fe63290bd942b853631f73` from the supplied package. Initial tool output was truncated; recovered only cutoff model/page sections from that package. No changed source file was read separately; package line numbers were mapped for report references. No branch/index/code changes, commits, or test/build reruns.
- Named outside-diff checks were limited to remote request/page and manifest contracts; approved-source action contracts; actual citation/revision/source projection; and API-base/authenticated-original paths (`frontend/src/utils/constants.js:1`, `frontend/src/utils/request.js:17`). No broader codebase review.
- Existing Piper externalization/static-dynamic import/chunk-size build warnings are documented baseline noise (`task-6-report.md:16`), not newly introduced findings. No new build output was generated.
