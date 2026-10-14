# Task 3 report: sources, located parsing, and embedding index

## Delivered

Added the parser, indexer, and source service under `server/modules/meetings/`, with focused tests in `server/__tests__/meetings/`. Manual file and text additions create a source row and `PARSE_SOURCE` job in one SQLite transaction. Jobs are written through the transaction client directly; the shared job runner discovers them by polling, so no global Prisma enqueue occurs inside a transaction.

Uploaded files are stored beneath the configured `storageRoot` under generated UUID names. The original client filename remains display metadata only. Active content hashes are unique per meeting. File size, active file count, and total bytes are checked before publication; duplicate transaction races map to a stable duplicate error. Supplemental additions downgrade approved meetings to drafts. Tencent original sources cannot be deleted. Deleting a draft supplement retains its source row and history, increments the meeting generation, blocks retrieval, and queues a `REINDEX` job. When cleanup removes the last effective source, the meeting returns to `WAITING_CONTENT`. Failed new-source parsing preserves an existing `AVAILABLE` index; a failed first source or replacement after last-source deletion stays blocked as `INDEX_FAILED`.

`prepareImport(content)` is pure with respect to the database and returns an array of prepared source records containing `sourceType`, `name`, `segments`, `chunks`, `contentText`, `contentHash`, and applicable attachment metadata (`buffer`, `bytes`, `externalFileId`, and `artifactType`). It supports Tencent summary segments and normalized transcript segments while retaining `recordFileId` locations. Attachment provenance is stored alongside, rather than mixed into, the shared segment shape in the source `segments` JSON envelope: `{ "segments": [...], "provenance": { "externalFileId": ..., "artifactType": ... } }`. `commitImport(tx, meeting, prepared)` writes every source and chunk using the caller-supplied transaction and only marks the meeting `AVAILABLE` after at least one valid chunk has been written. It opens no nested transaction.

The indexer splits long text within each source segment, keeping that segment's location on every chunk. It stores embeddings as serialized arrays and searches cosine similarity only across current-generation chunks whose meeting is `AVAILABLE` and whose source is active and `SUCCESS`. Search results include the source and review metadata needed for citation construction. Reindexing embeds outside the transaction, then checks the captured generation and active source set before replacing chunks and publishing status. Parse and reindex workers verify source identity and generation before publication, so deleted or superseded work cannot become current again.

Approval now treats failed parse history as resolved when the corresponding source is deleted or has since indexed successfully. Failed reindex history is resolved after a later generation is available. Active failed or pending sources still prevent approval.

## Runtime adapter setup

`createParser({ services, fetchImpl })` exposes `parse({ name, buffer })`. TXT/MD paragraphs, DOCX paragraphs, PPTX slides, XLSX cell values, and text PDF pages are extracted locally. The server package now pins `pdf-parse` to `1.1.1` for PDF page extraction. `adm-zip` and `exceljs` are existing server dependencies.

Scanned PDFs, PNG/JPG/JPEG/WebP images, or unsupported embedded slide-image text require `services.ocr = { url, token? }`. `url` is the complete HTTP(S) parser endpoint and must end in `/parse`; `token` is optional and sent as a Bearer token. The service receives multipart field `file` with the submitted filename and must return JSON shaped as `{ "segments": [{ "text": "...", "location": { ... } }] }`. Each location is validated against the shared paragraph/page/image/cell/slide/transcript shape. Missing configuration, request failures, malformed responses, and empty output are explicit errors. No OCR, live parser endpoint, or provider credentials were available for an end-to-end remote-service check.

`createIndexer({ prisma, embedder, chunkCharacters? })` requires `embedder.embedDocuments(texts) -> number[][]` and `embedder.embedQuery(question) -> number[]`. Missing operations, invalid vector sets, and embedding failures are explicit errors. The application integration can wrap its configured local or remote embedding provider with these two methods; no model is selected or silently substituted by this module.

`createSourceService({ prisma, parser, indexer, storageRoot?, audit? })` exposes the brief's source operations. `process(job)` accepts the durable job object returned by the existing runner; no additional enqueue adapter is required. `storageRoot` should be the server's `storage/meetings` directory or an isolated directory in tests.

## Verification

- RED confirmed before implementation for the three requested parser/source/indexer test files and for approval after deleting a failed source.
- Required focused command: `npx jest server/__tests__/meetings/parser.test.js server/__tests__/meetings/sources.test.js server/__tests__/meetings/indexer.test.js --runInBand` — 3 suites, 25 tests passed.
- Integration regression command additionally included lifecycle, importer, and Tencent suites — 6 suites, 67 tests passed.
- Targeted Prettier completed for all Task 3 implementation and test files, including the new-feature approval integration in `meetingService.js`. Scoped ESLint passed for all four implementation files with the Prettier rule enabled.
- Real generated TXT, DOCX, PPTX, XLSX, and PDF files were used for local extraction tests. The remote OCR contract was validated using a deterministic fetch stub.

## Limits

No production credentials, OCR endpoint, or live Tencent APIs were used. Runtime embedding-provider wiring and deployment storage configuration remain integration work for the application task. Local PDF extraction is covered with a valid PDF fixture; scanned PDF/image recognition still requires the configured parser service.

## Review follow-up

The review follow-up added guarded source ownership, active-set and lease checks at index publication, generation-aware pending-source requeue, and deletion restricted to draft supplements. Revisions to imported summary/transcript text now update the source text, hash, segments, and chunk locations in the same publication transaction. The importer registers staged attachment cleanup with the outer transaction caller so a later lost-lease rollback removes files written by a successful source commit.

PPTX parsing now follows slide relationships to embedded images and sends each image to the configured located parser; OCR text is attached to the actual slide. PDF extraction retains empty page identities and sends a mixed document to OCR when any page lacks extractable text, then requires page locations for the scanned pages. Standalone image sources use the whole-asset `image` location.

- RED: the four focused parser/indexer/source/importer suites reproduced 9 new assertions before implementation.
- GREEN: `npx jest server/__tests__/meetings --runInBand` — 7 suites, 84 tests passed, including Tencent importer and lifecycle regressions.
- Scoped ESLint passed for parser, indexer, sources, and importer. Targeted Prettier checks and `git diff --check` passed.
- Runtime extension: `createIndexer().reindex(meetingId, { job })` accepts the durable runner job to guard publication by lease. `commitImport(tx, meeting, prepared, { onRollback })` registers cleanup with the importer's outer transaction; the three-argument call remains valid when the caller owns rollback cleanup.

### Rereview follow-up: multiple OCR segments per PDF page

- RED: the mixed text/scanned PDF fixture returned two located OCR segments for page 2; before the fix, parsing retained only the last one.
- GREEN: `npx jest server/__tests__/meetings/parser.test.js server/__tests__/meetings/sources.test.js --runInBand` — 2 suites, 29 tests passed. The parser now groups OCR results into ordered arrays by page and expands all segments for each textless page; missing-page and format-location validation remain enforced.
- Scoped ESLint, targeted Prettier, and `git diff --check` passed for the parser change.
