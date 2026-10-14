# Task 6 report — React meeting and QA pages

Implemented the authenticated meeting center, meeting details, fixed-scope QA conversations, source viewer, and admin-only connection settings. Added the `/meetings` route family and sidebar entry, a shared API client that checks response envelopes and reports errors, and direct `regenerator-runtime@0.14.1` dependency metadata in `frontend/package.json` and the Yarn v1 lockfile.

The meeting center supports quarterly and China-time date filtering, auto-selects the result set while leaving every checkbox editable, and blocks starting when more than ten meetings are selected or any selected meeting is unavailable. Tencent import loads the private-safe manifest before confirming one meeting, lets the user select attachments and a transcript interval up to three hours, and shows durable job states with cleanup-safe polling. Meeting details separate read-only Tencent originals from supplemental sources, show size/count limits and parse errors, and expose approval, retry, deletion, and explicit single-meeting reindex actions. New supplemental files and text can be added to DRAFT or APPROVED meetings; adding to an APPROVED meeting returns it to DRAFT. Supplemental file deletion/reupload is DRAFT-only, while approved supplemental text deletion is allowed and returns the meeting to DRAFT. QA scope requires an explicit workspace selection (default empty), remains fixed, blocks on unavailable meetings, preserves answer history and citation snapshots, and distinguishes missing evidence from interrupted service output. Source previews and downloads use authenticated blob requests; model text is rendered as ordinary React text.

## Verification

From `frontend/`:

- `node --test src/models/meetings.node-test.mjs` — 5 tests passed. Coverage includes auto-selected over-limit metadata rows remaining deselectable, the 20 → deselect 11 → 9 AVAILABLE flow, start blockers, draft-only supplemental deletion, citation locations, China-time inclusive dates, and reversed-range rejection. The date regression was observed failing before the helper was added, then passed.
- `node node_modules/eslint/bin/eslint.js src/models/meetingRules.js src/models/meetings.js src/models/meetings.node-test.mjs src/pages/Meetings src/main.jsx src/components/Sidebar/index.jsx src/utils/paths.js` — passed with no warnings.
- `node node_modules/prettier/bin/prettier.cjs --check src/models/meetingRules.js src/models/meetings.js src/models/meetings.node-test.mjs src/pages/Meetings/*.jsx src/main.jsx src/components/Sidebar/index.jsx src/utils/paths.js package.json` — passed.
- `npm run build` — passed, including Vite production build and the frontend post-build script.

The successful build retains existing warnings: Piper externalizes Node `fs`, `path`, and `crypto` for browser compatibility; two existing pages are both statically and dynamically imported; and existing minified chunks exceed 500 kB. The first build attempt found that the worktree's installed modules lacked the already-required `regenerator-runtime`; installing the exact pinned package resolved that baseline failure. A second install aligned the locally installed Phosphor package to the Yarn lock version after npm had selected a newer semver-compatible release; no extra dependency change was retained.

No backend or UI server was started. The shared Prisma client uses a hard-coded SQLite URL without datasource override support, so `DATABASE_URL`/storage environment overrides would not isolate startup. The Task 5b report documents the separate smoke database; this task did not access it or any original user data. No screenshot or live Tencent/OCR/provider behavior is claimed. Browser interaction against isolated meeting fixtures remains for Task 7.

## Review round 1 fixes

Addressed the review's eight important findings and latest-answer control:

- Remote history now sends `startTime`/`endTime`, unwraps the actual `{ meetings: { items, nextCursor } }` page, appends later pages, and carries the selected discovery window into the durable import scope.
- Citation cards render structured coverage through a shared component; meeting title/date come from the resolved meeting record. A server-side React render probe exercises an actual meeting citation with object-shaped coverage.
- The action matrix allows approved summary/transcript edits and new supplemental file/text additions (which return the meeting to DRAFT); supplemental file deletion/reupload stays DRAFT-only, while approved supplemental text deletion is allowed and returns the meeting to DRAFT.
- Imports without a supported transcript no longer require elapsed offsets. Full supported transcripts are accepted only when within three hours; partial ranges are validated. Selected attachments are checked for 20 files and known per-file/combined decimal byte limits. Tencent currently reports attachment `bytes: null`, so the UI labels unknown sizes and leaves final byte enforcement to the existing backend importer.
- Source viewer compares the answer's actual saved `citedSources` fingerprint (`contentHash`, `activeHash`, `updatedAt`) with the current archived source and labels unchanged, modified, deleted, or unverifiable originals. The saved quote remains separate from the live source.
- Detail polling preserves editable summary/transcript drafts. Center background polling reuses the active quarter/date filter and retains selected IDs. Upload errors survive a successful refresh, and partial batches show the successful count.
- The “latest answer” control now fills the same saved question and clarification as the history-card reanswer action.

## Review round 1 verification

From `frontend/` after the final edits:

- `node --test src/models/meetings.node-test.mjs` — 17/17 passed. The focused regressions cover the actual remote envelope, approved action matrix, metadata-only and selected-transcript scopes, attachment count/size limits, current-versus-cited source state, latest-answer reanswer fields, the live React citation render, draft-safe polling, active date-filter polling, and upload error/partial-success feedback. New contract tests were observed failing before the corresponding helpers/exports were added.
- `node node_modules/eslint/bin/eslint.js src/models/meetingRules.js src/models/meetings.js src/models/meetings.node-test.mjs src/pages/Meetings src/main.jsx src/components/Sidebar/index.jsx src/utils/paths.js` — passed.
- `node node_modules/prettier/bin/prettier.cjs --check src/models/meetingRules.js src/models/meetings.js src/models/meetings.node-test.mjs src/pages/Meetings/*.jsx src/main.jsx src/components/Sidebar/index.jsx src/utils/paths.js package.json` — passed.
- `npm run build` — passed, including Vite production build and `scripts/postbuild.js` (exit 0).
- `git diff --check` — passed before commit.

The final build emitted the same known Piper `fs`/`path`/`crypto` browser-externalization warnings, existing static-plus-dynamic import warnings for LLMPreference and Security, and the existing >500 kB chunk warning. No shared backend or application server was started; database isolation and Task 7 browser interaction remain as described above.

## Approved-meeting file-add correction

A final PRD/action-matrix cross-check found that the initial review-round fix had also restricted **adding a new supplemental file** to DRAFT. The backend permits new sources on both DRAFT and APPROVED meetings and resets an APPROVED meeting to DRAFT when a new source is added. The UI now exposes add-file on both states; supplemental file deletion remains DRAFT-only. The approved action-matrix regression asserts `addSupplementFile: true` and separately verifies that deleting an approved supplemental file remains false. Detail copy explains that adding to an approved meeting returns it to DRAFT.

Verification after this correction, from `frontend/`:

- `node --test src/models/meetings.node-test.mjs` — 17/17 passed, including `approved meeting action matrix allows revisions and new files but not deleting files`.
- `node node_modules/eslint/bin/eslint.js src/models/meetingRules.js src/models/meetings.node-test.mjs src/pages/Meetings/Detail.jsx` — passed.
- `node node_modules/prettier/bin/prettier.cjs --check src/models/meetingRules.js src/models/meetings.node-test.mjs src/pages/Meetings/Detail.jsx` — passed.
- `npm run build` — passed, including Vite build and the frontend post-build script. Known Piper browser externalization, existing static/dynamic imports, and >500 kB chunk warnings remain unchanged.
