# Meeting Gateway OAuth QR and API Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development task-by-task. All code searches, implementation and reviews use GPT-6 Luna subagents. Steps use checkbox syntax.

**Goal:** AnythingLLM发起现有Gateway OAuth，在自己的页面显示Gateway企业微信二维码；扫码成功后由后端取得、保管用户Gateway API token，并用于接口调用。

**Architecture:** 复用现有authorization-code + PKCE、Consumer登录事务/回调、本地投影和bridge。扩展现有登录/结果组件显示受信Gateway扫码界面；Gateway验证企业身份，Consumer后端兑换code、确认主体并加密保管access/refresh token，浏览器只持本地会话。

**Tech Stack:** Existing Express/CommonJS, Prisma/SQLite, React/Vite, JWT, Jest/Node tests. No second user system, token store or authentication service.

**Spec:** `prd/AnythingLLM_MeetingGateway_企业微信登录与接入迁移_开发需求PRD_v2.0.0.md`, content 2.0.3, §4.7 DEC-R2-OAUTH-QR-005; §4.6 remains in force.

**Spec SHA256:** `1af748f9122e71054e2efaba0897adabe9dd967d317e5e1eb29dcab5bc680c09`.

**Baseline:** `bf397e53`, branch `codex/meeting-intelligence`. Previous AUTH_LOCAL_SEARCH plan records completed Consumer foundations against PRD 2.0.2; this plan amends the actual OAuth presentation and Gateway credential path. Old test/build evidence is historical and does not prove this new flow works.

**Current status:** Decision recorded; read-only code/metadata discovery completed by GPT-6 Luna. No OAuth request, login, token exchange or product-code change performed for this amendment. Client registration and the actual Gateway QR page/embedding behavior remain configuration facts to confirm. Do not require a newly invented dedicated WeCom API.

## Global Constraints

- AnythingLLM must display the real Gateway QR authorization UI; a top-level redirect alone does not fulfill §4.7. Prefer the existing Gateway-hosted component/page or existing QR payload it actually supplies; confirm CSP/frame permissions before selecting the rendering adapter.
- Do not fake/capture/generate a WeCom QR, strip Gateway security headers, proxy arbitrary HTML, or call Tencent connection authorization an enterprise login.
- Reuse deployed OAuth client registration. Exact callback allowlist, client authentication, scope/resource and PKCE match actual Gateway behavior; never invent client IDs, return URLs, profile endpoints or undocumented QR fields.
- Gateway access/refresh tokens stay server-side, encrypted and actor/session-bound; no Gateway or Tencent token in URL, iframe messages, localStorage, browser DTOs or logs. Local JWT is never a Gateway bearer.
- For identity, use Gateway's verified response or supported userinfo/session capability. Trust JWT identity claims only after their required verification. Access tokens may be opaque to Consumer; do not add a JWKS/introspection service just because a token looks like JWT.
- Stable projection tuple and ordinary local role remain unchanged. First/repeat logins, local disabled/revoked/expired cases and cross-user authorization continue to be enforced.
- Lost redemption/credential result remains current-session LOCAL_ONLY: existing authorized local data only, zero remote meeting fetch/import/backfill; explicit verified rescan restores Gateway access.
- New import development/acceptance remains DEFERRED_CURRENT_PHASE. Preserve prior local datasets, ordinary password/single-user login, and the quarantined unknown-context queue policy.
- No production account/client registration, configuration/DB mutation, secrets acquisition, upstream authorization/token request or real-user scan without its necessary real configuration and authorized flow. Do independent implementation/test work first; report missing values specifically.

## Confirmed existing OAuth surface

- Issuer/origin: `https://copilot.superic.com:9999`.
- Authorization: `/oauth/authorize`; `response_type=code`, registered `client_id`, exact `redirect_uri`, `resource`, allowed `scope`, random `state`, S256 `code_challenge`.
- Token: `/oauth/token`, form-encoded authorization_code grant with `code`, `code_verifier`, `redirect_uri`, `resource`, and the registered client's authentication method.
- Revoke: `/oauth/revoke`; REST audience: `https://copilot.superic.com:9999/api/v1`.
- Reviewed Gateway source redirects authorization to a Portal consent page and returns `mt_` business tokens. This proves reusable OAuth plumbing, not the live WeCom QR presentation or a token-to-profile mapping.
- No `userinfo_endpoint` is advertised in observed metadata. Reviewed `/api/v1/auth/session` requires `ms_`, so do not send it `mt_` and assume identity lookup succeeds. Confirm the actual deployed authenticated profile source instead of adding a mandatory new service.

## Configuration facts to resolve

