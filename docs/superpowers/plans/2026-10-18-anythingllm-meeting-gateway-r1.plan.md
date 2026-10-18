# AnythingLLM Meeting Gateway R1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划只交付文档，用户尚未要求开始实施。

**Goal:** 让员工使用本人 Gateway OAuth 查询会议并将完整原生转写/纪要导入专用受限 Workspace，在所有既有内容读取入口维持授权，且崩溃/重试/撤权可恢复、可验收。

**Architecture:** 保留 AnythingLLM Bearer 主认证，新增短期 opaque bridge Cookie 与服务端用户绑定。Gateway client、state store、Workspace policy、access admission、managed Collector/embedding 和 importer 为深 Module，以小 Interface 封装权限与恢复；所有外部依赖经注入 seam 测试。受限空间用请求级 fail-closed admission，底层向量清理不作为权限门禁。

**Tech Stack:** 现有 Node.js/CommonJS、Express、Prisma/SQLite、React/Vite、Collector 与现有向量引擎；Node >=18.12.1，使用仓库锁定依赖，新增库需先验证现有依赖可复用。Jest 为当前测试runner，不另引 node --test。

**Spec:** [PRD v1.1](E:/git/anything-llm/prd/anythingllm-meeting-gateway-prd-v1.1.md)。
**Status:** LOCAL_IMPLEMENTATION_PARTIAL · 2026-10-18 · 本地切片已提交；真实 Gateway 集成、全读取路径门禁与生产验收仍未完成。
**Scan evidence:** [GPT-6 Luna代码扫描记录](E:/git/anything-llm/docs/superpowers/plans/2026-10-18-meeting-gateway-code-scan-evidence.md)。

## Global Constraints

- 两仓基线：consumer 1336d327f4460510b755059b15481fd94a57cef7；provider d6bf6465f07385ce5906a7e0fced488c0c0881e9。当前工作区已有用户改动，不reset、不纳入无关文件提交。
- “代码阅读/扫描必须创建子代理，模型GPT-6 Luna（gpt-6-luna）；主代理整合设计和文档。”（PRD §28.4）。实施时重新扫描最新diff/入口也遵守。
- “R1 使用专用受限 Workspace”（§9.7）；在线admin/manager/API Key/embed不得绕过owner，普通空间行为不变。可信主机/DB运维的离线读取不在防护承诺内。
- Bearer+bridge+user身份必须同时匹配；deadline取最早，不超过900秒；Gateway真实Token只在服务端加密；同源Origin/CSRF和最小scope。
- 401/超时拒读不删除；权威撤权才SOURCE_REVOKED。门禁覆盖普通chat/API/key/embed/pinned/fulltext/agent/vector-search/原文及历史回填，不能只改Meetings。
- 每源20MiB/100,000段/2,000页；目录10,000项/20MiB/快照TTL60s；每owner最多1在途query、2个import worker。
- lease60s、20s续租、fencing CAS；operation_id与文档docId在外部写之前持久。location只取Collector结果；清理必须精确generation。
- OA写、腾讯直连、企业AKSK、ASR/自生成基础纪要、Compare/Translation行为改动、无人值守同步均在范围外。
- 未证实Gateway字段/资源授权接口为CONTRACT阻塞。计划获批可先做本地规则/fixture任务，真实适配不可猜契约。
- G0–G4真人证据+70个BUSINESS_REQUIRED AC+独立2个GATE_META，才可进行候选G5；Gate不得读取自己的待产出结果。
- 新增所有Module/端点/测试路径均为拟新增；现有文件依据代码扫描记录。每任务结束要求对应测试退出0及独立review；不以mock证明真实联调。
- 功能默认disabled；在所有guard及受管存储隔离到位前不得暴露真实导入。禁用新增业务路由后持久权限guard仍保留。

## 执行前置与依赖

本轮用户只授权PRD修订与计划编写。执行时先确认书面设计/计划，按using-git-worktrees创建或复用合适隔离工作区，保留用户现有改动。任务000是外部契约门禁，并不阻塞001–004及007/008的纯本地测试；005/006真实适配及014需契约/真实环境齐备。任务011是启用功能硬门禁，不能先把新内容写入可见空间再补权限。

依赖链：001→002→003→004；000+003→005→006→007；007+001→008→009；001–009→010；003/004/008–010→011；003–011→012；全部本地任务→013；000–013+真实环境→014。
首批可并行只读扫描/纯规则测试必须说明文件归属；同一个schema、endpoints或model不可让两个实现代理同时编辑。

## 文件职责与共享Interface

- server/models/meetingGateway.js：唯一台账/事务/CAS入口；只此Module直接写新增表。
- server/utils/meetingGateway/{client,sessions,workspacePolicy,access}.js：分别拥有网络、会话、受限空间不变量与请求admission。
- server/utils/meetingGateway/{catalogue,snapshots,content,formatter,hashes}.js：源query和目录观察、完整正文、确定性派生。
- server/utils/meetingGateway/{managedDocuments,importer,cleanup,worker}.js：受管文档/预存docId、阶段Saga、代际清理、lease执行。
- collector/processManagedRawText/index.js + collector/utils/managedDocumentStore.js：内部受管操作协议，不扩张公开metadata输入。
- server/utils/chats/authorizedRetrieval.js：所有文档上下文生成的共享授权seam；handler传播actor，不自己推断来源权限。
- server/endpoints/meetingGateway.js：strict DTO与服务端actor装配，薄adapter；不混入业务状态机。
- frontend Meetings modules：只使用BFF DTO，不保存OAuth/Gateway凭证；CSRF只内存，刷新通过只读session bootstrap重取。
- scripts/meeting-gateway/release-gate.cjs：纯评估函数+CLI，测试类与候选发布类分开。

新增公共类型（JSDoc对象，JS实现不用引入TypeScript构建）：
```js
// Actor: { kind: 'USER'|'API_KEY'|'ANONYMOUS', userId?: number, bridgeId?: string }
// Admission: { allowed: boolean, code?: string, workspaceId: number,
//   policyEpoch?: number, validatedAt?: number, bridgeId?: string, expiresAt?: number }
// GenerationRef: { generationId: string, generation: number, operationId: string,
//   vectorDocId: string, fence: number, workspaceId: number }
// ManagedProvenance: { operation_id, import_id, generation,
//   owner_user_id, workspace_id, payload_sha256 }
```

同一对象命名在Module外使用camelCase，持久/外部DTO用schema定义的snake_case，转换仅在store/adapter处。时间内部以UTC epoch秒处理，持久ISO/DB DateTime，禁止把秒与毫秒混用；tests使用注入clock。所有代码例子是拟实现接口的验收测试片段，不是当前已存在代码。

## 任务

### PLAN-MGW-000：固定 Gateway 契约与现有入口清单

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-CONF-001, REQ-AUTH-002, REQ-SOURCE-001, REQ-CONTENT-001, REQ-CONTENT-002。
**Acceptance refs：** A-CONF-001-01/02；A-AUTH-002-01/02；GC-02/04。
**Preconditions / Depends on：** 计划获确认；Gateway owner提供受控环境/脱敏契约。未获证据时本任务BLOCKED，001–004和本地mock工作可继续。

**Files：**

- Create: `docs/integrations/meeting-gateway-contract.md`
- Create: `server/utils/meetingGateway/gateway-contract.schema.json`
- Create: `server/__tests__/meetingGateway/fixtures/gateway-contract.redacted.json`
- Create: `server/utils/meetingGateway/contract.js`

- Test: `server/__tests__/meetingGateway/gatewayContract.test.js`

