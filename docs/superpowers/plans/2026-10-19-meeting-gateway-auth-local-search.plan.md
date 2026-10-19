# Meeting Gateway AUTH_LOCAL_SEARCH Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. All implementation, code search/reading and reviews must use GPT-6 Luna subagents as explicitly requested by the user.

**Goal:** 实现AnythingLLM消费Gateway企业微信扫码认证、拉取用户信息并同步本地投影；认证兑换结果丢失后只允许获本地授权的既有会议检索，暂停本阶段新导入开发与验收。

**Architecture:** Gateway是企业用户身份源，Consumer持有必要本地用户投影、短时登录事务和可撤销session。可信服务端session/事务决定GATEWAY_ENABLED或LOCAL_ONLY；一个共享访问策略同时约束BFF远端出口与本地会议/QA/历史读取，页面只反映其结果。Gateway实际wire通过有来源证据的契约适配，不把测试adapter当生产认证。

**Tech Stack:** 现有Node.js/CommonJS、Express、Prisma/SQLite、JWT、React/Vite、Jest/Node test；复用既有依赖，不更换数据库或认证框架。

**Spec:** `prd/AnythingLLM_MeetingGateway_企业微信登录与接入迁移_开发需求PRD_v2.0.0.md`（内容2.0.2，§4.6优先）；源文件`E:/git/anything-llm/prd/AnythingLLM_MeetingGateway_企业微信登录与接入迁移_开发需求PRD_v2.0.0.md`。

**Spec SHA256:** `ff382298a2ef1fc18d9a0dd9af1901172116c96643887fb8e1080c1f2d09cfaf`。

**Baseline:** Consumer `7e465a04c1ad63166c7b952b41dfd316882329ea`，分支`codex/meeting-intelligence`；Gateway源码参考`d6bf6465f07385ce5906a7e0fced488c0c0881e9`。用户提供联调Origin：`https://copilot.superic.com:9999`，仅凭地址不代表服务类型/契约/企业微信能力已经验证。

**Authorization:** 用户于2026-10-19明确要求创建`.plan.md`后委派GPT-6 Luna完成计划。这授权本阶段计划与本地实施；不是整份R2/线上配置/生产数据迁移的批准，不需要再次询问执行方式。计划外的Gateway仓库修改不在本次实施范围。

## Global Constraints

- 当前阶段标识：`AUTH_LOCAL_SEARCH`。只按PRD§4.6执行；旧全量R2 G1–G5、78个AC及8个GC不能作为本阶段强制前置，也不能冒称已通过。
- `remote_access_mode=LOCAL_ONLY`只绑定当前本地session或prelogin事务，不是全局开关。兑换结果丢失不重放一次性票据，不自动恢复上游认证，不直接访问腾讯。
- LOCAL_ONLY：Gateway/腾讯会议目录、详情、录制、转写、纪要、附件、新源job、远端导入/补抓请求数必须为0；本地cache miss不补抓。
- 只有已有有效本地会话能在LOCAL_ONLY读取已经持久化且本地owner/workspace ACL允许的资料；跨人、未知owner、已知撤销/停用、会话过期拒绝。无本地会话不能假登录或匿名读取。
- 用户显式重新扫码、后台验证成功并拉取当前profile后才恢复GATEWAY_ENABLED。未观察到的上游撤销不能声称离线实时可知。
- `independent_local_user_creation=false`、`gateway_user_projection_sync=true`。稳定键`(gateway_instance_id,gateway_org_id,gateway_member_id)`；认证后服务端profile拉取→事务upsert投影→本地会话签发。不按姓名/邮箱匹配、不采信浏览器userId、不创建伪密码、不自动admin。
- Gateway member/alias/企业身份申请审批、独立身份服务、客户端Secret/Tencent/WeCom token浏览器存储均不实施。允许本地必要外键ID和普通角色投影；现有非企业登录保持兼容。
- 新导入编排、导入页面与A-IMPORT-001-*验收为`scope_disposition=DEFERRED_CURRENT_PHASE`；不要求删除/全局停用既有导入代码。LOCAL_ONLY仍必须阻断远端导入和后台补抓。
- 不修改生产环境/账户，不向Gateway发送登录尝试或mutation来猜契约。无实际wire或真实认证环境证据时明确DEPENDENCY_NOT_READY/BLOCKED，不能伪造二维码/认证成功/Phase PASS。
- 联调HTTPS；`__Host-meeting_login` Secure/HttpOnly/Path=/ /SameSite=Lax，300秒；bridge Strict最多900秒；结果票据60秒；本地SSO会话最多8小时且不晚于已验证身份期限。测试用受控时钟/隔离DB，不关闭生产Cookie安全属性。
- 保留原工作树两个未跟踪产物`server/prisma/task7-isolated-102c2410f89148b08c2fdfaedafef1ed/`、`server/storage/task5b-runtime-smoke-20261014.sqlite`；不用git add -A，不改E盘master用户文件，不删除工作树，不push/merge。

