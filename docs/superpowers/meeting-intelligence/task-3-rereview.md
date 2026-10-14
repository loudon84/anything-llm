# Task 3 fix-round1 rereview

## Verdicts

- **Spec compliance: changes required.** The ten previously identified fixes are addressed in their reported paths, but the PDF merge introduced in this round can silently discard selected OCR evidence while publishing a successful source/import.
- **Task quality: changes required.** Publication ownership, source-set, lease, and rollback boundaries are substantially improved. One concrete parser regression remains open; the current passing tests cover only one OCR segment per scanned page.

## Scope and evidence

Read `task-3-brief.md` first, followed by `task-3-report.md`, `task-3-review.md`, `task-3-controller-findings.md`, and `task-3-fix-round1-diff.txt`; checked the corresponding current implementation and focused regression tests. This is a rereview of the reported findings and concrete breakage introduced by the fix diff, not a fresh broad review. No implementation edits or child agents were used.

The binding requirements include full selected import atomicity, immutable original files, deletion confined to current-draft supplements, preserved source rows and historical answer snapshots, blocked metadata-only content, prevention of stale/deleted publication, preservation of an older usable index on new-source failure, and accurate page/slide provenance. A standalone image's source/file identifies the whole image; no pixel bounds are required.

The controller independently reran the complete current meeting suite: **7 suites, 84 tests PASS**. This rereview accepts that supplied evidence and did not repeat that suite. A separate in-memory reproduction exercised only the newly identified multi-segment PDF case below. No live Tencent API, OCR endpoint, embedding provider, Linux deployment, or production performance was verified.

At inspection, the implementation changes were already present in the current checkout and were not shown as unstaged changes by `git status`; the supplied fix diff remains the scope boundary.

## Disposition of the ten findings

1. **ADDRESSED — split chunks retain source ownership.** `indexer.js:119-124` carries `sourceId` onto every prepared piece; `indexer.js:278-283` groups chunks using that preserved identity. The former per-segment/per-chunk cursor mismatch is removed. The added indexer regression uses a splitting first source and a second source.

2. **ADDRESSED — publication checks the active source set.** `indexer.js:220-234` captures the active source IDs, hashes, and parse states; `indexer.js:307-334` compares the current set inside the publish transaction before chunk deletion. A change aborts publication and queues a reindex for the new set. The added source test lets another source finish while embedding is blocked and checks that the first reindex does not replace its chunks.

3. **ADDRESSED — expired parse workers cannot overwrite their replacement.** `sources.js:419-430` checks current processing status, owner, and unexpired lease. Both success publication (`sources.js:522`) and failure publication (`sources.js:621`) repeat that check in their transaction; failure also refuses to demote a successful source (`sources.js:640`). REINDEX receives the durable job (`sources.js:716`) and checks its lease before publication (`indexer.js:294-305`); reindex failure updates are lease guarded as well (`sources.js:726`). The added replacement-worker test covers the originally reported late-failure path.

4. **ADDRESSED — an old-generation pending parse is requeued.** Parse keys and payloads now include generation (`sources.js:128-156`); `sources.js:433-474` queues current-generation work only for an active, unchanged pending source on a live meeting. Both initial stale-generation detection and post-embedding detection use that path. The added pending-source regression verifies the replacement generation and retained pending state.

5. **ADDRESSED — imported summary/transcript deletion is rejected.** `sources.js:350-357` allows only `SUPPLEMENT_FILE` and `SUPPLEMENT_TEXT`, after the existing current-draft guard. Imported sources remain retained; deletion continues to soft-delete supplements and queue cleanup rather than deleting their historical rows. The added test rejects both SUMMARY and TRANSCRIPT removal.

6. **ADDRESSED — outer import rollback cleans attachment files.** `sources.js:881-889` registers stored-file cleanup with the outer transaction owner. `importer.js:540-541` accepts that registration and `importer.js:562-564` runs it when the transaction fails, including failure after source commit. The callbacks are cleared only after successful transaction completion (`importer.js:554`). The added importer test forces the lost-lease completion failure and verifies file removal.

7. **ADDRESSED — OCR provenance is checked for the uploaded format.** `parser.js:325-342` requires the expected location type, while the generic validator requires positive integer PDF pages. Known PDF page bounds are checked; scanned pages must be represented. Standalone images require `image` and use the source/file as the whole-asset locator. Embedded-image OCR gets its slide locator from the owning slide (`parser.js:375-382`). The added mismatched-location test rejects paragraph provenance for scanned PDF input.

8. **ADDRESSED — PPT native text and embedded-image OCR are both processed.** `parser.js:174-202` resolves embedded image relationships and retains the owning slide; `parser.js:367-384` parses those images through the configured service and appends their text with slide provenance. A native-text slide no longer bypasses required image OCR; missing OCR configuration fails explicitly. The added fixture combines native text with an embedded image.

9. **ADDRESSED — mixed PDF textless pages now trigger OCR.** `parser.js:257-260` preserves page identities even when local extraction is empty. `parser.js:390-415` invokes configured OCR when any page lacks text, requires corresponding page locations, and preserves local text-page content. The added mixed-PDF test verifies native page 1 plus OCR page 2. The distinct multi-segment merge regression introduced by this fix is open below.

10. **ADDRESSED — revised SUMMARY/TRANSCRIPT source rows match the new index.** `indexer.js:243-266` derives changed content from current meeting fields and records source revisions. `indexer.js:340-355` updates content text, SHA-256 hash, active hash, and segments in the same transaction that replaces chunks. `indexer.js:389-398` uses current paragraph locations, dropping obsolete recording/timing labels; this applies to both source types. The added SUMMARY test verifies current text, changed hash, and matching source/chunk paragraph locators. Historical answer snapshots are not rewritten by this path.

## Open finding introduced by the fix

11. **[P1] Preserve every OCR segment on each scanned PDF page.** At `server/modules/meetings/parser.js:398-400`, `new Map(remote.map(segment => [segment.location.page, segment]))` stores only one segment per page. At `parser.js:412-414`, a scanned page is replaced with that single segment. The documented remote response allows multiple located segments for the same page; all earlier segments on that page are silently lost, yet parsing succeeds. This affects both all-scanned PDFs and scanned pages within mixed PDFs, causing selected document evidence to be absent from indexing and citations while a full import is marked successful.

   **Concrete reproduction:** generated an in-memory two-page PDF with native text on page 1 and no extracted text on page 2. The deterministic OCR response contained `First scanned-page decision` and `Second scanned-page decision`, both located at page 2. The actual parser returned only `Native page` (page 1) and `Second scanned-page decision` (page 2); the first decision was missing. No files or application data were modified by this reproduction.

   **Required fix:** group OCR results as arrays per page, then flatten every returned segment for each textless page while retaining its page locator; preserve the existing missing-page and invalid-provenance rejection. Add a regression with at least two OCR segments for the same scanned page and assert both reach the parser result. The existing 84-test passing result does not cover this case.
