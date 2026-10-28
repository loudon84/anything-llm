# Meeting Summary and Local Todos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or executing-plans task-by-task. Steps use checkbox syntax.

**Goal:** Deliver dual-track meeting summary maintenance (`LOCAL_SUMMARY` + `contentVersion`), APPROVED content freeze with readable-write ACL, deterministic action-item candidates, and a Summary/Todos UI; ship OA person search + local task create behind a default-off flag (D-OA-01).

**Architecture:** Persist local edits only on a new `LOCAL_SUMMARY` `meeting_sources` row (never mutate gateway `SUMMARY`). Add `meetings.contentVersion` for CAS. Tighten write paths so `APPROVED` rejects all content-mutating ops; allow writes when the actor can already read the meeting. Extract candidates from imported SUMMARY + `ai_*_minutes` artifacts into `meeting_action_candidates`; optional `meeting_local_tasks` + OA proxy when flag on. Indexer prefers non-empty `LOCAL_SUMMARY` over gateway SUMMARY for the summary slot.

**Tech Stack:** Node/Express, Prisma/SQLite, existing meeting modules/tests under Jest, React/Vite Meetings UI.

**Spec:** `prd/AnythingLLM_会议摘要维护与待办任务_PRD_v1.0.0.md`

**Worktree:** `C:\Users\smc-sz-hr21007\.codex\worktrees\meeting-intelligence-3204\anything-llm` on `codex/meeting-intelligence`.

## Global Constraints

- Never overwrite gateway `SUMMARY` / originKey / baseline hashes (D-SUM-02).
- `generation` is index epoch only; CAS uses `contentVersion` only (D-SUM-05).
- `APPROVED` freezes summary, transcript, supplements, and task create (D-REV-01/02).
- Write ACL = meeting readable (D-ACL-01); expands beyond Gateway owner-only revise.
- Action items: whitelist titles only; no LLM inference; caps 50/50 (D-ACT-*).
- Local tasks / OA create default **off** until `fd_no` contract confirmed (D-OA-01).
- Soft-deleted meetings hide tasks (D-VIS-01).
- Tests: extend `server/__tests__/meetings/*` patterns.

---

### Phase A — Schema, ACL, LOCAL_SUMMARY, contentVersion, index

### Task 1: Prisma migration

- [x] Add `contentVersion Int @default(0)` on `meetings`.
- [x] Add `meeting_action_candidates` (`id`, `meetingId`, `candidateId` unique per meeting, `kind` auto|manual, `status` pending|created|needs_confirm, `originKey`, `sourceFingerprint`, `title`, `description`, `sourceExcerpt`, `taskId` nullable, timestamps).
- [x] Add `meeting_local_tasks` (`id`, `meetingId`, `candidateId` unique with meeting, `title`, `description`, `status` default pending, `assigneeKey`, `assigneeName`, `assigneeDepartment`, `dueAt` date string nullable, `notes`, `createdBy`, `idempotencyKey` nullable unique, timestamps).
- [x] Migration SQL under `server/prisma/migrations/`.
- [x] Tests: schema loads; defaults 0 (`contentVersion.test.js`).

### Task 2: Write ACL + APPROVED freeze

- [x] Add `assertMeetingWritable(authState, meetingId, action)` = readable AND `reviewStatus === DRAFT` (and not deleted).
- [x] Change revise / supplement / content-mutating paths to use writable assert; **reject APPROVED** with `MEETING_IMMUTABLE`.
- [x] For Gateway: content write no longer requires `createdBy === actor` (D-ACL-01); keep read rules otherwise.
- [x] Update `lifecycle.test.js` / `localOnlyAccess.test.js`: APPROVED revise fails; readable non-owner can write when DRAFT.
- [x] Update `meetingRules.js` `editContent` to DRAFT-only.

### Task 3: `saveLocalSummary` service + API

- [x] `saveLocalSummary({ meetingId, content, expectedContentVersion, userId, authState })` with writable check, CAS, upsert only `LOCAL_SUMMARY`.
- [x] Empty content soft-deletes LOCAL_SUMMARY; never updates gateway `SUMMARY` / `gateway:` originKey.
- [x] Bump `contentVersion`, bump `generation`, set `retrievalStatus=INDEXING`, enqueue REINDEX.
- [x] Harden legacy `revise`: reject APPROVED; skip gateway-origin SUMMARY rows.
- [x] Endpoint: `PATCH /meetings/:id/local-summary`.
- [x] Tests in `localSummary.test.js`.