## Evidence and dependency baseline

- 代码阅读由Luna完成。Consumer目前只有普通密码登录与Simple SSO临时token回调；没有WeCom/profile/session-registry/LOCAL_ONLY实现。
- `users.password`当前必填；`User.create`要求并hash密码。采用nullable password的专用Gateway投影写入，兼容密码路径显式拒绝null；不能给SSO用户生成伪密码。
- R1实际表`meeting_gateway_bindings`与`meeting_bridge_sessions`；现有binding不含instance namespace。来源实际为`meeting_sources.segments`和`meeting_chunks`。
- `meetings.createdBy`可为null；null/无法证明owner的历史资料不能推定属于当前Gateway员工。当前list/get/source未完整按owner过滤；conversation owner检查不足以保证其meeting scope安全。
- 旧`runtime.remote`仍构建Tencent直连client；远端route/queueImport/retry及worker不能仅靠UI禁用。LOCAL_ONLY要在服务端调用它们前拒绝，并防止worker自动补抓。
- Gateway固定源码只确认account-login、auth/session、ms_→mt_ exchange；不能把腾讯OAuth或Simple SSO当WeCom。部署Origin已提供，实际部署公开契约由Luna只读核对；真实wire不能从URL猜测。
- Live只读发现（2026-10-19）：`https://copilot.superic.com:9999/health/live`返回status ok；`/health/ready`返回database=true、backend=false。HTTP可达不代表认证上游已就绪。
- `/.well-known/oauth-authorization-server`与`/.well-known/oauth-protected-resource/api/v1`可读；REST audience确认为`https://copilot.superic.com:9999/api/v1`。account-login/exchange的GET返回405且Allow:POST，仅确认路由方法，不证明登录成功。
- 部署未公开OpenAPI/docs；未取得真实WeCom start/redeem/profile wire，不能依据普通OAuth metadata猜二维码接口。禁止用account-login/腾讯OAuth替代真实WeCom。无任何POST或凭据尝试。
- fresh baseline command：`corepack yarn test --runInBand server/__tests__/meetings/endpoints.test.js server/__tests__/meetings/retrieval.test.js server/__tests__/models/user.test.js server/__tests__/meetingGateway/sessions.test.js`，4 suites /31 tests passed。

## Shared interfaces (冻结Consumer内部接口，不宣称是Gateway wire)

```js
// ValidatedGatewayProfile (all IDs opaque nonempty strings; active must be true).
// gatewayInstanceId comes from verified deployment configuration, never browser input.
// { gatewayInstanceId, orgId, memberId, userId, issuer, displayName,
//   active, identityExpiresAt }  identityExpiresAt is validated UTC ISO time.
createWeComGatewayClient({ contract, transport, clock });
// .getAvailability() -> { enabled, available, reason }
// .startAuthentication({ clientState, codeChallenge, redirectUri })
//   -> { transactionId, authorizationUrl, expiresAt }
// .redeemAuthentication({ transactionId, resultTicket, codeVerifier, redirectUri })
//   -> server-private validated identitySession with verified subject/expiry
// .fetchAuthenticatedProfile({ identitySession }) -> ValidatedGatewayProfile

createWeComIdentityStore({ prisma, clock });
// .upsertGatewayUserProjection({ profile }) -> { user, binding, created }
// .createLocalSession({ userId, bindingId, identityExpiresAt, authMethod })
//   -> { id, userId, credentialEpoch, expiresAt, remoteAccessMode }
// .getLocalSession({ sessionId, userId }) -> record|null
// .markLocalOnly({ localSessionId, preloginTransactionId, reason })
// .revokeLocalSession({ sessionId, userId })

createWeComAuthService({ gateway, store, jwt, clock, cryptoConfig });
// .start({ origin, currentLocalSession, browserProof }) -> public start DTO + cookie
// .complete({ browserProof, origin, csrf, callbackTicket })
//   -> { state, user, localToken, expiresAt, remoteAccessMode } (local token only)
// .getState({ localToken, browserProof })
//   -> { authenticated, remoteAccessMode, reason, expiresAt, user }
// .logout({ localToken, browserProof, csrf }) -> revoked local state

createMeetingAuthAccess({ authService, meetingStore, workspaceAccess, clock });
// .getRequestState({ request, response }) -> server-verified actor+session+mode
// .assertRemoteAllowed({ authState, action }) -> void or typed 401/403
// .assertLocalMeetingReadable({ authState, meetingIds, action }) -> readable IDs
// .filterLocalMeetings({ authState, meetings }) -> owner/ACL-filtered rows
```

