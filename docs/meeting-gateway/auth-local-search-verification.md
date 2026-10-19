# AUTH_LOCAL_SEARCH 阶段验证记录

**记录时间：** 2026-10-19（Asia/Shanghai）  
**阶段：** `AUTH_LOCAL_SEARCH`（PRD §4.6），不代表完整 R2、旧验收集或导入能力完成。  
**当前状态：** reviewed fixtures、默认单用户无 token 的 HTTP/BFF 与浏览器会议页兼容验证通过；`PHASE-LOCAL-02`、`PHASE-SCOPE-03` fixture 证据可记录 PASS，导入保持 deferred；真实 `PHASE-AUTH-01` 与整体 AUTH_LOCAL_SEARCH 仍为 `BLOCKED`。本文件不声称扫码、真实 Gateway 认证或生产联调已经完成。

## 证据身份

| 项 | 本次记录 |
| --- | --- |
| Consumer source | 最终 backend source `01823fe8`；该修订包含已审阅的最终 worker/queue fix。Frontend tree 相对 `0453b27f029f23bbde69a5081067578c390b12ad` 无差异（`git diff --quiet ... -- frontend` exit 0），因此前端测试/build沿用该 frontend 基线 |
| Gateway source | 已审阅参考 revision `d6bf6465f07385ce5906a7e0fced488c0c0881e9`；该源码未提供已验证的 WeCom start/redeem/profile Consumer wire |
| Deployment observation | `https://copilot.superic.com:9999` 只读观察记录于 2026-10-19；live health 可达，ready 显示 `database=true`, `backend=false`。不表示认证服务可用 |
| Live auth config | 未提供已批准的 WeCom 契约、配置版本或真实 profile 样本。生产 adapter 当前 `DEPENDENCY_NOT_READY` |
| Fixture config | 集成测试内的 `fixture-instance`、受控 HTTPS URL、profile 与加密/JWT测试密钥；只用于验证 Consumer 行为，不代表部署配置。测试密钥不是真实密钥且不写入部署 |
| Spec | `prd/AnythingLLM_MeetingGateway_企业微信登录与接入迁移_开发需求PRD_v2.0.0.md`，内容版本 2.0.2，§4.6；SHA-256 `ff382298a2ef1fc18d9a0dd9af1901172116c96643887fb8e1080c1f2d09cfaf` |
| Build under test | Frontend 基线 `0453b27f029f23bbde69a5081067578c390b12ad`；backend source 更新至 `01823fe8` 后确认 frontend tree 无差异，因此沿用该基线的 18+5 frontend tests 和 production build：exit 0，92.94s，6284 modules；既有 Vite warnings，无 errors。Schema 未变，沿用已验证结果 |

## 本轮实际验证

新增的 `server/__tests__/meetingGateway/authLocalSearchIntegration.test.js` 把真实 `createWeComIdentityStore`、Prisma 生成客户端、临时 SQLite、真实 Express BFF routes 与受控 Gateway fixture 连接起来。测试在 OS 临时目录生成独立 Prisma client，以旧结构建立隔离数据库，再执行仓库里的 `20261019000100_gateway_auth_local_search` 迁移。它没有连接应用 storage 数据库或共享生成客户端。

| 命令 | 结果 | 证据边界 |
| --- | --- | --- |
| `corepack yarn test --runInBand --testTimeout=90000 server/__tests__/meetingGateway/authLocalSearchIntegration.test.js` | 1 suite / 2 tests PASS | 受控 fixture 的 BFF HTTP success 写入 passwordless default user 与 `GATEWAY_ENABLED` registry session；另一个用例证明当前 session 的兑换响应丢失会持久化 `LOCAL_ONLY`，返回原 session state，redeem 只调用一次。不是上游认证证据 |
| Consolidated backend command (19 explicit suites; full command below) | **19 suites / 214 tests PASS** | Final backend source `01823fe8`; controller run 56.31s |
| `node --test frontend/tests/baseHeaders.node.js frontend/tests/wecomAuth.node.js` | 18 / 18 PASS | 冻结 DTO 视图状态、legacy null-mode 会话兼容、LOCAL_ONLY UI 行为及 lost-response 不重交票据 |
| `corepack yarn --cwd frontend test:meeting-gateway` | 5 / 5 PASS | Meeting Gateway 前端 DTO 兼容 |
| `server\node_modules\.bin\prisma.cmd validate --schema server/prisma/schema.prisma` | PASS | 当前 schema 语法/关系有效；不等于生产 DB 已迁移或部署 client 已生成 |
| `corepack yarn test --runInBand server/__tests__/meetingGateway/authLocalSearchGate.test.js` | 1 suite / 7 tests PASS（由已审阅 Task 6 gate 报告） | 证明 gate 对 fixture、伪造 provenance、缺 case、deferred import 和 outbound count 的处理；测试数据自身不构成阶段运行证据 |

