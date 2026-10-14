# Task 5b review

## Spec Compliance

- ❌ Issues found. Runtime answers cannot pass the grounding contract (`server/modules/meetings/runtime.js:481`, `:487`); Workspace original links have no production resolver (`server/endpoints/meetings.js:68`, `server/index.js:113`); Chroma evidence identity does not match the runtime lookup (`server/modules/meetings/runtime.js:49`); abort handling does not reliably preserve incomplete answers (`server/modules/meetings/runtime.js:470`); authentication/role errors do not use the specified JSON envelope (`server/endpoints/meetings.js:115`).
- ⚠️ Cannot verify live Tencent/OCR/model/vector services, Linux fresh deployment, production performance, or semantic entailment from this diff. The report explicitly limits its smoke to real local Prisma/Express with fake external adapters (`docs/superpowers/meeting-intelligence/task-5b-report.md:57`). Keep these as release checks. React and broad Task 7 integration were outside this gate.
- ⚠️ The unchanged Task 2/3/4/5a quota, complete-import, lifecycle, archive, and source-publication safeguards were not re-reviewed wholesale. Their reported suites are supplied evidence, not independently rerun results.

## Strengths

- Operation-scoped construction fetches current private settings and creates a fresh embedder/profile/parser/indexer, and the three durable job handlers use that operation factory (`server/modules/meetings/runtime.js:211`, `:284`). This is the right configuration ownership boundary.
- Workspace lookup and publication revision lookup accept the transaction client; evidence has separate chunk and document identity (`server/modules/meetings/runtime.js:194`, `:93`, `:355`). The actual document add path creates a new internal document ID (`server/models/documents.js:127`), so normal re-addition does not depend on `lastUpdatedAt` being an automatic update timestamp.
- Uploads use disk storage, generated temporary filenames, and the decimal 100 MB cap. File opening checks lexical and canonical containment before streaming (`server/endpoints/meetings.js:78`, `:176`). HTTP boot now returns the actual listener, permitting runner lifecycle registration (`server/utils/boot/index.js:67`, `server/modules/meetings/serverLifecycle.js:1`).

## Issues

### Critical (Must Fix)

- None identified in this task-scoped review.

### Important (Should Fix)

1. **[P1] Convert provider output to the grounding validator's contract.** `server/modules/meetings/runtime.js:481` and `:487` return `{ textResponse: ... }`. The QA call passes the returned value directly to `validateGroundedResponse` (`server/modules/meetings/qa.js:632`), which accepts either the actual structured response or a raw JSON string and requires `status`, `text`, and `citations` (`server/modules/meetings/grounding.js:57`). Thus even a valid provider JSON answer becomes `FAILED/INVALID_MODEL_OUTPUT`; the runtime never produces a successful grounded answer when evidence exists. Return the provider's raw JSON text or explicitly unwrap and strictly parse it before validation. Add a positive `createMeetingRuntime -> qa.ask` regression with current evidence and a real validator; the new runtime tests currently exercise only the Workspace projection adapter (`server/__tests__/meetings/runtime.test.js:1`).

2. **[P1] Wire the Workspace original resolver into the registered endpoints.** `server/endpoints/meetings.js:68` defaults `originals` to `null`, and its file route rejects when that value is absent (`:318`). The actual registration supplies only runtime and Prisma (`server/index.js:113`). Runtime retrieval separately obtains `getWorkspaceOriginals()` and can emit a valid original-file link (`server/modules/meetings/runtime.js:93`), but every such production link is rejected by the endpoint. Pass the same resolver from runtime/bootstrap or resolve it through an explicit runtime seam. Verify a retained, bound Workspace original through the actual registration defaults; the existing endpoint test succeeds by supplying an `originals` fake explicitly.

3. **[P1] Preserve actual provider vector identity rather than assuming every projected `id` is a vector ID.** `server/modules/meetings/runtime.js:49` treats `metadata.id` as `document_vectors.vectorId`, then drops any result without that match (`:52`). This works for the inspected default Lance projection but fails for the existing Chroma provider: `similarityResponse` iterates `response.ids` while discarding their values and returns stored metadata (`server/utils/vectorDbProviders/chroma/index.js:154`, `:168`); ingestion separates `docId` from metadata and creates different UUIDs for vector rows (`:218`, `:297`, `:311`). Consequently Chroma's projected `id` is the parsed-document metadata ID, not the vector ID required by this adapter, and valid Workspace chunks silently disappear. Extend the provider projection/adapter seam to carry actual chunk/vector IDs and map exact current document membership, without filename inference. Use the real Chroma projection lifecycle as the regression fixture, including multiple chunks of one document; the current fixture asserts the Lance-compatible optimistic shape only (`server/__tests__/meetings/runtime.test.js:47`).