规则：profile必须与已验证兑换subject/org/member一致，identityExpiresAt保守取有效期限；本地默认角色`default`，本地suspended不能被同步清零；绑定或session epoch在请求时复核。稳定主体namespace不得因显示名变化而变；旧instance=null的binding不自动认领。

Additional task-owned interfaces:

```js
// Task5 frontend/src/models/wecomAuth.js pure view resolver
resolveWeComView({ authenticated, remoteAccessMode, available, reason });
// -> { canSearchLocal, canFetchRemote, message, nextAction }
// Task6 scripts/meeting-gateway-r2/auth-local-search-gate.cjs export
// evidence entries identify caseId, mode(fixture|real), source/config/build IDs,
// execution command/exitCode, assertions and integrity evidence.
evaluatePhaseGate({ phase, evidence }); // -> { status, reason, caseResults }
```

## Task ownership and order

执行顺序T1→T2→T3→T4→T5→T6；每任务独立review，之后才进入依赖任务。实现worker不自行再派reviewer；主控统一分派Luna reviewer。任务报告/差异包/进度ledger放本plan独占的`.superpowers/sdd/2026-10-19-meeting-gateway-auth-local-search.plan/`。

### Task 1: Gateway认证消费契约、profile校验与依赖门禁

**Requirement/Acceptance:** CONTRACT、IDENT-001、CONFIG；PHASE-AUTH-01的Consumer契约部分，真实认证依赖独立标记。

**Files:**
- Create `server/utils/meetingGateway/wecomClient.js` (Consumer normalized port and contract-gated transport).
- Create `server/__tests__/meetingGateway/wecomClient.test.js`.
- Create `docs/meeting-gateway/auth-local-search-contract.md` (实际部署/源码证据、字段映射、未满足项，不能含密钥).
- Modify existing `server/utils/meetingGateway/client.js` only if reusable bounded transport needs a nonbreaking export; existing account/exchange行为不能被假实现替换。

**Interfaces:** consumes signed-off deployment contract or explicit absent contract; produces createWeComGatewayClient interface above. No production path fallback.

- [ ] **Step 1: Write failing dependency/profile tests.**

```js
expect(createWeComGatewayClient({ contract: null }).getAvailability())
  .toMatchObject({ available: false, reason: 'DEPENDENCY_NOT_READY' });
// Controlled test transport records requests; a complete test contract is test-only.
await expect(client.fetchAuthenticatedProfile({ identitySession: sessionForA }))
  .rejects.toMatchObject({ code: 'MGW_IDENTITY_ASSERTION_INVALID' });
// Cases: mismatching member/org/user, false active, expired identity, bad JSON,
// malicious authorization origin, missing required field, unknown contract revision.
```

- [ ] **Step 2:** Run `corepack yarn test --runInBand server/__tests__/meetingGateway/wecomClient.test.js`; confirm failing behavior before implementation.
- [ ] **Step 3: Implement bounded normalized adapter.** Contract must pin origin, immutable version/schema digest, start/redeem/profile operation methods+paths+authentication+response mapping and exact allowed authorization/callback URLs. Read only the deployment's public contract to establish these. Actual provider wire unavailable: implement validation/availability and test-injected port, leave live adapter unavailable; do not make up an existing endpoint. Production requests never use a browser-selected URL, never log token/profile raw bodies, never retry uncertain redeem, and never follow redirects to another origin. Reuse existing HTTP timeout/error conventions.
- [ ] **Step 4:** Run the test above and existing `server/__tests__/meetingGateway/client.test.js`; document source-vs-live capability facts and fixture-vs-real evidence separately.
- [ ] **Step 5:** Stage only Task1 files and commit `feat: add contract-gated gateway wecom consumer adapter`; report exact commands/counts and external blockers. Review before T2.

