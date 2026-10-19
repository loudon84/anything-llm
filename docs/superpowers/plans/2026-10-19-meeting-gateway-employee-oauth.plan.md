# Meeting Gateway Employee Session and Tencent OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development task-by-task. All code reading, implementation and review must be delegated to GPT-6 Luna, as requested by the user.

**Goal:** Implement the user's existing account-login → ms_ → exchange → Gateway business token → Tencent authorization URL → connection_id return chain, using browser navigation and actor-scoped server credentials.

**Architecture:** Reuse the existing Gateway client/session bridge, identity projection/session registry, OAuth state store and frontend Gateway model. Keep employee identity and Tencent connection authorization as separate states. Gateway owns Tencent callback/state; Consumer owns its initiating employee/browser context and verifies connection status server-side after return.

**Tech Stack:** Existing Express/CommonJS, Prisma/SQLite, JWT, React/Vite, Jest and Node tests; no new identity system, token database or import pipeline.

**Spec:** `prd/AnythingLLM_MeetingGateway_企业微信登录与接入迁移_开发需求PRD_v2.0.0.md`, content 2.0.4, §4.8 DEC-R2-EMPLOYEE-OAUTH-006 and retained §4.6.

**Spec SHA256:** `b3c39277b7a3b5ebd89f3412ce350167a7109c858e0f1dfae927bf87b8791d92`.

**Baseline:** `861c0e45` on `codex/meeting-intelligence`; prior foundation code `01823fe8` passed 19 backend suites/214 tests. That result does not prove this protocol is implemented. User has authorized the implementation workflow and supplied the concrete protocol; do not ask again for a static QR URL or a new WeCom contract.

## Global Constraints

- Credentials are submitted to Gateway account-login only; Backend JWT/refresh tokens must never be retained or returned by Consumer. Extract only Gateway ms_ session and approved identity/expiry fields. Never persist/log account password.
- Exchange subject_token must start with ms_; local JWT, raw user IDs and Backend JWT must fail closed. Registered client credentials stay server-side. Business token must represent this MEMBER and the Gateway REST resource; no shared-account fallback.
- Use exchange access_token for POST `/api/v1/oauth/authorizations` and Gateway connection API calls. Keep ms_/business/refresh material encrypted in the existing bridge/token store and bound to actor/session/binding epoch. Browser gets only local credentials and safe status.
- Stable Gateway identity projection remains the enterprise user source; no independent local signup, fake password, name/email merge or auto-admin. Preserve ordinary legacy single-user/password modes. Where an employee's first app login is supported, profile/projection and registry issuance precede local success; do not require independently provisioning that employee first.
- Authorization URL must have exact Tencent origin/path and exactly corp_id, sdk_id, redirect_uri, state, without duplicates. Callback equals the configured Gateway PUBLIC_BASE_URL + `/callbacks/tencent/oauth/<appId>`. Do not confuse it with Consumer return_to.
- Open/load authorization_url in the employee browser. Never GET, proxy, capture or scrape it on the server. Do not describe this Tencent authorization page as proof of enterprise WeCom identity.
- Gateway owns the one-use approximately 300-second state. Consumer preserves returned transaction_id/expires_at, applies a bounded pending-browser transaction, never substitutes/replays Gateway state or extends its deadline.
- Gateway return_to query carries connection_id only. The identifier does not log in a user or assert ACTIVE. Verify local session, pending transaction, member/connection ownership and authoritative Gateway state before displaying authorization success.
- LOCAL_ONLY permits previously persisted, locally authorized data only; no remote list, authorization/refresh/import/retry/backfill. Explicit verified employee reauthentication is required to restore remote access. New import development/acceptance remains deferred.
- No live credential login/exchange/authorization, external client registration, production configuration/DB mutation, shared Prisma generation, push or merge during fixture implementation. Actual deployment testing requires already registered config and an authorized real-user flow; report it separately.
- Preserve unrelated untracked task7-isolated directory and task5b runtime-smoke SQLite. Do not stage all files or touch E-drive master product code.

## Evidence and precedence

The user supplied the actual route/prefix/envelope/browser/return semantics. Existing Gateway source may be read narrowly to map request/response fields and connection operations; do not invent body fields or treat old assumptions as requirements. §4.8 supersedes the prior QR plan's assumed `/oauth/authorize` + authorization_code `/oauth/token` login path for this implementation. Earlier in-page QR discussion does not authorize server retrieval of the Tencent URL. Render the authorized browser experience supported by the actual page, and state any embedding limitation honestly.

## Shared interfaces

- Keep the current Gateway client factory; implement its existing `accountLogin(credentials)` and `exchange(...)` ports and required identity/connection operations with bounded same-origin transport. Preserve existing callers or update them together; report canonical field names/signatures for dependent workers.
- `accountLogin({account,password})` produces only normalized ms_ session token, verified subject/profile data and absolute expiry. Backend token fields are discarded, including nested unexpected fields.
- `exchange` consumes ms_ + configured registered client/resource/scopes and produces a normalized Gateway API access token plus actual expiry/scope/resource; no provider credentials in public DTOs.
- Existing session login/status/logout remain additive-compatible; the bridge binds the same Gateway employee to the local actor. Reuse `createWeComIdentityStore` where first-login user projection is needed; do not introduce another user store.
- Existing OAuth start yields public `{authorizationUrl,transactionId,expiresAt}`; local BFF DTO may remain normalized while upstream Gateway responses are unwrapped from `data`.
- Completion consumes connectionId plus a server-associated pending employee/bridge context, then returns safe server-read connection state. It never consumes a query token or creates login from connection_id.
- Frontend has distinct employee authentication and Tencent connection status; it opens the returned URL via browser APIs, receives only safe callback status, and refreshes state from BFF.

