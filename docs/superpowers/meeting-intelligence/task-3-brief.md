# Task brief

## Shared/global context


- Linux fresh deployment; no legacy data migration acceptance.
- Quarterly active meetings <=200 including metadata-only drafts; cross-meeting selection <=10; transcript selection <=3 hours.
- Each file <=100 MB (decimal 100000000 bytes), per meeting <=20 active files and <=500 MB (decimal 500000000 bytes), original and supplemental combined.
- Original Tencent files read-only in DRAFT and APPROVED. Supplemental files content-unique within a meeting; delete/reupload only current DRAFT; no replace endpoint. Text supplementation cannot be directly edited.
- Drafts queryable only if AVAILABLE. Metadata-only creates DRAFT+WAITING_CONTENT, consumes quota and dedup identity; only successful effective-source indexing enables QA and approval.
- Source absence/confirmed API capability gap allows manual supplementation; runtime API/parse/index failure never degrades silently into metadata success.
- Full selected import scope succeeds or no content is exposed. Source-only supplementation failure does not invalidate existing usable content. Deletion/revision pauses retrieval until index cleanup/rebuild succeeds.
- Fixed conversation meeting/Workspace sets. Any selected meeting unavailable blocks new/reanswered questions. Historical evidence is snapshots, never fresh evidence by itself.
- No model knowledge as facts; citation IDs/quotes must correspond to retrieved evidence; conflict displayed, suggestions distinct from decisions, uncertainty prompts clarification or supplementation.
- Retain history on delete and reanswer. Delete old source then upload produces a new source ID; old snapshots remain old.
- Reuse accessible Workspaces, selected explicitly every new conversation; no real-time outside knowledge or tools.
- Existing auth remains. No new fine-grained meeting ACL scope. Admin-only connection/service configuration, never reveal secrets.
- Do not claim live API, OCR/provider or production performance verified without actual evidence; Linux/live credentials tests remain release checks.

## Review Focus

1. Concurrent duplicate import/upload or quota race: transaction and DB unique keys, not frontend-only guards (Task 1/2/3 tests).
2. Content edited/deleted while answer running: validate current source/generation before returning/persisting a successful answer; no historical context resurrection (Task 4 tests).
3. Delete last effective source then failing upload: WAITING_CONTENT or index failure stays blocked, old source never restored (Task 3 tests).
4. API only metadata vs transient failure: distinct capability status and import outcomes (Task 2 tests).
5. Parser loses location or returns empty text: do not declare successful index or generate fabricated citation; remote parser protocol validated (Task 3/4 tests).

## Shared contracts and data ownership

Task 1 defines Prisma models named `meeting_connections`, `meetings`, `meeting_sources`, `meeting_chunks`, `meeting_jobs`, `meeting_conversations`, `meeting_answers`. Subsequent tasks use those models; fields below are the minimum contract. JSON structures are serialized strings because Prisma SQLite JSON support is not assumed.

- `meeting_connections`: id Int, name String, config String (encrypted credentials plus service config), createdAt/updatedAt.
- `meetings`: id Int, connectionId Int, externalId String, activeKey String? @unique (connectionId:externalId; null on deletion), title String, startTime DateTime, endTime DateTime?, quarter String, reviewStatus String DRAFT|APPROVED, retrievalStatus String WAITING_CONTENT|AVAILABLE|INDEXING|INDEX_FAILED|DELETED, summary String?, transcript String?, coverage String, generation Int default 0, deletedAt DateTime?, createdBy Int?, reviewedBy Int?, reviewedAt DateTime?, createdAt/updatedAt.
- `meeting_sources`: id Int, meetingId Int, sourceType String TENCENT_ORIGINAL|SUPPLEMENT_FILE|SUPPLEMENT_TEXT|SUMMARY|TRANSCRIPT, name String, contentHash String?, activeHash String?, bytes Int default0, filePath String?, contentText String?, segments String?, parseStatus String PENDING|PROCESSING|SUCCESS|FAILED, error String?, deletedAt DateTime?, createdBy Int?, createdAt/updatedAt; @@unique([meetingId,activeHash]).
- `meeting_chunks`: id Int, meetingId Int, sourceId Int, text String, location String, embedding String, generation Int, createdAt.
- `meeting_jobs`: id Int, kind String IMPORT|PARSE_SOURCE|REINDEX, meetingId Int?, connectionId Int?, externalId String?, activeKey String? @unique, quarter String?, payload String, status String CREATED|PROCESSING|SUCCESS|FAILED, stage String?, error String?, attempts Int default0, createdAt/updatedAt.
- `meeting_conversations`: id Int, meetingIds String, workspaceIds String, createdBy Int?, createdAt.
- `meeting_answers`: id Int, conversationId Int, question String, status String, text String?, missingInfo String?, citations String, sourceState String, previousAnswerId Int?, error String?, createdAt.