**Interface：** 产生固定SHA、account-login/exchange响应、scope/audience、Connection/meeting/recording/asset、job.complete、resource权限端点及403/404语义的版本化契约。schema 是本地确认结果，不能猜上游字段。

**State / Side effects / T0：** UNKNOWN_CONTRACT→CONFIRMED 或 BLOCKED；不写用户业务数据。
**Failure / Compensation：** 缺契约保持BLOCKED；不得用fixture取代真实样本。

- [ ] **Step 1：写失败验收。** 以最小字段缺失（asset_id、source_version、complete）、枚举未知和403语义未知样本写失败契约断言。

```js
const { validateGatewayContract } = require('../../utils/meetingGateway/contract');
test('missing content version blocks adapter', () => {
  expect(() => validateGatewayContract({ assets: [{ asset_id: 'a1' }] }))
    .toThrow('MGW_UPSTREAM_CONTRACT_ERROR');
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/gatewayContract.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 由Luna子代理读固定Gateway源码/OpenAPI、核对脱敏真实返回，记录每个schema字段的JSON pointer和证据；本地不存在Gateway仓库时由owner提供材料，不调用管理员接口扩权。新增contract.js导出validateGatewayContract；未知返回显式阻断。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function validateGatewayContract(contract) {
  const required = ['revision', 'tokenExchange', 'resourceAuthorization', 'assets', 'jobs', 'catalogue'];
  if (required.some(key => !contract[key])) throw new Error('MGW_UPSTREAM_CONTRACT_ERROR');
  if (contract.assets.some(asset => !asset.asset_id || !asset.source_version))
    throw new Error('MGW_UPSTREAM_CONTRACT_ERROR');
  return contract;
}
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/gatewayContract.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "docs: pin meeting gateway integration contract"`。未通过不进入依赖任务。


### PLAN-MGW-001：新增台账、受限空间与generation数据结构

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-STATE-001, REQ-IDENT-001, REQ-RETRY-001, REQ-WORKSPACE-001。
**Acceptance refs：** A-STATE-001-01/02；A-REV-005-01/02；A-REV-010-01/02。
**Preconditions / Depends on：** 计划确认；本地SQLite provider与基线一致；先备份测试副本，不对真实库执行migrate dev。

**Files：**

- Create: `server/models/meetingGateway.js`
- Create: `server/prisma/migrations/20261018000100_meeting_gateway_adapter/migration.sql`
- Create: `server/utils/meetingGateway/lifecycle.js`
- Modify: `server/prisma/schema.prisma`
- Test: `server/__tests__/meetingGateway/stateStore.test.js`

**Interface：** createMeetingStore({prisma,clock}) -> reserveIdentity(input), claimGeneration(importId), acquireLease(generationId,workerId), commitGeneration(id,fence,patch), markAccess(importId,state), policyByWorkspace(id)。数据库约束和合法迁移封装在此Module。；lifecycle.js 导出 nextGeneration(input), assertTransition(from,to), decideResubmit(row)，所有状态名直接来自PRD。

**State / Side effects / T0：** T0=迁移前DB快照/表schema/普通文件摘要；只增加新表/index，不重排既有数据。
**Failure / Compensation：** SQLite临时库迁移/回退失败保留备份和schema证据，生产provider不是SQLite时停止依赖迁移任务并取得部署迁移方案。

- [ ] **Step 1：写失败验收。** 测试唯一身份、双worker租约、REMOVED新generation、过期fence拒绝；使用临时SQLite执行迁移并断言既有表/文档计数不变。

```js
const { nextGeneration, assertTransition } = require('../../utils/meetingGateway/lifecycle');
test('removed can start a fresh generation only after cleanup', () => {
  expect(nextGeneration({ status:'REMOVED', generation:2, cleanupDone:true })).toBe(3);
  expect(() => nextGeneration({ status:'PENDING_CLEANUP', generation:2, cleanupDone:false }))
    .toThrow('MGW_CLEANUP_IN_PROGRESS');
  expect(() => assertTransition('REMOVED','VERIFIED')).toThrow();
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/stateStore.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 九张表按PRD建FK/唯一索引；SQLite String枚举由lifecycle.js校验，JSON用Prisma支持类型按当前provider验证。meeting_import_attempts.import_id允许首次FETCH前为null并保存request_id，真实asset/version到手再关联；revision唯一键用workspace_id。单事务reserve、CAS与fencing，禁用不drop台账。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function nextGeneration(row) {
  if (row.status === 'PENDING_CLEANUP' || !row.cleanupDone)
    throw new Error('MGW_CLEANUP_IN_PROGRESS');
  if (row.status !== 'REMOVED') throw new Error('MGW_IMPORT_CONFLICT');
  return row.generation + 1;
}
// reserveIdentity/claimGeneration/lease提交使用prisma.$transaction，
// UPDATE ... WHERE generation=? AND fencing_token=? AND lease_deadline>now，
// affected rows != 1 时拒绝；不在事务外先读后无条件覆盖。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/stateStore.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: add meeting adapter state and generation ledger"`。未通过不进入依赖任务。


### PLAN-MGW-002：受控 Gateway client、配置与错误映射

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-CONF-001, REQ-SEC-003, REQ-OBS-001, REQ-AUTH-002。
**Acceptance refs：** A-CONF-001-01/02；A-SEC-003-01/02；A-REV-008-01/02；A-REV-010-01/02。
**Preconditions / Depends on：** 001；真实transport联调依赖000。

**Files：**

- Create: `server/utils/meetingGateway/client.js`
- Create: `server/utils/meetingGateway/errors.js`
- Create: `server/utils/meetingGateway/redact.js`
- Modify: `server/index.js`
- Test: `server/__tests__/meetingGateway/client.test.js`

**Interface：** createGatewayClient({origin,allowlist,fetchImpl,clock}) -> accountLogin(credentials), exchange(ms), requestForSubject({bridge,path,method,body})；classifyFailure({stage,httpStatus,reason,writeOutcome}) -> {code,status,state,accessState,retryPolicy}。

**State / Side effects / T0：** CONFIG_BLOCKED或ENABLED；T0为配置存在性摘要，0Gateway/Backend配置写。
**Failure / Compensation：** FI-001/002/003/004、SSRF和429；未知外部写结果必须查operation，不能网络自动重发。

- [ ] **Step 1：写失败验收。** 拒绝非法origin/路径/redirect，401不重试、429有界退避，canary不出日志；disabled时0新业务调用且已有guard不卸载。

```js
const { classifyFailure } = require('../../utils/meetingGateway/errors');
test('401 freezes without destructive cleanup', () => {
  expect(classifyFailure({ stage:'VERIFY', httpStatus:401, writeOutcome:'NONE' }))
    .toMatchObject({ code:'MGW_BUSINESS_AUTH_REQUIRED', accessState:'AUTH_REQUIRED', retryPolicy:'MANUAL' });
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/client.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 实现HTTPS精确origin/port/path白名单、redirect:error、AbortController各阶段timeout、JSON schema验证和§19.3决策；日志字段白名单去除query/headers/body，state仅授权URL透传不记录。只提供用户上下文request，不暴露任意URL代理。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function classifyUnauthorized() {
  return { code:'MGW_BUSINESS_AUTH_REQUIRED', status:401,
    state:'AUTH_REQUIRED', accessState:'AUTH_REQUIRED', retryPolicy:'MANUAL' };
}
// client固定new URL(path, configuredOrigin)，校验origin与白名单path，
// fetch使用redirect:'error'与AbortController；401返回上面的确定结果，
// 外部写响应未知时返回RECOVERY_REQUIRED，不进入通用网络retry分支。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/client.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: add bounded gateway client and deterministic failures"`。未通过不进入依赖任务。


