# Employee login and Tencent authorization verification

This documents the Consumer UI/BFF flow implemented for the meeting Gateway. It is based on fixture tests only; no Tencent/Gateway account, live authorization, production configuration, or production database was used.

## Employee login and readiness

In multi-user mode, the login page checks `GET /api/meeting-gateway/employee-login/status`. The endpoint returns only `{ "available": boolean }`, and returns false when multi-user mode, employee authentication, or Gateway transport configuration is unavailable. It does not include configuration values, credentials, or exception details. Single-user mode retains the existing password login and does not display this entry.

The employee form sends `{ account, password }` only to the same-origin `POST /api/meeting-gateway/employee-login`. It clears the controlled credentials before awaiting the request. A successful response contains the safe local session projection (`user`, `localToken`, `expiresAt`, `remoteAccessMode: "GATEWAY_ENABLED"`); the frontend stores only the existing local user/JWT/timestamp keys. Gateway tokens, refresh tokens, and client secrets are neither accepted nor stored by the browser. Employee authentication alone does not mean a Tencent connection is active.

## Tencent connection protocol

For a `GATEWAY_ENABLED` employee session, the panel bootstraps `GET /api/meeting-gateway/session`, then reads `GET /api/meeting-gateway/connections`. The safe list response is `{ items: [{ id, name, status }] }`; only a server-reported `ACTIVE` item is shown as connected. Authorization first reserves a browser popup, then calls same-origin `POST /api/meeting-gateway/oauth/start`. The normalized response is `{ authorization_url, transaction_id, expires_at }`. The frontend validates HTTPS, the exact `meeting.tencent.com/marketplace/authorize.html` origin/path, and exactly one each of `corp_id`, `sdk_id`, `redirect_uri`, and `state`, then navigates the popup. The authorization URL is never fetched by frontend code.

The Gateway callback accepts and redirects only `connection_id` to `/sso/meeting-gateway/result?connection_id=...`. The result UI removes the query from browser history and sends the ID to its same-origin opener only after exact source/origin checks. The opener uses its authenticated bridge session and CSRF token to call `POST /api/meeting-gateway/connections/:connectionId/confirm` with `{}`. The ID is not success evidence: the UI reports connected only after the protected BFF returns `{ status: "ACTIVE" }` or the authenticated list reports ACTIVE. The callback protocol exposes no cryptographic correlation to a specific OAuth start; Task 2 snapshots existing member connection IDs, then validates new ID ownership, type, state, and post-confirm status. A concurrent, newly-created connection cannot be proven to belong to this exact browser start with the upstream callback contract.

`LOCAL_ONLY` employees retain local meeting search and see employee reauthentication, but the panel does not call remote list/start/confirm APIs. No authorization action automatically imports meetings. The existing WeCom identity entry remains separate and keeps its own readiness behavior; Tencent authorization is not described as WeCom identity verification.

## Deployment configuration and migration

Task 1 runtime settings: `MEETING_GATEWAY_ENABLED`, `MEETING_GATEWAY_ORIGIN`, `MEETING_GATEWAY_INSTANCE_ID`, `MEETING_GATEWAY_CLIENT_ID`, `MEETING_GATEWAY_CLIENT_SECRET`, `MEETING_GATEWAY_SCOPES`, `MEETING_GATEWAY_REST_RESOURCE`, and `MEETING_GATEWAY_ALLOWED_ORIGIN`. The bridge HMAC/keyring configuration is also required. Multi-user employee login must be enabled by the deployment.

Task 2 OAuth settings: optional `MEETING_GATEWAY_OAUTH_APPLICATION_ID` (empty selects the Gateway ENV-owned application), required `MEETING_GATEWAY_OAUTH_CALLBACK_REF`, `MEETING_GATEWAY_PUBLIC_BASE_URL`, `MEETING_GATEWAY_TENCENT_CORP_ID`, and `MEETING_GATEWAY_TENCENT_SDK_ID`. Configure Gateway `oauth_return_uris` to allowlist `${MEETING_GATEWAY_PUBLIC_BASE_URL}/callbacks/tencent/oauth/${MEETING_GATEWAY_OAUTH_CALLBACK_REF}`. For the ENV-owned Gateway application, callback ref is the SDK ID; for an explicitly selected application, it is that application's UUID. The OAuth return URI on the Gateway side remains `${MEETING_GATEWAY_ALLOWED_ORIGIN}/api/meeting-gateway/oauth/return`.

Task 2 added migration `20261020000100_meeting_oauth_connection_snapshot` for the pre-start connection snapshot. Production migration and external Gateway/Tencent application configuration remain deployment actions and were not run here.

## Verification boundary

Fixture/JSDOM coverage verifies same-origin credential submission, immediate field clearing, safe local token storage, separate employee/connection state, single-user and LOCAL_ONLY UI behavior, safe readiness DTO, browser-only URL navigation, popup blocking, callback query allowlisting, source/origin checks, CSRF-backed server confirmation, and ACTIVE-only success. It does not verify real employee credentials, live browser navigation, Gateway/Tencent approval, deployed callback allowlists, migration application, or a real connection. No live API request, shared Prisma generation, database migration, import, or production change was performed.
