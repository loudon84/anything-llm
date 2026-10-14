# Task 5a independent spec and quality review

Reviewed `925a6bc3..7d80316c` against task-5a-brief.md first, then task-5a-report.md and task-5a-diff.txt. Traced the actual Collector -> saved JSON -> Document.addDocuments -> manifest path, and the source/index/QA transaction paths. No implementation changes were made. The supplied 117 passing tests, scoped lint, and diff check were accepted without rerunning them. Additional probes used only in-memory adapters; no live services or credentials were used.

**Spec compliance verdict: changes required. Quality verdict: changes required.** The principal gap is that original retention is not connected to the existing persisted-document pipeline. The helper also does not establish the required genuine parsed-document identity before binding. The current tests substitute a nested metadata shape and therefore miss these boundaries.

## Open findings

### 1. [P1] Persist the trusted reference into the actual flat parsed document

Location: `server/utils/workspaceOriginals.js:99-106` (also `server/utils/collectorApi/index.js:154` and `server/models/documents.js:109-126,159-166`).

Trigger: an ordinary GUI or API Workspace file upload, followed by embedding the returned document location. Collector's `writeToServerDocuments` (`collector/utils/files/index.js:120-154`) writes flat `{id,title,pageContent,...}` JSON before returning it. `attach` changes only the response and places the new reference under a newly introduced nested `metadata` object. It never updates the saved JSON. GUI upload ignores the returned objects except for moving their files; folder moves rename files without rewriting their contents. API upload similarly calls embedding with `document.location`. `Document.addDocuments` then reloads the old JSON using `fileData` and checks a top-level `workspaceOriginalId` in its flattened metadata.

Implication: the original binary and unbound manifests are retained, but actual Workspace records/vector metadata lack a resolvable original reference. New ordinary uploads cannot open their retained original through this mechanism. Fixing only the returned shape is insufficient; persist a trusted reference in the saved document before any move/embedding, while preserving the existing flat data format and location behavior.

### 2. [P1] Authenticate the parsed document before accepting the first binding

Location: `server/utils/workspaceOriginals.js:86-95,113-139`; consumer `server/models/documents.js:159-166`.

Trigger: use the legitimate, still-unbound reference minted by `attach` for parsed document A as the metadata reference for a different document B. The manifest records only the binary file identity and empty Workspace/docId fields: no trusted parsed ID, document path, content hash, or other verifiable mapping to A. `bind` accepts any nonempty caller-supplied docId, and the consumer supplies only that metadata string plus its newly generated docId. Resolution checks the binding established by this call, so it cannot detect the substitution.

Implication: a valid UUID is treated as authority to bind any document to the original. Containment and subsequent cross-document rejection do not satisfy the brief's genuine parsed-document binding requirement. An in-memory probe minted a reference for `{id:'genuine-parsed-A',location:'custom-documents/A.json'}`, bound it to `unrelated-document-B`, and resolved B successfully. This is a reproduced helper/consumer contract violation; no claim is made that an existing public HTTP endpoint currently permits arbitrary forged JSON metadata. Record and verify the genuine parsed identity at attachment/binding, instead of authorizing initial binding solely from metadata possession.

### 3. [P2] Support existing multi-Workspace and re-embedding behavior without consuming the reference

Location: `server/utils/workspaceOriginals.js:127-128`; consumer `server/models/documents.js:158-180`.

Trigger: once finding 1 is repaired, embed the same parsed document into two Workspaces, or remove and re-add it to the same Workspace. Existing `Document.api.uploadToWorkspace` explicitly loops over comma-separated Workspace slugs and invokes `addDocuments` for the same saved document. Each call generates a new docId, while the parsed document has one reference. The first binding permanently consumes that reference; every second binding throws, even for the same Workspace after removal.

Implication: the shared hook breaks a supported import flow. It throws after `VectorDb.addDocumentToNamespace` succeeds, leaving vectors without their Workspace document row; the catch also does not add this failure to `failedToEmbed`, so API upload can report success. A read-only in-memory probe confirmed the second binding throws `Retained original is already bound to another document`. Use verified parsed identity plus separate safe membership bindings, and make failed binding/row creation consistent with vector and failure reporting behavior. The filesystem read/check/rename is also not an atomic first-binding claim: concurrent bind calls can both observe null and overwrite one another.

### 4. [P2] Validate dimensions and complete profile envelopes before publishing vectors

Location: `server/modules/meetings/indexer.js:99-116,209-212`; publication `server/modules/meetings/indexer.js:412-428` and `server/modules/meetings/sources.js:744-764,1088-1115`.

Trigger A: a provider returns nonzero finite document vectors of different lengths, e.g. `[1,0]` and `[1,0,0]`, for one prepare/reindex batch. `vectorize` checks each vector independently, without requiring one dimension. The prepare probe returned both unchanged. Source processing/import/reindex persist them and can declare the meeting AVAILABLE; the first subsequent query discovers the incompatible dimension and fails. The required whole-current-index validation is therefore missing at publication.

