# Task 6 report — React meeting and QA pages

Implemented the authenticated meeting center, meeting details, fixed-scope QA conversations, source viewer, and admin-only connection settings. Added the `/meetings` route family and sidebar entry, a shared API client that checks response envelopes and reports errors, and direct `regenerator-runtime@0.14.1` dependency metadata in `frontend/package.json` and the Yarn v1 lockfile.

The meeting center supports quarterly and China-time date filtering, auto-selects the result set while leaving every checkbox editable, and blocks starting when more than ten meetings are selected or any selected meeting is unavailable. Tencent import loads the private-safe manifest before confirming one meeting, lets the user select attachments and a transcript interval up to three hours, and shows durable job states with cleanup-safe polling. Meeting details separate read-only Tencent originals from draft-only supplemental files and text, show size/count limits and parse errors, and expose approval, retry, deletion, and explicit single-meeting reindex actions. QA scope requires an explicit workspace selection (default empty), remains fixed, blocks on unavailable meetings, preserves answer history and citation snapshots, and distinguishes missing evidence from interrupted service output. Source previews and downloads use authenticated blob requests; model text is rendered as ordinary React text.

## Verification

From `frontend/`:

- `node --test src/models/meetings.node-test.mjs` — 5 tests passed. Coverage includes auto-selected over-limit metadata rows remaining deselectable, the 20 → deselect 11 → 9 AVAILABLE flow, start blockers, draft-only supplemental deletion, citation locations, China-time inclusive dates, and reversed-range rejection. The date regression was observed failing before the helper was added, then passed.
- `node node_modules/eslint/bin/eslint.js src/models/meetingRules.js src/models/meetings.js src/models/meetings.node-test.mjs src/pages/Meetings src/main.jsx src/components/Sidebar/index.jsx src/utils/paths.js` — passed with no warnings.
- `node node_modules/prettier/bin/prettier.cjs --check src/models/meetingRules.js src/models/meetings.js src/models/meetings.node-test.mjs src/pages/Meetings/*.jsx src/main.jsx src/components/Sidebar/index.jsx src/utils/paths.js package.json` — passed.
- `npm run build` — passed, including Vite production build and the frontend post-build script.

The successful build retains existing warnings: Piper externalizes Node `fs`, `path`, and `crypto` for browser compatibility; two existing pages are both statically and dynamically imported; and existing minified chunks exceed 500 kB. The first build attempt found that the worktree's installed modules lacked the already-required `regenerator-runtime`; installing the exact pinned package resolved that baseline failure. A second install aligned the locally installed Phosphor package to the Yarn lock version after npm had selected a newer semver-compatible release; no extra dependency change was retained.

No backend or UI server was started. The shared Prisma client uses a hard-coded SQLite URL without datasource override support, so `DATABASE_URL`/storage environment overrides would not isolate startup. The Task 5b report documents the separate smoke database; this task did not access it or any original user data. No screenshot or live Tencent/OCR/provider behavior is claimed. Browser interaction against isolated meeting fixtures remains for Task 7.