### PLAN-MGW-003：Bearer绑定的bridge会话与解绑

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-IDENT-001, REQ-AUTH-001, REQ-AUTH-002, REQ-SEC-001。
**Acceptance refs：** A-IDENT-001-01/02；A-AUTH-001-01/02；A-AUTH-002-01/02；A-REV-003-01/02。
**Preconditions / Depends on：** 001–002；真实account-login/exchange依赖000。

**Files：**

- Create: `server/endpoints/meetingGateway.js`
- Create: `server/utils/meetingGateway/sessions.js`
- Create: `server/utils/middleware/meetingBridge.js`
- Modify: `server/index.js`
- Modify: `server/models/user.js`
- Modify: `frontend/src/components/UserMenu/UserButton/index.jsx`
- Modify: `frontend/src/components/PrivateRoute/index.jsx`
- Test: `server/__tests__/meetingGateway/sessions.test.js`

**Interface：** createSessionModule({store,gateway,keyring,clock}) -> login({user,jwt,oldBridge,credentials}), requireBridge({user,jwt,cookie,csrf,origin,mutation}), revokeCurrent(id), revokeUser(userId)。返回browser DTO仅csrf/expires/binding，不含Gateway token。

**State / Side effects / T0：** UNBOUND→BOUND/SESSION_ACTIVE→REST_AUTHORIZED；吊销→AUTH_REQUIRED，binding删除冻结受限空间，不迁移旧资料。
**Failure / Compensation：** FI-001/002/003、过期及断网；失败0新绑定，密钥轮换读取旧key_id但禁止延长deadline。

- [ ] **Step 1：写失败验收。** 双浏览器独立、同浏览器rotate、suspend/password change、JWT错配、CSRF重放、最早期限；logout断网不声称服务端已吊销。

```js
const { computeDeadline } = require('../../utils/meetingGateway/sessions');
test('bridge cannot outlive any credential', () => {
  expect(computeDeadline({ now:0, msExpiry:1000, mtExpiry:800, jwtExpiry:700 })).toBe(700);
  expect(computeDeadline({ now:0, msExpiry:10000, mtExpiry:9000, jwtExpiry:8000 })).toBe(900);
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/sessions.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 使用validatedRequest真实user，login初次同源Origin校验；bridge opaque cookie+域分离HMAC/JWT绑定、AES-GCM AAD；写操作CSRF；本地DELETE session/binding不依赖Gateway。User.update密码变更（含PasswordRecovery间接调用）及User.delete吊销bridges，requireBridge逐请求比较credential_binding_hmac以防吊销写故障；前端signout先best-effort revoke再清本地token，用户停用按每请求DB校验。禁止改全局主登录认证。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function computeDeadline({ now, msExpiry, mtExpiry, jwtExpiry }) {
  if (![now, msExpiry, mtExpiry, jwtExpiry].every(Number.isFinite))
    throw new Error('MGW_BUSINESS_AUTH_REQUIRED');
  const expires = Math.min(now + 900, msExpiry, mtExpiry, jwtExpiry);
  if (expires <= now) throw new Error('MGW_BUSINESS_AUTH_REQUIRED');
  return expires;
}
// Cookie随机值只HMAC存库；每次requireBridge先JWT/user/suspend，
// 再bridge HMAC/JWT HMAC/deadline，mutation再Origin/CSRF。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/sessions.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: bind gateway bridges to verified local sessions"`。未通过不进入依赖任务。


### PLAN-MGW-004：专用受限Workspace的创建和持续访问策略

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-WORKSPACE-001, REQ-SEC-001, REQ-COMPAT-001。
**Acceptance refs：** A-WORKSPACE-001-01/02；A-SEC-001-01/02；A-REV-001-01/02。
**Preconditions / Depends on：** 001、003；可完全使用本地fixture。

**Files：**

- Create: `server/utils/meetingGateway/workspacePolicy.js`
- Modify: `server/models/workspace.js`
- Modify: `server/models/workspaceUsers.js`
- Modify: `server/utils/middleware/validWorkspace.js`
- Modify: `server/endpoints/workspaces.js`
- Modify: `server/endpoints/api/admin/index.js`
- Modify: `server/endpoints/embedManagement.js`
- Modify: `server/endpoints/meetingGateway.js`
- Test: `server/__tests__/meetingGateway/workspacePolicy.test.js`

**Interface：** createWorkspacePolicy({store,prisma}) -> createRestricted({userId,name}), assertOwner({workspaceId,actor}), assertMutation({workspaceId,actor,action,expectedEpoch}), filterVisible(workspaces,actor)。actor={kind:'USER'|'API_KEY'|'ANONYMOUS',userId?,bridgeId?}，只有USER且owner才通过受限策略。

**State / Side effects / T0：** NONE→ACTIVE，异常→FROZEN；T0普通Workspace/members不变。
**Failure / Compensation：** 并发add-member和attach：epoch不符拒绝，事务失败不能遗留无policy的可用空间。

- [ ] **Step 1：写失败验收。** owner可用、manager/admin非owner拒绝、普通空间不变；所有member create/reset/delete路径与embed创建拒绝破坏持续不变量。

```js
const { canReadRestricted } = require('../../utils/meetingGateway/workspacePolicy');
test('privileged application roles do not replace owner', () => {
  expect(canReadRestricted({ ownerUserId:1 }, { kind:'USER', userId:2, role:'admin' })).toBe(false);
  expect(canReadRestricted({ ownerUserId:1 }, { kind:'USER', userId:1 })).toBe(true);
  expect(canReadRestricted({ ownerUserId:1 }, { kind:'API_KEY', userId:1 })).toBe(false);
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/workspacePolicy.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 仅BFF创建空Workspace+policy+owner同事务，禁止收编旧空间；给getWithUser/whereWithUser加受限特例且保留普通分支。WorkspaceUser所有写入口集中policy/CAS，API admin增量/重置也同约束；既有embed运行在011再防御。已有普通空间角色权限回归。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function canReadRestricted(policy, actor) {
  return actor.kind === 'USER' && actor.userId === policy.ownerUserId;
}
// 普通空间走旧逻辑；受限空间先查policy并过滤admin/manager特例。
// createRestricted、membership与policy_epoch变更用同一prisma事务，
// 不允许其它模块直接改受限空间membership绕过此Module。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/workspacePolicy.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: enforce durable restricted workspace ownership"`。未通过不进入依赖任务。


### PLAN-MGW-005：OAuth事务、校验URL与本人确认

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-OAUTH-001, REQ-OAUTH-002, REQ-OAUTH-003。
**Acceptance refs：** A-OAUTH-001/002/003-01/02；A-REV-008-01/02。
**Preconditions / Depends on：** 000、002–003；000未完成仅做schema/fixture测试，真实联调BLOCKED。

**Files：**

- Create: `server/utils/meetingGateway/oauth.js`
- Modify: `server/endpoints/meetingGateway.js`
- Test: `server/__tests__/meetingGateway/oauth.test.js`

**Interface：** createOAuthModule({gateway,store,clock}) -> listConnections(ctx), start(ctx), confirm(ctx,connectionId)；校验sdk_id/redirect_uri/host，保存无state transaction_id，confirm后重读ACTIVE。

**State / Side effects / T0：** NOT_CONNECTED→WAITING_BROWSER_CONSENT→PENDING_CONFIRMATION→ACTIVE（仅Gateway真值）。
**Failure / Compensation：** FI-004/005、URL/state传输例外；旧state取消/过期不重放。

- [ ] **Step 1：写失败验收。** URL合法state透传但日志0、篡改host/redirect拒绝、PENDING单事务、跨owner confirm拒绝、corp mismatch不继续query。

