# Task 5a round 1 rereview

Reviewed `00641182` and task-5a-fix-round1-diff.txt against the six prior findings, the deferred service seams, and the controller's seventh credential-leak finding. Inspected actual changed code and adjacent document/source publication flow. No implementation changes were made. Accepted the reported 125 meeting tests, 63 adjacent tests, scoped ESLint, Prettier, and diff-check results without repeating them. One new read-only, in-memory two-source import probe was run to test the remaining publication boundary.

**Spec compliance verdict: changes required. Quality verdict: changes required.** Findings 1, 2, 3, 5, 6, and 7 are resolved in this service scope. Finding 4 is partially resolved: malformed envelopes and inconsistent dimensions within a single preparation batch now fail, but independently prepared sources can still publish an incompatible combined index as AVAILABLE.

## Per-finding result

1. **Resolved — trusted reference persistence and flat document shape.** `workspaceOriginals.attach` now loads the actual saved JSON and calls `updateDocumentData` before returning a top-level `workspaceOriginalId` (`server/utils/workspaceOriginals.js:113-160`). The stored flat record retains its id/pageContent and other metadata; the generated reference reaches `Document.addDocuments` through its existing `fileData` read. `updateDocumentData` rewrites that contained on-disk JSON atomically through a temporary file (`server/utils/files/index.js:45-68`). Existing folder moves rename the saved file without dropping the reference, and binding accepts the changed folder while verifying the preserved parsed identity. The documentOriginals regression exercises the real fileData/update/move helpers rather than only a returned nested mock.

2. **Resolved — genuine parsed identity before binding.** The manifest records parsed ID, page-content hash, and parsed filename after verifying the Collector's returned ID/content against persisted JSON. Bind checks these fields plus the saved file's generated reference/ID/hash (`workspaceOriginals.js:196-217`), and `Document.addDocuments` supplies its actual loaded parsed ID, actual docpath, and actual content hash (`server/models/documents.js:167-180`). The former substitution of unrelated parsed document B into reference A fails before membership is created. The arbitrary metadata string alone no longer establishes authority. Resolver still requires an exact membership binding and contained retained binary; actual authenticated current membership/ACL remains Task 5b's second boundary.

3. **Resolved — multi-Workspace/re-add and persistence failure reporting.** Membership records have separate names derived from workspaceId/docId beneath each trusted reference (`workspaceOriginals.js:220-241,302-321`). Distinct Workspace imports no longer overwrite or consume one global manifest. Removal unbinds only the deleted membership; re-add uses a new docId. Document persistence/binding failures now append failedToEmbed/errors, remove successful bindings, delete namespace vectors, and delete vector bookkeeping (`documents.js:187-211`). This preserves the existing comma-separated Workspace import contract and reports a failed row after vectorization. The new regression covers parallel imports to two Workspaces, removal/re-add, rejected parsed identity, and DB-row failure.

4. **Partially resolved — envelope and index dimension validation.** `indexer.vectorize` now rejects mixed dimensions within one call (`server/modules/meetings/indexer.js:116-123`), and search rejects missing/blank profile metadata on object envelopes (`indexer.js:219-228`). Reindex prepares all selected source segments together, so the prior inconsistent-batch rebuild trigger is repaired. However, the required validation before publishing an entire usable index remains incomplete for import and independently processed supplements; see the remaining P2 below.

5. **Resolved — public nonsecret Tencent settings.** `getPublic` now returns saved appId/sdkId/operatorId through an explicit allowlist (`server/modules/meetings/config.js:82-86`). OCR/Tencent secret encryption and public secret redaction remain intact.

6. **Resolved — historical Workspace source-change hints.** Saved citedSources now records Workspace/document/revision identities without inserting old quotes into retrieval (`server/modules/meetings/qa.js:95-112`). Both history entry points call authenticated current evidence validation and initialize stale from that result (`qa.js:338-365,422-429,449-456`). A changed or removed cited document produces stale while the saved quote remains an immutable snapshot. Meeting stale/newSources behavior remains separate, and new question/reanswer evidence is still freshly retrieved.

