# Git lineage and worktree audit

Audit date: 2026-10-27 (local worktree state; read-only inspection)

## Findings

**Recommended committed base: `codex/meeting-intelligence` at `75d351156495498e5c6344da7ef75fd0e0135ef7`.** It contains all commits reachable from `master` and from `codex/meeting-gateway-r1`, plus the meeting-intelligence and employee OAuth work. It is also the exact same commit as `codex/meeting-intelligence-qr-login`. This recommendation identifies the broadest committed history, not a completed deliverable: its worktree has substantial uncommitted feature work that must be reviewed and preserved before consolidation.

### Branch graph

| Ref | Commit | Relation to master | Notes |
|---|---|---:|---|
| `master` | `1336d327f4460510b755059b15481fd94a57cef7` | baseline | Matches `origin/master`; commit dated 2026-10-13. |
| `codex/meeting-gateway-r1` | `c73dce7cf6383981f4ef4cac3c5363275d9b4b59` | 13 commits ahead | Commit dated 2026-10-18. All 13 commits are ancestors of the intelligence branch. |
| `origin/codex/meeting-intelligence` | `7e465a04c1ad63166c7b952b41dfd316882329ea` | 50 commits ahead | Merge commit dated 2026-10-19; ancestor of local intelligence. |
| `codex/meeting-intelligence` | `75d351156495498e5c6344da7ef75fd0e0135ef7` | 85 commits ahead | 35 commits ahead of its origin tracking ref; latest commit dated 2026-10-20. |
| `codex/meeting-intelligence-qr-login` | `75d351156495498e5c6344da7ef75fd0e0135ef7` | 85 commits ahead | Exactly same commit as `codex/meeting-intelligence`; branch name does not denote separate committed code. |

Verified ancestry: `merge-base(master, gateway-r1) = master`; `merge-base(master, intelligence) = master`; `merge-base(gateway-r1, intelligence) = c73dce7c`; local intelligence contains the origin intelligence ref; both local intelligence-named branches have the same tip. The branch names needing cleanup are aliases of commit state at this point, not distinct histories.

## Worktree state

| Worktree | Branch / HEAD | Git status | Audit assessment |
|---|---|---|---|
| `E:/git/anything-llm` | `master` / `1336d327` | 1 modified tracked file and 8 untracked status paths (82 untracked leaf paths) | Contains local repository guidance, docs, PRD, and package metadata absent from master. Preserve/compare these before any cleanup. |
| `.../meeting-intelligence-3204/anything-llm` | `codex/meeting-intelligence` / `75d35115` | 98 status entries: 43 changed tracked files, 100 untracked paths | Largest substantive working set: approx. 8,307 insertions and 3,178 deletions in tracked diff, plus new meeting list/import/migration/test/docs/PRD files. Also contains numerous local server logs and a SQLite diagnostic file; do not treat those as source deliverables. |
| `.../gateway-qr-login/anything-llm` | `codex/meeting-intelligence-qr-login` / `75d35115` | 15 status entries: 14 changed tracked files and 1 untracked source file | Separate QR/login implementation work in progress, approx. 809 insertions and 154 deletions; it is not committed. The new `server/utils/meetingGateway/loginBodyParser.js` and this worktree's version of the 14 changed files are distinct local material. |
| `.../meeting-gateway-r1/anything-llm` | `codex/meeting-gateway-r1` / `c73dce7c` | 2 untracked status roots | No tracked source diff. The status is `server/node_modules.partial-codex/` (38,437 untracked leaf paths) and `storage/`; these are environment/runtime artifacts, not commits. |

The main intelligence and QR worktrees share 14 changed paths, but every existing shared file has a different SHA-256; three source/test files deleted from the main intelligence worktree still exist modified in QR. Therefore the QR worktree is not redundant and should not be removed until its implementation is reviewed against the main worktree. Their same HEAD means these changes exist only in their respective working directories.

`node_modules`, `server/node_modules`, and `server/storage` directories are present in more than one worktree. Their existence does not establish that dependency/runtime state is interchangeable, and ignored files were not included in branch completeness counts.

## Suggested safe consolidation sequence

1. Treat `codex/meeting-intelligence` as the canonical **commit base** because it contains the gateway branch and 35 commits beyond the current remote intelligence tip.
2. Preserve and review the 98-entry intelligence worktree and the separate 15-entry QR worktree before any worktree deletion, reset, branch deletion, or cleanup. Specifically compare overlapping login/auth files and determine whether the main worktree's deletions are intentional replacements.
3. Review the 82 untracked paths and one package metadata change on `master`; they appear to be local project guidance/specification work and are not part of the intelligence commit history.
4. Separate intended source, tests, migrations, plans, and PRD from generated logs, SQLite data, dependency fragments, and local storage before deciding what belongs in a deliverable commit.
5. Once all unique intended changes are reconciled, verify the assembled result and only then select a single branch/worktree to retain. This audit did not run tests, inspect log/database contents, or change Git state.

## Boundaries

No checkout, merge, commit, cherry-pick, stash, reset, branch deletion, worktree deletion, push, or process launch was performed. No log or database payloads were read. The findings describe observed Git metadata and worktree status only; they do not establish that the code is complete or passes verification.

## Local startup verification

Started only the meeting-intelligence-3204 checkout after comparing feature coverage. Server PID38180, frontend PID30188, collector PID13320. Existing environment files loaded; no credentials/config source changes. HTTP verification: frontend localhost:3000 (Accept:text/html)200 with app root, API127.0.0.1:3001/api/ping200 online, collector127.0.0.1:8888/200. Browser rendered the local AnythingLLM home and meeting navigation. Plain non-HTML probes to Vite root returned404; HTML navigation works and no source correction was required. No Git state changes, commits, merges, deletions or push performed. Audit artifacts and runtime log appends are additional local files and do not represent feature commits.
