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
- [ ] T4 Grounded QA / history — in progress (GPT-6 Luna)
- [ ] T5 API / runtime — pending
- [ ] T6 React pages — pending
- [ ] T7 Integration / review — pending


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