### Task 1: Employee auth transport, actor credentials and runtime composition

**Files:** `server/utils/meetingGateway/client.js`, `sessions.js`, `server/index.js`; relevant `models/meetingGateway.js`/existing identity store integration; existing `server/endpoints/meetingGateway.js` and additive employee-login BFF/service only where first-login projection requires a coherent seam. Tests: Gateway client/session/identity and endpoint integration suites. Prefer a focused helper over growing the existing large WeCom service.

- [ ] Write failing tests for exact account-login and exchange POSTs/envelope mapping; ms_ prefix rejection; Backend token/password stripping; employee/member/audience/expiry mismatch; no secrets in DTO/log/errors; encrypted actor-scoped credential persistence.
- [ ] Implement bounded transport and normalize only actual response fields. Reuse existing server configuration with safe readiness diagnostics; no contract:null stub gating this known protocol. Do not read or print configured secret values while developing.
- [ ] Integrate Gateway identity/profile and local projection/session issuance where needed for first employee login, and bind the same actor's ms_/business credentials into the existing bridge. Existing authenticated-user linking must reject cross-actor mismatches rather than silently adopting another employee.
- [ ] Wire real configured Gateway client/session instances lazily. Missing client config affects this flow only and must preserve legacy app behavior. Cover profile/projection/token-persistence failure atomicity and LOCAL_ONLY on uncertain results, with no blind redemption/refresh retry.
- [ ] Run focused client/session/identity/BFF tests and one isolated real-store fixture; commit only task paths; fresh Luna review before dependent work. Return exact normalized client/session APIs to Task 2/3.

### Task 2: Tencent authorization URL, transaction and verified return

**Files:** `server/utils/meetingGateway/oauth.js`, `stateStore.js`, `client.js` connection operations only as needed; `server/endpoints/meetingGateway.js`; `server/index.js`. Tests: OAuth/state-store/endpoints and a fixture-backed integration.

- [ ] Write RED tests for all four required URL params, duplicate/missing/foreign origin or callback/corp/sdk rejection, Gateway callback vs Consumer return_to, returned expiry and ~300-second bounded pending state, one-use/expired/cross-employee returns.
- [ ] Map POST `/api/v1/oauth/authorizations` and connection list/confirm/status to actual Gateway source fields. Use the current employee's API token, exact configured callback/app identifiers and allowlisted Consumer return_to. Never fetch Tencent authorization_url on the server.
- [ ] Implement Consumer return handling for connection_id only; reject unexpected credential/query fields and arbitrary redirects. Account for existing Strict/Secure cookies by returning safely to same-origin UI before authenticated status checks when necessary; do not weaken cookie settings.
- [ ] Bind pending authorization to current employee/bridge/browser. Query Gateway connection state after return, verify owner/MEMBER/type, confirm if required and re-query ACTIVE. Replayed query data must not create another login/confirmation or claim success. Handle cancellation/expiry and keep employee login separate from connection authorization.
- [ ] Run OAuth/state-store/BFF integration tests including outbound spies and LOCAL_ONLY denial; commit scoped changes; obtain Luna review.

### Task 3: Employee login and Tencent authorization UI, integrated acceptance

**Files:** existing `frontend/src/models/meetingGateway.js`, Login and Meetings entry/components, existing result routes or a purpose-specific Tencent return component, relevant `paths.js`/`main.jsx` only as needed. Reuse `baseHeaders`, existing LOCAL_ONLY notice and token-safe browser storage. Tests: frontend Gateway/auth/header node suites and backend affected suites; verification docs.

- [ ] Write failing UI/model tests for separate employee-authenticated and connection-ACTIVE states; account/password sent only to same-origin BFF and cleared after submission; no Gateway token accepted/stored; browser-only authorization URL opening; callback connection_id causes server status lookup rather than success by itself.
- [ ] Add employee Gateway login/reauthentication using Task 1 APIs without independent local signup. Present Tencent authorization as a separate action after employee credentials are valid. Preserve existing WeCom entry readiness truthfully; do not relabel Tencent QR as enterprise WeCom identity verification.
- [ ] Show pending/expiry/cancelled/failed/ACTIVE from server state. Guard popup/window messaging by exact origin/source where used, and keep callback/query free of tokens. Preserve legacy single-user/password behavior and LOCAL_ONLY local search; do not start import automatically.
- [ ] Run affected backend suites, frontend model/header suites and production build; inspect local desktop/browser flow with explicit fixtures where needed. Keep real user/Gateway authorization unverified until actually executed; do not reuse old 214-test result as proof.
- [ ] Record protocol mapping, exact results, deployment settings still needed and no-live-side-effect boundary; final Luna whole-change review, one concentrated fixwave and scoped rereview. Commit; retain branch/worktree without push/merge or production migration.