### Task 2: Passwordless用户投影、可撤销本地session与事务存储

**Requirement/Acceptance:** IDENT-002、AUTH、REVOKE；PHASE-AUTH-01 first/repeat/invalid-user cases.

**Files:**
- Modify `server/prisma/schema.prisma`, `server/models/user.js`, existing password-login branch in `server/endpoints/system.js`.
- Create migration `server/prisma/migrations/20261019000100_gateway_auth_local_search/migration.sql`.
- Create `server/models/wecomIdentity.js`, `server/__tests__/meetingGateway/wecomIdentity.test.js`.
- Extend `server/__tests__/models/user.test.js` with nullable-password rejection regression where appropriate.

**Interfaces:** consumes validated profile fromT1; produces createWeComIdentityStore, opaque login transaction storage and local session registry. Does not consume browser user IDs or raw Gateway JSON.

- [ ] **Step 1: Write failing isolated-DB tests:** verified first profile creates one user with password=null+role=default; repeat sync preserves ID; same-name different stable tuples remain separate; different Gateway instances don't collide; changed display profile refreshes; active=false/expired/subject mismatch creates no user/session; local suspension never reset; concurrent upserts yield one record. Null-password user cannot password-login.

```js
const first = await store.upsertGatewayUserProjection({ profile: profileA });
const repeat = await store.upsertGatewayUserProjection({ profile: changedDisplayA });
expect(repeat.user.id).toBe(first.user.id);
expect(first.user.password).toBeNull();
expect(first.user.role).toBe('default');
expect(await prisma.users.count()).toBe(1);
```

- [ ] **Step 2:** Run `corepack yarn test --runInBand server/__tests__/meetingGateway/wecomIdentity.test.js server/__tests__/models/user.test.js`; confirm new tests red before implementation.
- [ ] **Step 3: Add schema/migration and implement transaction.** Make `users.password` nullable; guard existing password-auth entry points against null rather than hashing a placeholder. Extend R1 `meeting_gateway_bindings` with nullable legacy `gateway_instance_id`, profile fields and stable triple unique constraint; do not create a competing identity binding table. Legacy instance=null rows retain data and are not automatically adopted. Add `meeting_login_sessions` and short-lived `meeting_sso_transactions` with epoch, TTL, encrypted verifier/ticket storage, consumption CAS, remoteAccessMode and token/proof hashes. An internal deterministic login handle may use `mgw_`+SHA256(stable tuple) prefix; it must not be a user-match criterion. Persist displayName separately or as validated binding profile projection. No username/email merge and no automatic admin.

```js
// The transaction owns the unique stable tuple and its local integer user ID.
// existing binding -> load same user, reject suspended, refresh safe profile fields;
// absent binding -> create users(password:null, role:'default'), then stable binding.
// createLocalSession expiry = min(now + 8h, verified identity expiry).
// mode begins GATEWAY_ENABLED only after verified profile; failed sync publishes none.
```

- [ ] **Step 4:** Validate schema using `server/node_modules/.bin/prisma.cmd validate --schema server/prisma/schema.prisma`; apply migration tests only to temporary isolatedDB. Never run migrate/reset on existing app/storage DB during this task. Run relevant user/projection suites.
- [ ] **Step 5:** Commit only Task2 changes as `feat: persist gateway user projections and local auth sessions`; include migration compatibility and failure evidence; review before T3.

### Task 3: 企业微信BFF、会话认证与LOCAL_ONLY状态转换

**Requirement/Acceptance:** IDENT-001/002、AUTH、REVOKE、UI-001 backend; PHASE-AUTH-01 / PHASE-LOCAL-02.

**Files:**
- Create `server/utils/meetingGateway/wecomAuth.js`, `server/endpoints/wecomAuth.js`, `server/__tests__/meetingGateway/wecomAuth.test.js`.
- Modify `server/index.js`, `server/utils/middleware/validatedRequest.js`, `server/utils/http/index.js` only for safe, additive auth/session integration.
- Modify `server/endpoints/meetingGateway.js` status/logout composition; preserve legacy bridge route compatibility.