7. **Resolved — OCR URL userinfo credential leak.** Config and parser reject URL username/password before persistence or fetch (`config.js:183-192`, `server/modules/meetings/parser.js:283-293`). Rejected errors use fixed controlled messages that do not interpolate the URL. Fetch failures now use generic `PARSER_SERVICE_FAILED` text (`parser.js:311-317`), so Node's fetch exception containing URL credentials cannot be persisted/reported as source failure detail. This is error/config boundary handling; the change does not rewrite extracted source knowledge. Regression coverage includes credential-bearing URL rejection/fetch suppression and generic fetch-error redaction.

## Remaining finding

### [P2] Validate all prepared/current source vectors before publishing AVAILABLE

Location: `server/modules/meetings/sources.js:922-927,1031-1045,1097-1115`; related supplemental publication `sources.js:747-762`.

Concrete trigger: the embedder uses one declared profile but returns two-dimensional vectors when preparing the summary and three-dimensional vectors when preparing the transcript. `prepareImport` calls `indexer.prepare` separately for each source. Each source's batch is internally consistent and passes the new check. `commitImport` does not check dimensions across those separately prepared chunks; it writes both and marks the meeting AVAILABLE. The same class of incompatibility can be introduced by separately processing a supplement against existing current-generation chunks, because hasCompleteCurrentIndex tests only that every successful source ID has some chunks.

A new in-memory probe called the actual `createIndexer`, `createSourceService.prepareImport`, and `commitImport` with summary+transcript and recorded:

```text
sourceCount: 2
dimensions: [2, 3]
retrievalStatus: AVAILABLE
first search: EMBEDDING_PROFILE_MISMATCH
```

Implication: the service publishes a meeting as queryable although its combined index is unusable, so successful import/source completion does not establish the brief's complete current-index validity contract. The later controlled search failure prevents silent missing-evidence fallback, but does not repair premature publication. Validate one consistent dimension/profile for the complete prepared import before any publication and validate new chunks against the existing eligible current chunk set before restoring/keeping availability. The supplied new indexer test covers mixed dimensions within one source batch/reindex call and therefore misses this multi-source boundary.

## Deferred seams and limits

- **ACL transaction forwarding resolved:** resolve now accepts db and passes it to lookupWorkspace; validateEvidence forwards its publication db to resolve (`retrieval.js:17-22,99-100`). Current document lookup already used the transaction. Actual authenticated adapters remain Task 5b-owned.
- **URL validation consistency resolved:** config and parser both accept HTTP(S) exact `/parse` with one optional trailing slash and reject prefixed paths and userinfo. Neither treats parse/network failure as source capability absence.
- **OCR report correction resolved:** the report now accurately says a parser uses its injected settings and Task 5b must obtain current persisted settings for each job. `getPrivate` supplies current encrypted/private configuration; dynamic job adapter wiring is explicitly future-owned, not claimed as verified here.
- No additional blocking regression was established in the scoped original-retention, history, or credential fixes. A minor helper concern remains: an identical concurrent membership bind can encounter EEXIST while the first exclusive-write file is still being filled, then parse an incomplete binding JSON. This can fail transiently instead of being fully idempotent; it does not overwrite another binding or authorize a mismatched document. The ordinary Document flow generates distinct docIds, so this is not the multi-Workspace regression. It can be addressed separately with an atomic completed-record publication/retry if identical-key concurrency becomes a runtime caller requirement.

No Express endpoints/authenticated download route, real provider wrappers, or Task 7 same-page PDF OCR trigger were expected in this subtask. Linux deployment, real Tencent/OCR credentials, production vector/provider behavior, and runtime ACL acceptance remain unverified. The supplied test results and this rereview are service-level evidence, not production acceptance.