Trigger B: a persisted object envelope has `vector:[1,0]` but no `profileId`. Search bypasses the profile comparison because it checks `if (storedProfile && ...)`. An in-memory search under `new-model` returned this chunk successfully. Such a malformed envelope is distinct from the explicitly supported legacy array fixture and has no detectable model identity.

Implication: inconsistent vectors can be published as usable, and corrupt profile metadata can silently bypass compatibility detection. Require consistent document dimensions and a valid profile for object envelopes; preserve only the deliberately documented array compatibility behavior. Profile-bearing envelopes otherwise flow correctly through source publication, import commit, and reindex, and mismatched declared profiles correctly fail search. Manual rebuild advances generation and preserves approval, but must not publish a malformed replacement index.

### 5. [P2] Return the required saved nonsecret Tencent settings from getPublic

Location: `server/modules/meetings/config.js:78-86` (save allowlist: `150-158`).

Trigger: save `appId`, `sdkId`, or `operatorId`, then reload configuration through the report's public settings seam. These fields are accepted and stored, but `getPublic` returns neither of them. It returns only userId/operatorIdType, capabilities, credential hints, and service settings.

Implication: an admin settings client cannot display the current required nonsecret identifiers after saving/reloading. This is an explicit Task 5a config requirement, not missing Task 5b UI wiring. Return the allowed nonsecret fields while retaining OCR/Tencent secret redaction.

### 6. [P2] Include cited Workspace revisions in historical source-change hints

Location: `server/modules/meetings/qa.js:94-96,275-316,377-378,405-406`.

Trigger: successfully answer using a Workspace document, then revise or unembed that document while the selected meetings remain unchanged. Citation snapshots contain the newly added documentId/revision, but `answerSourceState` skips any citation without meetingId/sourceId. History only snapshots meetings and compares those meeting-only citedSources; it never validates the saved Workspace citation against current document state.

Implication: history can continue to return `stale:false` for an answer whose cited Workspace source is gone or revised. Preserving the old quote is correct; reporting its source as unchanged is not. Keep the immutable snapshot, compare cited Workspace identities/revisions through the authenticated current-document seam, and do not reuse historical text as new evidence. The answer publication check for Workspace evidence is present and correctly receives the transaction for document lookup; that does not update later history hints.

## Boundaries that do satisfy the reviewed service scope

- Supplemental source removal retains originals, clears active hashes, pauses retrieval by advancing generation, and queues reindex. Originals/summary/transcript remain undeletable through the supplement remover. Approved supplemental text removal downgrades approval atomically; approved FILE removal rejects before mutation.
- Manual summary/transcript revision validates string values, creates a missing located source, and clears its current text/segments on an explicit empty string. Reindex then removes old chunks and reaches WAITING_CONTENT when no effective content remains. Archived source access is a read-only seam; mutations/indexing still reject deleted meetings/sources.
- Uploads check the injected trusted temporary root through realpath containment, hash with a stream, copy to generated quarter/internal-ID storage, enforce active-file/byte quotas inside the write transaction, use the active-hash DB uniqueness constraint, and clean rejected staged files. The buffered/streamed input paths share hashing. Outer import rollback cleanup is registered and preserves all-or-nothing content exposure.
- Critical config/import/meeting/source/QA audit callbacks receive their owning transaction client and propagate errors. The importer completes its job and audits within the same transaction; outer failure persists a durable failed job. No new global EventLogs call is made from these transaction callbacks.
- Workspace search carries documentId/revision; publication validates current Workspace access and exact membership/revision. Meeting generation/source-set guards remain active, and historical answer text/citations do not become retrieval evidence.
- Explicit profile rebuild uses the durable REINDEX path with generation blocking/dedup and preserves review state for unchanged content. Declared profile mismatch and zero/nonfinite vectors produce controlled failures rather than absent-evidence answers.

## Deferred minor issues and runtime handoff checks

- `validateEvidence` receives publication `db`, but its `resolve` call drops it before `lookupWorkspace` (`retrieval.js:17-22,99-100`). Document membership lookup does receive db. Expose/forward db to the authenticated Workspace lookup so Task 5b can use the publication transaction for access reads as well. This review does not assert a demonstrated unauthorized publication in SQLite from this omission alone.
- Config save accepts any HTTP(S) pathname ending in `/parse`, while the existing parser accepts only exact `/parse` after trimming one trailing slash. Align the declared URL validation contract; a saved prefixed `/service/parse` currently fails at parse time.
- The report says OCR settings are read at job execution time, but the existing parser closes over its injected `services` object. `getPrivate` does read current persisted settings. Task 5b must demonstrably fetch current config when constructing/invoking the job's parser adapter; the report should distinguish this remaining wiring obligation from verified current-on-use behavior.

Actual Express/authenticated file routes, production embedding/vector/provider adapters, and Task 7's same-page PDF OCR trigger are future-owned and their absence is not a Task 5a defect. Linux deployment, live Tencent/OCR/provider credentials, ACL behavior with actual runtime adapters, and production acceptance remain unverified. None of the supplied/mock checks establishes production acceptance.