**Interfaces:** consumesT1+T2; produces createWeComAuthService and server-derived authState used byT4/T5. Legacy JWT request semantics remain unchanged except projected users' signed registry sessions must be validated.

- [ ] **Step 1: Write failing HTTP/clock tests:** config is unavailable without actual dependency; start creates300s browser-bound state/PKCE; callback can't trust query IDs; complete only returns local JWT after profile sync; repeated tickets never redeem twice; incorrect Origin/CSRF/state/proof denied; suspended/expired/epoch-changed registry denied; logout revokes. Existing local session + lost redeem => that sessionLOCAL_ONLY; no local session + lost redeem => no new login/local content; another employee's session unaffected; explicit new verified scan/profile restores only intended session.

```js
await auth.complete(lostResponseAttemptForExistingSessionA);
expect((await auth.getState(validLocalSessionA)).remoteAccessMode).toBe('LOCAL_ONLY');
expect((await auth.getState(validLocalSessionB)).remoteAccessMode).toBe('GATEWAY_ENABLED');
expect(fakeGateway.redeemCalls).toBe(1);
expect(responseBody).not.toHaveProperty('mt_token');
```

- [ ] **Step 2:** Run `corepack yarn test --runInBand server/__tests__/meetingGateway/wecomAuth.test.js`; confirm new scenarios red.
- [ ] **Step 3: Implement BFF and registry checks.** Add same-origin `/api/auth/wecom/config`, `/start`, `/callback`, `/complete`, read-only `/state` (Consumer new endpoint for public recovery DTO), and unified logout. Callback stores short-lived ticket encrypted server-side then303-cleans query; URL never contains local JWT. The new state endpoint returns no ticket/Gateway token or full identity. Use secure cookie constraints inGlobalConstraints; nosecure=false shortcut. Browserproof/ticket consumption and registry issuance are atomic/CAS; uncertain redeem is not repeated. getState validates legacy existing session or projected registry session; browser cannot claim localSessionId or actor. In multi-user mode projectedJWT includes session_id/credential_epoch; keep single-user/legacy password auth compatibility and do not invent an employee for user=null. Startup loads contract lazily and reports unavailable, not crash/fake success.
- [ ] **Step 4:** Run new BFF/session tests and baseline auth suites; verify lostresponse preserves existing data and never fabricates successful identity. Sanitized reason/code/status no-store DTOs.
- [ ] **Step 5:** Commit `feat: add gateway wecom login and local-only recovery state`; review before T4.

### Task 4: 共享服务端门禁与本地会议检索隔离

**Requirement/Acceptance:** ACCESS、RAG、WORKSPACE、REVOKE、COMPAT; PHASE-LOCAL-02.

**Files:**
- Create `server/utils/meetingGateway/meetingAuthAccess.js` and `server/__tests__/meetings/localOnlyAccess.test.js`.
- Modify `server/endpoints/meetings.js`, `server/modules/meetings/meetingService.js`, `server/modules/meetings/qa.js`, `server/modules/meetings/indexer.js`, `server/modules/meetings/runtime.js` and worker dispatch seam only as needed to enforce trusted per-actor policy.
- Extend `server/__tests__/meetings/endpoints.test.js`, `qa.test.js`, `retrieval.test.js` for access through actual services.

**Interfaces:** consumesT3 authState; produces createMeetingAuthAccess for both route and pre-retrieval/pre-LLM checks. No global runtime.stop() on an employee's mode change.

- [ ] **Step 1: Write failing behavioral tests:** A's LOCAL_ONLY local data hit works with validsession; B cannot read A's meeting through list/detail/source/segments/file/conversation/history/ask; explicit multi-ID selection with any denied ID rejected before retrieval; nullcreatedBy/unknownowner quarantined, local disabled/known revoke/expired session denied; inaccessible workspace cannot reach workspaceRetriever. Existing non-WeCom/single-user ordinary feature compatibility is separately tested without attributing nullowner to a new WeCom subject.

```js
await requestAs(localOnlyA).get('/api/meetings/remote').expect(403);
expect(runtime.remote.list).not.toHaveBeenCalled();
expect(await localSearchAs(localOnlyA, ownedMeetingA)).toContainEqual(expectedLocalHit);
await expect(localSearchAs(localOnlyB, ownedMeetingA)).rejects.toMatchObject({ code: 'MGW_RESOURCE_NOT_ACCESSIBLE' });
expect(modelCallCountForDeniedSelection).toBe(0);
```