集成测试通过受控 `127.0.0.1` HTTP server，不使用正在运行的开发 API；未更改用户环境变量/API key。一次尝试通过 `prisma db push` 初始化独立临时 DB 时，Windows Schema Engine 返回通用错误；集成用例改为执行仓库真实迁移 SQL，随后完整通过。最终集成验证没有对 running DB 执行 migrate、push 或 reset。

## 阶段案例和依赖

| 案例 | 当前判定 | 依据 / 后续要求 |
| --- | --- | --- |
| `PHASE-AUTH-01` | **BLOCKED**：`REAL_AUTH_PROVENANCE_TRUST_UNAVAILABLE` | Task 1 证明实际 WeCom/profile wire 未提供；Task 6 gate 不信任调用者自报字段或自算摘要。fixture 登录、HTTP DTO、真实 SQLite 投影都不能满足真实 WeCom provenance。需要获批契约、配置身份以及经可信渠道观察的真实企业用户扫码/profile 与投影/session 证据。 |
| `PHASE-LOCAL-02` | **fixture PASS；受控 live legacy route PASS** | Task 4 review `3f8bbc62` 及后续 middleware fix `ad46589c`。T4 tests cover owner local-index QA/citation, workspace ACL, cross-user/null-owner/mixed-ID denials, source/detail/segment/file rejection before reads, remote adapter spies not called, and worker authorization before handler. QA uses actual indexer + QA service with fixture chunk/store adapter; worker and outbound checks are controlled tests, not production network measurements. Controller also verified no-Authorization `GET /api/meetings` returns 200 with `{meetings:[]}` in the default passwordless single-user mode. |
| `PHASE-SCOPE-03` | **fixture PASS；导入 DEFERRED** | Task 4 server admission 与 Task 5 UI/model 覆盖本阶段只读范围。`A-IMPORT-*` 标记 `DEFERRED_CURRENT_PHASE`，gate `NOT_REQUIRED`；deferred 不是 PASS，也不要求实现新导入。Task 5 null-user parser 与 no-token header 修复已 review。 |

因此当前 `AUTH_LOCAL_SEARCH` phase 总 gate 仍为 BLOCKED，唯一真实阶段阻断为 PHASE-AUTH-01 缺少可信认证 provenance。LOCAL_ONLY/scope 的 fixture 与默认 legacy 单用户受控浏览器路径结果都不能替代真实 Gateway 认证，deferred import 也不计 PASS。

## 部署依赖与安全边界

启用前必须对目标环境应用已审阅 migration，并从更新后的 `server/prisma/schema.prisma` 执行 Prisma Client generate，再启用 Gateway local login。旧生成 client 将 SQL `NULL` password 反序列化为非 nullable 字段时会失败；不能先启用再补生成。生产迁移需由目标环境部署流程执行，本次没有触及生产库。

当前不向 Gateway 发送 POST、登录尝试、兑换票据或凭据；不根据 origin 猜测认证契约；不存取或记录密钥；不声称完成真实扫码。任何兑换结果不确定时不重放一次性票据。`LOCAL_ONLY` 只属于通过服务端 registry 验证的当前 session；页面状态本身不能作为访问控制证据。

## Latest reviewed Consumer evidence (2026-10-19)

Task 4 was approved at `3f8bbc62`; its scoped report records **9 suites / 110 tests passed**, including:

- Positive LOCAL_ONLY QA through the actual indexer and QA service with a locally stored fixture chunk, returning its citation without a remote meeting client.
- Owner/workspace checks and rejection for another user, null owner, mixed meeting IDs, expired/unknown state, and explicit remote actions before adapters/retrieval/LLM dependencies run.
- Source/detail/segment/file endpoint denial before stored source reads, plus job admission denial before a worker handler. Worker tests use controlled job/session fixtures, not a production queue or real upstream.
- LOCAL_ONLY mode blocks parse/reindex/import/retry work when that work can mutate data or invoke the configured OCR HTTP parser. This phase allows existing-data reads only.

The final verification results and source identities are recorded in the evidence table above. The 19-suite command below covers the prior 17 suites plus `meetings/integration.test.js` and `meetings/lifecycle.test.js`; controller reported 214 tests passed in 56.31s. These are fixture and application results, not a real Gateway login.

The following is the consolidated verification command reported by the controller:

```powershell
corepack yarn test --runInBand --testTimeout=120000 server/__tests__/meetingGateway/wecomClient.test.js server/__tests__/meetingGateway/wecomIdentity.test.js server/__tests__/meetingGateway/wecomAuth.test.js server/__tests__/meetingGateway/authLocalSearchGate.test.js server/__tests__/meetingGateway/authLocalSearchIntegration.test.js server/__tests__/models/user.test.js server/__tests__/meetingGateway/sessions.test.js server/__tests__/meetingGateway/client.test.js server/__tests__/meetings/localOnlyAccess.test.js server/__tests__/meetings/endpoints.test.js server/__tests__/meetings/qa.test.js server/__tests__/meetings/runtime.test.js server/__tests__/meetings/retrieval.test.js server/__tests__/meetings/indexer.test.js server/__tests__/meetings/sources.test.js server/__tests__/meetings/importer.test.js server/__tests__/meetings/jobAdmission.test.js server/__tests__/meetings/integration.test.js server/__tests__/meetings/lifecycle.test.js
node --test frontend/tests/baseHeaders.node.js frontend/tests/wecomAuth.node.js
corepack yarn --cwd frontend test:meeting-gateway
corepack yarn --cwd frontend build
server\node_modules\.bin\prisma.cmd validate --schema server/prisma/schema.prisma
```

The default passwordless single-user browser compatibility was verified on frontend baseline `0453b27f029f23bbde69a5081067578c390b12ad`; the final backend source `01823fe8` leaves frontend tree unchanged. T3 runtime, T4 middleware, and T5 no-token header fixes have scoped clean reviews. Controller verified live BFF state without Authorization as HTTP 200 (`authenticated: true`, null mode/user), and `GET /api/meetings` without Authorization as HTTP 200 with `{meetings:[]}`. Browser `http://localhost:3000/meetings` loaded without auth/invalid-token errors; legacy controls appeared and the empty/filter state rendered. This confirms default single-user compatibility only; no real scan or import action was performed.

## Phase gate operation and current AUTH dependency

`scripts/meeting-gateway-r2/auth-local-search-gate.cjs` exports `evaluatePhaseGate({ phase, evidence })`; it is a library module, not a standalone CLI. The seven-test Jest suite verifies gate behavior, but it does not run the phase against real provider evidence. To evaluate an actual run, capture each documented command and exit code, bind every case to the same trusted `source/config/build/spec` identities, then pass that collected evidence object to the exported function. The unit test fixtures and locally authored JSON are not phase evidence. The gate deliberately returns `REAL_AUTH_PROVENANCE_TRUST_UNAVAILABLE` for any structurally complete real AUTH claim because this repository has no trusted provenance verifier integrated. An actual `evaluatePhaseGate` invocation using the recorded fixture-only run returned overall `BLOCKED` / `REAL_GATEWAY_AUTH_EVIDENCE_REQUIRED`, with AUTH blocked and LOCAL-02/SCOPE-03 fixture results PASS; its input/output are recorded in `.superpowers/sdd/2026-10-19-meeting-gateway-auth-local-search.plan/phase-evaluation.json`. This function result is distinct from the phase dependency assessment: real AUTH remains blocked because approved contract/config identity, trusted real-flow observation, and an integrated provenance verifier are absent. The returned evidence digest is only a self-computed fingerprint, not proof. Beyond an approved contract/config identity and trusted real-flow observation evidence, a trusted verifier must be implemented and connected; placing JSON or a self-generated digest in the evidence object cannot produce PASS.

Current external blocker remains: no owner-approved deployment WeCom start/redeem/profile contract or config identity, no authenticated live profile matched to the redeemed subject, and no trusted evidence provenance. Until those dependencies are supplied and a real user flow is observed through a trusted channel, `PHASE-AUTH-01 = BLOCKED`; overall `AUTH_LOCAL_SEARCH = BLOCKED`, even though the LOCAL_ONLY and scope fixture cases pass.

## Queued meeting jobs from before trusted initiator context

The worker requires each new source or reindex job to contain a server-derived initiator context. A pre-existing `PARSE_SOURCE` job without that context is isolated and marked `FAILED`; source status may remain `PENDING`. Since the existing source retry path accepts only `FAILED`, a simple retry or repeating the same operation is not guaranteed to recover this item. Keep this job isolated pending a separately reviewed, authorized recovery procedure; this phase does not repair its data or grant authorization automatically. Existing indexed local reads are unaffected. A newly created trusted-legacy job has passed the actual SQLite-backed worker test. No queue migration or automatic legacy-job recovery is performed.