Task 1 may add indexing/relations needed for safe queries without removing these names. Lazy database imports make unit tests possible without installed Prisma; real persistence integration uses generated Prisma client. Store enums as strings and validate transitions in domain code. Use `Asia/Shanghai` as initial business timezone and date interval [from inclusive, to exclusive), document this implementation ruling.

Source segment shape: `{text:string, location:{type:'paragraph'|'page'|'image'|'cell'|'slide'|'transcript', paragraph?:number,page?:number,sheet?:string,cell?:string,slide?:number,startMs?:number,endMs?:number}}`. Source reference includes id, meetingId, sourceType, name, location, quote, reviewStatus, coverage.


### Task 3: Sources, located parsing and embedding index

**Files:** Create `server/modules/meetings/parser.js`, `indexer.js`, `sources.js`; tests `server/__tests__/meetings/parser.test.js`, `sources.test.js`, `indexer.test.js`; add only justified parser dependency and fixtures if needed.

**Interfaces:** `createParser({services,fetchImpl})` exposes `parse({name,buffer}) -> segments`; `createIndexer({prisma,embedder})` exposes `prepare(segments)`, `reindex(meetingId)`, `search(meetingIds,question,limit=20)`. `createSourceService({prisma,parser,indexer,storageRoot,enqueue,audit})` exposes `upload(meetingId,{name,buffer},userId)`, `addText(meetingId,{name,text},userId)`, `remove(meetingId,sourceId,userId)`, `retry(sourceId)`, `process(job)`, `prepareImport(content)`, `commitImport(tx,meeting,prepared)` and `getSource(meetingId,sourceId)`.

Local TXT/MD paragraphs, DOCX/PPTX OOXML text + paragraph/slide location using adm-zip, XLSX exceljs cell values/cache, text PDF page extraction. Scanned PDFs/images and slide-image OCR use explicit configured OCR/document parser service; accept located segment response validated against shared shape. With no required parser/OCR config fail clearly, not fake content. Support `.docx,.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.pptx,.md,.txt`; reject unsupported formats. OCR response retains exact page/image/slide provenance; no automatic fallback. Remote service interface: multipart file POST to configured base URL, bearer token encrypted with meeting config, JSON `{segments:[...]}`; document for enterprise-local service implementation. Local parsing must not return SUCCESS on empty content. Use configured embedding engine; missing/calling failure explicit. Store chunk embeddings and compute cosine over selected current meeting chunks, never old/deleted chunks. Chunk/split within source/locator, stable reference IDs.

Uploads persisted under opaque generated name in storage/meetings, never original name as path. Limits plus SHA-256 active uniqueness checked transactionally; original files read-only, delete and reupload current DRAFT only, text no edit. Delete queues REINDEX immediately, last-source after cleanup => WAITING_CONTENT. New-upload failure retains existing index; deletion rebuild failure remains INDEX_FAILED. Reindex selects active SUCCESS sources and current revised summary/transcript, updates chunks and state atomically against generation; late worker cannot resurrect deleted source/meeting. New supplements downgrade APPROVED to DRAFT. Histories mark changed sources/new-source availability.

- [ ] RED tests for rename duplicate, concurrent duplicate, original forbidden delete, last-source deletion, failed first supplement, failed upload after deletion, traversal name safe path, empty parser response, DOCX/PPTX/Excel locations and OCR config failure.
- [ ] Run `npx jest server/__tests__/meetings/parser.test.js server/__tests__/meetings/sources.test.js server/__tests__/meetings/indexer.test.js --runInBand`.
- [ ] Implement located parser, source jobs and embeddings; preserve source errors and snapshots.
- [ ] Verify GREEN with real format fixture tests; commit and document local/remote service setup.


## Verified database constraint
Prisma 5.3.1 generated SQLite client in this repo does not expose createMany for new models. Use awaited per-row create inside transactions, not unsupported bulk operations. Client generated, all 41 migrations applied to ignored worktree storage DB. Tests that need real database should isolated temp copies/fixtures, not production.