### Task 4: Indexer preference

- [x] Non-empty LOCAL_SUMMARY replaces SUMMARY slot for retrieval; exclude `sourceType===SUMMARY` when local present.
- [x] Empty / missing LOCAL_SUMMARY → prior SUMMARY (+ optional `meetings.summary` override).
- [x] Tests in `indexer.test.js`.

### Task 5: Dual-track UI (summary half)

- [x] Route + page for readonly imported originals + LOCAL_SUMMARY editor with `contentVersion` CAS.
- [x] Detail: APPROVED hides save; link to SummaryAndTodos.
- [x] Frontend rules/node coverage for DRAFT-only edit capabilities.

---

### Phase B — Action-item candidates

### Task 6: Extractor pure module

- [x] `extractActionItems(sources[])` with whitelist headings; nest children; `candidateId` fingerprint; 50-cap.
- [x] Unit tests for zh/en headings, lists, nested merge, truncation (`actionItems.test.js`).

### Task 7: Sync candidates + APIs

- [x] Sync autos on import finalize / refresh; unmatched → `needs_confirm`; keep created; never delete tasks.
- [x] Manual create with server UUID; max 50.
- [x] `GET/POST/PATCH` action-candidates endpoints; readable GET; writable (DRAFT) mutate.
- [x] Tests in `actionCandidates.test.js`.

---

### Phase C — OA + local tasks (flag default off)

### Task 8: Feature flag + OA proxy stub

- [x] `feature_flags.meeting_local_tasks` via SystemSettings; default missing → disabled.
- [x] When disabled: OA search and create-task return `FEATURE_DISABLED` (not 500).
- [x] When enabled: OA people proxy maps `fd_no`/`fd_name`/`fd_department`.
- [x] Tests in `oaPeople.test.js` / `localTasksEndpoints.test.js`.

### Task 9: Create local task (idempotent)

- [x] `POST /meetings/:id/local-tasks` with candidateId, assignee snapshot, optional dueAt, Idempotency-Key.
- [x] Unique `(meetingId, candidateId)`; duplicate returns same task; status `pending` only.
- [x] Soft-deleted meeting → not readable → tasks hidden.
- [x] Max 50 tasks per meeting.
- [x] Tests in `localTasks.test.js` / `localTasksEndpoints.test.js`.

---

### Phase D — Hardening

### Task 10: Regression pack

- [x] Import conflict / re-import still preserves LOCAL_SUMMARY (gateway SUMMARY may update).
- [x] APPROVED blocks supplement add/delete that mutates retrieval content (D-REV-01).
- [x] Re-import / refresh action-item drift → `needs_confirm`; existing local tasks intact.
- [x] contentVersion CAS conflict keeps gateway SUMMARY unchanged.
- [x] Indexer prefers LOCAL_SUMMARY; empty LOCAL_SUMMARY falls back to SUMMARY.
- [x] Readable-write / DRAFT-only for local-summary and local-tasks.
- [x] Feature flag default off for OA/tasks.
- [x] Soft-deleted meeting hides tasks (not readable).
- [x] End-to-end checklist mapped to PRD §9 acceptance items 1–13 via `summaryTodosRegression.test.js` + existing suite.

## Spec coverage (self-check)

| Decision | Tasks |
|---|---|
| D-ACL / D-REV / D-VIS | 2, 9, 10 |
| D-SUM-* | 1, 3, 4, 5 |
| D-ACT-* | 6, 7 |
| D-OA / D-TASK-* | 8, 9 (flagged) |
| Deliberate deltas vs revise | 2, 3, 10 |

## Out of scope (per PRD)

OA writeback, task lifecycle beyond create, LLM action inference, changing import queue semantics beyond REINDEX trigger.

## Verification (Task 10)

```bash
cd server
npx jest __tests__/meetings/contentVersion.test.js \
  __tests__/meetings/localSummary.test.js \
  __tests__/meetings/indexer.test.js \
  __tests__/meetings/actionItems.test.js \
  __tests__/meetings/actionCandidates.test.js \
  __tests__/meetings/oaPeople.test.js \
  __tests__/meetings/localTasks.test.js \
  __tests__/meetings/localTasksEndpoints.test.js \
  __tests__/meetings/lifecycle.test.js \
  __tests__/meetings/localOnlyAccess.test.js \
  __tests__/meetings/summaryTodosRegression.test.js \
  --runInBand --forceExit

# from worktree root
node frontend/src/models/meetings.node-test.mjs
```