```js
const { validateAuthorizationUrl } = require('../../utils/meetingGateway/oauth');
test('rejects lookalike authorization hosts', () => {
  expect(() => validateAuthorizationUrl('https://meeting.tencent.com.evil.invalid/oauth'))
    .toThrow('MGW_OAUTH_START_REJECTED');
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/oauth.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 实现§8.1流程，transaction按bridge唯一在途；不生成state/auth_code，不接腾讯callback；return_to默认null，结果页后本人刷新confirm。网页授权超bridge deadline需本人重登录，过期pending不能被其他bridge接管。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function validateAuthorizationUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'meeting.tencent.com' ||
      url.username || url.password || url.port ||
      url.searchParams.get('sdk_id') !== '33510141629' ||
      url.searchParams.get('redirect_uri') !== 'https://copilot.superic.com:9999/callbacks/tencent/oauth/33510141629')
    throw new Error('MGW_OAUTH_START_REJECTED');
  return value; // 保留Gateway state；不打印/另存完整URL
}
// 授权pathname必须取000确认的精确入口白名单，不能只校验域名。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/oauth.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: add user scoped oauth initiation and confirmation"`。未通过不进入依赖任务。


### PLAN-MGW-006：源query、job观察与窗口目录快照

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-SOURCE-001, REQ-SOURCE-002, REQ-SOURCE-003, REQ-SOURCE-004。
**Acceptance refs：** A-SOURCE-001/002/003/004-01/02；A-REV-007-01/02。
**Preconditions / Depends on：** 000、002–005；权限schema不明时真实adapter任务BLOCKED。

**Files：**

- Create: `server/utils/meetingGateway/catalogue.js`
- Create: `server/utils/meetingGateway/snapshots.js`
- Modify: `server/endpoints/meetingGateway.js`
- Test: `server/__tests__/meetingGateway/catalogue.test.js`

**Interface：** createCatalogueModule({gateway,store,snapshots,clock}) -> submitWindow(ctx,{connectionRef,startAt,endAt}), observe(ctx,localRunId), list(ctx,{mode,queryRunId,cursor,limit}), recordings(ctx,meetingId)；query幂等key绑定user/connection/window，在途最多1。

**State / Side effects / T0：** ACCEPTED→RUNNING/RETRYING→SUCCEEDED+complete；cache目录与window结果分开。
**Failure / Compensation：** FI-006/007/008、recording ensure202；job_id响应丢失不伪造找回能力，Gateway无查询关联协议即恢复工单。

- [ ] **Step 1：写失败验收。** 202非完成、RETRYING非空、窗口外旧缓存不入window、半开边界、游标跨user/窗口/epoch/TTL、重复cursor和目录超限。

```js
const { isInWindow } = require('../../utils/meetingGateway/catalogue');
test('window uses meeting start and excludes upper endpoint', () => {
  expect(isInWindow({ start_at:'2026-10-11T00:00:00Z' }, '2026-10-11T00:00:00Z', '2026-10-18T00:00:00Z')).toBe(true);
  expect(isInWindow({ start_at:'2026-10-18T00:00:00Z' }, '2026-10-11T00:00:00Z', '2026-10-18T00:00:00Z')).toBe(false);
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 服务端推member与USER_WINDOW；POST前预存request id，结果未知记录query.status=BLOCKED与MGW_QUERY_RECOVERY_REQUIRED且禁止盲重发，Gateway若支持幂等键则按确认契约使用，否则显式人工核对。持久source mirror，2/4/8/30秒poll最多5分钟，5xx/429按§19.3。快照加密私有存储、TTL60、10k/20MiB；job successful+complete且快照完整才空态；recording ensure202轮询，ID不互换。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function isInWindow(meeting, start, end) {
  const time = Date.parse(meeting.start_at);
  if (!Number.isFinite(time)) throw new Error('MGW_UPSTREAM_CONTRACT_ERROR');
  return time >= Date.parse(start) && time < Date.parse(end);
}
// 只在Gateway分页终止且job complete后seal窗口快照；每个cursor保存
// user/member/connection/queryRun/snapshot/epoch引用，失配返回409。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: add verified window queries and owner bound catalogue cursors"`。未通过不进入依赖任务。


### PLAN-MGW-007：完整内容、原生纪要与确定性formatter

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-CONTENT-001, REQ-CONTENT-002, REQ-FORMAT-001。
**Acceptance refs：** A-CONTENT-001/002-01/02；A-FORMAT-001-01/02；A-REV-006-01/02。
**Preconditions / Depends on：** 000、002、006；纯formatter与hash测试不依赖真实源。

**Files：**

- Create: `server/utils/meetingGateway/content.js`
- Create: `server/utils/meetingGateway/formatter.js`
- Create: `server/utils/meetingGateway/hashes.js`

- Test: `server/__tests__/meetingGateway/content.test.js`

**Interface：** collectContent(ctx,{recordingId,kind},deps) -> {assetId,sourceVersion,sourceContent,contentSha256}；formatContent(input) -> {markdown,formatterVersion,markdownSha256}；hashPageContent(document) -> hex64，源JCS与派生NFC/LF分开。

**State / Side effects / T0：** CONTENT_ABSENT→STAGED_COMPLETE或FAILED；不完整永不调用Collector。
**Failure / Compensation：** FI-009/010、invalid UTF8/JCS不可无损、NO_MINUTES；没有asset/version不预造identity_key。

- [ ] **Step 1：写失败验收。** 三页顺序/毫秒时间/相同version、纪要todo=[]成功、版本漂移/重复游标/超限失败、恶意文本不执行、正文与容器摘要分离。

```js
const { hashPageContent } = require('../../utils/meetingGateway/hashes');
test('container metadata does not change the text digest', () => {
  expect(hashPageContent({ id:'old', pageContent:'正文\n' }))
    .toBe(hashPageContent({ id:'new', pageContent:'正文\n' }));
  expect(hashPageContent({ pageContent:'正文\n' })).not.toBe(hashPageContent({ pageContent:'正文改\n' }));
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/content.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** ensure202→job READY→完整cursor分页，验证asset/version不变、段落index顺序完整，20MiB/100k/2k页上限；原生minutes独立kind。JCS只用确认兼容库或经标准向量验证实现，格式化零网络零LLM，原文不修改；临时staging加密并owner隔离、完成/失败TTL清理。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
const { createHash } = require('crypto');
function hashPageContent(document) {
  if (typeof document.pageContent !== 'string') throw new Error('MGW_FORMAT_INVALID');
  return createHash('sha256').update(document.pageContent, 'utf8').digest('hex');
}
// content分页：seenCursor去环，asset/version逐页比较，预算计数先检查再追加；
// 只有next_cursor===null和完整性检查通过才返回STAGED_COMPLETE。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/content.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: collect complete native meeting text with stable hashes"`。未通过不进入依赖任务。


### PLAN-MGW-008：Collector受管幂等写入、journal与私有存储

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-IMPORT-001, REQ-RETRY-001, REQ-SEC-003。
**Acceptance refs：** A-IMPORT-001-01/02；A-RETRY-001-01/02；A-REV-004-01/02。
**Preconditions / Depends on：** 001、007；普通raw-text原有行为保持。

**Files：**

- Create: `collector/processManagedRawText/index.js`
- Create: `collector/utils/managedDocumentStore.js`
- Modify: `collector/index.js`
- Modify: `server/utils/collectorApi/index.js`
- Modify: `server/utils/files/index.js`
- Modify: `server/endpoints/api/document/index.js`
- Modify: `server/endpoints/document.js`
- Test: `collector/__tests__/processManagedRawText/index.test.js`