- [ ] **Step 2:** Run `corepack yarn test --runInBand server/__tests__/meetings/localOnlyAccess.test.js server/__tests__/meetings/endpoints.test.js server/__tests__/meetings/qa.test.js`; confirm newly introduced access tests red.
- [ ] **Step 3: Implement one shared admission boundary.** Pass trustedactor to every listedlocalread, filter lists before serialization, reject explicit inaccessible scopes before snapshot/indexer.search/workspace retrieval and model calls; history/answers/file routes do not bypass policy. Use createdBy ownership and existing workspace ACL; don't infer ownership for null/legacy records. For LOCAL_ONLY reject remote list/manifest/query/sourceensure/import/retry before runtimeclient invocation and before queued work fetches; session change must not globally stop other actors. Existing client functions/worker paths without provable actor/session cannot bypass the scoped prohibition. NoGateway live access call in permittedLOCAL_ONLY local search; current known local deny still wins. Do not build new importpipeline or old directTencent fallback.
- [ ] **Step 4:** Run positive/negative tests with outbound Gateway/Tencent spy counts exactly0 for LOCAL_ONLY; exercise actual localindex and QA pipeline where isolated fixtures permit, not only middleware mocks. Baseline legacy regression remains green.
- [ ] **Step 5:** Commit `feat: enforce local-only meeting search and remote read fences`; review before T5.

### Task 5: 登录入口、结果页和本地模式页面状态

**Requirement/Acceptance:** UI-001 / currentUI-003subset; PHASE-AUTH-01 / PHASE-LOCAL-02 / PHASE-SCOPE-03.

**Files:**
- Create `frontend/src/models/wecomAuth.js`, `frontend/src/pages/Login/SSO/WeComResult.jsx`, `frontend/src/pages/Meetings/LocalOnlyNotice.jsx`, `frontend/tests/wecomAuth.node.js`.
- Modify `frontend/src/pages/Login/index.jsx`, `frontend/src/main.jsx`, `frontend/src/utils/paths.js`, `frontend/src/pages/Meetings/index.jsx`, `frontend/src/models/meetings.js`; use existing login storage/install pattern after trusted same-origincomplete.
- Update relevant existing profile display/logout code only when needed; never add IdentityBindings/approvalpage.

**Interfaces:** consumes `/api/auth/wecom/{config,start,state,complete}` BFF DTO and serverremoteAccessMode; no profilefetch directly to Gateway frombrowser.

- [ ] **Step 1: Write failing frontendmodel/view-state tests:** unavailableconfig does not show fakeQR/success; start navigates only validatedserverauthorizationURL; callbackresult never consumes JWT from query; stateLOCAL_ONLY gives exact limited-modecopy and disables remoteactions; existing local-list/search remain enabled only when serverauthenticated; lostresponse does not clear workinglocal login blindly or resubmit ticket; profilecompletion stores only localJWT/safeuserinfo; no hardcodedusername or privilegedrole; no newimportacceptance.

```js
const ui = resolveWeComView({ authenticated: true, remoteAccessMode: 'LOCAL_ONLY' });
assert.equal(ui.canSearchLocal, true);
assert.equal(ui.canFetchRemote, false);
assert.equal(ui.message, '认证结果丢失，仅可检索本地已有会议数据；重新扫码后恢复远端访问');
```

- [ ] **Step 2:** Run `node --test frontend/tests/wecomAuth.node.js`; confirm new test failure before implementation.
- [ ] **Step 3: Implement state-driven UI.** Preserve existingPasswordModal/SimpleSSO compatibility and route guards. New `/sso/wecom/result` view uses same-originstate, not auth tokens inlocation; errors distinct from lackofmeetingpermission. AddWeCom CTA controlled byavailable/reason. PresentGatewaydisplayName safely; localuser handle is not new registrationform. LOCAL_ONLY banner explains local-onlydata and explicitrescan action; remote controls disabled, server remainsauthority. Do not add adminbindings or new importforms. Noauth service rollout config automaticallyenabled.
- [ ] **Step 4:** Run `node --test frontend/tests/wecomAuth.node.js`; `corepack yarn --cwd frontend test:meeting-gateway`; `corepack yarn --cwd frontend build`. Browser/DOM evidence should cover desktop/mobile login unavailable/result/localonly states if supported; fixture visualstates must be labeledfixture, neverrealWeComlogin.
- [ ] **Step 5:** Commit `feat: add gateway wecom login pages and local-only notices`; review beforeT6.

