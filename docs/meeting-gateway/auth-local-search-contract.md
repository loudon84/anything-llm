# Meeting Gateway authentication consumer contract status

**Status: `DEPENDENCY_NOT_READY` for live WeCom authentication and profile retrieval.** This note records the consumer boundary and the evidence available on 2026-10-19. It contains no credentials.

## Evidence observed

| Evidence | Observation | What it establishes |
| --- | --- | --- |
| Consumer source baseline `7e465a04c1ad63166c7b952b41dfd316882329ea`, `server/utils/meetingGateway/client.js` | Existing adapter retains the account-login and session/exchange boundary; the existing implementation does not supply a WeCom QR flow or authenticated profile consumer. | Existing account bridge behavior must remain separate; it cannot establish WeCom support. |
| Gateway source baseline `d6bf6465f07385ce5906a7e0fced488c0c0881e9`, identity/auth services and API routes | The reviewed source describes account login, Gateway session handling, and `ms_` to `mt_` exchange. No WeCom start/redeem/profile consumer wire was found in the reviewed source. | The known account/session wire is not a WeCom wire and is not substituted here. |
| Deployment `https://copilot.superic.com:9999/health/live` (read only, 2026-10-19) | Returned `status: ok`. | The origin was reachable at that observation time. |
| Deployment `/health/ready` (read only, 2026-10-19) | Returned `database: true`, `backend: false`. | The deployment reported its database ready and its backend dependency not ready. This is not an authentication readiness result. |
| Deployment public OAuth metadata (read only, 2026-10-19) | Metadata was exposed and identified REST audience `https://copilot.superic.com:9999/api/v1`. | This documents an audience only; it does not define a WeCom QR/profile contract. |
| Deployment account-login/exchange GET probes (read only, 2026-10-19) | Returned `405` with `Allow: POST`. No POST or credential attempt was made. | The route method was observed; authentication success and request/response schemas remain unverified. |
| Deployment OpenAPI/docs discovery (read only, 2026-10-19) | No OpenAPI or interactive docs were exposed. No WeCom start/redeem/profile schema was obtained. | No production WeCom operation paths or field mappings can be pinned from the available evidence. |

The PRD source of scope is `prd/AnythingLLM_MeetingGateway_企业微信登录与接入迁移_开发需求PRD_v2.0.0.md`, content version 2.0.2, §4.6. It requires Gateway-owned enterprise identity, a stable verified subject, a server-fetched profile, and `DEPENDENCY_NOT_READY` when the actual profile contract is absent. A reachable health endpoint or public OAuth metadata does not satisfy that requirement.

## Consumer normalized profile

Once a deployment owner supplies a signed-off, immutable contract, the consumer maps its documented profile fields into:

```js
{
  gatewayInstanceId, // pinned deployment configuration, never browser input
  orgId,
  memberId,
  userId,
  issuer,
  displayName,
  active,            // must be true
  identityExpiresAt  // valid UTC ISO time, no later than the redeemed identity
}
```

All IDs and issuer are opaque nonempty strings. Profile `orgId`, `memberId`, `userId`, and `issuer` must equal the identity session returned by the preceding verified redemption. The instance namespace comes from the pinned consumer contract, not the profile response or browser. The profile is rejected when a required field is missing, the member is inactive, the assertion is expired, the profile extends the verified identity lifetime, the JSON is malformed, or the subject differs.

## Contract lock required before live enablement

The adapter accepts only an owner-signed-off contract at the supported consumer contract revision with a SHA-256 schema digest that matches the canonical contract contents. That lock must define:

- The deployment origin and immutable Gateway instance ID.
- Exact HTTPS authorization endpoint origin/path and exact callback URL allowlist, including the query parameter names used to bind state and callback.
- Start, one-time redemption, and authenticated profile operations: HTTP method, fixed path, authentication, request mapping, response mapping, and response schema revision.
- The identity-session mapping and profile mapping, including the identity expiry and stable subject fields.

Browser values cannot select an origin, path, callback, or authorization endpoint. Redirects are rejected. An uncertain redemption result is surfaced as `MGW_AUTH_REDEEM_OUTCOME_UNKNOWN` with recovery required; it is never automatically retried. The adapter does not log tokens, raw profile bodies, or arbitrary upstream error text.

No accepted live contract or transport is currently available. Therefore, the live adapter reports `available: false` and `reason: DEPENDENCY_NOT_READY`; it makes no request. The controlled contract and transport in `server/__tests__/meetingGateway/wecomClient.test.js` are test fixtures only. They prove consumer validation behavior and are not evidence of a real Gateway login, endpoint, or profile mapping.