**Interface：** processManagedRawText(input,{store,clock}) -> {success,documents:[{location}],operationState}；managedDocumentStore.prepare/commit/get(operationId,payloadHash)；CollectorApi.processManagedRawText/getManagedRawTextOperation。UUID由Collector生成且journal恢复，不由BFF拼location。

**State / Side effects / T0：** NONE→PREPARED→COMMITTED；T0仅新增operation目录/journal；不重写普通文档。
**Failure / Compensation：** FI-011、落盘成功回传前杀进程，orphan=0；journal不一致进入恢复工单，禁止按正文hash认领他人文件。

- [ ] **Step 1：写失败验收。** same ID/payload并发一个文件、异payload409、两个owner相同正文隔离、prepare/write/commit/response各崩溃点恢复、raw原接口freshUUID回归。

```js
const { createManagedStore } = require('../../utils/managedDocumentStore');
const fs = require('fs'); const os = require('os'); const path = require('path');
test('payload mismatch cannot claim an existing operation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mgw-managed-'));
  try {
    const store = createManagedStore({ root });
    await store.prepare({ operationId:'op1', payloadHash:'aa', ownerUserId:1, generation:1 });
    await expect(store.prepare({ operationId:'op1', payloadHash:'bb', ownerUserId:1, generation:1 }))
      .rejects.toThrow('MGW_IMPORT_CONFLICT');
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand collector/__tests__/processManagedRawText/index.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 实现独占journal+临时文件fsync/rename、preallocatedUUID恢复、COMMITTED查询接口和§9.10provenance。共享picker/search/raw/move/delete统一排除meeting-managed并走owner策略，不把目录过滤当授权；普通upload不能伪造managedProvenance。路径realpath/root/symlink校验。未知响应返回operationId可恢复。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
// managedDocumentStore 的持久协议（所有名称为内部私有文件）：
// 1. fs.open(journalPath,'wx')独占prepare，写payloadHash/UUID/provenance后fsync。
// 2. 已存在则读journal逐字段比较，mismatch抛MGW_IMPORT_CONFLICT。
// 3. fs.open(tempPath,'wx')写完整JSON+fsync，原子rename到journal的UUID目标。
// 4. journal通过temp+rename改COMMITTED，返回真实location。
// 5. 恢复PREPARED时检查同UUID的完整文件/provenance/hash；存在则续commit，
//    不存在才以同UUID创建；部分临时文件隔离清理，不认领其它operation。
// GET operation只读journal状态，不触发重新随机创建。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand collector/__tests__/processManagedRawText/index.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: make managed collector writes idempotent and recoverable"`。未通过不进入依赖任务。


### PLAN-MGW-009：预存向量docId、可核验embedding与精确删除

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-WORKSPACE-001, REQ-IMPORT-001, REQ-RETRY-001, REQ-REMOVE-001。
**Acceptance refs：** A-WORKSPACE-001-01/02；A-REMOVE-001-01/02；A-REV-004-01/02；A-REV-005-01/02。
**Preconditions / Depends on：** 001、004、008；feature仍disabled，所有通用文档入口须先挂拒读保护。

**Files：**

- Create: `server/utils/meetingGateway/managedDocuments.js`
- Modify: `server/models/documents.js`
- Modify: `server/utils/files/purgeDocument.js`
- Test: `server/__tests__/meetingGateway/managedDocuments.test.js`

**Interface：** createManagedDocuments({store,vectorDb,documents,readFile}) -> attach({generationId,fence,workspaceId,epoch}), verify(generationId), cleanup({generationId,fence})；使用预存vector_doc_id，适配provider既有add/delete/get能力，缺可核验能力BLOCKED。 预存的vector_doc_id就是workspace_documents.docId，不是每个chunk的provider vectorId；沿用provider按docId删除接口，不新增全provider协议。

**State / Side effects / T0：** DOCUMENT_CREATED→ATTACHING→VERIFYING；物理失败PENDING_CLEANUP且权限拒读。
**Failure / Compensation：** FI-012/013/015；T0保留普通文档与其他generation的向量ID集合。

- [ ] **Step 1：写失败验收。** 向量成功DB失败、DB成功返回丢失、provider delete抛错/undefined、不存在文件不silent success、旧代清理不碰新代。

```js
const { cleanupGeneration } = require('../../utils/meetingGateway/managedDocuments');
test('cleanup addresses the recorded old vector id', async () => {
  const remove = jest.fn().mockResolvedValue(undefined);
  await expect(cleanupGeneration({ vectorDocId:'old-doc', workspaceSlug:'private-a', generation:1 }, { remove, confirmAbsent: async () => false }))
    .rejects.toThrow('MGW_REVOKE_CLEANUP_FAILED');
  expect(remove).toHaveBeenCalledWith({ namespace:'private-a', docId:'old-doc' });
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/managedDocuments.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 受管窄接口不依赖uploadToWorkspace布尔值；预存docId后入向量/本地关联，显式返回每阶段结果。所有workspace_documents关联修改核验policy与generation；直接通用addDocuments对受管location拒绝绕行。verify查询引擎实际docId/关联，remove只删旧docId及对应document_vectors；provider无法确认absent不得标cleanup done。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
async function cleanupGeneration(row, { remove, confirmAbsent }) {
  await remove({ namespace:row.workspaceSlug, docId:row.vectorDocId });
  if (!(await confirmAbsent(row.vectorDocId)))
    throw new Error('MGW_REVOKE_CLEANUP_FAILED');
  return { removed:true, generation:row.generation };
}
// 实际cleanup还须先store验证fence/provenance/旧location，再删精确关联；
// provider返回undefined不等于确认absent，不能吞错标成功。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/managedDocuments.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: persist managed vector identities before embedding"`。未通过不进入依赖任务。


### PLAN-MGW-010：导入Saga、租约、重导入与撤权清理

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-STATE-001, REQ-RETRY-001, REQ-REMOVE-001, REQ-SEC-002。
**Acceptance refs：** A-STATE-001-01/02；A-RETRY-001-01/02；A-SEC-002-01/02；A-REMOVE-001-01/02；A-REV-005-01/02。
**Preconditions / Depends on：** 001–009；有真契约的Gateway模块才可进入集成，暂不启用UI。

**Files：**

- Create: `server/utils/meetingGateway/importer.js`
- Create: `server/utils/meetingGateway/cleanup.js`
- Create: `server/utils/meetingGateway/worker.js`
- Modify: `server/endpoints/meetingGateway.js`
- Test: `server/__tests__/meetingGateway/importer.test.js`

**Interface：** createImporter(deps) -> submit(ctx,input), retry(ctx,importId), remove(ctx,importId), runGeneration(generationId,workerId)；worker负责lease60s/renew20s/fencing，cleanup精确generation并持久恢复记录。

**State / Side effects / T0：** 完整状态以§9.11为唯一来源；delete先REVOKING拒读，再REMOVED或PENDING_CLEANUP。
**Failure / Compensation：** FI-006/011/012/013/014/015/016；每步before/after T0、crash hook和fence证据齐全。

- [ ] **Step 1：写失败验收。** 三并发submit一个有效代、AUTH_REQUIRED重登恢复、REMOVED再导入新代、PENDING_CLEANUP409、旧worker不能提交/删新代、drift保留字节禁读。

