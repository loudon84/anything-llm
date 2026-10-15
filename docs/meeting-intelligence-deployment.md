# Meeting Intelligence deployment and release verification

This feature adds an authenticated meeting center and fixed-scope evidence QA to AnythingLLM. This runbook describes a **fresh Linux deployment**. It does not migrate or certify legacy meeting data. The Windows integration work did not exercise a Linux host, tenant Tencent credentials, a production OCR endpoint, or production model providers; those are release gates below.

## Runtime prerequisites and process model

Deploy with Node.js `>=18.12.1`, the repository's normal AnythingLLM server and frontend build/install process, and a writable application data directory. The application database must support the Prisma schema and migration set used by the deployed revision. Run the repository migrations before starting the updated application:

```sh
cd server
npx prisma migrate deploy --schema prisma/schema.prisma
npx prisma generate --schema prisma/schema.prisma
npm run start
```

Run the repository frontend production build from `frontend/` as part of the normal release pipeline. Back up the application database and storage according to the deployment's existing AnythingLLM procedure before applying migrations. This feature stores meeting metadata, source history, chunks, durable jobs, conversations, and answer snapshots in the application database. Supplemental file bytes are archived beneath the configured storage root in `meetings/`; multipart temporary files use `meeting-uploads/`. Keep both durable and writable, monitor their capacity, and include them with the database in backup/restore planning.

The durable meeting job runner is started and stopped with the server process. It processes `IMPORT`, `PARSE_SOURCE`, and `REINDEX` jobs; this revision does not define an independently managed worker service. Run the application's established supervised server process and restart procedure. A restart recovers durable jobs through the runner. Do not run two server processes against one SQLite deployment unless the application's supported concurrency and file-locking setup permits it. The application storage root is selected by the existing `STORAGE_DIR` setting; meeting paths are contained under the meeting storage tree. Verify the effective storage mount and permissions in the target deployment before enabling uploads.

## Tencent Meeting and parser configuration

An admin configures an authenticated connection through the Meeting Intelligence settings page or the authenticated API. The API is below the existing `/api` base path:

- `GET /api/meetings/config` returns the admin's redacted configuration; employee responses omit connection identifiers, service URLs, and credential hints.
- `PUT /api/meetings/config` is admin-only. It accepts connection name, Tencent `appId`, `sdkId`, `secretId`, `secretKey`, operator/user identifiers and options, capability states, and optional `services.ocr.url`, `services.ocr.token`, and `services.ocr.timeoutMs`. Secret fields are encrypted by the application's existing encryption manager; blank secret fields preserve stored credentials. Treat the application's encryption key/salt and database as one restore unit. Do not put credentials in URL userinfo or logs.
- `GET /api/meetings/remote` and `GET /api/meetings/remote/:externalId/manifest` use the saved connection and return meeting metadata/capabilities; signed attachment URLs are not exposed.

Tencent transcript, smart-minutes/summary, and downloadable-artifact capabilities start as **unknown**. This release does not automatically probe unverified APIs. The administrator must verify and configure supported capabilities, or explicitly record an unsupported capability; that decision stores the administrator identity and time. A Tencent response that confirms content is absent is also authoritative. Unknown capabilities block metadata-only success, and a configured supported capability that fails at runtime fails its import instead of silently degrading. Only explicit verified unsupported states or confirmed absence allow metadata-only creation/manual supplementation. Tencent's detail response does not document artifact sizes, so the manifest can return unknown size; actual download enforcement still applies the 100,000,000-byte per-file limit. The implementation uses Tencent's documented Meeting APIs and only downloads from Tencent-returned HTTPS artifact URLs. Tenant app grants, operator role, STS provisioning where required, plan gates, and actual content availability need verification by the tenant administrator. Do not infer that API access works from a saved config alone.