### Task 6: 三项阶段验收、依赖证据和交付记录

**Requirement/Acceptance:** EVID、OBS、COMPAT; all three PHASE cases from§4.6, independently from fullR2/importsuite.

**Files:**
- Create `scripts/meeting-gateway-r2/auth-local-search-gate.cjs`, `server/__tests__/meetingGateway/authLocalSearchGate.test.js`.
- Create `docs/meeting-gateway/auth-local-search-verification.md`.
- Add scripts to root `package.json` / frontend `package.json` only if needed for the exact commands documented here.
- Update thisplan's checkbox/statuses and ledger with verified outputs and dependency state.

**Interfaces:** consumes testresults/source+config+specidentity and separate fixture/realwecom evidence; produces phase-onlyresult nofakefullR2PASS.

- [ ] **Step 1: Write failing gate tests:** missing phasecase fails; fixtureprofile evidence cannot satisfy realGatewayPHASE-AUTH-01; BLOCKED/SKIPPED remains nonPASS; deferredimport never countedPASS or currentrequired; mismatching build/config or malformed evidence fails; local-onlyoutboundcount>0 fails. No self-certified PASS from merely writingJSON.

```js
expect(evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence: onlyFixtureEvidence }))
  .toMatchObject({ status: 'BLOCKED', reason: 'REAL_GATEWAY_AUTH_EVIDENCE_REQUIRED' });
expect(evaluatePhaseGate({ phase: 'AUTH_LOCAL_SEARCH', evidence: tamperedEvidence }).status).not.toBe('PASS');
```

- [ ] **Step 2:** Run `corepack yarn test --runInBand server/__tests__/meetingGateway/authLocalSearchGate.test.js`; confirm new tests red.
- [ ] **Step 3:** Implement phasecase evidence validation with source/config/spec matching, actual testcommands/exitcounts, nohardcodedpass; keep currentphase importscope disposition separate fromexecutionstatus. Use existing evidenceintegrity/signing primitive only if present, otherwise explicitly record missing trustmaterial and failclosed forrealPASS rather than inventproductionkeys. Collect integrationtests ofactualBFF/profileprojection/localpolicy/QA with isolatedDB and controlledupstream. Missing actualGatewaywire/credentials/HTTPSrealuser samples isBLOCKED forrealphase; continue all independenttestabletasks.
- [ ] **Step 4:** Run consolidated affected suites (not newimportacceptance), frontendtests/build, schemavalidate, isolatedmigrationcompatibility and scoped diffcheck. Run phasegate; report fixturepasses separately fromrealBLOCKED. Request final Luna wholechange review and address findings throughonefixwave + scopedrereview.
- [ ] **Step 5:** Commit `test: verify gateway auth and local-search phase boundaries`; leavebranch/worktree intact. No push/merge orproductionDBmigration. Report exactimplementedtasks, currenttestresults, remainingexternaldependency and uservisiblepageURL only if verified.

## Controller self-review and preflight

- Coverage: PHASE-AUTH-01→T1/T2/T3/T5/T6; PHASE-LOCAL-02→T3/T4/T5/T6; PHASE-SCOPE-03→T4/T5/T6. Importscope remainsdeferred, notfalselycomplete.
- Interface consistency: profiletuple/expiry and authState/sessionmode shared above; T3BFF emits samefields T5reads; T4trusts onlyservercontext; T6checksactualoutputs rather thanUIlabels.
- T1→T3/T5 sharegatewayprotocol; T2→T3 sharestore/session; T3→T4/T5 shareauthState; T4→T5/T6 shareremoteprohibition/localACL; allindependentfileseams noted. Changes totheseinterfaces require ledgerentry and dependenttestupdate.
- No further userexecutionchoice needed: user alreadyselectedLuna delegation. UserprovidedOriginisnotpermission tocreateaccountsorchangeupstreamconfig.
- Externaldependencies may leave realPHASE-AUTH-01 BLOCKED, whileConsumerimplementation and fixture/localtests finish; never labelthewholephasecompletewithoutrealrequiredproof.