```js
const { decideResubmit } = require('../../utils/meetingGateway/lifecycle');
test('pending cleanup blocks a fresh writer', () => {
  expect(decideResubmit({ status:'PENDING_CLEANUP', generation:1 })).toEqual({ action:'REJECT', code:'MGW_CLEANUP_IN_PROGRESS' });
  expect(decideResubmit({ status:'REMOVED', generation:1, cleanupDone:true })).toEqual({ action:'NEW_GENERATION', generation:2 });
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/importer.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 按VALIDATE/FETCH/STAGE/DOCUMENT_CREATE/WORKSPACE_ATTACH/VERIFY/COMMIT执行；资产身份真实到手才reserve；写前持久operation/vector docId。提交切active epoch事务，旧版退役后异步cleanup；401/未知只冻结，权威撤权才删除。补偿最多3次后恢复工单，未知Owner保留。explicit retry/new generation，禁止state任意跳转。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function decideResubmit(row) {
  if (row.status === 'PENDING_CLEANUP' || row.status === 'REVOKING')
    return { action:'REJECT', code:'MGW_CLEANUP_IN_PROGRESS' };
  if (row.status === 'REMOVED' && row.cleanupDone)
    return { action:'NEW_GENERATION', generation:row.generation + 1 };
  if (row.status === 'VERIFIED') return { action:'REVALIDATE_EXISTING' };
  if (row.status === 'AUTH_REQUIRED') return { action:'REAUTHENTICATE' };
  if (row.status === 'BLOCKED_DRIFT') return { action:'REJECT', code:'MGW_IMPORT_CONFLICT' };
  return { action:'RESUME_OR_EXPLICIT_RETRY' };
}
// 在途只返回原202；FAILED必须显式retry且旧写结果已确认，禁止else无条件新建。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/importer.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: coordinate generation safe meeting imports and cleanup"`。未通过不进入依赖任务。


### PLAN-MGW-011：全读取路径共享admission gate与history防回填

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-SEC-001, REQ-SEC-002, REQ-WORKSPACE-001, REQ-COMPAT-001。
**Acceptance refs：** A-SEC-001/002-01/02；A-WORKSPACE-001-01/02；A-REV-001-01/02；A-REV-002-01/02。
**Preconditions / Depends on：** 003–004、008–010；上线前必须全部完成，缺一个入口不得启用meeting功能。

**Files：**

- Create: `server/utils/meetingGateway/access.js`
- Create: `server/utils/chats/authorizedRetrieval.js`
- Modify: `server/utils/chats/stream.js`
- Modify: `server/utils/chats/apiChatHandler.js`
- Modify: `server/utils/chats/openaiCompatible.js`
- Modify: `server/utils/chats/embed.js`
- Modify: `server/endpoints/chat.js`
- Modify: `server/endpoints/api/workspace/index.js`
- Modify: `server/endpoints/api/workspaceThread/index.js`
- Modify: `server/endpoints/api/openai/index.js`
- Modify: `server/endpoints/embed/index.js`
- Modify: `server/endpoints/utils.js`
- Modify: `server/endpoints/system.js`
- Modify: `server/endpoints/workspaces.js`
- Modify: `server/utils/files/index.js`
- Test: `server/__tests__/meetingGateway/readPaths.test.js`

**Interface：** createAccessModule({store,gateway,sessions,clock}) -> admit({actor,workspaceId,bridge}), assertStillValid(admission)；authorizedRetrieval({admission,loadPinned,loadParsed,search,history})包住检索与上下文，受限gate不通过不执行loader/search/LLM。普通空间返回unrestricted admission而不强求bridge。

**State / Side effects / T0：** VALID允许；AUTH_REQUIRED/UNVERIFIED拒读不删除；SOURCE_REVOKED先拒读后cleanup；disabled仍guard。
**Failure / Compensation：** FI-014/015/017及停用适配器；不能只断言搜索命中0，必须截获发给LLM的实际context与引用。

- [ ] **Step 1：写失败验收。** 对所有入口用同一canary与LLM spy，向量删除失败/401/未知时response/source/context/LLM皆0；API key body.userId不可信；fixed doc/fulltext/history不能绕过。

```js
const { authorizedRetrieval } = require('../../utils/chats/authorizedRetrieval');
test('denied admission never loads pins or invokes search', async () => {
  const loadPinned = jest.fn(); const search = jest.fn();
  await expect(authorizedRetrieval({ admission:{ allowed:false, code:'MGW_BUSINESS_AUTH_REQUIRED' }, loadPinned, search }))
    .rejects.toThrow('MGW_BUSINESS_AUTH_REQUIRED');
  expect(loadPinned).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/readPaths.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 普通chat传可信USER+bridge，API/线程自报userId不提升权限；匿名embed和全局key对受限空间直接拒绝。各handler在pinned/parsed/history处理前admit、发送前assertStillValid，校验后5秒超时重验；agent/tool无actor默认拒绝，代码扫描登记全部retrieval调用点。已有历史读取只本地owner，冻结时禁止history回填生成新回答/TTS/文件；显式已生成历史下载例外必须标记残留。vector-search独立门禁，受管picker/raw/source/move/export同策略。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
async function authorizedRetrieval({ admission, loadPinned, loadParsed, search, history }) {
  if (!admission.allowed) throw new Error(admission.code);
  const pinned = await loadPinned();
  const parsed = loadParsed ? await loadParsed() : [];
  const results = await search();
  return { pinned, parsed, results, history };
}
// 每个handler在调用前admit，在LLM/响应发送前assertStillValid；
// loader/search不得先于admit执行；返回值sources与contextTexts不能分开授权。
// 受限失败直接拒整次新请求，因此无历史backfill到LLM。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/readPaths.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: enforce meeting authorization across every read path"`。未通过不进入依赖任务。


### PLAN-MGW-012：Meetings页面、BFF DTO与恢复交互

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-UI-001, REQ-COMPAT-001, REQ-OAUTH-001, REQ-SOURCE-003。
**Acceptance refs：** A-UI-001-01/02；A-COMPAT-001-01/02；A-REV-003-01/02；A-REV-007-01/02。
**Preconditions / Depends on：** 003–011已通过本地集成；000完成才能真实端到端。

**Files：**

- Create: `frontend/src/models/meetingGateway.js`
- Create: `frontend/src/pages/Meetings/index.jsx`
- Create: `frontend/src/pages/Meetings/ConnectionPanel.jsx`
- Create: `frontend/src/pages/Meetings/Catalogue.jsx`
- Create: `frontend/src/pages/Meetings/ImportHistory.jsx`
- Create: `server/utils/meetingGateway/dto.js`
- Modify: `frontend/src/main.jsx`
- Modify: `frontend/src/components/Sidebar/index.jsx`
- Test: `server/__tests__/meetingGateway/bffContract.test.js`

**Interface：** 前端model保留Bearer、same-origin cookie、CSRF仅内存；页面使用§9.3/9.12 DTO，mode window/cache显式，workspace_id服务端建立。主路由注册在main.jsx，主导航在Sidebar/index.jsx，均已由Luna核对；新增/meetings路由包PrivateRoute，桌面/移动侧栏均有入口。；dto.js产生validateImportRequest(body)（strict additionalProperties=false）。

**State / Side effects / T0：** 仅从BFF真值渲染，刷新页面重取csrf/bridge状态，不用localStorage伪造ACTIVE。
**Failure / Compensation：** 断网/取消授权/过期/deleted再导入/空窗口；浏览器真实A/B证据留到014，不能以snapshot代替。

- [ ] **Step 1：写失败验收。** BFF额外owner/token字段422、client拿不到凭证、invalid cursor不混页、过期恢复不保留ACTIVE、只有受限空间可选。