4. **[P1] Detect aborts that the existing stream handler resolves without an error event.** `server/modules/meetings/runtime.js:470` detects only emitted `abort` or `error`. The actual OpenAI handler's `isAbortError` branch calls `clientAbortedHandler`, and that helper resolves `fullText` without emitting either event (`server/utils/AiProviders/openAi/index.js:328`, `server/utils/helpers/chat/responses.js:19`). Runtime therefore loses the incomplete-output signal and partial-text preservation; after fixing item 1 it could accept an aborted stream whose current prefix is valid JSON. Establish explicit successful completion versus upstream abort/exception, preserve collected partial text in `FAILED_INCOMPLETE`, and test the actual handler behavior where abort resolves rather than rejects. An emitted-error-only fake does not cover this contract.

5. **[P2] Normalize authentication and role-denial responses locally.** `server/endpoints/meetings.js:54`–`:55` and `:115` run the existing authentication/admin middleware outside the route's `publicError` handling. The actual `validatedRequest` sends JSON containing only `error` (`server/utils/middleware/validatedRequest.js:79`), while `flexUserRoleValid` sends a plain-text 401 for a forbidden role (`server/utils/middleware/multiUserProtected.js:82`). These routes consequently violate the required `{ error, code }` contract precisely on unauthenticated or non-admin requests. Wrap response formatting for these middleware paths without bypassing the existing checks. Test denied requests through the middleware chain; the endpoint fixture makes both auth and admin checks unconditional passthroughs (`server/__tests__/meetings/endpoints.test.js:62`).

### Minor (Nice to Have)

- **[P3] The claimed bounded SSE sink retains every event.** `server/modules/meetings/runtime.js:452` accumulates all parsed SSE events in an unbounded array even though only failure/completion state is needed. The brief explicitly calls for a bounded sink. Track small state flags and bound any retained partial-text/event bytes instead of retaining duplicate output events for the lifetime of generation; include the bound in the streaming regression.

## Checks and Scope

- Read the supplied review package as the change under review; the first tool response was output-truncated, so only its omitted test section was recovered. Focused partial reads of changed grounding.js and retrieval.js recovered the validator/adapter context missing from their mid-function diff hunks. No Git diff was regenerated. Final changed-file anchor lookups were reference-only and explicitly authorized by the controller.
- **Named risk: provider/QA return-value mismatch.** Checked the QA invocation and grounding validator contract. Ran one read-only Node assertion probe: the same valid JSON succeeds as raw text and fails with `INVALID_MODEL_OUTPUT` inside the runtime `{textResponse}` envelope. No supplied passing suite was rerun.
- **Named risk: actual provider selection/history contract.** Checked `server/utils/helpers/index.js:714`–`:782`: it accepts the supplied user, synthetic Workspace, empty history override, and zero message count. No additional history query was introduced by the runtime call itself.
- **Named risk: real vector projection and revision lifecycle.** Checked the focused Lance and Chroma ingestion/search projections and `server/models/documents.js:127`–`:131`. Lance carries vector IDs; Chroma does not. Normal `Document.addDocuments` creates a fresh `docId`. External in-place mutation preserving IDs and all row metadata remains outside the proven revision signal.
- **Named risk: resolved stream abort.** Checked the actual OpenAI `handleStream` abort branch and `clientAbortedHandler`/`writeResponseChunk`; this establishes item 4 without a live provider call.
- **Named risk: existing auth response contract.** Checked `validatedRequest`, `flexUserRoleValid`, and `userFromSession`: existing identity checks are retained, but denial formatting is incompatible with the new endpoint envelope.
- **Named risk: original download bootstrap.** Checked the new bootstrap registration against the endpoint's required resolver and runtime's separate original resolver. No broader original-retention implementation was re-reviewed.
- Supplied evidence: 17 suites/142 tests, scoped lint/format, and isolated 43-migration Prisma/Express smoke. Those checks were not rerun; they do not exercise the positive runtime model/QA path or actual Chroma identity contract.

## Assessment

**Task quality: Needs fixes.**

The separation between durable services, request handlers, and operation-scoped adapters is sound, but actual caller contracts break successful answering, Workspace evidence, and original-file opening. Fix the runtime boundaries and add the requested runtime positive/abort/current-profile regressions before treating Task 5b as complete.

