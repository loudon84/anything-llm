# Meeting Intelligence execution ledger

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

- [ ] T1 Persistence / lifecycle — pending
- [ ] T2 Tencent / jobs — pending
- [ ] T3 Parsing / sources / index — pending
- [ ] T4 Grounded QA / history — pending
- [ ] T5 API / runtime — pending
- [ ] T6 React pages — pending
- [ ] T7 Integration / review — pending