```js
const { validateImportRequest } = require('../../utils/meetingGateway/dto');
test('client cannot assign a gateway member', () => {
  expect(() => validateImportRequest({ recording_id:'r1', content_type:'transcript', workspace_id:7, gateway_member_id:'other' }))
    .toThrow('MGW_INPUT_INVALID');
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/bffContract.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 实现7个PRD UI场景，新增空受限空间创建入口；GET session为刷新恢复CSRF只读bootstrap；OAuth结果页后手工刷新/确认；query202/RETRYING/NO_RECORDING/NO_MINUTES/drift/cleanup各有明确操作。密码提交后清内存，退出取消pending；长任务超过5分钟停poll但保留人工刷新。Meetings独立导航，Compare/Translation不改语义；恢复/删除不隐藏残留事实。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function validateImportRequest(body) {
  const allowed = new Set(['recording_id','content_type','workspace_id']);
  if (Object.keys(body).some(key => !allowed.has(key)) ||
      typeof body.recording_id !== 'string' ||
      !['transcript','minutes'].includes(body.content_type) ||
      !Number.isInteger(body.workspace_id)) throw new Error('MGW_INPUT_INVALID');
  return body;
}
// 前端CSRF不落localStorage，刷新GET session恢复；HTTP202只是进度状态。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/bffContract.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。前端另运行 `npm run lint:check --prefix frontend` 与 `npm run build --prefix frontend`；没有既有前端test runner，浏览器A/B真实操作验证见014。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "feat: add meetings connection catalogue and import ui"`。未通过不进入依赖任务。


### PLAN-MGW-013：审计、非循环Gate与兼容回归

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-OBS-001, REQ-SEC-003, REQ-COMPAT-001, REQ-TEST-001。
**Acceptance refs：** A-OBS-001-01/02；A-SEC-003-01/02；A-COMPAT-001-01/02；A-TEST-001-01/02；A-REV-009-01/02；A-REV-010-01/02。
**Preconditions / Depends on：** 001–012；Gate元测试用合成独立run，不依赖实时Gateway。

**Files：**

- Create: `server/utils/meetingGateway/audit.js`
- Create: `scripts/meeting-gateway/release-gate.cjs`
- Create: `scripts/meeting-gateway/acceptance-map.json`
- Create: `docs/integrations/meeting-gateway-runbook.md`

- Test: `server/__tests__/meetingGateway/releaseGate.test.js`

**Interface：** evaluateCandidate({manifest,businessEvidence,metaEvidence,goldenEvidence}) -> {status,exitCode,failures}，纯函数export；CLI只处理文件输入/退出码。acceptance-map列72个AC的测试文件/testName与class，70 business+2 meta；GC8单列。

**State / Side effects / T0：** 元测试PASS仅证明算法；实际发布维持NOT_RUN直到014；普通文档/Compare/Translation/OA摘要和网络0写。
**Failure / Compensation：** 所有FI用例有机器assertion/exit code；执行全Jest前检查环境与依赖，失败不得改Gate绕过。

- [ ] **Step 1：写失败验收。** 首跑完整candidate无自循环、缺AC/重复/错SHA/错config/mock代真人均fail；负向AC的预期拒绝是PASS，不覆盖候选输出。

```js
const { evaluateCandidate } = require('../../../scripts/meeting-gateway/release-gate.cjs');
test('missing evidence cannot pass', () => {
  expect(evaluateCandidate({ manifest:{ requiredAcceptanceIds:['A-REV-001-01'] }, businessEvidence:[], metaEvidence:[], goldenEvidence:[] }))
    .toMatchObject({ status:'FAIL_OR_BLOCKED', exitCode:1 });
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/releaseGate.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 按§24/25构造完整evidence schema与封存digest，日志canary扫描、阶段词表统一、raw secret不可归档。Gate元测试独立run并不列自身候选结果；exact ID清单/构建/配置/真实GC验证。runbook写禁用后guard仍存在、session expiry、恢复工单、备份30天、审计180天/诊断7天，部署参数仅缩短。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
// evaluateCandidate按此顺序纯评估，不能在计算中修改输入evidence：
// exact-id-set -> revision/config match -> all BUSINESS PASS
// -> independent GATE_META PASS -> real GC-01..08 complete -> G0..G4 PASS。
// 任一步失败返回{status:'FAIL_OR_BLOCKED',exitCode:1,failures:[...]};
// 全部满足返回{status:'PASS',exitCode:0,failures:[]}。
// CLI只在require.main===module时process.exitCode=result.exitCode；
// 被require做元测试时不能自己exit，也不要求当前candidate结果已存在。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/releaseGate.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "test: add non circular meeting release evidence gate"`。未通过不进入依赖任务。


### PLAN-MGW-014：真人联调、A/B越权、撤权与候选发布证据

**状态：** planned；evidence=[]。
**Requirement refs：** REQ-TEST-001, REQ-SEC-001, REQ-SEC-002, REQ-COMPAT-001。
**Acceptance refs：** GC-01–GC-08；G0–G5；全部72 AC（70 business、2独立meta）。
**Preconditions / Depends on：** 000–013全部通过；真实部署HTTPS、多用户A/B、已授权测试会议、已知源样本及运维恢复权限齐备。缺一为BLOCKED，不用fixture替代。

**Files：**

- Create: `docs/integrations/meeting-gateway-release-checklist.md`

- Test: `server/__tests__/meetingGateway/goldenConsumer.test.js`

**Interface：** 真人执行记录与候选manifest按§24；golden test仅加载受控证据并校验schema/完整性，不能自行伪造OAuth/Consumer成功。

**State / Side effects / T0：** BUSINESS/GOLDEN PASS后运行候选聚合器exit0才可提出发布；本轮不会执行此任务。
**Failure / Compensation：** 未具测试权限/Gateway契约不符/仍RETRYING→BLOCKED+非0；保留失败范围与恢复工单。

- [ ] **Step 1：写失败验收。** 给golden evidence校验器缺失GC-03/07的输入必须失败，确保测试不会因没有凭据跳过而PASS。

```js
const { assertGoldenEvidence } = require('../../utils/meetingGateway/audit');
test('a synthetic oauth fixture is not a real golden run', () => {
  expect(() => assertGoldenEvidence({ id:'GC-03', run_mode:'SYNTHETIC', status:'PASS' }))
    .toThrow('REAL_CONSUMER_REQUIRED');
});
```

- [ ] **Step 2：运行红灯。** `npm test -- --runInBand server/__tests__/meetingGateway/goldenConsumer.test.js`。预期是新增Module/行为尚未实现的断言失败；依赖安装错误不能算有效红灯。
- [ ] **Step 3：实现最小行为。** 先G0真实source job SUCCEEDED+complete与已知样本，再A/B OAuth/binding、窗口所有页/录制/内容完整、Collector实际location/向量核验。逐入口A/B/manager/API key/embed负向，撤权+向量DB故障验证LLM payload0，恢复普通文档摘要与OA写0。产实际command/退出码/脱敏trace，不操作生产资料制造故障。

关键实现顺序/约束（其余分支按本任务Interface及Spec实现）：

```js
function assertGoldenEvidence(evidence) {
  if (evidence.run_mode !== 'REAL' || evidence.status !== 'PASS')
    throw new Error('REAL_CONSUMER_REQUIRED');
  if (!evidence.candidate_build_id || !evidence.executed_at || !evidence.artifact_digest)
    throw new Error('GOLDEN_EVIDENCE_INCOMPLETE');
  return evidence;
}
// GC命令/操作人/时间/trace必须来自真实受控运行，不能从此函数生成事实。
```

- [ ] **Step 4：运行绿灯与目标回归。** `npm test -- --runInBand server/__tests__/meetingGateway/goldenConsumer.test.js` 必须exit=0；保存AC对应testName/expected/actual、T0/post摘要及失败注入结果。当前命令未运行，不能把此计划视为测试成功。
- [ ] **Step 5：review并提交本任务。** 核对Spec/安全/普通功能回归，使用requesting-code-review；只stage上列实际修改文件，`git commit -m "docs: record verified meeting integration release evidence"`。未通过不进入依赖任务。


