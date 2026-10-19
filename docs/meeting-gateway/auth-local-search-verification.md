# AUTH_LOCAL_SEARCH 阶段验证记录

**记录时间：** 2026-10-19（Asia/Shanghai）  
**阶段：** `AUTH_LOCAL_SEARCH`（PRD §4.6），不代表完整 R2、旧验收集或导入能力完成。  
**当前状态：** fixture 与 Consumer 集成验证已通过；真实 `PHASE-AUTH-01` 仍为 `BLOCKED`；`PHASE-LOCAL-02` 等待 Task 4 验收证据。本文件不声称扫码、真实 Gateway 认证或生产联调已经完成。

## 证据身份

| 项 | 本次记录 |
| --- | --- |
| Consumer source | `anything-llm` worktree，提交 `0a006d211bbe4da2fcd1c05c8d89c0edfac69b3b`（Task 3 完成点；Task 4 工作进行中，不能作为最终集成构建身份） |
| Gateway source | 已审阅参考 revision `d6bf6465f07385ce5906a7e0fced488c0c0881e9`；该源码未提供已验证的 WeCom start/redeem/profile Consumer wire |
| Deployment observation | `https://copilot.superic.com:9999` 只读观察记录于 2026-10-19；live health 可达，ready 显示 `database=true`, `backend=false`。不表示认证服务可用 |
| Live auth config | 未提供已批准的 WeCom 契约、配置版本或真实 profile 样本。生产 adapter 当前 `DEPENDENCY_NOT_READY` |
| Fixture config | 集成测试内的 `fixture-instance`、受控 HTTPS URL、profile 与加密/JWT测试密钥；只用于验证 Consumer 行为，不代表部署配置。测试密钥不是真实密钥且不写入部署 |
| Spec | `prd/AnythingLLM_MeetingGateway_企业微信登录与接入迁移_开发需求PRD_v2.0.0.md`，内容版本 2.0.2，§4.6；SHA-256 `ff382298a2ef1fc18d9a0dd9af1901172116c96643887fb8e1080c1f2d09cfaf` |
| Build under test | 临时 Task 6 集成改动叠加于 Consumer HEAD `0a006d2`；Task 4 同时进行中，因此没有最终阶段 build SHA |

## 本轮实际验证

新增的 `server/__tests__/meetingGateway/authLocalSearchIntegration.test.js` 把真实 `createWeComIdentityStore`、Prisma 生成客户端、临时 SQLite、真实 Express BFF routes 与受控 Gateway fixture 连接起来。测试在 OS 临时目录生成独立 Prisma client，以旧结构建立隔离数据库，再执行仓库里的 `20261019000100_gateway_auth_local_search` 迁移。它没有连接应用 storage 数据库或共享生成客户端。

| 命令 | 结果 | 证据边界 |
| --- | --- | --- |
| `corepack yarn test --runInBand --testTimeout=90000 server/__tests__/meetingGateway/authLocalSearchIntegration.test.js` | 1 suite / 2 tests PASS | 受控 fixture 的 BFF HTTP success 写入 passwordless default user 与 `GATEWAY_ENABLED` registry session；另一个用例证明当前 session 的兑换响应丢失会持久化 `LOCAL_ONLY`，返回原 session state，redeem 只调用一次。不是上游认证证据 |
| `corepack yarn test --runInBand --testTimeout=90000 server/__tests__/meetingGateway/wecomClient.test.js server/__tests__/meetingGateway/wecomIdentity.test.js server/__tests__/meetingGateway/wecomAuth.test.js server/__tests__/meetingGateway/authLocalSearchGate.test.js server/__tests__/meetingGateway/authLocalSearchIntegration.test.js server/__tests__/models/user.test.js server/__tests__/meetingGateway/sessions.test.js` | 7 suites / 65 tests PASS | T1/T2/T3、证据 gate、集成与相关用户/session回归；Jest timeout 专用于隔离 Prisma 生成测试 |
| `node --test frontend/tests/wecomAuth.node.js` | 14 / 14 PASS | 冻结 DTO 视图状态、legacy null-mode 会话兼容、LOCAL_ONLY UI 行为及 lost-response 不重交票据 |
| `corepack yarn --cwd frontend test:meeting-gateway` | 5 / 5 PASS | Meeting Gateway 前端 DTO 兼容 |
| `server\node_modules\.bin\prisma.cmd validate --schema server/prisma/schema.prisma` | PASS | 当前 schema 语法/关系有效；不等于生产 DB 已迁移或部署 client 已生成 |
| `corepack yarn test --runInBand server/__tests__/meetingGateway/authLocalSearchGate.test.js` | 1 suite / 7 tests PASS（由已审阅 Task 6 gate 报告） | 证明 gate 对 fixture、伪造 provenance、缺 case、deferred import 和 outbound count 的处理；测试数据自身不构成阶段运行证据 |