The adapter's implementation references are Tencent's official [enterprise AK/SK authentication](https://cloud.tencent.com/document/product/1095/42413), [ended meeting search](https://cloud.tencent.com/document/product/1095/53805), [recording search](https://cloud.tencent.com/document/product/1095/51189), [transcript details](https://cloud.tencent.com/document/product/1095/65111), [smart minutes](https://cloud.tencent.com/document/product/1095/109458), and [recording artifacts](https://cloud.tencent.com/document/product/1095/51180) documentation. Recheck the current tenant grants and Tencent API contract when running the release verification; these links do not constitute a live tenant test.

The optional document/OCR parser is a controlled HTTP service. Configure `services.ocr.url` as an absolute HTTP(S) URL whose path is exactly `/parse` (for example `https://parser.example.internal/parse`), optionally set a bearer token, and choose a timeout from 5,000 to 300,000 milliseconds. The default is 120,000 milliseconds. The same deadline covers the request and full response-body parsing; expiry aborts the HTTP request and fails that durable job so the runner can continue with later work. A short timeout can reject legitimate slow OCR; a long timeout can hold one worker longer. The selected bound is a conservative operational default, not a measured latency target. The token is stored encrypted and only a presence hint is returned publicly. For each parse job, the current saved endpoint, token, and timeout are used. The server sends a `POST` with `multipart/form-data`, one `file` part, and `Authorization: Bearer <token>` when configured. The service must return JSON of this shape:

```json
{
  "segments": [
    {
      "text": "Located extracted content",
      "location": { "type": "page", "page": 1 }
    }
  ]
}
```

Each segment needs non-empty text and a valid locator. Image requests require `location.type: "image"`; PDF requests require `location.type: "page"` and an in-range one-based page number. The server rejects unsuccessful HTTP responses, invalid JSON, missing/invalid locations, and empty content. It does not mark the source successfully indexed on those responses. Pure text PDFs stay on the local parser; PDF pages with image content are also sent for OCR even when the same page has native text, and native text is retained alongside returned OCR segments. Images, and images embedded in PPTX, require the configured parser. DOCX, XLSX, PPTX text, Markdown, and plain text have local extraction paths; PPTX images require OCR. Supported extensions are `.docx`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.xlsx`, `.pptx`, `.md`, and `.txt`. Extension support is not a guarantee that every encrypted, malformed, or unusual document will parse.

Use a trusted internal parser endpoint with TLS where traffic crosses a network boundary. Restrict its network ingress to application hosts, protect and rotate the bearer token, set service-side request/body limits compatible with the application file limits, and use parser retention settings appropriate for meeting data. No OCR provider is bundled or selected automatically.

## Fresh Linux verification and release gate

Before release, provision an empty Linux deployment database and isolated storage location. Apply the migrations and generate the Prisma client using the commands above. Start the normal server under its production supervisor and verify the health endpoint, authenticated admin/employee behavior, and server restart. Configure actual tenant credentials in the admin UI, then verify one bounded history search, one manifest, and a small content import against the tenant's real Tencent Meeting account. Record the tenant, granted API capabilities, request/result IDs, and sanitized failure evidence without recording secrets. Verify at least one enabled content path and one unsupported/absent path; do not mark content capability enabled until successful real evidence is observed.

Run an owned test parser service with the documented multipart and locator contract first. Then verify the real selected OCR service using a scanned-page fixture and a same-page mixed native-header/scanned-body PDF; confirm both native and OCR text remain locatable. Also verify a pure-text PDF does not call OCR. Change the saved OCR URL/token and prove that the next parse job uses the new configuration. These checks must use test documents and must not expose meeting contents in logs.

Exercise the critical business flows on the fresh deployment: metadata-only DRAFT consumes quota and remains unqueryable; successful source indexing makes it AVAILABLE; approval; approved genuinely new file causes DRAFT; deleting a source retains its historical bytes/snapshot and blocks retrieval until cleanup/reindex completes; a deleted-file reupload to an APPROVED meeting is rejected without state/quota changes; the same file can be uploaded as a new source ID in DRAFT; cross-meeting identical content remains allowed; active duplicates and concurrent duplicate/quota reservations are rejected by database-backed constraints. Verify original Tencent sources stay read-only. Confirm QA blocks when any selected meeting/workspace is inaccessible/unavailable, citations quote current retrieved evidence, changed/deleted sources cannot be returned as fresh evidence after model completion, and old snapshots remain historical. Verify embedding model A → same-dimensional model B rejects an old profile, then an explicit rebuild makes the new profile queryable. Reuse the focused automated regressions for stream abort, real Chroma projection, current Workspace membership, and existing authentication denials.

Release decisions use a zero-tolerance critical gate: **0 unresolved critical failures** for migration/start/restart, tenant authorization, source immutability, duplicate/quota races, lifecycle/reupload guards, stale-source answer races, parser failure/locator validation, retrieval-profile mismatch, and authenticated evidence access. Record every expected result and attach sanitized logs or screenshots from the actual rendered application. A failure in any critical path blocks release.

Report OCR quality/coverage, Tencent capability coverage, model answer quality, p95 latency, indexing throughput, concurrent-user capacity, and storage/retention cost as separate **secondary, measured gates**. No performance threshold or value is established by this implementation task. Product/release owners must set thresholds before accepting these measures; label unavailable measurements `unmeasured`, not passed. Also record the Linux distro, runtime versions, database, storage mounts, deployed commit, migration result, and parser/Tencent service versions so the run can be reproduced.

## What the current integration evidence establishes

Task 7 automated integration uses a fresh SQLite database copied from the Prisma schema/migrations, applies all 43 migrations, and runs real Prisma lifecycle/config/runtime transactions. Controlled adapters and local HTTP services stand in for external Tencent, embedding, vector, LLM, and OCR services. The isolated full server and frontend can be run with test-only preload injection and synthetic meeting fixtures. This establishes local wiring and lifecycle behavior only. It does not establish Linux deployment, live Tencent access, production OCR quality, live model/provider behavior, or performance. Those checks must be performed in the target environment before claiming release acceptance.