## Requirement与修订覆盖

所有原有AC为各REQ的-01/02两项；以下任务同时负责测试原规范与对应v1.1新增AC，不能只实现新增20项。

- REQ-CONF-001 → PLAN-MGW-002, PLAN-MGW-000；原有AC须两项都运行。
- REQ-IDENT-001 → PLAN-MGW-001, PLAN-MGW-003；原有AC须两项都运行。
- REQ-AUTH-001 → PLAN-MGW-003；原有AC须两项都运行。
- REQ-AUTH-002 → PLAN-MGW-000, PLAN-MGW-002, PLAN-MGW-003；原有AC须两项都运行。
- REQ-OAUTH-001 → PLAN-MGW-005, PLAN-MGW-012；原有AC须两项都运行。
- REQ-OAUTH-002 → PLAN-MGW-005；原有AC须两项都运行。
- REQ-OAUTH-003 → PLAN-MGW-005；原有AC须两项都运行。
- REQ-UI-001 → PLAN-MGW-012；原有AC须两项都运行。
- REQ-SOURCE-001 → PLAN-MGW-000, PLAN-MGW-006；原有AC须两项都运行。
- REQ-SOURCE-002 → PLAN-MGW-006；原有AC须两项都运行。
- REQ-SOURCE-003 → PLAN-MGW-006, PLAN-MGW-012；原有AC须两项都运行。
- REQ-SOURCE-004 → PLAN-MGW-006；原有AC须两项都运行。
- REQ-CONTENT-001 → PLAN-MGW-007；原有AC须两项都运行。
- REQ-CONTENT-002 → PLAN-MGW-007；原有AC须两项都运行。
- REQ-FORMAT-001 → PLAN-MGW-007；原有AC须两项都运行。
- REQ-IMPORT-001 → PLAN-MGW-008, PLAN-MGW-009, PLAN-MGW-010；原有AC须两项都运行。
- REQ-WORKSPACE-001 → PLAN-MGW-001, PLAN-MGW-004, PLAN-MGW-009, PLAN-MGW-011；原有AC须两项都运行。
- REQ-STATE-001 → PLAN-MGW-001, PLAN-MGW-010；原有AC须两项都运行。
- REQ-RETRY-001 → PLAN-MGW-001, PLAN-MGW-008, PLAN-MGW-010；原有AC须两项都运行。
- REQ-SEC-001 → PLAN-MGW-003, PLAN-MGW-004, PLAN-MGW-011；原有AC须两项都运行。
- REQ-SEC-002 → PLAN-MGW-010, PLAN-MGW-011；原有AC须两项都运行。
- REQ-SEC-003 → PLAN-MGW-002, PLAN-MGW-008, PLAN-MGW-013；原有AC须两项都运行。
- REQ-OBS-001 → PLAN-MGW-002, PLAN-MGW-013；原有AC须两项都运行。
- REQ-REMOVE-001 → PLAN-MGW-009, PLAN-MGW-010；原有AC须两项都运行。
- REQ-COMPAT-001 → PLAN-MGW-004, PLAN-MGW-011, PLAN-MGW-012, PLAN-MGW-013；原有AC须两项都运行。
- REQ-TEST-001 → PLAN-MGW-000, PLAN-MGW-013, PLAN-MGW-014；原有AC须两项都运行。

修订验收的精确测试映射：

- A-REV-001-01/02 → workspacePolicy.test.js, readPaths.test.js → 004, 011。
- A-REV-002-01/02 → readPaths.test.js → 011。
- A-REV-003-01/02 → sessions.test.js → 003。
- A-REV-004-01/02 → collector processManagedRawText/index.test.js, managedDocuments.test.js, importer.test.js → 008–010。
- A-REV-005-01/02 → stateStore.test.js, importer.test.js → 001, 010。
- A-REV-006-01/02 → content.test.js, managedDocuments.test.js → 007, 009。
- A-REV-007-01/02 → catalogue.test.js → 006。
- A-REV-008-01/02 → oauth.test.js, client.test.js → 002, 005。
- A-REV-009-01/02 → releaseGate.test.js → 013。
- A-REV-010-01/02 → client.test.js, importer.test.js, releaseGate.test.js → 002, 010, 013。

server测试路径前缀均为server/__tests__/meetingGateway/，collector路径为collector/__tests__/processManagedRawText/index.test.js。每个Jest用例testName必须包含其AC ID或TEST-AC ID；一个文件可覆盖多个AC，但evidence按每AC独立expected/actual输出。命令以任务中具名Jest文件为准，替代v1.0虚构的逐ID node --test文件。

## 集成验证与发布

- 本地每任务运行指定Jest文件红→绿；迁移在临时DB中运行具名migration，使用server/schema对应锁定Prisma CLI。构造命令前由Luna读取当前package脚本，禁止在工作库运行会改真实数据的migrate dev。迁移验收必须对新建库及既有库副本执行，并确认旧数据摘要不变。
- 完成本地任务后：`npm test -- --runInBand`；`npm run lint:check --prefix frontend`；`npm run build --prefix frontend`。实际依赖缺失/环境错误记录为BLOCKED或失败，不能当产品用例PASS。
- 具体AC执行与Gate元测试先跑完；014真实GC证据不齐全则不运行“成功发布”路径。最终CLI拟定：`node scripts/meeting-gateway/release-gate.cjs --manifest <candidate-manifest-path>`，manifest路径是执行时新生成的候选文件参数，不能用示例伪造。
- FI-001–FI-018由会话、client、catalogue、content、Collector、managedDocuments、importer与readPaths测试按对应PRD触发点覆盖；FI-011/013的process kill必须在测试子进程执行，不能仅throw假装真实落盘崩溃。
- 普通空间、普通raw-text、既有用户文件与Compare/Translation回归；OA网络POST/PUT/PATCH/DELETE=0；敏感canary扫描0（只排除明确定义的OAuth URL/password必要瞬时传输）。

## 交付、审查与执行边界

本计划和PRD v1.1为待复审文档；代码扫描证据为静态事实，不是运行成功。R01–R10均有设计条款和新增AC映射，但实际实现、合约联调和真实Consumer仍NOT_RUN。
用户确认实施后采用subagent-driven-development逐任务实施并review；本轮不自动开工、不自动commit/push、不创建GitHub Issue。已存在的无关工作区变更必须保留。


## Implementation update (2026-10-18)

Commit `037a9c75` (`feat: add gated meeting gateway foundations`) contains the reviewed local implementation slices. Focused verification passed: 11 Jest suites / 129 tests plus 5 frontend Node tests; additional final task suites passed independently (OAuth 19/19, managed lifecycle/store 28/28, release gate 9/9). The full repository Jest run is not green in this worktree because dependencies are missing and unrelated existing suites fail; see the task ledger.

Status by gate: 000 BLOCKED (no upstream Gateway contract); 001–003 and 008 complete in earlier commits; 004/009 local protections implemented and reviewed, but production vector operations remain disabled until a provider supports fenced/cancellable mutations; 005 local OAuth/BFF seams and DTOs are implemented, with adapter still null; 006 and integrated 007 blocked on confirmed source contract (007 formatter/hash slice exists); 010 lease worker helper exists, importer/cleanup saga orchestration remains incomplete; 011 admission seam exists but existing retrieval handlers are not comprehensively guarded, so the feature hard gate is NOT READY; 012 BFF client only, Meetings UI intentionally unexposed; 013 pure release gate exists, evidence adapter/schema remains incomplete; 014 BLOCKED on contract and live environment. Do not enable meeting retrieval/import or claim production acceptance.