集成测试通过受控 `127.0.0.1` HTTP server，不使用正在运行的开发 API；未更改用户环境变量/API key。一次尝试通过 `prisma db push` 初始化独立临时 DB 时，Windows Schema Engine 返回通用错误；集成用例改为执行仓库真实迁移 SQL，随后完整通过。最终集成验证没有对 running DB 执行 migrate、push 或 reset。

## 阶段案例和依赖

| 案例 | 当前判定 | 依据 / 后续要求 |
| --- | --- | --- |
| `PHASE-AUTH-01` | **BLOCKED**：`REAL_AUTH_PROVENANCE_TRUST_UNAVAILABLE` | Task 1 证明实际 WeCom/profile wire 未提供；Task 6 gate 不信任调用者自报字段或自算摘要。fixture 登录、HTTP DTO、真实 SQLite 投影都不能满足真实 WeCom provenance。需要获批契约、配置身份以及经可信渠道观察的真实企业用户扫码/profile 与投影/session 证据。 |
| `PHASE-LOCAL-02` | **等待 Task 4** | 此轮仅验证认证/投影集成和 LOCAL_ONLY session 状态存储。尚未把正在开发的 route、QA、检索、history、worker/outbound ACL 变更计为通过。需 Task 4 review release 后验证真实本地检索链路、所有者/workspace ACL、拒绝路径与 LOCAL_ONLY 出站计数为 0。 |
| `PHASE-SCOPE-03` | **待合并阶段证据** | Task 5 的报告说明入口和页面模型兼容；仍需 Task 4 证明服务端行为并完成最终集成审阅。旧导入范围标记为 `DEFERRED_CURRENT_PHASE` / gate `NOT_REQUIRED`，既不算 PASS，也不要求本阶段完成新导入。 |

因此当前 `AUTH_LOCAL_SEARCH` gate 不能报告 PASS。完成 fixture 集成仅表示可测试的 Consumer 路径得到证据；它不能替代真实认证证据，也不能解除 LOCAL_SEARCH 的 Task 4 待验状态。

## 部署依赖与安全边界

启用前必须对目标环境应用已审阅 migration，并从更新后的 `server/prisma/schema.prisma` 执行 Prisma Client generate，再启用 Gateway local login。旧生成 client 将 SQL `NULL` password 反序列化为非 nullable 字段时会失败；不能先启用再补生成。生产迁移需由目标环境部署流程执行，本次没有触及生产库。

当前不向 Gateway 发送 POST、登录尝试、兑换票据或凭据；不根据 origin 猜测认证契约；不存取或记录密钥；不声称完成真实扫码。任何兑换结果不确定时不重放一次性票据。`LOCAL_ONLY` 只属于通过服务端 registry 验证的当前 session；直到 Task 4 证明统一服务端门禁，页面状态本身不能作为访问控制证据。

## Review round 1 follow-up — cross-session HTTP lost-response coverage

The lost-response fixture now traverses the complete Express BFF boundary. It starts a rescan using the existing user's bearer and HttpOnly session proof, handles the callback over HTTP, then exercises `POST /complete` over HTTP. Foreign Origin and invalid `X-MGW-CSRF` each return 403 and make zero redemption calls. The valid request returns HTTP 503 with `MGW_AUTH_REDEEM_OUTCOME_UNKNOWN` / `reload_state`; the test then reads both session states through `/state` and inspects both SQLite rows. Only the triggering employee's row is `LOCAL_ONLY`; a separately projected employee's valid session stays `GATEWAY_ENABLED`. The fixture confirms exactly one redeem attempt and no profile fetch.

The first run of this strengthened case failed because the test JWT used a private fixture key while the existing BFF start route decodes bearer claims through the configured application JWT secret. The test now temporarily aligns `process.env.JWT_SECRET` to its test-only key and restores the previous value in `finally`; no secret is printed or changed outside the test process. This was a test harness correction, not a product-code change.

- RED: `corepack yarn test --runInBand --testTimeout=90000 server/__tests__/meetingGateway/authLocalSearchIntegration.test.js` — 1 suite / 2 tests, the new HTTP lost-response assertion failed: the target session remained `GATEWAY_ENABLED` because the fixture start request had not been associated with its existing registry session.
- GREEN: same command after fixture key alignment — 1 suite / 2 tests passed.
- Scope: only this integration test plus this verification document and report were edited; no product, Task 4, gate, plan, package, or ledger files were changed. No files were staged or committed.

## Additional compatibility gap reported to controller

A separate read-only cross-module check found the Task 3 single-user legacy state (`authenticated: true`, `remoteAccessMode: null`, `user: null`) is permitted by the frozen DTO and server, but the Task 5 client currently rejects authenticated state when `user` is null. Existing frontend compatibility tests cover a legacy multi-user state with a safe user only. This could reject single-user meeting bootstrap. The controller assigned this to the Task 5 worker; Task 6 does not change frontend behavior. Re-run the relevant frontend node test after that fix and record its reviewed result before final phase acceptance.