Obtain the existing usable QR authorization URL or its config location. Extract/confirm the registered client ID/authentication method, Consumer callback allowlist, minimal API scope/resource, permitted QR page/component origin, embedding/cookie behavior, and the authenticated identity source bound to the issued token. Never request secret values through chat. Registration facts can be recorded without revealing a client secret.

## Task 1: Reuse OAuth code flow and persist Gateway actor credentials

**Files:** `server/utils/meetingGateway/wecomClient.js`, `wecomAuth.js`, `wecomAuthRuntime.js`, existing `client.js`/`sessions.js` only where reusable; `server/endpoints/wecomAuth.js`; `server/index.js`; current bridge/session model seam and matching tests. Reuse existing token storage rather than add a competing store. Touch `server/models/wecomIdentity.js` only if atomic actor/session linkage requires it.

**Interfaces:** Keep existing Consumer config/start/state/complete endpoints compatible. Start supplies a validated display target plus transaction expiry; callback consumes standard `code/state`; token/profile remain server-private. Existing callers can continue reading `authorizationUrl` while new display metadata is introduced only after actual Gateway behavior is confirmed.

- [ ] Write RED tests for real OAuth request/response mapping: authorize URL and PKCE; form token exchange; callback code/state/cookie association; exact redirect/resource/client; one-use code and no retry on uncertain result.
- [ ] Implement the adapter against existing OAuth endpoints/config. Remove the assumption that production login must use a custom start/redeem API; no guessed QR/profile endpoint fallback.
- [ ] Verify the authorized subject via the deployed Gateway response/profile capability, upsert the existing local projection, and persist Gateway access/refresh tokens encrypted against the same actor/session before reporting remote readiness. Fail incomplete persistence/subject linkage; never return provider tokens in the local JWT DTO.
- [ ] Run OAuth adapter/BFF/session/identity tests and an isolated real-store HTTP integration. Prove token retrieval/persistence/API Authorization uses the actor Gateway token; negative tests cover another actor, expiry, wrong audience/scope and missing identity proof.
- [ ] Commit only task paths and request a fresh Luna spec/quality review before the dependent page integration.

## Task 2: Display Gateway QR within the existing AnythingLLM login UI

**Files:** `frontend/src/pages/Login/index.jsx`, `Login/SSO/WeComResult.jsx`, `frontend/src/models/wecomAuth.js`, existing paths/notice components if required, `frontend/tests/wecomAuth.node.js`. Backend display DTO/callback adjustment only where needed for the confirmed embedding mode.

**Interfaces:** Start → trusted Gateway display target; page → same-origin completion/state; result → local session. Never transfer access_token through DOM, messages or browser state.

- [ ] Write RED tests that start opens an in-page QR surface rather than immediately navigating away; unavailable/expired/cancelled states are distinct and never fake success.
- [ ] Render the actual allowed Gateway page/component or existing QR data inside the existing login view. Check the actual embedding CSP/cookie behavior, not root-page headers. No arbitrary URL/image/HTML input.
- [ ] Complete iframe/top-level callback association safely: precise postMessage origin/source if messages are needed, no token payload, same-origin CSRF and browser transaction proof preserved. If the deployed page cannot embed, record the concrete missing Gateway capability; do not substitute external navigation as a completed requirement.
- [ ] Run frontend model/header/Gateway tests and build; verify desktop/mobile rendering and expiry/rescan behavior in the browser when the real display configuration is available. Preserve legacy login and LOCAL_ONLY local search.
- [ ] Commit the task and obtain Luna review; label fixture visuals explicitly.

## Task 3: Verify the full scan → token → API path

**Files:** existing auth integration tests, `docs/meeting-gateway/auth-local-search-contract.md`, `auth-local-search-verification.md`; phase evidence/gate adapter only where real OAuth evidence requires a supported validation path.

- [ ] Run affected server tests, frontend tests/build, scope/ACL/LOCAL_ONLY regression and code diff check. Use temporary DB/client generation; no migration of the running app DB.
- [ ] With actual registered OAuth config, display a real Gateway WeCom QR inside AnythingLLM, scan, validate the Gateway callback, create/reuse the local projection and show success. Use the resulting actor token for one authorized read-only Gateway call; no meeting import.
- [ ] Verify browser/logs contain no Gateway token; cancellation, expired QR, invalid state, wrong employee, missing API scope and uncertain exchange are failures or LOCAL_ONLY as appropriate. Keep real auth and controlled fixtures as separate evidence.
- [ ] Update the verification record with actual source/config/build identities and observed results. Do not use old constant gate rejection as a substitute for integrating an available OAuth flow; do not bypass real-evidence validation with self-authored PASS JSON.
- [ ] Request final Luna review, fix findings, and record exactly what passed or which concrete deployment value remains missing. Preserve branch/worktree; no automatic push/merge or production migration.