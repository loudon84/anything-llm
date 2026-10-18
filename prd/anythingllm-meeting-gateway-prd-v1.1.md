---
title: "AnythingLLM 对接 Meeting Gateway：按用户 OAuth 授权与会议资料导入工程需求 PRD"
subtitle: "AnythingLLM Meeting Adapter / OAuth / Meeting Catalogue / Transcript & Minutes / Restricted Workspace"
prd_id: "PRD-ANYTHINGLLM-MEETING-GATEWAY-20261017"
version: "1.1.0"
status: "REVIEW"
template_version: "1.0"
review_revision: "R01-R10"
source_v1_0_sha256: "cf58852625f04a54c5f06ac44af279c3cfa0e2f479331eecd0621c3186c5af94"
created_at: "2026-10-17"
updated_at: "2026-10-18"
anythingllm_commit: "1336d327f4460510b755059b15481fd94a57cef7"
meeting_gateway_commit: "d6bf6465f07385ce5906a7e0fced488c0c0881e9"
document_type: "ENGINEERING_CONTRACT_PRD"
---

# AnythingLLM × Meeting Gateway 集成工程需求 PRD（v1.1）

> **文档状态：REVIEW（非实施完成）**。当前静态源码核对不等于生产运行状态；真实 Gateway 授权已据操作者报告达到 ACTIVE，但腾讯 `USER_WINDOW` 历史会议查询作业曾处于 RETRYING，尚未取得其最终错误码、成功结果和已知会议样本。本文不将该步骤标记为 PASSED。
>
> **文档规范：**严格遵循《需求PRD工程模板》v1.0 的 0–36 章、Requirement Unit、Acceptance、Oracle、Evidence 和 No-Inference Rule。所有标注为“拟新增”的 API/页面/表在当前仓库中并不存在。
>
> **边界：**本轮仅 AnythingLLM 与 Meeting Gateway 的**人员级 OAuth 授权、查询、导入、Workspace 隔离**；不直接开发腾讯会议 ASR、基础 AI 纪要、AK/SK 企业链路、OA 写入、Compare/Translation 核心功能。

> **v1.1 修订说明（2026-10-18）：**按PRD review R01–R10修订；新增持续受限Workspace、Bearer+bridge、全读取门禁、Collector操作日志/向量docId恢复、generation、窗口快照、摘要分层和非循环Gate。状态仍REVIEW；配套plan为用户明确授权的待审草案。仅文档产出，未实施/真实联调。
>
> **条款整合：**§9.7–9.12、§19.3、§25.2为新增规范；相关旧条款已同步调整。原AC保留，补20个修订AC。源码扫描模型GPT-6 Luna，记录见配套code-scan-evidence.md。

# 0. PRD 使用原则

## 0.1 PRD 的职责

- WHY：让拥有合法腾讯第三方应用 OAuth 授权的员工在 AnythingLLM 消费本人会议成果，形成可检索资料。
- WHAT：AnythingLLM 本地身份关联、OAuth 引导、会议列表、录制/转写/纪要、导入与受限 Workspace。
- BOUNDARY：腾讯协议及员工连接归 Meeting Gateway；AnythingLLM 只使用受控 REST 和本地文档处理管道；Backend 仅由 Gateway 发起**唯一**账号登录接口。
- STATE：授权/Source Job/Asset 权威状态在 Gateway；AnythingLLM 导入状态在本地 Prisma/Collector；向量状态在 Workspace 向量引擎。
- INPUT：AnythingLLM用户Bearer JWT与opaque bridge Cookie、本人提交的 Gateway 账号密码、网关短会话和业务令牌、Gateway 资源 ID、合法资源正文。
- OUTPUT：真实会议目录、转写/纪要文档、私有 Workspace 可检索结果、完整的操作/失败证据。
- SIDE EFFECT：仅允许明确授权的本地绑定、会话、导入记录、受管文档/向量；查询 Gateway 和腾讯从 Gateway 发出网络请求，不写源会议。
- FAILURE：失权、重试、契约错误/分页错误、过期、已存在冲突和导入中断分别返回确定状态，禁止伪造成功。
- ACCEPTANCE/EVIDENCE：第20–27章定义机器 Oracle、脱敏证据和 R1 Release Gate。

## 0.2 强制规范关键词

- **MUST / MUST NOT**：对应 Requirement 内正向/反向 Acceptance；未证明则该 Requirement 非 PASS。
- **SHOULD / SHOULD NOT**：可有偏离记录，但不可绕过 MUST / MUST NOT。
- **MAY**：未列 Release Required 的可选扩展，不能改变默认路径。
- 本文出现的 Gateway/AnythingLLM URL 及字段分为**仓库中现有**和**拟新增接口**，二者不可混淆。

## 0.3 No-Inference Rule

开发 Agent 若不能从本文件确定 Owner、Gateway 授权策略、源/本地 ID 差异、回跳、下载范围、Hash、状态机、补偿、权限和验收 Oracle，**MUST report `SPEC_SEMANTIC_GAP`** 且在该实施点停止生成计划，不得凭经验越权替换接口。例如：“有管理员 API Key 就代表员工 A”应直接判为错误；“Gateway 202 等于查询成功”应直接判为错误。

# 1. 文档元数据

```yaml
title: AnythingLLM 对接 Meeting Gateway 按用户 OAuth 授权与会议导入
prd_id: PRD-ANYTHINGLLM-MEETING-GATEWAY-20261017
version: 1.1.0
status: REVIEW
product: AnythingLLM Meeting Adapter
repository:
  consumer: https://github.com/loudon84/anything-llm
  provider: https://github.com/smc-copilot/meeting-gateway
branch:
  consumer: master
  provider: master
commit:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
owner: AnythingLLM 二开工程负责人（角色）
reviewers: [AnythingLLM负责人, MeetingGateway负责人, 安全与测试负责人, 会议业务负责人]
created_at: 2026-10-17
updated_at: 2026-10-18
target_release: R1-integration-read-only
change_type: [BROWNFIELD_CHANGE, INTEGRATION, MIGRATION, GOVERNANCE]
golden_consumer: AnythingLLM 多用户 Web + Gateway 真实员工 A/B + 腾讯授权且已结束会议样本
related_docs:
  - 需求PRD工程模板.md@sha256:b00234e6d103b2c102cbcc7b02fbcd961e71b0ce784ee736ead592c301e35eff
  - Gateway 历史 OAuth 授权 ACTIVE / USER_WINDOW RETRYING 联调记录（由使用方提供，未执行独立复验）
supersedes: none; This PRD supplements but does not modify Meeting Gateway's own PRD.
```

## 1.1 源码证据基线与实现声明

| 判断 | 仓库证据 | 置信边界 |
|---|---|---|
| Gateway OAuth 自己管理授权和 User Connection | `app/services/connection_service.py`、`app/callbacks/router.py` | 静态源码已核对；R1 真人测试仍需 Evidence |
| Gateway REST 列表、源查询、录制、正文接口 | `app/api/business.py`、`app/services/query_service.py`、`app/services/content_service.py` | 已有接口；腾讯商业权限/实际错误码不可推断 |
| Gateway 仅账号登录上游与本地身份 | `app/api/identity.py`、`app/integrations/nodeskclaw_backend/client.py` | 不允许 AnythingLLM 另行调用 Backend |
| AnythingLLM 支持原始文本文档与 Workspace | `server/endpoints/api/document/index.js`、`server/endpoints/api/workspace/index.js` | 原有 API Key 路由并不自动提供员工级授权 |
| AnythingLLM Workspace Users 模型 | `server/models/workspaceUsers.js`、`server/prisma/schema.prisma` | 需要本次额外校验私有读者集合 |
| Gateway 现有 `/mcp` / AnythingLLM 现有 MCP transport | Gateway `app/main.py`、AnythingLLM `server/utils/MCP/hypervisor/index.js` | R1 不以 MCP 作为导入传输 |

- 固定入口：Gateway 公网 `https://copilot.superic.com:9999` 只用来做 Tencent 回调与必要受控入口；对内 REST 使用经运维确认的内部 Gateway HTTPS origin，不能假定所有 `/api/v1` 都已匿名公网开放。
- 固定第三方腾讯应用：`corp_id=210022394`、`sdk_id=33510141629`；客户密钥只放 Gateway `.env`；数字回调地址 `/callbacks/tencent/oauth/33510141629`、`/callbacks/tencent/events/33510141629`。
- **双令牌区别：**Gateway 账号登录签发 `ms_` 本地会话；Gateway 业务 REST 使用 `mt_`；腾讯的 `AccessToken` 只在 Gateway 内部加密使用。

# 2. 一句话目标

让已登录 AnythingLLM 且具有 Gateway 本人有效身份、腾讯第三方应用 OAuth ACTIVE 连接和会议读取权限的员工，通过 Meetings 页面主动查询可见会议，导入完整转写与腾讯原生纪要到本人独占 Workspace，并以状态、来源、哈希和 A/B 用户越权测试证明这一结果；同时不泄露腾讯或网关凭据、不扩张会议资源权限，也不对 OA 产生写入。

# 3. 背景与问题定义

## 3.1 Current State

1. **Tencent**：第三方应用通过 OAuth 授权；已有真实回调成功案例，某员工 Connection 达到 ACTIVE。Webhook 注册成功是另一条链路，不替代个人 OAuth。
2. **Meeting Gateway**：真实用户授权后接收 `state`、兑换 Tencent Token、关联成员、允许按人查询会议；Gateway 会议历史任务 `POST /api/v1/meeting-queries` 返回 202，但本轮此前唯一用户提供的实测记录停留在 RETRYING（根因未给出）。
3. **AnythingLLM**：支持 `/v1/document/raw-text`、`Collector.processRawText`、Workspace 文档索引和聊天；没有与上述 Gateway 用户映射/授权状态/历史会议异步查询一体化的 Meetings 页面、导入记录和员工隔离保障。
4. **第三方项目集成**：AnythingLLM 内部文档 API 的全局 API Key 不能成为“用户本人有权查看该会议”的证据。Gateway 用户和 AnythingLLM user_id 独立，必须建立可信关联。
5. **原设计方向**：Compare 和 Translation 为独立模块；会议任务建议及经人工确认后对接 OA 是更下游业务，不应被本轮 OAuth/导入联调自动触发。

## 3.2 Problem

- P-001：当前 AnythingLLM 无法让员工通过自身 UI 完成 Gateway OAuth 发起/状态确认。
- P-002：没有稳定的 AnythingLLM user ↔ Gateway member ↔ OAuth connection 映射，错误复用一个管理员 Token 有跨用户泄露风险。
- P-003：Gateway 历史会议源查询不保证已成功；把 202 和 RETRYING 显示为空会议会掩盖上游失败。
- P-004：完整转写是分页读取、纪要是异步 READY；直接把一页内容存入 Workspace 将构造不完整业务资料。
- P-005：导入后原 Gateway 权限不会自然跟随到 Workspace；如直接导入共享 Workspace 会突破授权边界。
- P-006：缺少 source_version/文档位置/独立 Workspace 的导入记录，重复导入与撤销无法审计或补偿。

## 3.3 Impact

| 类型 | 影响 | 本轮处理 |
|---|---|---|
| 业务 | 员工不能在 AnythingLLM 搜索其腾讯会议成果 | OAuth 连接 + 导入 R1 |
| 工程 | 同一会议生成多个无来源文件 | 版本化幂等映射 + 向量核验 |
| 安全 | 管理员 API Key / 公用 Token 导致 A 数据泄露给 B | 双层权限 + 私有 Workspace |
| 运维 | Tencent 源错误与 Collector 错误混淆 | 独立 Job/Stage/Code/Evidence |
| AI Coding | Agent 自行设计 Backend 身份桥、腾讯 Token 获取 | 边界和禁止项直接写为 Contract |

# 4. Scope

## 4.1 In Scope

| Scope | 交付能力 | Requirement |
|---|---|---|
| SCOPE-001 | 双仓配置与网络门禁 | REQ-CONF-001 |
| SCOPE-002 | 员工绑定 + Gateway local account-login | REQ-IDENT-001, REQ-AUTH-001 |
| SCOPE-003 | Gateway REST 业务 Token/权限 | REQ-AUTH-002 |
| SCOPE-004 | OAuth 状态、发起、回跳、员工确认 | REQ-OAUTH-001/002/003 |
| SCOPE-005 | AnythingLLM Meetings 页面 | REQ-UI-001 |
| SCOPE-006 | Gateway USER_WINDOW、源作业、列表、会议/录制详情 | REQ-SOURCE-001/002/003/004 |
| SCOPE-007 | 原生转写全文和纪要 | REQ-CONTENT-001/002 |
| SCOPE-008 | 格式化并调用 AnythingLLM Collector | REQ-FORMAT-001, REQ-IMPORT-001 |
| SCOPE-009 | 私有 Workspace 授权、索引 | REQ-WORKSPACE-001 |
| SCOPE-010 | 导入映射、版本和补偿 | REQ-STATE-001, REQ-RETRY-001 |
| SCOPE-011 | 双用户拒绝、撤权、清理、敏感信息 | REQ-SEC-001/002/003, REQ-REMOVE-001 |
| SCOPE-012 | 观察性、兼容和验收 | REQ-OBS-001, REQ-COMPAT-001, REQ-TEST-001 |

## 4.2 Out of Scope

| Non-goal | 精确定义 |
|---|---|
| NON-GOAL-001 | R1 **MUST NOT** 在 AnythingLLM 接触 Tencent AppSecret、Tencent OAuth Token，亦不实现腾讯直连、ASR 或基础纪要生成。 |
| NON-GOAL-002 | R1 **MUST NOT** 走企业 AK/SK、STS 或通过官方 MCP 代替 OAuth；不得重新部署 Hermes、smc-copilot 其他项目或 Backend 管理接口。 |
| NON-GOAL-003 | R1 **MUST NOT** 自动创建、取消会议、获取媒体文件或下载视频。 |
| NON-GOAL-004 | R1 **MUST NOT** 写入 OA/任务服务；任务候选、人工确认、OA 传输将另立下游 PRD，接口契约缺失前禁止自动假定。 |
| NON-GOAL-005 | R1 **MUST NOT** 把独立 Compare/Translation 实现并入 Meetings；其已有菜单与数据层保持不变。 |
| NON-GOAL-006 | R1 **MUST NOT** 将个人 OAuth 会议内容自动发布至团队共享 Workspace；跨用户共享需要另一个显式来源授权产品需求。 |
| NON-GOAL-007 | R1 **MUST NOT** 做无人值守夜间全量同步；Gateway 本地身份短会话到期后不能借用 service Token 冒用本人。 |
| NON-GOAL-008 | R1 **MUST NOT** 以原生会议纪要“任务”字段为空为理由自动调用 LLM 生成仿冒腾讯纪要。 |

以上禁止项由 REQ-COMPAT-001、REQ-SEC-001/002/003、REQ-OAUTH-001/002/003、REQ-TEST-001 的 Negative Acceptance 联合验证。

## 4.3 Architecture Boundary

| Domain | Owner | Input | Output | 不负责 |
|---|---|---|---|---|
| Tencent OAuth & API | 腾讯会议 | 员工 Consent / Gateway 应用配置 | OAuth Token、会议数据 | AnythingLLM 私有库 |
| Gateway app config | Meeting Gateway `.env` | CORP/APP/Secret/Webhook | Tencent API 封装 | AnythingLLM 业务用户 UI |
| Gateway identity | Meeting Gateway | Gateway `/auth/account-login` | `ms_`、本地 member | 按 AnythingLLM 用户分库 |
| Gateway authorization & source | Meeting Gateway | `mt_`、connection、job | 会议/录制/正文受控 REST | AnythingLLM 索引 |
| Meeting Adapter | AnythingLLM 二开 | 本地用户 Session、Gateway REST | 绑定/资源镜像/导入流程 | Tencent API 直连 |
| Document & Workspace | AnythingLLM 原有核心 + 受管适配 | 标准 Markdown、doc location | 私有文档/向量检索 | Gateway OAuth grant |
| Compare / Translation | 独立模块（既有项目边界） | 用户显式选文档 | 对比/翻译独立产物 | 隐式会议授权 |
| OA/task | 后续独立业务应用 | 人工确认后的任务 | OA 单据 | R1 自动任务写入 |

# 5. Terminology / Domain Model

| 术语 | 唯一定义 |
|---|---|
| Anything User | AnythingLLM 当前经过服务端认证的本地 users.id。 |
| Gateway Member | Gateway 在 account-login 后本地维护的 `member_id`，不等同于腾讯 `open_id` 或旧 Backend member_id。 |
| OAuth Connection | Gateway `Connection` 中 `THIRD_PARTY_OAUTH` 实例；属于一个 Gateway member。 |
| ACTIVE | **Gateway** 返回的实际 Connection.status=ACTIVE 且允许当前 member 使用。 |
| `ms_` | Gateway 本地登录会话，不是 Gateway REST 业务 Token。 |
| `mt_` | Gateway REST resource 业务 Token，仅可在用户 Scope 内调用 `/api/v1`。 |
| Tencent AccessToken | 仅 Gateway 持有并使用的第三方 OAuth Token，不进入 AnythingLLM。 |
| Gateway Meeting ID | Gateway `GET /meetings` 的 `items[].id`，用于 Gateway 详情/录制路由。 |
| Tencent Meeting ID | 腾讯源 `meeting_id`；不同于 Gateway 内部 ID，也不同于展示用会议号。 |
| Recording ID | Gateway `recordings[].id`，用于 transcript/minutes 路由。 |
| Asset Version | Gateway 内容响应的 `content_version`/`asset_version`（若字段缺失必须阻断版本替换）；非文档 Hash。 |
| Doc Location | AnythingLLM Collector 创建的 `location`，必须来自处理成功响应。 |
| Source Coverage | Gateway `sync_coverage` + `coverage_is_partial`，标明目录并非腾讯全部会议。 |
| Workspace Owner | AnythingLLM 经认证的用户 + 当前 Workspace membership；R1 要求目标仅有这一名有效读者。 |
| Retryable | 仅该请求在不扩权与不重放不可重放 Token 的前提下可再次尝试。 |
| VERIFIED | 导入状态：来源完整、Collector 已创建、Workspace 链接存在、私有检索可验。 |
| BLOCKED | 前置条件未满足或真值不可查，不能标 PASS。 |

# 6. System Context

## 6.1 Context Diagram

```text
┌───────────────────────┐
│ AnythingLLM User A/B  │
│ local Session / Roles │
└──────────┬────────────┘
           │ Meetings 页面 / 用户主动触发
           ▼
┌────────────────────────────────────────────────────────┐
│ AnythingLLM Server                                    │
│ BFF: session binding / mt_ scope / oauth status /     │
│ meeting query / transcript+minutes import / audit      │
│  ├─ mapping & import-state (Prisma)                    │
│  ├─ generated document (Collector)                     │
│  └─ exclusive Workspace + embeddings                   │
└──────────┬────────────────────────────┬─────────────────┘
           │ per-user authenticated REST│ authorized native content
           ▼                            ▼
┌──────────────────────┐       ┌─────────────────────────┐
│ meeting-gateway      │       │ AnythingLLM RAG         │
│ local ms_ / mt_      │       │ document + vector       │
│ per-user OAuth Conn  │       │ private per-user scope  │
│ SOURCE_QUERY / Asset │       └─────────────────────────┘
└──────────┬───────────┘
           │ OAuth API + HTTPS callback 
           ▼
┌────────────────────────────────────────────────────────┐
│ 腾讯会议第三方 OAuth 应用（33510141629）               │
└────────────────────────────────────────────────────────┘

Gateway ── POST /api/v1/auth/account-login (only) ──> Backend 身份服务
AnythingLLM ─X─> Backend 管理/用户目录接口
AnythingLLM ─X─> 腾讯会议 SDK/API 及 OAuth 凭据
AnythingLLM ─X─> OA 写入（R1）
```

## 6.2 System Boundary

- Inside: AnythingLLM 页面、BFF/API、受限 Gateway Client、用户映射、文档格式化、受管导入表、Collector 与 Workspace 索引调用、诊断/审计/撤权清理。
- Outside: 腾讯 OAuth 请求签名与Token管理、Gateway 连接/权限/作业/源资源、Backend 账号校验、OA 和其它独立文档工具。
- Trusted: 服务器已认证的 AnythingLLM Session；Gateway 在授权 HTTPS 通道内给出的成员/资源授权结果。
- Untrusted: 浏览器提交的 member_id/connection_id/URL、腾讯会议正文、用户手工粘贴的会议号、伪造/过期的 Gateway token、LLM 生成文本。
- Network: Gateway 内部 REST origin 仅服务端连通；Tencent 回调由 Nginx `https://copilot.superic.com:9999` 转 Gateway，AnythingLLM 不能接管此回调。

# 7. Authoritative State / Source of Truth

| State | Role | Type | Authoritative? | Writer | Reader | 可自动覆盖？ |
|---|---|---|---|---|---|---|
| 腾讯应用 Id/Secret/回调 | DESIRED | DESIRED_STATE | YES（Gateway `.env`） | Gateway 运维 | Gateway | NO（AnythingLLM） |
| Backend 登录结果/当前员工 | OBSERVED | OBSERVED_STATE | YES（对当次 Gateway 登录） | Gateway | AnythingLLM BFF（通过 Gateway） | 由下次本人登录更新 |
| Gateway `ms_`/`mt_`/expires | RUNTIME | RUNTIME_STATE | YES（Gateway） | Gateway | AnythingLLM BFF | 按过期轮换 |
| OAuth Connection status/owner/scopes | RESOLVED | RESOLVED_STATE | YES（Gateway） | Gateway | AnythingLLM BFF | 只读本地缓存可覆盖 |
| Gateway SOURCE_QUERY job/progress | RUNTIME | RUNTIME_STATE | YES（Gateway） | Gateway Worker | BFF/UI | 只读镜像可覆盖 |
| Gateway Meetings/Recordings/Asset | SOURCE | RESOLVED_STATE | YES（Gateway） | Gateway | AnythingLLM | 不修改源，只重新读取 |
| AnythingLLM user binding | LOCAL | LAST_APPLIED_STATE | YES（本地关联） | BFF 用户绑定事务 | BFF | 冲突必须阻断 |
| import_attempt/status/provenance | LOCAL | LAST_APPLIED_STATE | YES（本地） | Meeting Adapter | BFF/审计 | 仅合法状态迁移 |
| 原生正文 staging | STAGING | RUNTIME_STATE | NO，临时副本 | BFF/Worker | Formatter | 可重建/过期清理 |
| AnythingLLM doc `location` | DOCUMENT | LAST_APPLIED_STATE | YES（Collector 输出） | Collector | Importer | 版本替换后刷新 |
| Workspace membership & docs | ACCESS | LAST_APPLIED_STATE | YES（AnythingLLM） | 受控 Workspace 操作 | BFF/聊天 | 仅可依已有授权修改 |
| 测试记录与 SHA | EVIDENCE | EVIDENCE_STATE | YES（验收证据） | Test Harness | Release Gate | 不可覆盖；新 run 生成新记录 |

**优先级：**Gateway 拒绝 > 本地缓存允许；当前 Workspace 拒绝 > Gateway 来源允许；授权无法确认/超时 → 拒绝。不得跨层推断允许。

# 8. State Machine

## 8.1 身份与 OAuth

```text
NOT_BOUND ── Gateway本人账号登录 ──> GATEWAY_SESSION_ACTIVE
GATEWAY_SESSION_ACTIVE ── 业务Token兑换成功 ──> REST_AUTHORIZED
REST_AUTHORIZED ── GET /me/connections ──> NOT_CONNECTED / ACTIVE / PENDING_CONFIRMATION
NOT_CONNECTED ── 点击连接 ──> WAITING_BROWSER_CONSENT
WAITING_BROWSER_CONSENT ── Tencent→Gateway成功回调 ──> PENDING_CONFIRMATION
PENDING_CONFIRMATION ── 本人confirm且企业验证匹配 ──> ACTIVE
ANY ── 身份会话过期 ──> AUTH_REQUIRED
ANY ── corp mismatch ──> CORP_MISMATCH
ACTIVE ── 真实撤权/失效 ──> REAUTH_REQUIRED / SOURCE_REVOKED
```

- 不允许 `NOT_CONNECTED → ACTIVE` 由 AnythingLLM 本地写值完成；`CORP_MISMATCH` 只能 Gateway 运维检查腾讯返回值与 `.env` 中 allowed_open_corp_ids。
- 用户取消授权、state 超时、Token 兑换失败：停在 `NOT_CONNECTED/REAUTH_REQUIRED`，新尝试重新发起 Gateway 授权，不重放旧 auth_code。
- 默认授权成功落 Gateway 结果页；用户返回 AnythingLLM 后观察与确认；任何无白名单 return_to 均不重定向。

## 8.2 会议查询和内容导入

```text
IDLE → SOURCE_QUERY_ACCEPTED (HTTP 202)
     → PENDING / RUNNING / RETRYING
     → SUCCEEDED + progress.complete=true → CATALOGUE_READY
     → FAILED / AUTH_REQUIRED / BLOCKED (no fake empty list)
CATALOGUE_READY → MEETING_SELECTED → RECORDINGS_READY
RECORDINGS_READY → CONTENT_ENSURE_PENDING(202) → CONTENT_STAGED_COMPLETE
CONTENT_STAGED_COMPLETE → FORMATTED → DOCUMENT_CREATED
DOCUMENT_CREATED → WORKSPACE_ATTACHED → VERIFIED
                    └→ PENDING_CLEANUP / FAILED
VERIFIED → SOURCE_REVOKED → REVOKE_PENDING_CLEANUP / CLEANUP_DONE
VERIFIED → USER_REMOVE → REVOKING → REMOVED
```

- 状态枚举仅属于 AnythingLLM 适配层；Gateway Job 的具体底层枚举原样保存、按映射转换，不修改 Gateway 实现。
- 业务 Token 到期 `AUTH_REQUIRED` 并停止所有依赖本人权限的外部读取，重新登录后同一用户恢复。
- 不能从任意 `RETRYING`、`ACCEPTED`、`CONTENT_NOT_READY` 直接转 VERIFIED。
- 初次 source query 空结果只有在 `SUCCEEDED + complete=true + 真实源返回窗口 0 条` 时显示“本次窗口无会议”；不能等价为“用户从未参会”。

# 9. Data / Schema Contract

## 9.1 Schema Rule

新增 Prisma model（名称为本 PRD 契约，实际迁移时转换为合法 Prisma 字段命名）：

```yaml
schema_id: meeting_gateway_adapter_state
schema_version: 1
storage: AnythingLLM existing Prisma datasource (current baseline SQLite; actual deployed provider must be confirmed)
additionalProperties: false
datetime: UTC ISO8601 with timezone; DB native datetime
ids: opaque strings from Gateway; never reinterpret UUID to Tencent ID
null_policy: explicit nullable only; logical JSON uses validated canonical JSON String in SQLite, enum uses validated String
migration: additive-only; do not rewrite existing workspaces/documents tables unless required by supported migration
rollback: migration reversal must preserve old user tables and managed evidence; drop only new empty adapter tables after controlled export
```

**表一 `meeting_gateway_bindings`**：`id` UUID PK、`anything_user_id` Int NOT NULL UNIQUE、`gateway_org_id` String NOT NULL、`gateway_member_id` String NOT NULL、`gateway_user_id` String NOT NULL、`identity_issuer` String default `account-login-v1`、`status` enum BOUND|DISABLED|REAUTH_REQUIRED、`verified_at` DateTime、`created_at` DateTime、`updated_at` DateTime；`UNIQUE(anything_user_id, gateway_org_id)，UNIQUE(gateway_org_id,gateway_member_id)（避免同Gateway员工绑定不同本地用户）`，同用户切换组织必须先手动解除旧绑定。

**表二 `meeting_bridge_sessions`**：`id` UUID PK、`anything_user_id` Int NOT NULL、`session_binding_hmac` String UNIQUE、`ciphertext` Bytes、`nonce` Bytes、`key_id` String、`gateway_expiry` DateTime、`created_at` DateTime、`revoked_at` DateTime NULL。密文载荷解密后仅有 `ms_`/`mt_`、声明 Scope、Gateway org/member；不存密码、不存 Tencent Token。`MAX(gateway_expiry) <= now+900s` 对单次登录，真实以 Gateway `expires_in` 收敛；按§9.8显式bridge revoke和最早deadline清理；不假设基线JWT自带服务端注销。

**表三 `meeting_query_runs`**：`id` UUID PK、`anything_user_id` Int、`gateway_member_id` String、`connection_ref` String、`selection` String default USER_WINDOW、`window_start` DateTime、`window_end` DateTime、`gateway_job_id` String、`status` Enum、`last_reason` String NULL（白名单错误字段）、`last_error_code` String NULL、`progress` JSON（仅允许安全字段）、`submitted_at` DateTime、`finished_at` DateTime NULL、`idempotency_key` String UNIQUE。

**表四 `meeting_imports`**：`id` UUID PK、`anything_user_id` Int、`gateway_org_id` String、`gateway_member_id` String、`connection_ref` String、`gateway_meeting_id` String、`gateway_recording_id` String、`gateway_asset_id` String、`content_type` transcript|minutes、`source_version` String、`content_sha256` String、`formatter_version` String default v1、`workspace_slug` String（展示镜像）、`workspace_id` Int FK、`identity_key` String UNIQUE、`active_generation` Int NULL、`current_generation` Int default 0、`document_location` String NULL、`last_applied_doc_sha256` String NULL、`status` Enum、`access_state` String VALID|AUTH_REQUIRED|SOURCE_REVOKED|UNVERIFIED、`attempt_count` Int default 0、`created_at` DateTime、`updated_at` DateTime、`verified_at` DateTime NULL、`source_verified_at` DateTime NULL、`last_error_code` String NULL。

**表五 `meeting_import_attempts`**：`id` UUID PK、`import_id` FK NULL（FETCH取得真实资产前允许空）、`request_id` UUID、`operation_id` UUID UNIQUE、`stage` Enum、`state` PENDING|RUNNING|FAILED|SUCCEEDED|CLEANUP_PENDING、`attempt` Int default 0、`retry_after` DateTime NULL、`evidence_ref` String NULL、`created_at` DateTime、`updated_at` DateTime、`last_error_code` String NULL。

**表六 `meeting_import_audits`**：`id` UUID PK、`operation_id` UUID、`owner_user_id` Int、`stage` String、`status` String、`error_code` String NULL、`trace_id` String NULL、`gateway_job_id_digest` String NULL、`timestamp` DateTime、`details` JSON（无凭证无正文）；业务审计保留 180 天，诊断事件 7 天，并可经部署参数缩短不能延长到无穷。

约束：`meeting_imports` 对 `(anything_user_id, connection_ref, gateway_asset_id, content_type, source_version, workspace_id)` UNIQUE；`meeting_imports.document_location` 与任何现有 `Document` 实际位置对应；孤儿文档清理由补偿机制负责，不允许通配删除整个 Workspace。

## 9.2 Field Semantic Table

| Field | Type | Required | Default | Authority | Meaning |
|---|---|---:|---|---|---|
| `anything_user_id` | Int | YES | none | AnythingLLM session | 本地资源 Owner，不从浏览器 body 读取 |
| `gateway_member_id` | String | YES | none | Gateway `/auth/account-login` | 本地 Gateway 员工 PK |
| `connection_ref` | String | YES | none | Gateway `/me/connections` | 对应该员工的 OAuth Connection |
| `gateway_meeting_id` | String | YES | none | Gateway `/meetings.items[].id` | 详情使用的本地网关会议标识 |
| `gateway_recording_id` | String | YES | none | Gateway `/meetings/{id}/recordings` | 正文读取的网关录制标识 |
| `gateway_asset_id` | String | YES | none | Gateway content info | 源内容实体 ID |
| `source_version` | String | YES | none | Gateway Asset response | 上游实际内容版本/哈希 |
| `document_location` | String | NO | null | AnythingLLM Collector | 原生文档标识，不自行生成 |
| `last_applied_doc_sha256` | hex64 | NO | null | Formatter output | 最后受管内容的精确字节摘要，变更即 drift |
| `status` | enum | YES | PENDING | AnythingLLM importer | 当前导入过程真相 |
| `access_state` | enum | YES | UNVERIFIED | Gateway source revalidation + local policy | 是否允许在 Meetings 功能中作为 RAG 素材 |
| `coverage_is_partial` | bool | YES（UI DTO） | true | Gateway list | 会议目录只覆盖部分来源 |
| `last_reason` | String | NO | null | Gateway job | 脱敏可展示的上游失败分类 |

## 9.3 拟新增 AnythingLLM BFF API 契约（不是现有实现）

所有 `/api/meeting-gateway/*` 复用AnythingLLM Bearer JWT，成功建立bridge后同时验证§9.8的opaque bridge Cookie；写端点同源Origin/CSRF。首次session登录采用Bearer+同源Origin，Body additionalProperties=false。主登录不迁移为Cookie。

| Method | New Endpoint | Request | 200/201/202 Success | Failure |
|---|---|---|---|---|
| POST | `/api/meeting-gateway/session` | {account,password} | {binding_status,expires_at,csrf_token}（无Gateway令牌） | 401/403/429/503 |
| GET | `/api/meeting-gateway/connections` | empty | {items:[status,id,name]} 仅本人 | 401/503 |
| POST | `/api/meeting-gateway/oauth/start` | empty | {authorization_url,transaction_id,expires_at} | 401/403/409 |
| POST | `/api/meeting-gateway/connections/:id/confirm` | empty | {status:ACTIVE} | 401/403/409 |
| POST | `/api/meeting-gateway/queries` | {connection_ref,start_at,end_at} | 202 {job_id,status:ACCEPTED} | 401/403/422/429 |
| GET | `/api/meeting-gateway/queries/:localId` | empty | {state,progress,last_reason} | 403/404/503 |
| GET | `/api/meeting-gateway/meetings` | {mode,query_run_id或connection_ref,cursor,limit}（query parameters，见§9.11） | {items,next_cursor,coverage_is_partial} | 401/403/503 |
| GET | `/api/meeting-gateway/meetings/:id` | empty | {meeting,recordings_state} | 403/404 |
| GET | `/api/meeting-gateway/meetings/:id/recordings` | empty | {items,job_id?} | 403/404 |
| POST | `/api/meeting-gateway/imports` | {recording_id,content_type,workspace_id}（仅专用受限空间） | 202 {import_id,state} | 403/404/409/422 |
| GET | `/api/meeting-gateway/imports/:id` | empty | {state,progress,document_location?} | 403/404 |
| GET | `/api/meeting-gateway/imports` | {limit,cursor?} | {items,next_cursor} | 403/404 |
| DELETE | `/api/meeting-gateway/imports/:id` | {reason} | {status:REMOVED或PENDING_CLEANUP} | 403/404/409 |

**DTO 约束：**客户端只传 Gateway 的 `connection_ref`/`recording_id` 等资源标识；`anything_user_id`、`gateway_member_id`、Scope、Token 都必须由 BFF 根据登录上下文推导，前端如提交多余字段应返回 422； `limit` 默认 20、最大100；GET 需要本人会话；删除原因 3–500 字；时间窗口 `start_at < end_at <= request_now` 且不超过90天。BFF 不直接承诺 Gateway 的源 Schema 全部属性。

## 9.4 Gateway 已存在接口及其区别

| API | 当前真实功能 | 备注 |
|---|---|---|
| `POST /api/v1/auth/account-login` | 用内部账号密码经 Gateway 登录，签发 `ms_` | Gateway 对 Backend 唯一允许登录调用 |
| `POST /api/v1/portal/session` | `ms_`→`mt_`，依赖 Portal client 与 action ceiling | 历次现场曾出现该路径缺陷，属于 G0 门禁 |
| `POST /api/v1/auth/exchange` | `ms_` + 内部注册客户端→`mt_` | 明确凭据注册/Scope/audience，不是匿名交换 |
| `GET /api/v1/me/connections` | 用户自己的 Tencent OAuth Connection | `ACTIVE` 是必要非充分条件 |
| `POST /api/v1/oauth/authorizations` | 生成腾讯官方 OAuth 授权 URL | 默认应用可传 `{}` |
| `GET /callbacks/tencent/oauth/33510141629` | 腾讯→Gateway 授权码回调 | AnythingLLM 不接收 auth_code |
| `POST /api/v1/connections/{id}/confirm` | 本人确认 OAuth 连接 | 所属者和企业核验均须通过 |
| `POST /api/v1/meeting-queries` | 返回 202 + job_id，安排真实源查询 | `USER_WINDOW` 严格限定当前 member |
| `GET /api/v1/jobs/{id}` | 作业状态/结果信息 | `RETRYING` 不等于成功 |
| `GET /api/v1/meetings` | 已同步本地目录、按 Gateway 权限过滤 | 不是直接实时 Tencent 查询 |
| `GET /api/v1/meetings/{id}` | Gateway ID 详情 | 不是 Tencent meeting_code |
| `GET /api/v1/meetings/{id}/recordings` | Gateway 录制信息，ensure 可返回202 | 使用 Gateway internal meeting ID |
| `GET /api/v1/recordings/{id}/transcript` | 完整转写按段落游标分页 | `fetch=ensure` 可先返回 202 |
| `GET /api/v1/recordings/{id}/minutes` | 原生智能纪要 | 不等于 AI 在 AnythingLLM 再创作 |

## 9.5 导入内容标准形式

```text
# 会议转写 / 会议原生纪要
来源系统：Tencent Meeting via Meeting Gateway
Gateway会议标识：<opaque-id>
Gateway录制标识：<opaque-id>
内容类型：transcript | minutes
内容版本：<source-version>
源会议开始时间（UTC）：<SOURCE_ISO8601>

## 正文
[00:02:05.160] 发言人：……
……
```

安全要求：上例私有 source ID 默认只存在于服务器受控 provenance 或对应受控文档，禁止随 metadata 向任意 Workspace 全部用户广播；用户可见 Markdown 可以只显示安全的文档来源链接（不带 token）。所有原始 JSON 保存在受限 storage，不作为浏览器脚本执行。

## 9.6 用户操作页面与交互合同（拟新增）

| Page / Component ID | 入口 | 控件及行为 | 网关/本地交互 | 空/错状态 |
|---|---|---|---|---|
| UI-MGW-001 Meetings/Overview | 左侧一级 `Meetings` | 连接状态、我的会议、查询时间窗、导入记录 | 本地 BFF `/connections`、`/meetings` | 未绑定→登录 Gateway；未 ACTIVE→连接腾讯；网关离线→重试 |
| UI-MGW-002 GatewayAccountModal | Meetings 首次进入 | 内部账号/密码、登录/取消、过期提示 | `POST /api/meeting-gateway/session` | 不填缓存账号密码；后台唯一 account-login 失败→明确提示 |
| UI-MGW-003 OAuthConnectCard | Meetings 顶部 | ACTIVE/UNBOUND/PENDING_CONFIRMATION/CORP_MISMATCH/REAUTH_REQUIRED、连接/确认/重新授权 | `GET /connections`；`POST /oauth/start`；`POST /connections/:id/confirm` | OAuth 发生在腾讯网页，返回 Gateway 结果页后用户返回 AnythingLLM 点击刷新/确认 |
| UI-MGW-004 MeetingList | Meetings → 我的会议 | 开始/结束 UTC 转本地时间、主题、会议状态、来源覆盖、分页、查询历史、选中 | `POST /queries` → poll `GET /queries/:id` → `GET /meetings` | HTTP 202 展示“已提交”，RETRYING 展示上游错误而非空会议；无会议需 verified complete |
| UI-MGW-005 MeetingDetail | 列表行点击 | 主持人、时间、来源、录制集合、转写/纪要可用性 | `GET /meetings/:id` + `/recordings` | 无录制→不能导入；权限丢失→关闭详情且不展示缓存正文 |
| UI-MGW-006 ImportDialog | 详情→导入 | 选择 transcript/minutes、创建/选择本人专用受限 Workspace、确认导入、进度提示 | `POST /imports`、`GET /imports/:id` | 资源未 READY、Workspace 共享、内容分页不完整均禁提交 |
| UI-MGW-007 ImportHistory | Meetings → 导入记录 | 查询已导入、源版本、目标 Workspace、重试/解绑、详情 | `GET /imports`、`DELETE /imports/:id` | FAILED/RETRYING/PENDING_CLEANUP 均有明确状态，不可误标 VERIFIED |

**导航独立性：**Meetings 与 Compare、Translation 平级，而非将 Compare/Translation 强制放入会议页下；OA 任务页不在本轮。

**关键浏览器流程：**

1. 用户进入 Meetings，若没有 Gateway 绑定则 UI-MGW-002 接受账号/密码；BFF 仅将密码给 Gateway account-login，并从 Gateway 获得本人 member_id。
2. Bearer+bridge与Gateway REST Token可用后，UI-MGW-003 GET 本人 OAuth Connection。`ACTIVE` 直接进入 UI-MGW-004；其它状态显示明确引导。
3. 点击“连接腾讯会议”时由 BFF 调用 Gateway OAuth 发起，返回 `https://meeting.tencent.com/...` 的官方地址，由用户在浏览器打开；腾讯回调固定 Gateway 数字 URL，不回调 AnythingLLM 自行兑换 Token。
4. Gateway 返回结果页后用户切回原 AnythingLLM 页面刷新连接状态；连接若处 `PENDING_CONFIRMATION`，再由本人显式点击确认；只有 Gateway 再查询为 `ACTIVE` 才可查会议。
5. 用户选最近 7 天或指定 1–90 天时间窗，点击“从腾讯查询”；页面显示 Gateway job_id digest、状态和 attempts，不在 202 后立即填充列表。
6. Gateway 真正 SUCCEEDED 后刷新已同步目录；用户进详情选择录制、转写或纪要，系统等待完整正文并展示原生类型。
7. 用户在导入框创建或选择本人专用受限 Workspace，确认后观察 Collector/向量进度；若检测到跨用户 Workspace 或权限失效，立即显示拒绝与恢复建议。
8. 删除导入需再次确认且仅清理本次受管资源；用户原 Workspace 文档不得受到波及。

**用户默认值：**会议列表 `limit=20`、来源窗口 `[now-7days,now]`（UTC 存储，前端按用户时区展示）、OAuth state 由 Gateway 管理、连接观察缓存 30s、页面自动 job 轮询 2→4→8→30 秒并在 5 分钟内停止自动刷新、不执行 OA 修改。

**页面级防护：**所有按钮只操作当前 Session Owner；`connection_id` 和 `document_location` 即便出现在 URL 也必须 BFF 重新核验；用户刷新页面后读取服务端真值，禁止仅依赖 localStorage 保存 ACTIVE。UI 中禁显示腾讯密钥、用户密码和 Token。

## 9.7 v1.1 持续访问约束与信任边界

R1 使用专用受限 Workspace：BFF 创建空空间并在同一本地事务写入受限记录和唯一 owner membership；不收编已有空间。新增 meeting_restricted_workspaces(workspace_id PK/FK, owner_user_id, policy_epoch Int default 1, state ACTIVE|FROZEN|RETIRED, created_at, updated_at)。删除最后一个导入不自动解除受限标记。workspace_id 为永久标识，slug 仅作显示/路由。

在线 admin、manager、全局 API Key、无用户身份的 embed/OpenAI-compatible 请求均不得绕过受限空间 owner 校验。主机/DB/备份操作者属于可信基础设施运维边界，不承诺抵御其离线读取；人工恢复路径单独授权并留审计，不作为正常读取后门。

受限空间禁止加入其他成员、公开 embed/分享、受管文档移动/复制/关联到其他空间、跨用户转移及通用同步器重新索引。成员/角色/分享/slug/文档关联变更先执行受限策略；policy_epoch 与成员更新在本地事务中 CAS，导入提交和发送内容前复核。仅统计 workspace_users 不构成隐私证明。普通非受限空间维持既有访问语义。

集中门禁覆盖：普通 stream/non-stream chat、API chat/thread、OpenAI-compatible、embed、vector-search、agent/tool、pinned/fulltext/parsed-file 注入、raw/source/file读取、全局picker/search、move/copy/delete/download/export。没有可信用户上下文的路径默认拒绝。不得相信 API body.userId、游客username或 API key.createdBy 等同当前人。

R1 用 Workspace 级 admission gate，不依赖所有向量引擎新增过滤字段：任何当前有效导入的授权不能被证明，本次整受限空间拒读，包含空间内非会议内容；普通空间不受影响。门禁在检索前、固定文档加载前和正文送入 LLM/响应前执行；上游成功验证至发送最多5秒，超出重验。门禁禁读期间 sources/contextTexts/LLM payload 均不能出现旧内容。禁用 MEETING_GATEWAY_ENABLED 只停止新连接/导入，持久受限门禁继续生效。

已生成的历史聊天、TTS、用户导出和外部LLM数据不回溯抹除；其在线读取仍需本地 owner 校验。受限空间新请求在源权限未知时整体拒绝，不能把旧会话/引用回填进新 LLM 请求或从历史再生成新音频/新文件，以此绕过冻结。明确已存在的历史下载属于已生成数据例外，UI/审计不得宣称完全擦除。

## 9.8 v1.1 Bearer 与 bridge session

复用 AnythingLLM Authorization Bearer JWT，不改主登录为 Cookie。沿用 validatedRequest 校验 JWT、当前 users 行和 suspended；单用户模式、开发 passthrough 不具备 meeting owner，不启用本功能。

Gateway 登录成功后，新发256-bit随机 opaque bridge id，仅放 __Host-meeting_bridge Cookie（HttpOnly/Secure/SameSite=Strict/Path=/，无Domain）；Cookie 不含 ms_/mt_。服务端只存 bridge id HMAC、JWT HMAC、CSRF HMAC，使用域分离。bridge 必须绑定 user_id、当前JWT和浏览器Cookie；所有BFF/受限读取同时验证三者。写端点加同源 Origin 校验与 X-Meeting-CSRF；session 首次建立以 Bearer+同源Origin保护，建立后返回 CSRF，旧CSRF随bridge轮换失效。

POST session 仍输入 account/password，输出 binding_status/expires_at/csrf_token。GET /api/meeting-gateway/session验证Bearer+bridge后只返回binding_status/expires_at/csrf_token，供刷新恢复；csrf_token=HMAC(独立CSRF key, bridge opaque id)，仅返回同源请求，不触发Gateway登录或延长期限。DELETE /api/meeting-gateway/session 本地吊销当前bridge并清Cookie，不依赖Gateway可达；DELETE /api/meeting-gateway/binding 吊销该user所有bridge、禁用binding并冻结受限空间，旧资料不迁移，完成后才能换member/org。

同浏览器重新登录轮换当前bridge；不同浏览器的bridge独立。JWT变化使旧bridge失配，须重新Gateway登录；用户停用每请求拒绝。用户密码变更时吊销其全部bridge（在现有User.update入口联动），不承诺吊销AnythingLLM既有JWT。前端logout先调用bridge revoke再清本地登录；断网时只能本地退出，不能声称服务端即时失效，残留bridge最多存活原deadline。

deadline 取 ms_ expiry、mt_ expiry、JWT expiry 和 now+900s 的最早值，不滑动延期；缺任一必需可验证期限为AUTH_REQUIRED。AES-256-GCM AAD绑定user/bridge/key_id，ms/mt expiry分开保存。session_binding_hmac定义为bridge id HMAC，补jwt_binding_hmac/csrf_hmac/credential_binding_hmac。credential_binding_hmac为当前users密码hash的域分离HMAC，每次requireBridge重比；不保存/日志原密码hash。密码更新、恢复码reset、User.delete均吊销bridge，指纹比对为吊销写失败时拒读的防线。

新增 meeting_oauth_transactions(id UUID, transaction_id UNIQUE, owner_user_id, bridge_session_id FK, expires_at, state PENDING|CONFIRMED|EXPIRED|CANCELLED)，每bridge仅一个PENDING；不存state/auth_code。state只允许由Gateway生成验证，在授权URL/回调链路往返；BFF只透明传经校验URL，禁止另存/记录state。

## 9.9 v1.1 撤权、未知与会话过期

每次受限读取通过当前owner有效mt_重验Connection和当前活跃source asset权限。具体resource cache/detail授权端点须由G0固定版本契约确认，不能为鉴权下载全文；只有ACTIVE不足以证明资产可读。30秒连接缓存仅用于UI。鉴权HTTP timeout=5秒，同一读取请求不自动重试。

- 401/本地或ms_/mt_过期：access_state=AUTH_REQUIRED，拒读、不物理删除；本人重登录并逐资源验证成功恢复VALID。
- 网络超时/429/5xx/缺真值字段：UNVERIFIED，本次冻结、不删除；成功重新验证后可恢复。
- 403/404立即拒读；仅在Gateway固定契约确认为资源失权/移除，或Connection权威状态明确撤销时置SOURCE_REVOKED并精确清理。未知403/404语义为UNVERIFIED，不能误删。
- SOURCE_REVOKED/REVOKING/PENDING_CLEANUP/REMOVED/SUPERSEDED/BLOCKED_DRIFT、非VERIFIED代不得进入RAG。清理失败仍拒读；备份不进入picker或向量库。
- 用户修改源派生文件产生drift时保留字节，冻结其检索资格；不能以转为USER_OWNED逃脱来源授权。重新授权不自动复活旧代，需清理完成后创建新generation。

access_state完整枚举为VALID|AUTH_REQUIRED|UNVERIFIED|SOURCE_REVOKED。source_verified_at为审计观察值，非永久授权。撤销检测采用用户下次读取触发，不增加夜间同步；已经送出的内容无法追回。

## 9.10 v1.1 可恢复 Collector 与摘要

拟新增内部 POST /process-managed-raw-text 与 GET /managed-raw-text/:operationId，沿用Collector现有服务认证；普通processRawText行为不变。输入 operation_id/import_id/generation/owner_user_id/workspace_id/payload_sha256/textContent/白名单metadata，只允许可信BFF传provenance，不接受浏览器/API Key自报。

Collector独立meeting-managed目录不被普通picker扫描。先以独占创建持久operation journal=PREPARED（payload hash、预分配Collector UUID及owner/provenance），再临时文件+原子rename写完整JSON，再journal=COMMITTED保存真实location和摘要。同operation_id同payload返回同location；异payload返回409 MGW_IMPORT_CONFLICT。崩溃恢复读取PREPARED的UUID/正文摘要完成commit，不另建随机文件。未知响应先GET operation查询，不盲重放。location仍由Collector返回，BFF不构造路径。

payload_sha256定义为SHA256(UTF8(JCS({operation_id,import_id,generation,owner_user_id,workspace_id,textContent,metadata})))，不含秘密和可变时间；Collector先重新计算再接受操作。JSON持久 managedProvenance={operation_id,import_id,generation,owner_user_id,workspace_id,payload_sha256}。目录和provenance不得通过普通列表、raw文件接口或向量metadata泄露；owner gate为真实控制，不依赖隐藏文件名。journal/文件跨进程竞争以独占创建和原子提交控制；同ID并发只一个结果。

content_sha256=SHA256(UTF8(JCS完整源JSON))，不改源Unicode、排除响应包装动态字段。last_applied_doc_sha256=SHA256(UTF8(JSON.pageContent))，等于生成Markdown原字节；校验时不再次NFC/LF规范化，不对整个JSON计算此摘要。container_sha256单独记录Collector已写JSON精确字节摘要，provenance另与DB逐字段核对；动态id/published变化不当作正文drift，未知owner始终PRESERVE+REPORT。

新增 meeting_import_generations(id UUID, import_id FK, generation Int, operation_id UNIQUE, state, document_location UNIQUE nullable, vector_doc_id UNIQUE nullable（即workspace_documents.docId，不是chunk vectorId）, last_applied_doc_sha256, container_sha256, policy_epoch, lease_owner nullable, lease_deadline nullable, fencing_token Int)，UNIQUE(import_id,generation)。operation_id预存后才发Collector；lease=60秒，每20秒续租，CAS失败停止；所有提交/清理校验generation+fencing token。

受管embedding必须预留并持久vector_doc_id，调用向量写入时复用该docId；不能继续使用“向量已写但DB未记随机docId”的无主窗口。仅核验实际workspace_documents、document_vectors与引擎可查询docId均存在才VERIFIED，不能把uploadToWorkspace的true/undefined当完整证明。清理以持久的旧代location+vector_doc_id定位，拒绝依据当前import的新location删除；provider无法核验残留则PENDING_CLEANUP并禁读。

## 9.11 v1.1 生命周期与目录窗口

meeting_imports为源身份行，补identity_key UNIQUE、workspace_id FK、active_generation nullable、current_generation Int default0；复合唯一键将可变workspace_slug替换为workspace_id。generation文档位置/向量ID以子表为权威，父表原document_location与hash如保留只能镜像active_generation，不独立更新。

import status：PENDING|FETCHING|STAGED|DOCUMENT_CREATED|ATTACHING|VERIFYING|VERIFIED|AUTH_REQUIRED|FAILED|BLOCKED_DRIFT|PENDING_CLEANUP|REVOKING|REMOVED|SUPERSEDED。REVOKE_PENDING_CLEANUP/CLEANUP_FAILED统一存PENDING_CLEANUP，由access_state/error_code区分。query status：ACCEPTED|RUNNING|RETRYING|SUCCEEDED|FAILED|AUTH_REQUIRED|BLOCKED。Query POST丢失job_id为BLOCKED+MGW_QUERY_RECOVERY_REQUIRED，不使用未定义RECOVERY_REQUIRED状态；确认Gateway幂等/关联能力前禁止自动重复POST。generation.state复用完整import状态集合。attempt stage：VALIDATE|FETCH|STAGE|DOCUMENT_CREATE|WORKSPACE_ATTACH|VERIFY|COMMIT|CLEANUP。枚举用String常量+显式校验以适配当前SQLite Prisma。

同身份键重提：VERIFIED先fresh鉴权再RETURN_EXISTING；在途返回原202且单lease；AUTH_REQUIRED返回401、本人重登后显式retry恢复；FAILED显式retry创建新generation前确认旧操作已补偿；BLOCKED_DRIFT返回409保留。REVOKING/PENDING_CLEANUP返回409 MGW_CLEANUP_IN_PROGRESS，不复活。REMOVED在fresh授权且旧代清理完成后原身份行generation+1、新operation/location/docId；SOURCE_REVOKED还需源权真实恢复。SUPERSEDED返回409提示退役，新source_version另立身份行，新版VERIFIED后旧版退役。重复delete REMOVED返回成功且零二次删除。

资产ID/source_version尚未从Gateway取得时，先建request/attempt，不预造identity_key；首页取得真实身份再reserve唯一import行，完整分页同版本后才提交。新版本提交/旧版本退役以本地事务切换active状态，旧版本异步清理仅删除自己generation；不可出现两个可检索活跃版本。

目录GET meetings分mode=window与mode=cache。window必传本人query_run_id，从服务端行取得[window_start,window_end)及connection_ref，浏览器不能覆盖。BFF遍历Gateway本人目录，按meeting.start_at落半开窗口过滤、按Gateway id去重，形成私有服务端快照；不按end_at归属。目录最多10,000项/20MiB，超限BLOCKED/MGW_LIMIT_EXCEEDED，不假complete。快照TTL60秒，随机游标引用绑定user/member/connection/query_run/snapshot/policy_epoch，每页重新鉴权；limit默认20最大100，invalid返回409重建，不混页。

仅关联run SUCCEEDED+complete且完整窗口快照数量0才显示“本次窗口无会议”。cache模式显式选取，显示“本地缓存目录”，不冒充该窗口实时查询。Gateway缺start_at/完整分页等契约为G0阻塞，不能用缓存猜测源结果。

## 9.12 v1.1 BFF补充与上限

- POST /api/meeting-gateway/workspaces {name} ->201 {workspace_id,slug,state:ACTIVE}；创建空受限空间+owner+policy为同事务。已有空间不能直接导入。
- POST /api/meeting-gateway/imports/:id/retry {} ->202 {import_id,generation,state}；按§9.11决策，不接受前端generation。
- DELETE session / DELETE binding见§9.8；GET meetings的字段是query parameters，不是body。window请求{mode,query_run_id,cursor?,limit?}，cache请求{mode,connection_ref,cursor?,limit?}。
- 单资源20MiB UTF-8、100,000段、2,000页；超限413 MGW_LIMIT_EXCEEDED，游标重复立即409 MGW_TRANSCRIPT_INCOMPLETE。每owner最多1在途源query、2个import Worker；超限429 Retry-After30秒。
- Gateway client普通timeout10秒、内容30秒、鉴权5秒，禁止HTTP自动redirect。轮询上限与操作重试独立；凭证deadline优先停止。
- 密码仅交互表单/TLS请求瞬时存在，禁止localStorage、自动填回、回显、日志和文档存储。OAuth state的授权URL传输例外见§18，不可把必要传输算泄露。
- Gateway字段、错误码、scope、Token交换路径必须来自固定SHA契约/脱敏真响应；尚未核实的契约为显式阻塞，不靠模拟测试升级为事实。

# 10. Requirement Unit

本章各 Req 按模板完整定义 Goal、Normative Requirement、Inputs、Preconditions、Authoritative State、State Transition、Allowed/Forbidden Side Effects、Ownership Scope、Idempotency、Failure Semantics、Postconditions、Invariants、Error Codes、Acceptance 和 Evidence。本文所有 `MUST` / `MUST NOT` 均处在有正反双 Acceptance 的 Requirement 中；附加禁止项由第22章覆盖。全部 Requirement 的实现阶段是 R1，无一声称已完成测试。

## REQ-CONF-001 — 双仓配置与连接器启动门禁

**交付阶段：**R1　　**Owner / 文件线索：**基础设施；AnythingLLM server/index.js + Gateway app/core/config.py

### Goal

在不接管腾讯应用配置的前提下，提供 AnythingLLM 到 Gateway 的受控服务器侧连接。

### Normative Requirement

1. MUST 以 AnythingLLM 独立配置 `MEETING_GATEWAY_BASE_URL`、`MEETING_GATEWAY_ENABLED`、`MEETING_BRIDGE_KEYRING_JSON` 和经管理员登记的内部客户端信息控制适配器；腾讯应用 AppID、AppSecret、Webhook Token 和 AESKey 只能存放在 Gateway 的 `.env`。
2. MUST 对 Gateway 地址执行 HTTPS/内网白名单校验、拒绝任意用户传入目标 URL；`MEETING_GATEWAY_ENABLED=false` 不注册新增连接/导入路由，但已有受限Workspace和受管文档门禁必须继续拒读；本地吊销/受控清理接口保持可用。
3. MUST NOT 将 Tencent OAuth Token、Gateway 上游登录密码或网关私有加密密钥写入 AnythingLLM 前端环境变量。

**规范条款映射：**上述每一条均由 A-CONF-001-01（正向契约）和 A-CONF-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- env 配置（AnythingLLM）
- 网关既有 `.env`
- Gateway 内部可达 HTTPS origin

### Preconditions

- PRE-CONF-001 管理员已核实服务间路由与 CA 证书
- PRE-CONF-002 不修改 Gateway OAuth 及 Webhook 端点

### Authoritative State

```text
SOT: Gateway 腾讯应用配置 = Gateway `.env`；AnythingLLM 适配器目标地址与加密键 = AnythingLLM `.env`；启动健康指标只作 Observed。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: DISABLED
Event: 启动服务并校验配置
After: ENABLED 或 CONFIG_BLOCKED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：读取环境变量；在 AnythingLLM 内存建立受限 Gateway HTTP 客户端；写入去标识化配置校验记录。

### Forbidden Side Effects

DENY：修改 Gateway `.env`、发布腾讯密钥、任意网络代理、调用 Backend 管理接口。

### Ownership Scope

FILE（新增连接器源代码）+ GENERATED_ONLY（配置摘要）；原 Gateway 配置归 Gateway 所有。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：相同配置重复启动不重复建密钥、不重写数据；禁用后路由访问返回 404。

### Failure Semantics

```yaml
failure_id: F-CONF-001
trigger: "连接地址不可达或配置不完整"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "零业务 DB 写；启动阻断连接器模块、其他 AnythingLLM 功能继续可用。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-CONF-001 暴露仅 server-side 的受控 Gateway client；POST-CONF-002 不暴露腾讯 Secret。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-CONF-001 secret 不进 browser bundle；INV-CONF-002 禁用时0新Gateway业务请求、已有受限读取仍拒绝。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_CONFIG_INVALID`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-CONF-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-CONF-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-CONF-001-01`、`TEST-A-CONF-001-02`。
- required artifacts: `EVID-A-CONF-001-01.json`、`EVID-A-CONF-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-IDENT-001 — AnythingLLM 用户与网关身份绑定

**交付阶段：**R1　　**Owner / 文件线索：**身份；AnythingLLM server/models/workspaceUsers.js + Gateway app/services/identity_service.py

### Goal

使每个 AnythingLLM 本地用户只能绑定自己通过 Gateway 登录验证的员工身份。

### Normative Requirement

1. MUST 通过用户主动提交的 Gateway 登录响应签发绑定记录 `(anything_user_id, gateway_org_id, gateway_member_id)`，以会话真实 `anything_user_id` 为 Owner，不接受前端提交的 owner/member_id。
2. MUST 保存绑定建立时间、最近验证时间、身份版本/失效状态；同一个 AnythingLLM 用户切换绑定要先撤销旧的私有会话，不自动迁移旧会议资料。
3. MUST NOT 因拥有 AnythingLLM 管理员角色而获得其他员工的 Gateway OAuth 连接。

4. MUST 同时满足v1.1 §9.8的确定性合同，新增验收 A-REV-003-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-IDENT-001-01（正向契约）和 A-IDENT-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- AnythingLLM 经签名验证的用户 Session
- Gateway account-login 成功响应 data.user.member_id/org_id
- 旧映射（可空）

### Preconditions

- PRE-IDENT-001 AnythingLLM 多用户登录已启用
- PRE-IDENT-002 Gateway 账号登录由用户本人触发

### Authoritative State

```text
SOT: AnythingLLM user_id = 本地身份源；Gateway member_id/org_id = Gateway 登录响应；映射 = AnythingLLM 新表。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: UNBOUND
Event: 绑定本人真实 Gateway 会话
After: BOUND（本地复合键）
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：写用户映射与审计事件、撤销同用户旧 BFF 令牌。

### Forbidden Side Effects

DENY：写 Gateway LocalMember、猜测 member_id、改变已有 Workspace 的读者名单。

### Ownership Scope

ROW（`meeting_gateway_bindings`，anything_user_id 主键）；不可替代 Gateway LocalMember。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：相同 user/org/member 绑定重试保持一行；冲突 user/member 返回 409 且旧绑定不变。

### Failure Semantics

```yaml
failure_id: F-IDENT-001
trigger: "另一用户试图指定同一绑定的 `anything_user_id` 或伪造 member_id"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "事务原子回滚，原绑定保留。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-IDENT-001 映射满足 `current_user.id` 绑定；POST-IDENT-002 不生成共享身份。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-IDENT-001 每条绑定唯一 Owner；INV-IDENT-002 授权用户与导入用户一致。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_IDENTITY_BINDING_CONFLICT`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-IDENT-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-IDENT-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-IDENT-001-01`、`TEST-A-IDENT-001-02`。
- required artifacts: `EVID-A-IDENT-001-01.json`、`EVID-A-IDENT-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-AUTH-001 — 经 Gateway 的账号密码验证与短会话

**交付阶段：**R1　　**Owner / 文件线索：**鉴权；Gateway app/api/identity.py + app/integrations/nodeskclaw_backend/client.py

### Goal

AnythingLLM 在本地用户操作时通过 Gateway 完成内部身份登录，不触碰 Backend 额外接口。

### Normative Requirement

1. MUST 新增服务端 `POST /api/meeting-gateway/session` 接收一次性 `account,password`，仅由 AnythingLLM BFF 通过 `POST Gateway /api/v1/auth/account-login` 转发，验证 `code=0`、`ms_` 和 Gateway 组织；不把上游 Backend JWT、密码或 `ms_` 返回浏览器。
2. MUST 将 `ms_` 与 Gateway REST `mt_`（如已兑换）以 AES-256-GCM 加密、按§9.8 Bearer/User/bridge隔离，生存期取 Gateway 声明的过期时间，默认不超过 900 秒；最早deadline及本地身份机制按§9.8。
3. MUST NOT 在日志、报错、Telemetry、前端状态、URL 或 AnythingLLM 文档中记录密码/Token。

4. MUST 同时满足v1.1 §9.8的确定性合同，新增验收 A-REV-003-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-AUTH-001-01（正向契约）和 A-AUTH-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- account/password（交互表单）
- AnythingLLM Bearer JWT + opaque bridge Cookie（§9.8）
- Gateway data.session_token、org_id、user.member_id

### Preconditions

- PRE-AUTH-001 BFF 已经通过 AnythingLLM Session 鉴别用户
- PRE-AUTH-002 代理仅连接允许的 Gateway

### Authoritative State

```text
SOT: Gateway 内部会话是登录验证事实源；AnythingLLM 会话库仅缓存有时限的加密副本。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: NO_GATEWAY_SESSION
Event: 成功调用 account-login
After: GATEWAY_SESSION_ACTIVE，expires_at <= upstream Expire
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：Gateway 唯一 account-login 网络调用、加密 BFF Session、审计元信息。

### Forbidden Side Effects

DENY：直接调用 Backend、存储密码、向浏览器转发 `ms_`、记录原始登录响应。

### Ownership Scope

ROW（本地加密凭证记录）+ NONE（密码）；网关 Token Owner=Gateway。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：同浏览器重复登录轮换该bridge并吊销旧bridge；其他浏览器独立，见§9.8。

### Failure Semantics

```yaml
failure_id: F-AUTH-001
trigger: "Gateway 返回 code!=0、密码错误、超时或用户 org 不匹配"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "0 身份绑定变更、0 token 明文持久化；可明确重试（人工重新提交）。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-AUTH-001 用户会话有明确过期；POST-AUTH-002 密码不会保留。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-AUTH-001 Gateway JWT 不作为业务 Token；INV-AUTH-002 用户会话与 AnythingLLM 登录上下文绑定。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_LOGIN_REJECTED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-AUTH-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-AUTH-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-AUTH-001-01`、`TEST-A-AUTH-001-02`。
- required artifacts: `EVID-A-AUTH-001-01.json`、`EVID-A-AUTH-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-AUTH-002 — 业务令牌交换与权限上限

**交付阶段：**R1　　**Owner / 文件线索：**鉴权；Gateway app/api/portal.py + app/services/auth_service.py

### Goal

从 Gateway 员工会话获取仅具会议读取范围的业务 Token，禁止共享管理员业务令牌。

### Normative Requirement

1. MUST 首选 `POST Gateway /api/v1/portal/session`（需合法 `PORTAL` client 与 `meeting.read`/`meeting.content.read` 授权），若其未通过仅允许显式配置的 `POST Gateway /api/v1/auth/exchange`、已登记内部客户端、`subject_token=ms_`、`resource=REST_RESOURCE_URI` 和请求最小 Scope。
2. MUST 在每次业务调用时检查 `mt_` 的过期和当前 AnythingLLM 用户关联，过期时要求本人重新通过 Gateway 登录，禁止以服务级 Token 代替员工读取 OAuth 会议。
3. MUST NOT 用网关 `ms_` 直接调用业务端点、用 `mt_` 当腾讯 Access Token 或绕过 `meeting.content.read`。

**规范条款映射：**上述每一条均由 A-AUTH-002-01（正向契约）和 A-AUTH-002-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- Gateway ms_session
- portal/session 或内部客户端凭据
- Gateway mt_token+scope+expires_in

### Preconditions

- PRE-AUTH-003 ms_session 有效
- PRE-AUTH-004 门禁配置存在私有客户端注册和权限

### Authoritative State

```text
SOT: Gateway 的业务令牌与 action ceiling = Auth authoritative；AnythingLLM 只缓存加密副本及最短 TTL。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: SESSION_ACTIVE
Event: REST Token 兑换成功
After: REST_AUTHORIZED（或 PERMISSION_BLOCKED）
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：网关 session/exchange API 调用、加密令牌替换。

### Forbidden Side Effects

DENY：重新配置 Gateway Client 权限、接受前端指定 Token Owner、升高 Scope。

### Ownership Scope

ROW（用户 BFF Token cache）+ NONE（Gateway 授权政策）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：重复调用先复用未过期且同用户令牌；失败不重复提交 Gateway 密码。

### Failure Semantics

```yaml
failure_id: F-AUTH-002
trigger: "PORTAL client 未初始化、无 meeting.read 或身份会话到期"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "保留未过期源映射，禁止下一步 OAuth/会议调用。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-AUTH-003 REST_TOKEN 仅作用于本网关 REST audience。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-AUTH-003 `access_token` 绝不暴露给浏览器；INV-AUTH-004 不提升原 Gateway 权限。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_BUSINESS_AUTH_REQUIRED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-AUTH-002-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-AUTH-002-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-AUTH-002-01`、`TEST-A-AUTH-002-02`。
- required artifacts: `EVID-A-AUTH-002-01.json`、`EVID-A-AUTH-002-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-OAUTH-001 — 授权状态查询和首次引导

**交付阶段：**R1　　**Owner / 文件线索：**OAuth；Gateway app/api/business.py + app/services/portal_service.py

### Goal

在 AnythingLLM Meetings 页面准确区分未授权、已授权和授权失效，避免每次重复弹窗。

### Normative Requirement

1. MUST 通过用户自身 Gateway REST Token 请求 `/api/v1/me/connections`，仅以相同 gateway_member_id 的 `THIRD_PARTY_OAUTH` 连接作为本用户可选连接；只有 `ACTIVE` 才允许进入会议查询动作。
2. MUST 对 `PENDING_CONFIRMATION`、`CORP_MISMATCH`、`REAUTH_REQUIRED` 或缺少连接显示独立的下一步操作；不得把 Webhook 已保存、Gateway HTTP 202 或 Token 存在当作 ACTIVE。
3. MUST NOT 在 AnythingLLM 本地缓存中伪造 ACTIVE 状态。

**规范条款映射：**上述每一条均由 A-OAUTH-001-01（正向契约）和 A-OAUTH-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- 当前用户 Gateway mt_
- GET /api/v1/me/connections
- 本地 connection cache（短暂观察值）

### Preconditions

- PRE-OAUTH-001 当前用户绑定且业务 Token 有效

### Authoritative State

```text
SOT: Gateway Connection.status = Authority；AnythingLLM 连接状态 = Observed cache。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: NOT_CONNECTED
Event: 拉取网关连接列表
After: ACTIVE | PENDING_CONFIRMATION | CORP_MISMATCH | REAUTH_REQUIRED | NOT_CONNECTED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：状态缓存 TTL 30 秒及脱敏审计；显示连接入口。

### Forbidden Side Effects

DENY：直接修改 Gateway connection.status、跨用户列出连接。

### Ownership Scope

ROW（本地观察缓存）+ NONE（腾讯 Token/连接真值）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：30 秒内重复 GET 可以复用同用户观察缓存；关键导入操作前强制新鲜查询。

### Failure Semantics

```yaml
failure_id: F-OAUTH-001
trigger: "Gateway 查询失败/401"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "标记 UNKNOWN，不保留“已连接”可操作状态。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-OAUTH-001 UI 各状态有确定文案与动作。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-OAUTH-001 非 ACTIVE 不可发起内容读取。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_CONNECTION_UNAVAILABLE`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-OAUTH-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-OAUTH-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-OAUTH-001-01`、`TEST-A-OAUTH-001-02`。
- required artifacts: `EVID-A-OAUTH-001-01.json`、`EVID-A-OAUTH-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-OAUTH-002 — 浏览器 OAuth 授权发起和安全回跳

**交付阶段：**R1　　**Owner / 文件线索：**OAuth；Gateway app/services/connection_service.py + app/callbacks/router.py

### Goal

用户在 AnythingLLM 点击连接后获得属于本人会话的腾讯授权地址，走真实浏览器 Consent。

### Normative Requirement

1. MUST 新增 BFF `POST /api/meeting-gateway/oauth/start`，使用当前人的 `mt_` 调用 `POST Gateway /api/v1/oauth/authorizations`，缺省请求体 `{}` 选中 ENV 默认应用；把 Gateway 返回 `authorization_url` 作为一次性浏览器跳转目标。
2. MUST 严格校验跳转目标为 `https://meeting.tencent.com/` 规定授权入口、`sdk_id=33510141629`、`redirect_uri=https://copilot.superic.com:9999/callbacks/tencent/oauth/33510141629`，服务端保存 `transaction_id` 与 AnythingLLM userId 的绑定/截止时间。
3. MUST NOT 自己生成/存储腾讯 `state`、`auth_code`，也不得将 `return_to` 设置为未列入 Gateway `.env` 精确白名单的 URL；R1 缺省 `return_to=null`，用户在网关结果页后回到 AnythingLLM 并刷新授权状态。

4. MUST 同时满足v1.1 §9.8及§18的确定性合同，新增验收 A-REV-008-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-OAUTH-002-01（正向契约）和 A-OAUTH-002-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- 当前用户有效 Gateway mt_
- POST Gateway OAuth authorizations
- authorization_url/transaction_id/expires_at

### Preconditions

- PRE-OAUTH-002 无有效 ACTIVE 或显式点击重新授权
- PRE-OAUTH-003 网关回调域名公网 HTTPS 正常

### Authoritative State

```text
SOT: Gateway AuthTransaction 是 state 源；AnythingLLM transaction_id = 对应用户的短期 UX 观察。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: NOT_CONNECTED 或 REAUTH_REQUIRED
Event: 用户点击连接
After: WAITING_BROWSER_CONSENT
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：为当前用户保存一次授权尝试不含 state 的追踪；返回校验后的授权 URL。

### Forbidden Side Effects

DENY：修改网关 OAuth state、拼接任意 redirect_uri、发起第三方开放重定向。

### Ownership Scope

ROW（前端 UX pending state）+ NONE（腾讯 OAuth grant）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：重复点击只允许一次在途授权；过期可重新生成新事务。

### Failure Semantics

```yaml
failure_id: F-OAUTH-002
trigger: "URL 的 sdk_id/redirect_uri 不匹配或浏览器取消"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "不打开外部链接/状态转 AUTH_REQUIRED；事务到期由网关终止。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-OAUTH-002 腾讯授权页面由 Gateway 生成地址触发，非伪造。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-OAUTH-002 仅校验过的腾讯 URL 可跳转；INV-OAUTH-003 不记录 state。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_OAUTH_START_REJECTED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-OAUTH-002-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-OAUTH-002-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-OAUTH-002-01`、`TEST-A-OAUTH-002-02`。
- required artifacts: `EVID-A-OAUTH-002-01.json`、`EVID-A-OAUTH-002-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-OAUTH-003 — OAuth 回调后确认连接并绑定用户

**交付阶段：**R1　　**Owner / 文件线索：**OAuth；Gateway app/services/connection_service.py + app/api/business.py

### Goal

腾讯完成真实授权后，原发起员工经 Gateway 确认与其自己的 open_id 绑定。

### Normative Requirement

1. MUST 让腾讯直接回调 Gateway 数字路径；AnythingLLM 不接收或兑换 `auth_code`；在网关默认结果页提示用户返回 AnythingLLM 页面，调用当前员工 `/me/connections` 查找 `PENDING_CONFIRMATION`。
2. MUST 仅允许授权前登记的当前 AnythingLLM 用户通过自己 `mt_` 对自己连接调用 `POST /api/v1/connections/{id}/confirm`，成功后重新拉取网关状态确认 ACTIVE。
3. MUST NOT 在 `CORP_MISMATCH`、connection_id 非当前 Gateway member、OAuth Token 不可用时自动确认或放宽 `allowed_open_corp_ids`。

**规范条款映射：**上述每一条均由 A-OAUTH-003-01（正向契约）和 A-OAUTH-003-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- 网关受控回调结果
- 当前用户 Connection 列表
- 网关 connection_id
- 用户同意确认动作

### Preconditions

- PRE-OAUTH-004 真实授权已经通过网关 state/Token
- PRE-OAUTH-005 当前会话持有匹配 Gateway 员工业务令牌

### Authoritative State

```text
SOT: Gateway Connection 的状态与绑定 = Authoritative；本地 UI 只观察。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: WAITING_BROWSER_CONSENT
Event: 用户返回并点击确认（或者已 ACTIVE 则不再提交）
After: ACTIVE / CORP_MISMATCH / FAILED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：当前用户 confirm API、状态刷新与前端通知。

### Forbidden Side Effects

DENY：接收腾讯 OAuth Token、改 Gateway 白名单、确认其他员工连接。

### Ownership Scope

ROW（仅本地 UX 状态）+ NONE（Gateway 授权记录）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：已 ACTIVE 再进入页面只读状态，不重复 POST confirm；未授权重试始终新 OAuth state。

### Failure Semantics

```yaml
failure_id: F-OAUTH-003
trigger: "返回 CORP_MISMATCH、403 或 Gateway 令牌失效"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "本地维持未连接/阻塞，不创建会议查询。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-OAUTH-003 同一用户确认后在 Gateway REST 中状态为 ACTIVE。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-OAUTH-004 本地状态只能下修不能冒充 Gateway ACTIVE。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_OAUTH_CONFIRM_DENIED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-OAUTH-003-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-OAUTH-003-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-OAUTH-003-01`、`TEST-A-OAUTH-003-02`。
- required artifacts: `EVID-A-OAUTH-003-01.json`、`EVID-A-OAUTH-003-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-UI-001 — Meetings 连接状态与入口页面

**交付阶段：**R1　　**Owner / 文件线索：**页面；AnythingLLM frontend/src/App.jsx + src routes + server/index.js

### Goal

让用户能明确看见连接、授权和查询的真实进度，不被无关 Workspace UI 隐藏。

### Normative Requirement

1. MUST 在 AnythingLLM 左侧导航新增独立 `Meetings` 页面，含“连接状态”、“连接腾讯会议”、“重新授权”、“我的会议”、“导入历史”、“导入记录”入口；根据本人 Gateway 状态显示可操作动作。
2. MUST 为 OAuth 未连接、浏览器授权中、待确认、ACTIVE、CORP_MISMATCH、业务 Token 失效及网络失败分别显示文案和恢复按钮；按钮仅调用自身 BFF。
3. MUST NOT 让页面访问 Gateway 公网回调 URL 作为业务查询接口或把公司应用密钥下发浏览器。

**规范条款映射：**上述每一条均由 A-UI-001-01（正向契约）和 A-UI-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- AnythingLLM Session
- Gateway 状态 DTO
- 本地 UX 状态

### Preconditions

- PRE-UI-001 登录用户可访问 Meetings

### Authoritative State

```text
SOT: Gateway 授权/内容状态 = Gateway；界面 state 仅临时显示。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: PAGE_IDLE
Event: 用户进入或操作
After: DISPLAY(status,actions)
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：导航、前端组件、BFF 调用与 loading 状态。

### Forbidden Side Effects

DENY：改变Compare/Translation语义及普通Workspace聊天语义；受限Workspace既有读取路径必须增加本PRD门禁。

### Ownership Scope

FILE（新增前端 Meetings 组件与注册路由），原页面 USER_OWNED。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：重复进入不触发第二次 OAuth；刷新从 BFF 恢复原状态。

### Failure Semantics

```yaml
failure_id: F-UI-001
trigger: "前端与 BFF 断线或用户刷新"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "显示不可用与重试，不误显示授权成功。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-UI-001 用户在一个页面完成连接状态到会议入口。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-UI-001 所有响应不包含 Tencent AppSecret/Token。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_UI_UNAVAILABLE`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-UI-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-UI-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-UI-001-01`、`TEST-A-UI-001-02`。
- required artifacts: `EVID-A-UI-001-01.json`、`EVID-A-UI-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-SOURCE-001 — 用户限定的会议源查询

**交付阶段：**R1　　**Owner / 文件线索：**会议发现；Gateway app/services/query_service.py + app/schemas/requests.py

### Goal

主动从腾讯会议查询用户自己的历史会议，而不是把本地缓存当作实时源。

### Normative Requirement

1. MUST 调用 `POST Gateway /api/v1/meeting-queries`，只使用 `selection=USER_WINDOW`、本人的 `connection_ref` 和 Gateway 真实 `target_member_id`，带有时区的起止时间；UI 默认窗口为当前时间向前 7 天至当前时间，单次请求最长 90 天。
2. MUST 把 HTTP 202 与 `job_id` 标为 ACCEPTED 而非 SUCCESS；开始查询前验证 Gateway Connection ACTIVE 和 `meeting.read`。
3. MUST NOT 发起 `CORP_WINDOW`、不使用腾讯个人会议号代替 `meeting_id`、不允许前端指定他人的 target_member_id。

**规范条款映射：**上述每一条均由 A-SOURCE-001-01（正向契约）和 A-SOURCE-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- Gateway current member_id
- selected connection_ref
- start_at/end_at AwareDatetime

### Preconditions

- PRE-SOURCE-001 ACTIVE OAuth
- PRE-SOURCE-002 当前 REST Token 含 meeting.read

### Authoritative State

```text
SOT: Gateway SOURCE_QUERY 作业与上游响应 = Authoritative；AnythingLLM 查询记录 = Mirror。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: NOT_QUERIED
Event: 提交 USER_WINDOW
After: ACCEPTED（job_id）
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：POST 网关源查询、写本地 query_run 与审计。

### Forbidden Side Effects

DENY：读取其他用户历史、向腾讯直接发请求、仅据 HTTP 202 写入成功会议。

### Ownership Scope

ROW（local query_run）+ NONE（Gateway job）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：短期重复相同 user/connection/window 以本地幂等 key 复用在途 job_id，不重复轰炸腾讯。

### Failure Semantics

```yaml
failure_id: F-SOURCE-001
trigger: "Gateway 返回 401/403/409/429、时区不合法"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "未提交查询状态，保留原会议列表，显示错误来源。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-SOURCE-001 用户可见作业 id 与窗口、完成前不显示新数据。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-SOURCE-001 Gateway user/member/connection 三者一致。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_SOURCE_QUERY_REJECTED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-SOURCE-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-SOURCE-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-SOURCE-001-01`、`TEST-A-SOURCE-001-02`。
- required artifacts: `EVID-A-SOURCE-001-01.json`、`EVID-A-SOURCE-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-SOURCE-002 — 异步任务轮询与 RETRYING 诊断

**交付阶段：**R1　　**Owner / 文件线索：**会议发现；Gateway app/services/job_service.py + 当前历史真实联调 RETRYING

### Goal

准确报告 Gateway Worker 实际进度，并保留已有 RETRYING 故障证据。

### Normative Requirement

1. MUST 对网关 `GET /api/v1/jobs/{job_id}` 进行受限轮询，按网关状态 PENDING/RUNNING/RETRYING/SUCCEEDED/FAILED 或实际状态枚举映射本地 UI；只有可证明的 SUCCEEDED 与 `progress.complete=true` 才视为数据源查询完成。
2. MUST 对 RETRYING 展示经Gateway固定契约确认的attempts、last_reason、next_run_at、trace_id等安全字段，隔离上游 429/限额/契约/网络/权限；在持续 RETRYING 时保持“查询中/失败待处理”，不得展示“无会议”。
3. MUST NOT 为通过验收伪造 Tencent 响应、强行改网关作业为 SUCCEEDED、无限热循环轮询。

**规范条款映射：**上述每一条均由 A-SOURCE-002-01（正向契约）和 A-SOURCE-002-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- owner query_run.job_id
- Gateway GET jobs 返回
- 安全诊断字段

### Preconditions

- PRE-SOURCE-003 job_id 与用户/connection 绑定

### Authoritative State

```text
SOT: Gateway Job.state/progress/last_reason = Authoritative；UI 轮询为 Observed。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: ACCEPTED
Event: 轮询/Worker 更新
After: RUNNING | RETRYING | SUCCEEDED | FAILED | REAUTH_REQUIRED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：按指数退避轮询；写进度/脱敏 last_reason；用户明确重试。

### Forbidden Side Effects

DENY：修改网关 job、绕过 API 从 DB 人为置成功、重放过期 token。

### Ownership Scope

ROW（local query_run status mirror）+ NONE（Gateway job）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：轮询 2s→4s→8s→最多 30s，单页面最多 5 分钟自动刷新，超过显示“后台处理中”并可手工刷新；禁止重复提交相同作业。

### Failure Semantics

```yaml
failure_id: F-SOURCE-002
trigger: "job RETRYING 超过 5 分钟、last_reason 为空或服务端异常"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "保留诊断、不给空集合承诺；允许人工继续查看。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-SOURCE-002 可审计判断 upstream 已运行还是仅受理。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-SOURCE-002 202 与 RETRYING 不等于 SUCCEEDED。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_QUERY_INCOMPLETE`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-SOURCE-002-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-SOURCE-002-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-SOURCE-002-01`、`TEST-A-SOURCE-002-02`。
- required artifacts: `EVID-A-SOURCE-002-01.json`、`EVID-A-SOURCE-002-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-SOURCE-003 — 会议列表的网关分页及覆盖标注

**交付阶段：**R1　　**Owner / 文件线索：**会议发现；Gateway app/services/meeting_service.py + app/api/business.py

### Goal

读取已经由 Gateway 从腾讯同步的可见会议，展示来源覆盖程度。

### Normative Requirement

1. MUST 在源查询完成或用户主动查看缓存时调用 `GET Gateway /api/v1/meetings?connection_ref={own}&limit=20`，完整遵循 `next_cursor`，最大每次 100 条；使用返回的 Gateway 内部 `id` 进行后续详情读取。
2. MUST 展示 `catalogue_as_of`、`coverage_is_partial` 和 `sync_coverage`，对内容尚未被真实源查询覆盖的窗口标“未核对”。
3. MUST NOT 用 `meeting_code`、腾讯 external meeting_id 或其他用户 connection_ref 构造 `GET /meetings/{meeting_id}`。

4. MUST 同时满足v1.1 §9.11的确定性合同，新增验收 A-REV-007-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-SOURCE-003-01（正向契约）和 A-SOURCE-003-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- Gateway mt_
- own connection_ref
- next_cursor
- Gateway meeting list items

### Preconditions

- PRE-SOURCE-004 meeting.read 授权

### Authoritative State

```text
SOT: Gateway Meetings DB 与权限过滤为事实源；AnythingLLM Meeting Card 是只读 mirror。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: LIST_EMPTY
Event: 分页 GET
After: LIST_PARTIAL | LIST_COMPLETE（对已同步本地目录而言）
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：读取列表、缓存本人元数据（TTL 60s）；写本地观察进度。

### Forbidden Side Effects

DENY：更改网关 Meeting、混入跨用户记录、忽略 coverage_is_partial。

### Ownership Scope

ROW（列表 UI 缓存）+ NONE（Gateway 资源）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：同一 cursor 请求返回同一页时不重复建立会议映射；Cursor Invalid 时清空仅观察缓存并重启第一页。

### Failure Semantics

```yaml
failure_id: F-SOURCE-003
trigger: "cursor 失效、策略变化、网关返回下一页异常"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "不返回拼接错误的列表，原导入状态保持。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-SOURCE-003 页面展示有访问权限的 Gateway IDs 与覆盖标记。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-SOURCE-003 cursor 按用户和 query 隔离。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_LIST_CURSOR_INVALID`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-SOURCE-003-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-SOURCE-003-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-SOURCE-003-01`、`TEST-A-SOURCE-003-02`。
- required artifacts: `EVID-A-SOURCE-003-01.json`、`EVID-A-SOURCE-003-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-SOURCE-004 — 会议详情与录制元数据发现

**交付阶段：**R1　　**Owner / 文件线索：**会议发现；Gateway app/services/meeting_service.py + app/api/business.py

### Goal

从 Gateway 内部 meeting_id 打开会议详情，并在必要时触发录制查询。

### Normative Requirement

1. MUST 基于从 `/api/v1/meetings` 获得的 Gateway `id` 调用 `GET /api/v1/meetings/{id}?fetch=cache`、`GET /api/v1/meetings/{id}/recordings?fetch=ensure`，若返回 HTTP 202 按作业轮询后再次读取。
2. MUST 以录制列表返回的 Gateway recording `id` 而不是 Tencent record_file_id 调用内容 API；对无录制会议展示无可导入资源。
3. MUST NOT 把仅有历史会议元数据伪装成“已有完整转写/纪要”。

**规范条款映射：**上述每一条均由 A-SOURCE-004-01（正向契约）和 A-SOURCE-004-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- gateway_meeting_id
- Gateway recordings items
- content asset summary

### Preconditions

- PRE-SOURCE-005 当前 user 对会议 meeting.read 授权

### Authoritative State

```text
SOT: Gateway Meeting/Recording/Asset 关系 = Authority。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: MEETING_SELECTED
Event: 加载详情及录制
After: METADATA_READY / FETCH_PENDING / NO_RECORDING
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：GET 内容元信息、必要时排队 Gateway 查询；写本地详情只读缓存。

### Forbidden Side Effects

DENY：直接下载媒体、用 record_file_id 猜测 recording_id。

### Ownership Scope

ROW（详情 cache）+ NONE（源会议）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：重复点详情复用同一进行中录制查询；空列表展示实际“无可用录制”。

### Failure Semantics

```yaml
failure_id: F-SOURCE-004
trigger: "网关 202 未完成、无录制、metadata 404"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "明确标状态，不自动导入空内容。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-SOURCE-004 详情关联 Gateway recording_id，可触发正文读取。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-SOURCE-004 只有真实 READY 内容可导入。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_RECORDING_NOT_READY`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-SOURCE-004-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-SOURCE-004-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-SOURCE-004-01`、`TEST-A-SOURCE-004-02`。
- required artifacts: `EVID-A-SOURCE-004-01.json`、`EVID-A-SOURCE-004-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-CONTENT-001 — 完整转写分页收集与原文保真

**交付阶段：**R1　　**Owner / 文件线索：**内容；Gateway app/services/content_service.py + app/api/business.py

### Goal

收齐腾讯会议原生转写并保留原始顺序、段落及可追溯标识。

### Normative Requirement

1. MUST 使用 `GET /api/v1/recordings/{id}/transcript?fetch=ensure&limit=100`；202 时轮询 job 并重试；READY 后按 `next_cursor` 遍历至 null，拼接原始 `paragraphs`，校验内容版本/asset ID 跨页不变。
2. MUST 在文本转换时保留发言人、原段落索引、时间戳和可提供的内容源标识；不得以 LLM 重新生成的内容代替转写原文。
3. MUST NOT 在分页失败、中断、cursor invalid 或内容版本切换时把部分段落标记为 COMPLETE。

**规范条款映射：**上述每一条均由 A-CONTENT-001-01（正向契约）和 A-CONTENT-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- Gateway recording_id
- Transcript response.content.paragraphs
- next_cursor
- asset id/version

### Preconditions

- PRE-CONTENT-001 meeting.content.read 权限
- PRE-CONTENT-002 有录制资源

### Authoritative State

```text
SOT: Gateway Asset 状态/version + 完整分页源；本地 staging 是 UNVERIFIED。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: CONTENT_ABSENT
Event: ensure+分页收齐
After: STAGED_COMPLETE 或 STAGED_INCOMPLETE
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：读取本人转写；写有时间限制的私有 staging；保存 SHA。

### Forbidden Side Effects

DENY：在未完成时调用 AnythingLLM 文档导入、任意重新排序原文。

### Ownership Scope

GENERATED_ONLY（临时 staging）+ NONE（Gateway Asset）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：相同录制与版本重复收集 hash 一致、复用已完成 staging；版本变更抛弃旧 staging 重拉。

### Failure Semantics

```yaml
failure_id: F-CONTENT-001
trigger: "第 N 页 403/409、cursor INVALID、段落版本漂移"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "删除/隔离 staging，不生成可见 doc；用户可重新拉取。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-CONTENT-001 paragraph_count 与原来一致且次序稳定。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-CONTENT-001 仅完整、同版本的转写可入库。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_TRANSCRIPT_INCOMPLETE`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-CONTENT-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-CONTENT-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-CONTENT-001-01`、`TEST-A-CONTENT-001-02`。
- required artifacts: `EVID-A-CONTENT-001-01.json`、`EVID-A-CONTENT-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-CONTENT-002 — 腾讯原生智能纪要提取

**交付阶段：**R1　　**Owner / 文件线索：**内容；Gateway app/services/content_service.py

### Goal

只引入 Tencent Gateway 返回的原生 minutes，而非 AnythingLLM 现场再摘要替代。

### Normative Requirement

1. MUST 调用 `GET /api/v1/recordings/{id}/minutes?fetch=ensure`，等待 Gateway READY；将原生结构保留为源数据，另外格式化 Markdown 供向量化。
2. MUST 明确区分 CONTENT_NOT_READY、NO_MINUTES、AUTH_DENIED、UPSTREAM_UNAVAILABLE；允许仅转写或仅纪要独立导入，不让其中一项失败改写另一项。
3. MUST NOT 以空 todo 判定腾讯纪要失败，不得把自行生成总结标为 Tencent 原生纪要。

**规范条款映射：**上述每一条均由 A-CONTENT-002-01（正向契约）和 A-CONTENT-002-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- Gateway recording_id
- Gateway minutes content JSON
- asset version

### Preconditions

- PRE-CONTENT-003 meeting.content.read
- PRE-CONTENT-004 纪要资源可存在

### Authoritative State

```text
SOT: Gateway native minutes content = Authority；本地 markdown 是派生版本。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: MINUTES_UNKNOWN
Event: ensure→READY/NOT_READY
After: MINUTES_READY / MINUTES_MISSING
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：GET minutes、保存结构化 staging 与内容摘要。

### Forbidden Side Effects

DENY：写回 Gateway、将 LLM 输出标原生、偷换 minutes 类型。

### Ownership Scope

GENERATED_ONLY（staging）+ NONE（native minutes）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：相同 asset_version 再取 hash 一致、默认跳过重复上传。

### Failure Semantics

```yaml
failure_id: F-CONTENT-002
trigger: "没有纪要/腾讯未生成"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "该资源显示未可用，转写资源仍可单独处理。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-CONTENT-002 导入结果的 provenance 明确为 Tencent native minutes。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-CONTENT-002 无伪造 minutes；空 todo 不等于缺失。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_MINUTES_UNAVAILABLE`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-CONTENT-002-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-CONTENT-002-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-CONTENT-002-01`、`TEST-A-CONTENT-002-02`。
- required artifacts: `EVID-A-CONTENT-002-01.json`、`EVID-A-CONTENT-002-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-FORMAT-001 — 可确定的会议文档标准化格式

**交付阶段：**R1　　**Owner / 文件线索：**内容；AnythingLLM collector/processRawText/index.js（复用下游）

### Goal

将 Gateway 内容转换为任何后续系统都可识别、可审计的标准 Markdown。

### Normative Requirement

1. MUST 对转写与纪要分别生成独立 Markdown 文档，头部包括 Gateway 会议 ID、录制 ID、asset ID、内容版本、来源、用户绑定、UTC 时间和 content hash；正文字段按确定顺序输出。
2. MUST 对所有来源文本以纯文本/转义后 Markdown 处理、统一 NFC 字符和 LF 换行，原始段落顺序保留，时间统一 ISO-8601；不得把来源正文中的指令当作系统命令。
3. MUST NOT 在默认 Formatter 中执行 LLM 改写、OA 任务创建或在线文档翻译。

4. MUST 同时满足v1.1 §9.10的确定性合同，新增验收 A-REV-006-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-FORMAT-001-01（正向契约）和 A-FORMAT-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- verified transcript/minutes
- Gateway metadata
- format_spec_version=v1

### Preconditions

- PRE-FORMAT-001 staging.complete=true
- PRE-FORMAT-002 已验证来源权限

### Authoritative State

```text
SOT: Gateway 内容是事实；formatter 输出是派生内容（可重建）。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: STAGED_COMPLETE
Event: deterministic formatter
After: MARKDOWN_READY
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：在本地私有 staging 生成 Markdown 和归一化摘要。

### Forbidden Side Effects

DENY：修改原始 Gateway JSON、执行嵌入指令、写 OA。

### Ownership Scope

GENERATED_ONLY（Markdown 文件）；用户在 Workspace 修改的文档属于 USER_OWNED。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：同输入 + 同版本 formatter 生成字节完全一致；源变化触发新版本。

### Failure Semantics

```yaml
failure_id: F-FORMAT-001
trigger: "invalid UTF-8 或结构损坏"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "丢弃派生稿，不导入 Knowledge。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-FORMAT-001 已保存原文及派生文字之间的 provenance。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-FORMAT-001 Formatter 0 外部网络调用。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_FORMAT_INVALID`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-FORMAT-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-FORMAT-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-FORMAT-001-01`、`TEST-A-FORMAT-001-02`。
- required artifacts: `EVID-A-FORMAT-001-01.json`、`EVID-A-FORMAT-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-IMPORT-001 — 调用 AnythingLLM 原始文本管道导入

**交付阶段：**R1　　**Owner / 文件线索：**文档入库；AnythingLLM server/endpoints/api/document/index.js + server/models/documents.js

### Goal

将单份真实 Gateway 转写或纪要复用 AnythingLLM 已有 Collector 与文档系统持久化。

### Normative Requirement

1. MUST 在服务器授权后调用§9.10拟新增processManagedRawText，复用原文处理格式、传textContent和非空metadata.title；先持久operation/generation后调用。仅实际operation COMMITTED且返回真实location才DOCUMENT_CREATED。
2. MUST 展示metadata仅白名单；受管内部接口另传可信operation/provenance并存私有journal，详见§9.10。源asset/member精确字段存导入表，不向picker/API Key/向量metadata广播。
3. MUST NOT 在 Collector 离线/上传失败时写入已成功映射，不自行构造 AnythingLLM `location`。

4. MUST 同时满足v1.1 §9.10的确定性合同，新增验收 A-REV-004-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-IMPORT-001-01（正向契约）和 A-IMPORT-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- 完整 Markdown
- metadata.title
- Collector.processRawText 返回 `location`

### Preconditions

- PRE-IMPORT-001 源内容完整
- PRE-IMPORT-002 Workspace Owner 校验已通过

### Authoritative State

```text
SOT: AnythingLLM 文档处理响应 location = 权威文档身份；导入映射本地存储它。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: MARKDOWN_READY
Event: Collector processRawText
After: DOCUMENT_CREATED 或 IMPORT_FAILED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：AnythingLLM Documents 私有存储写入、metadata 白名单、映射状态更新。

### Forbidden Side Effects

DENY：未经授权创建全局共享文档、伪造 location、修改 Gateway 文档。

### Ownership Scope

GENERATED_ONLY（创建的受管 Documents）+ ROW（导入映射）；既有用户文档 USER_OWNED。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：同operation+payload返回原location；identity_key按§9.11状态分支，未知写结果先查询journal，不重复造文件。

### Failure Semantics

```yaml
failure_id: F-IMPORT-001
trigger: "Collector offline/5xx 或返回 success=false"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "本地状态 FAILED；若创建临时孤儿文档，标注 PENDING_CLEANUP 并清理受管范围。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-IMPORT-001 返回合法 `location` 与 source_version 映射。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-IMPORT-001 失败不产生可见的“已导入”标签。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_DOCUMENT_IMPORT_FAILED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-IMPORT-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-IMPORT-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-IMPORT-001-01`、`TEST-A-IMPORT-001-02`。
- required artifacts: `EVID-A-IMPORT-001-01.json`、`EVID-A-IMPORT-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-WORKSPACE-001 — 受限 Workspace 文档关联与双层授权

**交付阶段：**R1　　**Owner / 文件线索：**Workspace；AnythingLLM server/models/workspaceUsers.js + server/endpoints/api/workspace/index.js

### Goal

确保 Gateway 用户级授权不会因 AnythingLLM Workspace 共享而失效。

### Normative Requirement

1. MUST 只向§9.7由BFF新建的专用受限Workspace导入；在线admin/manager/API Key/embed无owner不得读取，导入后成员/分享/跨空间移动同样受持续约束，不能以membership count代替有效读者集合。
2. MUST 用Collector真实location与§9.10预存vector_doc_id调用新增managed embedding能力，复用原向量引擎；核验文档关联、实际向量及policy_epoch后VERIFIED。既有uploadToWorkspace返回值不能替代完整核验。
3. MUST NOT 凭借全局 AnythingLLM API Key 跳过 Workspace membership 校验，亦不能向另一个用户所属 Workspace 建立引用。

4. MUST 同时满足v1.1 §9.7的确定性合同，新增验收 A-REV-001-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-WORKSPACE-001-01（正向契约）和 A-WORKSPACE-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- current_user.id
- workspace_slug
- workspace_users membership
- collector.location

### Preconditions

- PRE-WORKSPACE-001 多用户隔离开启
- PRE-WORKSPACE-002 工作空间权限属于调用者且唯一

### Authoritative State

```text
SOT: AnythingLLM Workspace+workspace_users 是展示权限事实源；Gateway 只管会议来源权限。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: DOCUMENT_CREATED
Event: workspace ACL verify + embed
After: EMBEDDED 或 WORKSPACE_BLOCKED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：更新用户独占 Workspace 的文档关联/向量索引；审计。

### Forbidden Side Effects

DENY：给 Workspace 增加读者、跳过 ACL、向共享知识库导入。

### Ownership Scope

ROW（workspace_documents mapping）+ RESOURCE（本项目生成的向量）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：相同generation/docId幂等embedding恰好一份，先查操作journal/引擎真值；已有有效版本fresh鉴权后跳过。

### Failure Semantics

```yaml
failure_id: F-WORKSPACE-001
trigger: "Workspace 为共享或当前用户不可访问"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "不关联文档；若已生成孤儿文档进入受管补偿回收。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-WORKSPACE-001 仅本人能通过已有 Workspace 问答读到该正文。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-WORKSPACE-001 Workspace audience subset of source authorized audience。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_WORKSPACE_NOT_PRIVATE`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-WORKSPACE-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-WORKSPACE-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-WORKSPACE-001-01`、`TEST-A-WORKSPACE-001-02`。
- required artifacts: `EVID-A-WORKSPACE-001-01.json`、`EVID-A-WORKSPACE-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-STATE-001 — 导入状态、身份与版本映射

**交付阶段：**R1　　**Owner / 文件线索：**数据模型；AnythingLLM server/prisma/schema.prisma + server/models/documents.js

### Goal

为不同用户/会议/内容类型保留唯一可追踪导入记录，支持幂等更新。

### Normative Requirement

1. MUST 建立 第9章九类表（bindings、bridge_sessions、query_runs、imports、attempts、audits、restricted_workspaces、oauth_transactions、import_generations），数据 schema/索引见第9章；每个 import 保存 user、org、member、connection、meeting、recording、asset、kind、source_version、workspace、doc_location、content_sha256、status。
2. MUST 使用第13章定义的身份哈希与 payload digest，唯一键保证重复提交不生成第二份文档；状态只在事务内合法转移。
3. MUST NOT 对同一个 doc_location 发生两个冲突 Owner 的关联，也不得把不存在的 Gateway asset 赋予 READY。

4. MUST 同时满足v1.1 §9.10–9.11的确定性合同，新增验收 A-REV-005-01/02, A-REV-006-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-STATE-001-01（正向契约）和 A-STATE-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- Gateway IDs
- content hash
- AnythingLLM user & workspace
- source_version

### Preconditions

- PRE-STATE-001 Prisma schema 迁移已执行并备份

### Authoritative State

```text
SOT: AnythingLLM meeting_imports 记录导入状态；Gateway Asset 状态/版本保留 Authority。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: NONE
Event: 建导入事务/版本更新
After: STAGED → IMPORTING → VERIFIED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：写指定新表和索引；改变本项目创建的 Document/Vector。

### Forbidden Side Effects

DENY：写 Gateway DB、覆盖已有 AnythingLLM 非受管 Documents。

### Ownership Scope

ROW（本项目新表）+ GENERATED_ONLY（受管文档）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：unique(user,connection,asset,kind,workspace_id,source_version)，按§9.11区分在途/失败/删除/退役再决定返回与重试；版本升级为新revision，完成新版本验证后事务切换活跃版本。

### Failure Semantics

```yaml
failure_id: F-STATE-001
trigger: "重复导入冲突、旧文档已被用户编辑"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "旧成功版本保持可读，新版本进入 BLOCKED_DRIFT。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-STATE-001 每条导入有 provenance、单一 Owner 与核验态。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-STATE-001 一个幂等键至多一个 VERIFIED 版本。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_IMPORT_CONFLICT`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-STATE-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-STATE-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-STATE-001-01`、`TEST-A-STATE-001-02`。
- required artifacts: `EVID-A-STATE-001-01.json`、`EVID-A-STATE-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-RETRY-001 — 导入补偿、失败重试和短会话过期

**交付阶段：**R1　　**Owner / 文件线索：**事务；AnythingLLM server utils meetingGateway importer/sync（拟新增）

### Goal

确保网关异步查询、导入数据库和 Workspace 向量写入之间可恢复。

### Normative Requirement

1. MUST 将每次导入拆为 VALIDATE → FETCH → STAGE → DOCUMENT_CREATE → WORKSPACE_ATTACH → VERIFY → COMMIT，并持久化操作进度；非幂等外部步骤前先查询当前映射/目标。
2. MUST 出现用户 `ms_` 或 `mt_` 会话到期时转为 `AUTH_REQUIRED` 并暂停依赖用户身份的 Gateway 请求，不得自动借用服务 Token；仅由同一用户重新登录后恢复。
3. MUST NOT 把后台 Worker 正在重试、HTTP 202 或未完成 Workspace embedding 判定成功。

4. MUST 同时满足v1.1 §9.10–9.11的确定性合同，新增验收 A-REV-004-01/02, A-REV-010-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-RETRY-001-01（正向契约）和 A-RETRY-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- 本地 import job
- Gateway 会话过期
- Collector 返回
- Workspace index

### Preconditions

- PRE-RETRY-001 所有导入阶段定义唯一 Owner 与恢复记录

### Authoritative State

```text
SOT: AnythingLLM import_attempts/状态是执行事实；Gateway source/job 独立。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: PENDING
Event: 阶段执行
After: STAGING | IMPORTING | ATTACHING | VERIFIED | AUTH_REQUIRED | FAILED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：在受管范围创建 staging/doc/vector 并记录补偿任务；重试有界。

### Forbidden Side Effects

DENY：改用户非受管文件、跨用户接管任务、覆盖 OAuth Token。

### Ownership Scope

ROW（import_attempts）+ GENERATED_ONLY（暂存/生成数据）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：网络故障最多 3 次指数退避 (2/4/8s)，409/403 禁止自动重试；超过转失败，人工点击可新尝试。

### Failure Semantics

```yaml
failure_id: F-RETRY-001
trigger: "Workspace 关联失败或进程在保存 mapping 前中止"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "关联失败清理当前受管 orphan；无法清理时 PENDING_CLEANUP 并保留恢复证据。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-RETRY-001 任一可恢复中断不产生重复文档；失败可定位。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-RETRY-001 仅 VERIFY 通过转 VERIFIED。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_IMPORT_RECOVERY_REQUIRED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-RETRY-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-RETRY-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-RETRY-001-01`、`TEST-A-RETRY-001-02`。
- required artifacts: `EVID-A-RETRY-001-01.json`、`EVID-A-RETRY-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-SEC-001 — 网关用户资源隔离与越权拒绝

**交付阶段：**R1　　**Owner / 文件线索：**安全；Gateway app/services/permission_service.py + AnythingLLM Workspace Users

### Goal

AnythingLLM 业务层必须在用户和连接层面强制隔离，不能仅依赖 Gateway 的最终 403。

### Normative Requirement

1. MUST 每个 BFF 请求从服务器认可的 AnythingLLM Session 得到 user_id，用存储绑定推导 gateway_member_id 和 connection_ref，并将关联的 Gateway Token 固定为当前用户；BFF 不使用客户端传来的 member_id、Gateway Token 或 connection owner。
2. MUST 在请求、数据查询、导入、Workspace、作业轮询、撤销每个步骤检查当前 owner；对不属于用户的资源返回 404/403 并记录去标识化拒绝审计。
3. MUST NOT 将管理员 API Key 或 Gateway service client 直接授予普通用户共享。

**规范条款映射：**上述每一条均由 A-SEC-001-01（正向契约）和 A-SEC-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- AnythingLLM cookie
- 绑定表 owner
- Gateway meeting/job/connection IDs

### Preconditions

- PRE-SEC-001 用户已登录或匿名拒绝

### Authoritative State

```text
SOT: AnythingLLM Session Owner + Gateway member permission = 双层访问权。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: AUTHENTICATED
Event: 请求任一资源
After: ALLOW_SELF / DENY_OTHER
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：本人资源的有限数据调用、权限审计。

### Forbidden Side Effects

DENY：跨用户会议/录制/纪要/作业/文档原始正文。

### Ownership Scope

NONE（拒绝）+ ROW（审计）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：重复跨用户请求均拒绝，不因之前缓存或角色变化放行。

### Failure Semantics

```yaml
failure_id: F-SEC-001
trigger: "篡改 connection_id/meeting_id/job_id 或同角色 A/B 交叉访问"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "0 内容泄露、0 外部写入。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-SEC-001 A/B 实测任意交叉 ID 都无法访问对方。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-SEC-001 owner 每层复核且优先拒绝。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_RESOURCE_NOT_ACCESSIBLE`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-SEC-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-SEC-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-SEC-001-01`、`TEST-A-SEC-001-02`。
- required artifacts: `EVID-A-SEC-001-01.json`、`EVID-A-SEC-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-SEC-002 — 导入后撤权、会话失效与内容冻结

**交付阶段：**R1　　**Owner / 文件线索：**安全；Gateway Connection revocation + AnythingLLM vector Documents

### Goal

源权限失效后不能继续在 Workspace 中暴露原来导入的受限正文。

### Normative Requirement

1. MUST 在§9.7所有入口fresh鉴权；401/超时进入AUTH_REQUIRED/UNVERIFIED拒读而不删除，只有权威确认撤权才SOURCE_REVOKED并按generation精确清理；不能将最近校验时间当永久授权。
2. MUST 将已撤销资料的 workspace_documents 引用和对应向量清理结果关联证据；当无法完成清理时标 `REVOKE_PENDING_CLEANUP`，该受限Workspace的全部读取入口按§9.7–9.9立即拒绝，不依赖向量删除完成。
3. MUST NOT 声称可抹去既有导出/聊天历史/TTS/外部LLM数据；在线访问保持owner校验，冻结时不允许新请求回填旧历史给LLM或再生成新产物，见§9.7。

4. MUST 同时满足v1.1 §9.7–9.9的确定性合同，新增验收 A-REV-002-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-SEC-002-01（正向契约）和 A-SEC-002-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- Gateway 当前连接/内容校验
- import provenance
- 受管文档和向量索引

### Preconditions

- PRE-SEC-002 Gateway 失效通知或本人触发重新检查

### Authoritative State

```text
SOT: Gateway 连接/权限状态 = 源权限事实；本地 Import access_state = 禁读开关。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: VERIFIED
Event: 检测 Gateway 授权撤销
After: SOURCE_REVOKED → CLEANUP_DONE 或 REVOKE_PENDING_CLEANUP
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：立即拒读、解除本项目受管向量关联、清理受管文档、记录补偿。

### Forbidden Side Effects

DENY：删除不属于本来源的用户文档、修改 Gateway 权限、扩散正文。

### Ownership Scope

GENERATED_ONLY（本项目受管文档、向量）+ ROW（导入映射）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：同一个撤权通知多次执行，仅第一次产生删除效果；后续返回当前 cleanup 状态。

### Failure Semantics

```yaml
failure_id: F-SEC-002
trigger: "向量删除失败、文档被其他授权记录使用"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "禁读继续生效，记录残留范围与人工修复，不宣称已物理删除。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-SEC-002 受管问答检索不再命中已撤销内容。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-SEC-002 源失权立即不再成为有效 RAG 上下文。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_REVOKE_CLEANUP_FAILED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-SEC-002-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-SEC-002-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-SEC-002-01`、`TEST-A-SEC-002-02`。
- required artifacts: `EVID-A-SEC-002-01.json`、`EVID-A-SEC-002-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-SEC-003 — 敏感日志、外部内容注入与请求边界

**交付阶段：**R1　　**Owner / 文件线索：**安全；AnythingLLM server/utils/http + Gateway app/core/middleware.py

### Goal

防止登录、OAuth、会议文本穿过日志与模型工具执行边界。

### Normative Requirement

1. MUST 过滤 request/response 日志中的 password、ms_/mt_/mr_、OAuth auth_code/state、Tencent AccessToken/RefreshToken、Gateway App Secret、会议原文；诊断仅保存错误码、status、traceId、脱敏 jobId 与摘要。
2. MUST 限制任何外部请求的 host/port/path 和重定向规则，防 SSRF；对会议正文视为不可信数据，只可作为文档内容，不可驱动系统命令、Tool Call 或 OA mutation。
3. MUST NOT 将腾讯 OAuth 客户密钥或网关 AppSecret 添加 AnythingLLM `.env` 或公开 API、向量元数据。

4. MUST 同时满足v1.1 §9.8及§18的确定性合同，新增验收 A-REV-008-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-SEC-003-01（正向契约）和 A-SEC-003-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- BFF 端点
- http client
- 来自 Gateway 的任意会议正文

### Preconditions

- PRE-SEC-003 生产日志与私有文件权限已检查

### Authoritative State

```text
SOT: Gateway 密钥属于 Gateway；AnythingLLM 仅持有桥接会话/客户凭据（加密）。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: REQUEST_PENDING
Event: 接受敏感输入
After: PROCESSED_REDACTED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：仅安全审计字段、私有内容文档（经授权）。

### Forbidden Side Effects

DENY：跨域跳转、令牌打印、执行正文中的命令。

### Ownership Scope

NONE（日志敏感内容）+ GENERATED_ONLY（脱敏审计）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：重复含敏感内容的请求日志保持净化；错误不回显完整 URL。

### Failure Semantics

```yaml
failure_id: F-SEC-003
trigger: "OAuth code 出现在 Query、错误栈；文档中含恶意提示"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "数据清洗、拒绝危险工具，0 明文日志。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-SEC-003 日志扫描不得发现预置 canary 凭证。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-SEC-003 无敏感串外传、不执行文档指令。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_SECRET_LEAK_PREVENTED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-SEC-003-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-SEC-003-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-SEC-003-01`、`TEST-A-SEC-003-02`。
- required artifacts: `EVID-A-SEC-003-01.json`、`EVID-A-SEC-003-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-OBS-001 — 业务诊断、阶段审计与错误码映射

**交付阶段：**R1　　**Owner / 文件线索：**可观测；Gateway Job API + AnythingLLM EventLogs（适配扩展）

### Goal

让 OAuth 授权成功而腾讯历史会议查询 RETRYING 的问题可被区别诊断。

### Normative Requirement

1. MUST 将 Gateway error_code、HTTP status、`last_reason`、阶段、Gateway trace_id、AnythingLLM import_op_id 关联记录，使用第19章单一阶段词表和错误码映射。
2. MUST 为授权成功、查询 202、查询完成、内容收齐、Collector 导入、Workspace 关联、向量核验分别生成不同 Evidence 事件。
3. MUST NOT 因 Gateway OAuth ACTIVE、HTTP 200/202 或本地文档存在就报告“端到端成功”。

4. MUST 同时满足v1.1 §19.3的确定性合同，新增验收 A-REV-010-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-OBS-001-01（正向契约）和 A-OBS-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- Gateway status/job output
- BFF operation_id
- Collector/Workspace status

### Preconditions

- PRE-OBS-001 日志、指标字段已脱敏

### Authoritative State

```text
SOT: Gateway job/error 原因 authoritative；本地审计为不可变观察。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: STARTED
Event: 阶段推进
After: OBSERVED_STAGES + final_status
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：写脱敏诊断行与 release evidence；产生结构化指标。

### Forbidden Side Effects

DENY：打印完整会议正文、Token、secret；修改来源 job 状态。

### Ownership Scope

ROW（audit_log）+ GENERATED_ONLY（evidence）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：相同 opId/stage 唯一去重；失败事件不可覆盖为成功。

### Failure Semantics

```yaml
failure_id: F-OBS-001
trigger: "上游超时/HTTP 202/作业 RETRYING"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "保持明确的未完成状态并存 diagnostic。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-OBS-001 每个失败能沿 opId→Gateway jobId 定位。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-OBS-001 成功声明须有来源证据。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_UPSTREAM_PENDING`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-OBS-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-OBS-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-OBS-001-01`、`TEST-A-OBS-001-02`。
- required artifacts: `EVID-A-OBS-001-01.json`、`EVID-A-OBS-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-REMOVE-001 — 用户主动解除关联和受管资料删除

**交付阶段：**R1　　**Owner / 文件线索：**移除；AnythingLLM server/models/documents.js + Workspace APIs

### Goal

实现导入资料的受控撤销，不把删除范围扩大到用户其他知识文件。

### Normative Requirement

1. MUST 支持当前用户撤销本人单条会议导入：先通过 Workspace ACL 与 import ownership 校验，再标记 REVOKING、停止检索、移除本次受管关联和向量，最终标记 REMOVED；已编辑用户自有的副本必须 PRESERVE 并警告。
2. MUST 将 `delete` 的数量、位置、source_version、工作区变更证据和补偿状态保存到审计；在撤销网关 OAuth 连接时不得自动删除其他未归属的文档。
3. MUST NOT 删除 Gateway 源会议、OAuth Connection 或其他用户在同一会议下合法独立导入的文档。

4. MUST 同时满足v1.1 §9.9–9.11的确定性合同，新增验收 A-REV-005-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-REMOVE-001-01（正向契约）和 A-REMOVE-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- current_user.id
- import_id
- source document location
- workspace membership

### Preconditions

- PRE-REMOVE-001 当前用户本人明确确认删除

### Authoritative State

```text
SOT: AnythingLLM import/doc/vector 映射为删除事实；Gateway 会议数据不归 AnythingLLM 修改。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: VERIFIED
Event: 本用户撤销导入
After: REVOKING → REMOVED | CLEANUP_FAILED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：仅受管 Workspace 映射/向量/关联表清理。

### Forbidden Side Effects

DENY：Gateway DELETE、不可追踪的批量 purge、删除独立用户文件。

### Ownership Scope

GENERATED_ONLY（该导入创建的资源）+ ROW（本用户 mapping）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：多次删除返回 REMOVED，0 第二次破坏性操作。

### Failure Semantics

```yaml
failure_id: F-REMOVE-001
trigger: "文档已被用户修改、删除 vectorDB 失败"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "禁止继续读取; 保留备份/任务；人工逐项恢复。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-REMOVE-001 只影响选定受管资源，保留其他会议信息。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-REMOVE-001 Gateway 无被删除资源。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_REMOVE_RECOVERY_REQUIRED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-REMOVE-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-REMOVE-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-REMOVE-001-01`、`TEST-A-REMOVE-001-02`。
- required artifacts: `EVID-A-REMOVE-001-01.json`、`EVID-A-REMOVE-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-COMPAT-001 — Compare、Translation、OA 模块边界不被侵入

**交付阶段：**R1　　**Owner / 文件线索：**兼容性；此前项目边界约束；独立 Compare / Translation 模块

### Goal

保障既有独立模块方向和后续会议任务闭环的可扩展性，但不扩大本轮产品范围。

### Normative Requirement

1. MUST 保持 Meetings/Compare/Translation 为独立导航、路由、权限域；本需求只新增 Meetings 对接代码，会议资料进入知识库后的 Compare/Translation 调用应为用户主动发起。
2. MUST 为后续“任务候选→人工确认→OA”保留不可变来源引用（gateway asset id/source_version/import_id），不在本轮实现真实 OA 任务写入。
3. MUST NOT 把 Compare/Translation 的核心功能改为会议页面子组件、不得在导入成功后自动写入 OA。

**规范条款映射：**上述每一条均由 A-COMPAT-001-01（正向契约）和 A-COMPAT-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- AnythingLLM 已有文档模块
- 未来 Compare/Translation/OA 外部产品接口

### Preconditions

- PRE-COMPAT-001 当前两个独立模块状态可做快照

### Authoritative State

```text
SOT: 本轮 Meeting Import 的来源记录 = meetings 子域；Compare/Translation 与 OA 自己的状态由其 Owner 管理。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: EXISTING_FEATURES
Event: 部署 Meetings 接入
After: EXISTING_FEATURES_PRESERVED + MEETINGS_ADDED（受限Workspace门禁为显式新增语义）
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：新增 Meetings 入口、保留来源引用字段。

### Forbidden Side Effects

DENY：写 OA、修改 Compare/Translation 现有代码/数据库语义。

### Ownership Scope

FILE（新增 Meetings 专属文件）+ NONE（独立模块）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：重复安装不重新注册旧模块或覆盖其文件。

### Failure Semantics

```yaml
failure_id: F-COMPAT-001
trigger: "检测到既有独立模块文件变更"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "阻止发布、回滚本次非受管修改。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-COMPAT-001 旧 Compare/Translation 入口功能未变化。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-COMPAT-001 本轮 OA external-write-count 永远为 0。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_SCOPE_VIOLATION`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-COMPAT-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-COMPAT-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-COMPAT-001-01`、`TEST-A-COMPAT-001-02`。
- required artifacts: `EVID-A-COMPAT-001-01.json`、`EVID-A-COMPAT-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

## REQ-TEST-001 — 跨用户真实消费者与 Release Gate

**交付阶段：**R1　　**Owner / 文件线索：**验收；模板 /mnt/data/需求PRD工程模板.md + 双仓源代码

### Goal

严格验证代码、模拟环境和真人 OAuth/腾讯会议数据三层链路。

### Normative Requirement

1. MUST 在 AnythingLLM 与 Gateway 各自固定提交上执行单元/集成/契约/真实消费端验证；真实测试需两个不同用户 A/B，A 有合法腾讯已结束会议及可用转写/纪要样本。
2. MUST 把上轮 Gateway `USER_WINDOW` 查询仍 `RETRYING` 列为 Gate G0 阻塞，只有真实腾讯作业 `SUCCEEDED` 且获取已知会议，才允许 AnythingLLM 导入 Golden Consumer 通过。
3. MUST NOT 将模拟腾讯响应、HTTP 202、ACTIVE、RAG 模型口头回答或缺测试文件报告为发布通过。

4. MUST 同时满足v1.1 §25.2的确定性合同，新增验收 A-REV-009-01/02，不得只凭原两条AC证明新增行为。

**规范条款映射：**上述每一条均由 A-TEST-001-01（正向契约）和 A-TEST-001-02（拒绝/故障契约）联合覆盖；缺少任一测试证据则本 Req 不得通过。

### Inputs

- 两仓 pinned SHA
- A/B 两个真实身份
- 已知会议样本
- 验收 Evidence schema

### Preconditions

- PRE-TEST-001 staging 环境权限与真实用户授权合法

### Authoritative State

```text
SOT: 实际 Gateway job/Asset + AnythingLLM doc/vector + Test Evidence 三重证据。
Observed: Gateway/Collector/AnythingLLM 实际返回值及当前本地状态
Derived: 只用于 UI 的状态映射，失效时不可反向覆盖权威状态
```

### State Transition

```text
Before: NOT_VERIFIED
Event: 依次执行 G0/G1/A1/A2
After: PASS / FAIL / BLOCKED
Illegal: 从错误/不确定状态直接改 VERIFIED/ACTIVE；不属于当前 Owner 的任何突变
```

### Allowed Side Effects

ALLOW：测试环境合法请求、测试导入、脱敏报告、失败回滚。

### Forbidden Side Effects

DENY：清库造假、替换网关权限代码、测试数据写 OA。

### Ownership Scope

GENERATED_ONLY（测试记录/evidence）+ NONE（业务生产源改造）。

### Idempotency

- first run：完成符合 Owner 和 Scope 的指定操作，保存必要映射与结果。
- second run：同 SHA 重跑记录新 run_id，对源数据的受控导入仍幂等。

### Failure Semantics

```yaml
failure_id: F-TEST-001
trigger: "缺 A/B、真实会议、网关仍 RETRYING"
expected_state: 按第19.3章该trigger及stage的唯一决策
error_decision: 第19.3章统一条件映射
rollback: "退出码非0，保存已完成 Evidence，完整 Gate 为 BLOCKED。"
retry_policy: 第19.3章统一决策（鉴权读取不自动重试）
```

### Postconditions

- POST-TEST-001 所有 required acceptance 具有 Oracle、Evidence、commit。
- 实际提交的网络、数据库及文档变更不得超出 Allowed Side Effects。

### Invariants

- INV-TEST-001 SKIPPED/BLOCKED 不视为 PASS。
- 正向成功不得越过上游拒绝/身份不一致/源内容不完整；负向AC按预期拒绝可PASS，不冒称业务成功。

### Error Codes

- `MGW_ACCEPTANCE_BLOCKED`：适配器级业务错误码（**拟新增**；不得假装是腾讯原生 error_code）。
- 若 Gateway 有原生 `reason` / upstream error_code，必须作为诊断独立字段保存，不覆盖适配器错误码。

### Acceptance

- `A-TEST-001-01` — 允许场景；Given/When/Then/Oracle/Evidence 见第20章。
- `A-TEST-001-02` — 拒绝、失败、边界场景；Given/When/Then/Oracle/Evidence 见第20、22章。

### Evidence

- required tests: `TEST-A-TEST-001-01`、`TEST-A-TEST-001-02`。
- required artifacts: `EVID-A-TEST-001-01.json`、`EVID-A-TEST-001-02.json` 以及该 Req 的最少一个成功/失败可观察结果。
- required digest: 双仓 Git SHA、测试输入 sha256 和操作前后受管范围摘要；令牌、密码、会议正文不可进入公共 Evidence。
- required runtime output: 实际 exit code、Gateway HTTP/status/trace、AnythingLLM operation_id、Oracle expected/actual 与来源版本。

# 11. Side-Effect Contract

对表中 DB/File/Cache “YES” 仅是本系统受管范围；禁止AnythingLLM直接写Gateway数据库、腾讯会议和Backend业务源；Gateway受控API本身可能创建授权事务、源查询作业/缓存，由Gateway服务负责，不冒称这些API无side effect。Telemetry、操作审计、缓存均属于 side effect，不能以“只读页面”为理由漏记。

| Operation | AnythingLLM DB Write | Doc/Vector Write | Gateway Network | Cache / Telemetry | Tencent / Backend Direct | OA Write |
|---|---:|---:|---:|---:|---:|---:|
| 查看连接状态 | 仅 30s 状态缓存 | NO | GET | YES（脱敏） | NO | NO |
| Gateway 身份登录 | YES（加密 session + binding） | NO | POST account-login | YES（仅脱敏） | NO | NO |
| Gateway 业务 Token 兑换 | YES（加密 session） | NO | POST portal/session 或 auth/exchange | YES | NO | NO |
| OAuth 授权发起 | YES（pending transaction 映射） | NO | POST oauth/authorizations | YES | NO | NO |
| OAuth 授权回调 | NO（仅 Gateway 处理） | NO | Browser→Gateway | NO | Gateway→Tencent | NO |
| OAuth confirm | YES（状态镜像） | NO | POST connection confirm | YES | NO | NO |
| 腾讯用户历史会议查询 | YES（job mirror） | NO | POST meeting-queries | YES | NO（Gateway 负责） | NO |
| 会议目录/录制列表查看 | 仅安全观察缓存 | NO | GET Gateway | YES | NO | NO |
| 完整转写/纪要获取 | YES（私有 staging） | 暂存 YES | GET Gateway + 可能 202 | YES | NO | NO |
| 文档导入 | YES（imports/attempts） | YES（受管文档） | 已授权取数据 | YES | NO | NO |
| Workspace 向量化 | YES（映射） | YES（受管向量） | NO | YES | NO | NO |
| 用户撤销资料 | YES（状态） | YES（受控删关联及向量） | 可选 GET 权限状态 | YES | NO | NO |
| R1 会议 AI 任务创建 | NO | NO | NO | NO | NO | **NO** |

所有真正 `ALLOW` 的操作需保留操作审计；“只读”定义为 **不变更业务来源/不写非受管用户文件**，并不否认受控缓存、诊断和日志写入。

# 12. Ownership Contract

## 12.1 Ownership Type

| 资源 | Ownership Type | Owner |
|---|---|---|
| Gateway OAuth 应用与加密凭证 | WHOLE_RESOURCE | Gateway `.env`/Gateway operator |
| Gateway Connection / Meeting / Job | RESOURCE | Gateway identity/policy/services |
| AnythingLLM 用户身份、Workspace、用户既有文档 | USER_OWNED / SHARED（原产品语义） | AnythingLLM 用户和现有控制器 |
| Meeting BFF 新增文件 | FILE | Meeting Adapter |
| 适配器新表行 | ROW | 对应 AnythingLLM user_id |
| 适配器生成 Markdown / 文档 / 向量 | GENERATED_ONLY | import_id + user_id + workspace |
| Compare/Translation 文件与 UI | USER_OWNED（相对于本项目） | 独立模块 |
| Evidence | GENERATED_ONLY（只追加） | 测试 run |

## 12.2 Ownership Rule

1. 创建时由当前 AnythingLLM Session 决定真实 owner；Gateway 员工由本人登录结果决定，不从浏览器任意字段建立身份。
2. 更新时通过 `import_id` 精确定位到本次创建的受管文档；不得使用文件名匹配或全局 `purgeFolder` 批量替换其他资料。
3. 用户已编辑文档时标BLOCKED_DRIFT并保留字节、冻结检索资格；不能解除来源授权约束：旧 `last_applied_doc_sha256` 与现有文件不一致，后续导入 BLOCKED_DRIFT，保留原件。
4. 删除时仅清理可以证明 `owner/import_id/location` 的受管内容；跨用户共享、无法证明来源、多个 import 引用相同 location 时一律 BLOCK。
5. Gateway 的 AppSecret、OAuth Token、连接状态、企业白名单和上游资源均非 AnythingLLM 管理对象。

## 12.3 Drift

```text
SHA256(UTF8(JSON.pageContent)) == last_applied_doc_sha256
  → SAFE_MANAGED_UPDATE
SHA256(UTF8(JSON.pageContent)) != last_applied_doc_sha256
  → BLOCKED_DRIFT（PRESERVE USER_CONTENT）
unknown document owner / missing provenance
  → PRESERVE + REPORT；MUST NOT DELETE
```

不允许“last writer wins”“自动覆盖最新版本”或按文件名重写用户已经编辑的内容。

# 13. Hash / Identity Contract

## 13.1 哈希字段规范

所有 Hash 使用 `SHA-256`、UTF-8、固定小写 hex 64 位，逻辑字段之间使用字节 `0x00`（NUL），不使用本地时区或平台相关的路径分隔符。派生Markdown字符串用 NFC Unicode、正文行尾LF；源JSON的JCS摘要保留原Unicode。正文Hash校验原pageContent、不对整个JSON套用；Hash 不包含应用 Secret、OAuth Token、员工密码和可变的 UI 文案。

```text
identity_key = SHA256(
  UTF8("mgw-import-id-v1") + NUL +
  UTF8(gateway_org_id) + NUL +
  UTF8(anything_user_id) + NUL +
  UTF8(gateway_member_id) + NUL +
  UTF8(connection_ref) + NUL +
  UTF8(gateway_asset_id) + NUL +
  UTF8(content_type) + NUL +
  UTF8(workspace_id) + NUL +
  UTF8(source_version)
)
```

`content_sha256 = SHA256(UTF8(canonical_json(source_content)))`；canonical_json 采用 RFC 8785 JCS 规则序列化经源字节无损解析的 JSON，不包含 Gateway API 包装的 `trace_id` 或动态 `fetched_at`；当源内容无法作为 JSON 无损解析时 BLOCK `MGW_FORMAT_INVALID`，不得悄悄转字符串。

`last_applied_doc_sha256 = SHA256(UTF8(Collector_JSON.pageContent)) = SHA256(bytes_of_generated_markdown_UTF8)`；生成 Markdown 不包含本地“导入时间”等会在同一源每次不同的字段（展示导入时间存入 mapping，不参与 Markdown Hash）。Workspace 关联唯一键基于 identity_key；不能基于用户可修改标题。

## 13.2 版本漂移与目录

- `source_version` 从 Gateway 返回的 `content_version`/`asset_version` 取得。它是上游 opaque 值，不得对它套用本地 SHA 的语义；若字段缺失，必须 `MGW_UPSTREAM_CONTRACT_ERROR` 并暂缓覆盖。
- 使用 Gateway 受控返回的 `recording_id`、`asset_id`、`content_type` 建 Source Identity；不要把相同 Tencent `meeting_code` 视为同一资源。
- 文档路径由 Collector 返回，不自行构造；只允许在实际 AnythingLLM Documents 根目录及白名单 meeting-managed 子目录内经owner gate访问，无符号链接越界。
- 恢复或删除时校验记录的 `location` 与当前文件/向量 owner/摘要；匹配后才能修改。

# 14. Transaction Contract

## 14.1 Transaction Boundary

跨 Gateway REST、AnythingLLM Prisma、Collector 文档系统和向量数据库**不存在天然单一 ACID 事务**。R1 使用 **本地 DB 事务 + 具有精确 owner 的受控补偿流程（Saga）**，不得宣称跨服务原子提交。

```text
TXN-A: bind/create login session（单本地 DB transaction）
TXN-B: create source query mirror（记录 job_id 的本地事务）
TXN-C: reserve import_id + unique identity_key（本地事务）
TXN-D: complete document + workspace stage（外部状态 + 本地事务更新）
TXN-E: finalize verified mapping（同时核验来源、文档、workspace）
```

## 14.2 Commit Order

```text
① 校验 AnythingLLM 当前用户、Gateway 的独立 member/connection/权限
② 先创建request/attempt并存T0；取得真实asset/version后reserve identity_key行与generation，不预造版本
③ 分页拉齐 Gateway 内容至私有 staging，校验 hash/version
④ 持久operation_id后调managed Collector/journal；记录真实location与provenance
⑤ 核验受限policy_epoch，预存workspace_documents.docId后写关联与向量
⑥ 查询关联、向量及 source 仍有效
⑦ 本地事务标记 VERIFIED，提交时间和 Evidence
⑧ 异步清理旧版本的受管资源（若原文无 drift）
```

## 14.3 Failure Atomicity

- `T0` = 第一次本地受管 mutation 前 `meeting_imports` 同版本映射、私有 Workspace Documents 与受管向量的可核验摘要集合。
- **若尚未执行任何外部写且只有本地 DB 写失败**：DB rollback 必须使受管行与 T0 一致；不得让错误映射成为 VERIFIED。
- **若跨 Collector/Vector 写入失败**：必须执行 idempotent compensation，把新增且唯一拥有的 document/vector 清理恢复至 T0；若因外部系统不可用无法完成，应保留 `PENDING_CLEANUP`、阻断检索并生成不可丢失的恢复工单，Release Gate 对该测试记 FAIL。不能伪称瞬间 ACID 回滚。
- **若源权限撤销**：立即将 access_state 拒绝读取，然后进行异步精确清理；不得在清理失败期间继续检索。

## 14.4 Rollback Failure

```text
error: MGW_IMPORT_RECOVERY_REQUIRED 或 MGW_REVOKE_CLEANUP_FAILED
recovery_artifact: operation_id + affected doc location + source_version + T0 digest + cleanup attempts（无正文）
backup_retention: 受控加密保留30天；到期若仍有未解决恢复工单则仅保留所需范围并审计延期，不进入RAG
manual_recovery: 管理员凭最小授权核对孤儿内容及向量后精确清除，保留审计
cleanup_policy: 仅 generated-only 且 owner 符合 import_id；无法证明 owner 则 PRESERVE+REPORT
```

# 15. Conflict Contract

| Conflict | Detection | Default Behavior | Error | Mutation |
|---|---|---|---|---|
| A 读取/导入 B 的 Gateway 资源 | 当前 user/member/conn 不一致 | DENY | MGW_RESOURCE_NOT_ACCESSIBLE | 0 |
| AnythingLLM 用户绑定不同 Gateway member | user_id 对应旧映射且无显式解绑 | BLOCK | MGW_IDENTITY_BINDING_CONFLICT | 0 |
| 相同源版本重复导入 | identity_key 唯一冲突 | 按§9.11现状态决定RETURN_EXISTING/202/409/新generation | NONE | 0 新文档 |
| 相同路径不同内容且用户编辑 | current sha != last_applied | PRESERVE/BLOCK | MGW_IMPORT_CONFLICT | 0 |
| 相同 doc location 不同 Owner | mapping 唯一/owner 检查 | BLOCK | MGW_IMPORT_CONFLICT | 0 |
| 私有文档导向共享 Workspace | 受限owner/成员/分享/epoch任一不符 | BLOCK | MGW_WORKSPACE_NOT_PRIVATE | 0 |
| Gateway User query RETRYING | job.state != SUCCEEDED | WAIT / ERROR | MGW_QUERY_INCOMPLETE | 0 文档 |
| Gateway Asset 版本分页漂移 | page source_version 不一致 | REFETCH | MGW_TRANSCRIPT_INCOMPLETE | 0 已提交文档 |
| Gateway `ms_`/`mt_` 到期 | Gateway 返回 401/本地 deadline 到期 | AUTH_REQUIRED | MGW_BUSINESS_AUTH_REQUIRED | 0 Gateway 请求 |
| source 失权但已在向量库 | Gateway 401/403 或撤销事件 | DISABLE + CLEANUP | MGW_REVOKE_CLEANUP_FAILED | 仅本导入资源 |

不得自动“采用最后写入者”“以管理员权限重试”“兜底使用上一个可用用户 Token”。

# 16. Compatibility / Migration

## 16.1 Existing State

- AnythingLLM：既有 `server/index.js` 端点装配、`server/models/documents.js`、`server/models/workspaceUsers.js`、`server/prisma/schema.prisma` 和现有 Workspace，不重置数据库。初始 Prisma Schema 可为 SQLite，生产部署也可能换过 provider，迁移脚本必须以实际 provider 为准。
- Gateway：已有腾讯第三方 OAuth、数字 AppID 回调、唯一账户登录、连接与源查询；不能重建腾讯应用配置。
- AnythingLLM `Compare`、`Translation` 为此前确定的独立模块方向；本项目不得改变其路由/数据语义。

## 16.2 Migration

1. `detect`：检查 Git SHA、Prisma datasource、已有表名、工作区角色和已定制页面，不改数据。
2. `backup`：备份现有 Prisma DB、相关受管文件清单、启动配置摘要；严格脱敏，保留备份 sha256。
3. `adopt`：仅添加 `meeting_gateway_*` 及相关新模型/路由；缺少同名表时创建，若已有同名非本项目表→BLOCK，不覆盖。
4. `migrate`：以实际 Prisma migration 脚本逐步新建表/索引；审计所有迁移变更，未建立关联前不创建 Document。
5. `preserve`：其他用户的 Documents/Workspaces 不迁移、不重排、不自动授权。
6. `remove/rollback`：关闭 `MEETING_GATEWAY_ENABLED`，在导出受管状态后按 Owner 删除新路由与新表；绝不清空全部 Documents 或 Workspace。

## 16.3 Unknown Ownership

如果无法证明一条文档归 `meeting_imports` 的 `import_id` 所有，**PRESERVE + REPORT**；不得用文件名中包含 `meeting` 判断其可删除；不能证明用户 Workspace 独占则该用户 R1 的导入入口 BLOCK。

# 17. External Dependency Contract

| Component | Exact Baseline | Required Path/API | Fallback | Offline / Failure |
|---|---|---|---|---|
| AnythingLLM | `{ALLM_SHA}` | `server/index.js`、`server/endpoints/api/document/index.js`、Workspace model/endpoint、Collector | 无跨主版本隐式回退 | Collector 离线返回 FAILED，不宣称已导入 |
| Meeting Gateway | `{GW_SHA}` | `/api/v1/auth/account-login`、`/portal/session`、`/oauth/authorizations`、`/meeting-queries`、`/jobs`、`/meetings`、`/recordings/...` | 仅允许已实现的 `auth/exchange` 经配置后作为 Token 分支 | Gateway 拒绝/超时就 BLOCK 本人查询 |
| Tencent OAuth | Gateway `.env` 固定 `33510141629`；腾讯实际响应 | `https://copilot.superic.com:9999/callbacks/tencent/oauth/33510141629` | 不使用 AKSK/STS | Gateway 负责 OAuth 错误分类 |
| Backend 登录 | 仅经 Gateway 已配置的 account-login | `/api/v1/auth/account-login` | 无其它成员 resolve/search/context/health | 拒绝 Gateway 登录，不允许 AnythingLLM 直连 |
| AnythingLLM Prisma/DB | 跟随上述 Consumer Commit 实际 schema 与部署 datasource | Prisma migrations + 新表 | 不切换/重建既有 DB | 迁移阻断，保留备份 |
| Collector & Workspace Vector | 跟随 AnythingLLM 已部署版本 | Collector.processRawText、Document.api.uploadToWorkspace、向量检索 | 不构造 fake document location | 不可用时失败并恢复 T0 |
| OA | R1 不配置 | NONE | NONE | 所有写接口禁止 |

**Immutable Identity：**R1 的产品构建记录必须写两仓确切 SHA。外部依赖升级、Gateway API Response 发生破坏性变化，先更新 Contract Test，再进入新的 REVIEW；禁止使用浮动 latest 被误认原基线。

# 18. Security Contract

| Threat | Control | Acceptance |
|---|---|---|
| B 伪造 A 的 connection_id、meeting_id、import_id | Session owner 派生 + Gateway revalidate + Workspace membership | A-SEC-001-02 |
| AnythingLLM 管理员 API Key 绕过用户范围 | 只作为服务器内部技术凭据，入库前用户级 ACL | A-WORKSPACE-001-02 |
| OAuth state/auth_code 被窃/日志记录 | 只通过 Gateway 回调；不要记录含 query 的 URL | A-OAUTH-002-02, A-SEC-003-01 |
| BFF 被用作任意 HTTP 转发 | Gateway origin allowlist，禁重定向、限制端口/路径、TLS 校验 | A-SEC-003-02 |
| 文档路径穿越/symlink | 只使用 Collector 返回 location，限制真实 docs root，拒绝 symlink 越界 | A-REMOVE-001-02 |
| 内容中含 prompt injection / XSS | 转写视为数据、Markdown/HTML 转义、禁止把正文当系统命令 | A-FORMAT-001-02 |
| 连接撤销后向量仍可检索 | 立刻 access_state=SOURCE_REVOKED，精准删除受管向量 | A-SEC-002-01/02 |
| Backend 被当应用配置中心 | Tencent app creds 仅 Gateway `.env`，账户验证仅 Gateway upstream login | A-CONF-001-02, A-AUTH-001-02 |
| 权限被缓存放大 | 关键操作前 Gateway 二次鉴权，30s 状态缓存只作 UI | A-OAUTH-001-02, A-SEC-001-02 |
| CSRF / Session fixation | HttpOnly Secure SameSite Cookie + CSRF Token + Session/subject binding | A-AUTH-001-02 |
| 越权覆盖用户已编辑资料 | last_applied doc digest 冲突检测、PRESERVE | A-STATE-001-02, A-REMOVE-001-02 |

服务端 Credential Store 采用 AES-256-GCM，密钥由 AnythingLLM 私有 `.env` 管理并可版本轮换；OAuth Token、AppSecret、Webhook Key 不能流出 Gateway；协议state的受控URL传输例外见§9.8/NEG-GLOBAL-004。对外查询输入不允许自定义 URL 或 userId。业务正文默认只供当前用户独占 Workspace 使用；单用户部署无法提供真实 A/B 隔离验收，不能通过多用户 Release Gate。

# 19. Observability

## 19.1 阶段与事件

```text
CONFIG_CHECK → GATEWAY_LOGIN → TOKEN_EXCHANGE → OAUTH_START
→ OAUTH_STATUS → OAUTH_CONFIRM → SOURCE_QUERY_ACCEPTED
→ SOURCE_QUERY_POLL → CATALOGUE_READ → RECORDING_DISCOVERY
→ CONTENT_ENSURE → CONTENT_PAGINATION → FORMAT
→ DOCUMENT_CREATE → WORKSPACE_ATTACH → VECTOR_VERIFY
→ IMPORT_VERIFIED / FAILURE / CLEANUP
```

每条事件最少：`operation_id`、`stage`、`status`、ISO8601 UTC `timestamp`、`consumer_sha`、`gateway_sha`、`anything_user_id_digest`、`gateway_connection_ref_digest`、`gateway_job_ref_digest`（如存在）、`result_count`、本地 `error_code`、Gateway `reason`（仅受控白名单）。不存完整源正文、OAuth state、密码、Token 或签名 Header。

## 19.2 错误分类

| 适配层 Error | 条件 | UI 与操作 | 是否重试 |
|---|---|---|---|
| MGW_LOGIN_REJECTED | Gateway 登录失败 | 请用户重新核验凭证 | NO 自动 |
| MGW_BUSINESS_AUTH_REQUIRED | Gateway `ms_/mt_` 到期/权限缺失 | 本人重新登录 Gateway/申请授权 | NO 自动越权 |
| MGW_OAUTH_START_REJECTED | 授权 URL 不合法/网关拒绝 | 不跳转 | NO |
| MGW_OAUTH_CONFIRM_DENIED | corp mismatch/非本人 | 管理员排查 Gateway 来源配置 | NO |
| MGW_QUERY_INCOMPLETE | SourceJob RETRYING、非 complete | 展示 job/last_reason 并等待 | 有界状态轮询 |
| MGW_SOURCE_QUERY_REJECTED | 4xx/422/429 | 展示具体业务原因 | 429 按上游 Retry-After |
| MGW_TRANSCRIPT_INCOMPLETE | 游标失败/版本变更/部分段落 | 放弃 staging | 条件恢复后重试 |
| MGW_MINUTES_UNAVAILABLE | 纪要还未 READY | 纪要不可导入，转写可单独导入 | 用户手动重试 |
| MGW_DOCUMENT_IMPORT_FAILED | Collector 不可用 | 标记 FAILED/PENDING_CLEANUP | 最多 3 次 |
| MGW_WORKSPACE_NOT_PRIVATE | workspace readers 超出本人 | 选择独占 Workspace | NO |
| MGW_RESOURCE_NOT_ACCESSIBLE | 当前用户资源越权 | 403/404，不显示正文 | NO |
| MGW_REVOKE_CLEANUP_FAILED | 失权清理不完整 | 阻断检索、保留恢复工单 | 管理员修复 |
| MGW_IMPORT_CONFLICT | 重复 owner 或用户编辑 drift | 不能覆盖、提示冲突 | NO 自动 |

**运维事件：**当前活跃连接数、Gateway 查询成功/重试率、完整转写页数、正文 hash 不匹配次数、Collector 导入失败数、孤儿资源数、越权拦截计数、清理待补偿数；指标不含原文及令牌。

## 19.3 v1.1 确定性故障决策

所有Requirement的Failure Semantics引用此表；过程状态、access_state与测试PASS/FAIL分开。负向测试正确拒绝为AC PASS，不代表被测发布可PASS。Gateway原生status/reason单独保存。

| 条件 | HTTP / MGW码 | 状态与行为 |
|---|---|---|
| 配置缺失/非法origin | 503 MGW_CONFIG_INVALID | CONFIG_BLOCKED，零外发；不建业务行 |
| 密码/org登录拒绝 | 401 MGW_LOGIN_REJECTED | 无新bridge，旧binding不变，人工重输 |
| JWT/bridge/ms_/mt_失效或401 | 401 MGW_BUSINESS_AUTH_REQUIRED | AUTH_REQUIRED，暂停请求，不物理删除 |
| 非owner | 404 MGW_RESOURCE_NOT_ACCESSIBLE | 原行业务不变，0正文/0上游调用 |
| 资源权威确认失权/删除 | 403 MGW_RESOURCE_NOT_ACCESSIBLE | REVOKING+SOURCE_REVOKED，先拒读后清理 |
| 未核实403/404或schema错误 | 503 MGW_UPSTREAM_CONTRACT_ERROR | BLOCKED+UNVERIFIED，不删除 |
| OAuth URL非法 | 422 MGW_OAUTH_START_REJECTED | 不建pending，不redirect，不自动重试 |
| corp不匹配/confirm拒绝 | 403 MGW_OAUTH_CONFIRM_DENIED | 非ACTIVE，无query |
| 非法字段/窗口/CSRF | 422 MGW_INPUT_INVALID（CSRF为403 MGW_CSRF_REJECTED） | 无业务写、无Gateway调用 |
| 上游429/owner并发额度 | 429 MGW_RATE_LIMITED | query RETRYING，读UNVERIFIED；遵循Retry-After，缺失30s，不超过deadline |
| 网络/5xx，未有外部写 | 503 MGW_UPSTREAM_UNAVAILABLE | query RETRYING或import FAILED；共最多3次重试，2/4/8s；鉴权读取不重试 |
| Query POST结果未知 | 202 MGW_QUERY_RECOVERY_REQUIRED | query BLOCKED，保留request_id，人工/已确认关联协议恢复，禁止盲重发 |
| 外部写结果未知 | 202 MGW_IMPORT_RECOVERY_REQUIRED | PENDING_CLEANUP，先查operation journal，禁止盲重放 |
| job未完成/轮询5分钟上限 | 202 MGW_QUERY_INCOMPLETE | RUNNING或RETRYING依权威job映射，停止页面自动poll，不造空成功 |
| cursor失效/版本漂移/重复cursor | 409 MGW_TRANSCRIPT_INCOMPLETE（目录MGW_LIST_CURSOR_INVALID） | 丢弃staging，FETCHING->FAILED；人工重拉 |
| 无纪要/尚未READY | 409 MGW_MINUTES_UNAVAILABLE | 当前kind FAILED，另一kind不变；人工重试 |
| invalid UTF8/结构不可无损解析 | 422 MGW_FORMAT_INVALID | FAILED，不创建文档，禁止自动修复原文 |
| Collector明确失败、无文件 | 503 MGW_DOCUMENT_IMPORT_FAILED | FAILED，最多3次；未知副作用转恢复 |
| Workspace策略/epoch不符 | 409 MGW_WORKSPACE_NOT_PRIVATE | FAILED，无新关联，补偿自身资源 |
| digest/provenance drift | 409 MGW_IMPORT_CONFLICT | BLOCKED_DRIFT+UNVERIFIED，保留字节、禁读 |
| cleanup未完时重提 | 409 MGW_CLEANUP_IN_PROGRESS | PENDING_CLEANUP，0新generation |
| 清理故障 | 202 MGW_REVOKE_CLEANUP_FAILED | PENDING_CLEANUP，禁读、恢复工单；最多3次后人工 |
| 内容/目录超限 | 413 MGW_LIMIT_EXCEEDED | import FAILED或query BLOCKED，无可读文档 |

同一条件依§9.9资源授权判定先区分401/未知/确认撤权。所有新表state/stage按§9.8–9.11显式String枚举校验；不允许Failure模板中的多选状态成为实现自由度。

# 20. Acceptance Design Standard

Acceptance 的五元组分别定义：**Given（前置输入）/ When（具体动作）/ Then（可观测结果）/ Oracle（机器判断）/ Evidence（可追溯运行证据）**。每个测试必须在实际执行后记录真实退出码；以下内容是**计划中的验收合同**，不是已经跑过的测试。所有 `A-*` 默认 `REQUIRED=true`。

## A-CONF-001-01 — 双仓配置与连接器启动门禁：正向成功 Oracle

### Requirement Refs

`REQ-CONF-001`

### Given

有效 HTTPS 内网 Gateway、最少配置和 ENA=true。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

启动连接器并请求其健康探测。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

健康探测通过且无密钥字段。

### Oracle

```yaml
type: machine_assertion
expression: "health.status=AVAILABLE 且公开 payload 敏感字段数=0"
requirement: REQ-CONF-001
acceptance: A-CONF-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-CONF-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/client.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-CONF-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-CONF-001-02 — 双仓配置与连接器启动门禁：负向/失败 Oracle

### Requirement Refs

`REQ-CONF-001`

### Given

缺少 MEETING_BRIDGE_KEYRING_JSON 或配置任意外部 URL。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

启动与调用 Connector。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

CONFIG_BLOCKED/404，网络无外发。

### Oracle

```yaml
type: machine_assertion
expression: "external_network_calls=0; connector_registered=false"
requirement: REQ-CONF-001
acceptance: A-CONF-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-CONF-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/client.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-CONF-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-IDENT-001-01 — AnythingLLM 用户与网关身份绑定：正向成功 Oracle

### Requirement Refs

`REQ-IDENT-001`

### Given

AnythingLLM A、B 各自 Gateway 登录并建立绑定。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

两个用户读取各自 bindings。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

返回 2 条不同 owner 的映射。

### Oracle

```yaml
type: machine_assertion
expression: "count=2; ids owner unique; A.view(B)=404"
requirement: REQ-IDENT-001
acceptance: A-IDENT-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-IDENT-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/sessions.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-IDENT-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-IDENT-001-02 — AnythingLLM 用户与网关身份绑定：负向/失败 Oracle

### Requirement Refs

`REQ-IDENT-001`

### Given

B 在请求体里填 A 的 anything_user_id/member_id。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

B 请求绑定或会话。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

服务器忽略/拒绝伪造字段。

### Oracle

```yaml
type: machine_assertion
expression: "A.binding unchanged; B.not_owner=403/404"
requirement: REQ-IDENT-001
acceptance: A-IDENT-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-IDENT-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/sessions.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-IDENT-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-AUTH-001-01 — 经 Gateway 的账号密码验证与短会话：正向成功 Oracle

### Requirement Refs

`REQ-AUTH-001`

### Given

合法 A 账号有效密码。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

点击“验证内部会议账号”。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

建立加密会话、浏览器仅获无密钥状态。

### Oracle

```yaml
type: machine_assertion
expression: "gateway_call_count(account-login)=1; browser_token_fields=0"
requirement: REQ-AUTH-001
acceptance: A-AUTH-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-AUTH-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/sessions.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-AUTH-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-AUTH-001-02 — 经 Gateway 的账号密码验证与短会话：负向/失败 Oracle

### Requirement Refs

`REQ-AUTH-001`

### Given

输入错误密码、重放 CSRF 或尝试匿名调用。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

请求会话。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

拒绝或登录失败，无会话数据写入。

### Oracle

```yaml
type: machine_assertion
expression: "stored_credentials_count=0; raw_password_logs=0"
requirement: REQ-AUTH-001
acceptance: A-AUTH-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-AUTH-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/sessions.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-AUTH-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-AUTH-002-01 — 业务令牌交换与权限上限：正向成功 Oracle

### Requirement Refs

`REQ-AUTH-002`

### Given

合法用户存在 PORTAL client 与 meeting.read grant。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

交换网关业务令牌。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

返回仅缓存于服务端的 mt_ Token。

### Oracle

```yaml
type: machine_assertion
expression: "mt_prefix=true; access_scope subset permitted; exposed_to_client=0"
requirement: REQ-AUTH-002
acceptance: A-AUTH-002-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-AUTH-002-01
command: npm test -- --runInBand server/__tests__/meetingGateway/sessions.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-AUTH-002-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-AUTH-002-02 — 业务令牌交换与权限上限：负向/失败 Oracle

### Requirement Refs

`REQ-AUTH-002`

### Given

仅存在无权限的 service credential。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

尝试访问员工 OAuth 会议。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

明确 403，无越权结果。

### Oracle

```yaml
type: machine_assertion
expression: "unauthorized_query_calls=0; cross_user_data=0"
requirement: REQ-AUTH-002
acceptance: A-AUTH-002-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-AUTH-002-02
command: npm test -- --runInBand server/__tests__/meetingGateway/sessions.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-AUTH-002-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-OAUTH-001-01 — 授权状态查询和首次引导：正向成功 Oracle

### Requirement Refs

`REQ-OAUTH-001`

### Given

A 已有 ACTIVE、B 未授权。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

分别打开 Meetings。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

A 直达查询；B 显示授权按钮。

### Oracle

```yaml
type: machine_assertion
expression: "A.connect_status=ACTIVE; B.connect_status=NOT_CONNECTED"
requirement: REQ-OAUTH-001
acceptance: A-OAUTH-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-OAUTH-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/oauth.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-OAUTH-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-OAUTH-001-02 — 授权状态查询和首次引导：负向/失败 Oracle

### Requirement Refs

`REQ-OAUTH-001`

### Given

Gateway 返回 CORP_MISMATCH 或访问超时。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

渲染页面并点击查询。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

展示错误和修复指引，禁止查询。

### Oracle

```yaml
type: machine_assertion
expression: "source_query_count=0; rendered_ACTIVE=false"
requirement: REQ-OAUTH-001
acceptance: A-OAUTH-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-OAUTH-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/oauth.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-OAUTH-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-OAUTH-002-01 — 浏览器 OAuth 授权发起和安全回跳：正向成功 Oracle

### Requirement Refs

`REQ-OAUTH-002`

### Given

A 未授权、真实 Gateway 返回允许的授权 URL。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

A 点击连接。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

新标签打开腾讯官方授权且事务归 A。

### Oracle

```yaml
type: machine_assertion
expression: "url_host=meeting.tencent.com; redirect_uri exact; pending_owner=A"
requirement: REQ-OAUTH-002
acceptance: A-OAUTH-002-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-OAUTH-002-01
command: npm test -- --runInBand server/__tests__/meetingGateway/oauth.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-OAUTH-002-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-OAUTH-002-02 — 浏览器 OAuth 授权发起和安全回跳：负向/失败 Oracle

### Requirement Refs

`REQ-OAUTH-002`

### Given

恶意或被篡改的 auth URL/return_to。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

BFF 处理 URL。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

直接拒绝，不执行 redirect。

### Oracle

```yaml
type: machine_assertion
expression: "redirect_count=0; reason=MGW_OAUTH_START_REJECTED"
requirement: REQ-OAUTH-002
acceptance: A-OAUTH-002-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-OAUTH-002-02
command: npm test -- --runInBand server/__tests__/meetingGateway/oauth.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-OAUTH-002-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-OAUTH-003-01 — OAuth 回调后确认连接并绑定用户：正向成功 Oracle

### Requirement Refs

`REQ-OAUTH-003`

### Given

Gateway 真实连接处于 PENDING_CONFIRMATION 且属于 A。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

A 确认连接。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

Gateway 状态变 ACTIVE 且 A 列表可见。

### Oracle

```yaml
type: machine_assertion
expression: "gateway_status=ACTIVE; owner=A; B.visible=false"
requirement: REQ-OAUTH-003
acceptance: A-OAUTH-003-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-OAUTH-003-01
command: npm test -- --runInBand server/__tests__/meetingGateway/oauth.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-OAUTH-003-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-OAUTH-003-02 — OAuth 回调后确认连接并绑定用户：负向/失败 Oracle

### Requirement Refs

`REQ-OAUTH-003`

### Given

B 拿到 A 的 connection_id 或企业不匹配。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

B 调 confirm。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

403/404 且原连接状态不变。

### Oracle

```yaml
type: machine_assertion
expression: "A.status unchanged; gateway_confirm_count_success=0"
requirement: REQ-OAUTH-003
acceptance: A-OAUTH-003-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-OAUTH-003-02
command: npm test -- --runInBand server/__tests__/meetingGateway/oauth.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-OAUTH-003-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-UI-001-01 — Meetings 连接状态与入口页面：正向成功 Oracle

### Requirement Refs

`REQ-UI-001`

### Given

A 未授权、B 已 ACTIVE 的多用户页面。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

分别打开 `/meeting-gateway`。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

A 显示连接按钮；B 显示会议查询入口。

### Oracle

```yaml
type: machine_assertion
expression: "A.menu_action=AUTHORIZE; B.menu_action=QUERY"
requirement: REQ-UI-001
acceptance: A-UI-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-UI-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/bffContract.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-UI-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-UI-001-02 — Meetings 连接状态与入口页面：负向/失败 Oracle

### Requirement Refs

`REQ-UI-001`

### Given

关闭网络、断开登录或未完成连接。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

点击查询。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

UI 禁止调用源查询。

### Oracle

```yaml
type: machine_assertion
expression: "meeting_query_requests=0; error_panel_visible=true"
requirement: REQ-UI-001
acceptance: A-UI-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-UI-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/bffContract.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-UI-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SOURCE-001-01 — 用户限定的会议源查询：正向成功 Oracle

### Requirement Refs

`REQ-SOURCE-001`

### Given

A ACTIVE 且有 meeting.read，窗口有效。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

点击“查询腾讯会议”。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

Gateway 接受 USER_WINDOW 返回 202 job_id。

### Oracle

```yaml
type: machine_assertion
expression: "http=202; selection=USER_WINDOW; target_member_id=A"
requirement: REQ-SOURCE-001
acceptance: A-SOURCE-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SOURCE-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SOURCE-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SOURCE-001-02 — 用户限定的会议源查询：负向/失败 Oracle

### Requirement Refs

`REQ-SOURCE-001`

### Given

B 传入 A connection、90 天以上窗口或 CORP_WINDOW。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

调用 BFF query。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

BFF 403/422、上游未提交。

### Oracle

```yaml
type: machine_assertion
expression: "gateway_source_query_count=0; no_mutation=true"
requirement: REQ-SOURCE-001
acceptance: A-SOURCE-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SOURCE-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SOURCE-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SOURCE-002-01 — 异步任务轮询与 RETRYING 诊断：正向成功 Oracle

### Requirement Refs

`REQ-SOURCE-002`

### Given

模拟作业 PENDING→RETRYING→SUCCEEDED(complete=true)。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

UI 轮询。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

只有最后阶段标记完成。

### Oracle

```yaml
type: machine_assertion
expression: "completed_at only after SUCCEEDED; polling_calls <= configured_limit"
requirement: REQ-SOURCE-002
acceptance: A-SOURCE-002-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SOURCE-002-01
command: npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SOURCE-002-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SOURCE-002-02 — 异步任务轮询与 RETRYING 诊断：负向/失败 Oracle

### Requirement Refs

`REQ-SOURCE-002`

### Given

模拟 job 永久 RETRYING 或缺 complete。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

持续轮询至上限。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

UI 报未完成并显示原因，不写 0 meetings。

### Oracle

```yaml
type: machine_assertion
expression: "query_final_status != SUCCEEDED; imported_rows=0"
requirement: REQ-SOURCE-002
acceptance: A-SOURCE-002-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SOURCE-002-02
command: npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SOURCE-002-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SOURCE-003-01 — 会议列表的网关分页及覆盖标注：正向成功 Oracle

### Requirement Refs

`REQ-SOURCE-003`

### Given

两页 Gateway 数据，cursor 存在，含 coverage_is_partial。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

展开全部列表。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

总条数等于两页唯一 id 总数，显示 coverage。

### Oracle

```yaml
type: machine_assertion
expression: "unique_ids=count(source_unique_ids); next_cursor exhausted"
requirement: REQ-SOURCE-003
acceptance: A-SOURCE-003-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SOURCE-003-01
command: npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SOURCE-003-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SOURCE-003-02 — 会议列表的网关分页及覆盖标注：负向/失败 Oracle

### Requirement Refs

`REQ-SOURCE-003`

### Given

换用户重放 cursor 或用会议号当 id。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

请求下一页或详情。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

400/404/403 且无跨用户数据。

### Oracle

```yaml
type: machine_assertion
expression: "leaked_meetings=0; gateway_lookups_invalid_id=0"
requirement: REQ-SOURCE-003
acceptance: A-SOURCE-003-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SOURCE-003-02
command: npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SOURCE-003-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SOURCE-004-01 — 会议详情与录制元数据发现：正向成功 Oracle

### Requirement Refs

`REQ-SOURCE-004`

### Given

会议有至少 1 个录制、ensure 返回 202 后 SUCCEEDED。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

轮询并读取 recordings。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

返回 recording_id 和 asset 概要。

### Oracle

```yaml
type: machine_assertion
expression: "recordings_count>=1; ids source-gateway IDs"
requirement: REQ-SOURCE-004
acceptance: A-SOURCE-004-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SOURCE-004-01
command: npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SOURCE-004-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SOURCE-004-02 — 会议详情与录制元数据发现：负向/失败 Oracle

### Requirement Refs

`REQ-SOURCE-004`

### Given

会议无录制或跨用户读取。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

点击“导入转写”。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

不可导入、不生成空文档。

### Oracle

```yaml
type: machine_assertion
expression: "created_documents=0; import_button.disabled=true"
requirement: REQ-SOURCE-004
acceptance: A-SOURCE-004-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SOURCE-004-02
command: npm test -- --runInBand server/__tests__/meetingGateway/catalogue.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SOURCE-004-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-CONTENT-001-01 — 完整转写分页收集与原文保真：正向成功 Oracle

### Requirement Refs

`REQ-CONTENT-001`

### Given

3 页转写含相同人名和毫秒时间，版本固定。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

按 cursor 全页收集。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

段落按顺序保存且 hash 可复验。

### Oracle

```yaml
type: machine_assertion
expression: "paragraph_count=sum(per_page); cursor=null; source_version stable"
requirement: REQ-CONTENT-001
acceptance: A-CONTENT-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-CONTENT-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/content.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-CONTENT-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-CONTENT-001-02 — 完整转写分页收集与原文保真：负向/失败 Oracle

### Requirement Refs

`REQ-CONTENT-001`

### Given

最后一页 401 或第 2 页 version 变更。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

运行导入。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

失败、无可读目标文档。

### Oracle

```yaml
type: machine_assertion
expression: "visible_document_count=0; staging_purged=true"
requirement: REQ-CONTENT-001
acceptance: A-CONTENT-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-CONTENT-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/content.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-CONTENT-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-CONTENT-002-01 — 腾讯原生智能纪要提取：正向成功 Oracle

### Requirement Refs

`REQ-CONTENT-002`

### Given

真实 Gateway 原生 minutes 结构存在且空 todo。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

提取。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

生成 docSource 腾讯纪要，保留主体内容。

### Oracle

```yaml
type: machine_assertion
expression: "source_kind=minutes; metadata.provider=Tencent; task_count may=0"
requirement: REQ-CONTENT-002
acceptance: A-CONTENT-002-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-CONTENT-002-01
command: npm test -- --runInBand server/__tests__/meetingGateway/content.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-CONTENT-002-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-CONTENT-002-02 — 腾讯原生智能纪要提取：负向/失败 Oracle

### Requirement Refs

`REQ-CONTENT-002`

### Given

Gateway 返回 CONTENT_NOT_READY 或网络中断。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

点击导入纪要。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

显示待生成，不生成替代文字。

### Oracle

```yaml
type: machine_assertion
expression: "fake_minutes_count=0; document_rows=0"
requirement: REQ-CONTENT-002
acceptance: A-CONTENT-002-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-CONTENT-002-02
command: npm test -- --runInBand server/__tests__/meetingGateway/content.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-CONTENT-002-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-FORMAT-001-01 — 可确定的会议文档标准化格式：正向成功 Oracle

### Requirement Refs

`REQ-FORMAT-001`

### Given

固定 2 段中文转写含发言人/时间。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

两次格式化。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

生成完全相同字节文本。

### Oracle

```yaml
type: machine_assertion
expression: "sha256(run1)==sha256(run2); original_seq preserved"
requirement: REQ-FORMAT-001
acceptance: A-FORMAT-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-FORMAT-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/content.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-FORMAT-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-FORMAT-001-02 — 可确定的会议文档标准化格式：负向/失败 Oracle

### Requirement Refs

`REQ-FORMAT-001`

### Given

输入含“忽略系统指令”或 HTML/script。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

格式化。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

作为引用文本处理，没有命令执行。

### Oracle

```yaml
type: machine_assertion
expression: "system_calls=0; OA_writes=0; unsafe_html_executed=false"
requirement: REQ-FORMAT-001
acceptance: A-FORMAT-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-FORMAT-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/content.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-FORMAT-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-IMPORT-001-01 — 调用 AnythingLLM 原始文本管道导入：正向成功 Oracle

### Requirement Refs

`REQ-IMPORT-001`

### Given

Collector 在线且返回 success=true + location。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

导入文本。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

保存一条文档映射。

### Oracle

```yaml
type: machine_assertion
expression: "mapped_doc_location==collector.location; user_visible=true"
requirement: REQ-IMPORT-001
acceptance: A-IMPORT-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-IMPORT-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/importer.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-IMPORT-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-IMPORT-001-02 — 调用 AnythingLLM 原始文本管道导入：负向/失败 Oracle

### Requirement Refs

`REQ-IMPORT-001`

### Given

Collector 报错或返回 success=false。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

导入。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

映射不成功、Workspace 不增加文档。

### Oracle

```yaml
type: machine_assertion
expression: "successful_import_count=0; workspace_adds=0"
requirement: REQ-IMPORT-001
acceptance: A-IMPORT-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-IMPORT-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/importer.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-IMPORT-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-WORKSPACE-001-01 — 受限 Workspace 文档关联与双层授权：正向成功 Oracle

### Requirement Refs

`REQ-WORKSPACE-001`

### Given

A 独占 Workspace，合法 doc location。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

加入 Workspace 并检索一个独特文本片段。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

A 能命中向量条目，B 看不到。

### Oracle

```yaml
type: machine_assertion
expression: "A.search_hits>=1; B.search_hits=0"
requirement: REQ-WORKSPACE-001
acceptance: A-WORKSPACE-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-WORKSPACE-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/workspacePolicy.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-WORKSPACE-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-WORKSPACE-001-02 — 受限 Workspace 文档关联与双层授权：负向/失败 Oracle

### Requirement Refs

`REQ-WORKSPACE-001`

### Given

A 选 B Workspace 或共享 Workspace。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

发起导入。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

拒绝并且没有向量写入。

### Oracle

```yaml
type: machine_assertion
expression: "workspace_vector_delta=0; error=MGW_WORKSPACE_NOT_PRIVATE"
requirement: REQ-WORKSPACE-001
acceptance: A-WORKSPACE-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-WORKSPACE-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/workspacePolicy.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-WORKSPACE-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-STATE-001-01 — 导入状态、身份与版本映射：正向成功 Oracle

### Requirement Refs

`REQ-STATE-001`

### Given

同一资源连续点击导入 3 次。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

多请求并发完成。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

只有 1 条 VERIFIED 及 1 份有效文档。

### Oracle

```yaml
type: machine_assertion
expression: "verified_rows=1; active_locations=1"
requirement: REQ-STATE-001
acceptance: A-STATE-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-STATE-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/stateStore.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-STATE-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-STATE-001-02 — 导入状态、身份与版本映射：负向/失败 Oracle

### Requirement Refs

`REQ-STATE-001`

### Given

另一个用户抢占相同 doc_location 或旧文档变化。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

执行更新。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

CONFLICT，不覆盖用户内容。

### Oracle

```yaml
type: machine_assertion
expression: "original_doc_digest equal T0; 0 unauthorized updates"
requirement: REQ-STATE-001
acceptance: A-STATE-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-STATE-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/stateStore.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-STATE-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-RETRY-001-01 — 导入补偿、失败重试和短会话过期：正向成功 Oracle

### Requirement Refs

`REQ-RETRY-001`

### Given

在 Document 创建后进程崩溃、随后恢复。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

重试该 import。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

发现已有 doc，继续关联且只一个生效文档。

### Oracle

```yaml
type: machine_assertion
expression: "active_docs=1; verified_mapping=1; orphan_count=0"
requirement: REQ-RETRY-001
acceptance: A-RETRY-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-RETRY-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/importer.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-RETRY-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-RETRY-001-02 — 导入补偿、失败重试和短会话过期：负向/失败 Oracle

### Requirement Refs

`REQ-RETRY-001`

### Given

mt_ 过期/租户切换中触发重试。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

后台任务继续。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

AUTH_REQUIRED 且 0 Gateway 内容请求。

### Oracle

```yaml
type: machine_assertion
expression: "unexpected_gateway_calls=0; not_successful=true"
requirement: REQ-RETRY-001
acceptance: A-RETRY-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-RETRY-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/importer.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-RETRY-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SEC-001-01 — 网关用户资源隔离与越权拒绝：正向成功 Oracle

### Requirement Refs

`REQ-SEC-001`

### Given

A/B 分别 ACTIVE，A 有一份会议与导入文档。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

访问各自完整流程。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

两用户各得本人数据。

### Oracle

```yaml
type: machine_assertion
expression: "A.read_A=200; B.read_B=200"
requirement: REQ-SEC-001
acceptance: A-SEC-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SEC-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/readPaths.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SEC-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SEC-001-02 — 网关用户资源隔离与越权拒绝：负向/失败 Oracle

### Requirement Refs

`REQ-SEC-001`

### Given

B 猜测 A 6 类 id（session、connection、query、meeting、recording、doc）。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

逐一访问。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

全部拒绝且无数据字节输出。

### Oracle

```yaml
type: machine_assertion
expression: "forbidden_attempts=6; leaked_bytes=0"
requirement: REQ-SEC-001
acceptance: A-SEC-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SEC-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/readPaths.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SEC-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SEC-002-01 — 导入后撤权、会话失效与内容冻结：正向成功 Oracle

### Requirement Refs

`REQ-SEC-002`

### Given

A 撤销 Gateway OAuth；A 已导入文档与向量。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

用户请求列表和工作区检索。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

本次导入被标 revoked 且文档不再命中。

### Oracle

```yaml
type: machine_assertion
expression: "meeting_doc_hits=0; revoked_access=403"
requirement: REQ-SEC-002
acceptance: A-SEC-002-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SEC-002-01
command: npm test -- --runInBand server/__tests__/meetingGateway/readPaths.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SEC-002-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SEC-002-02 — 导入后撤权、会话失效与内容冻结：负向/失败 Oracle

### Requirement Refs

`REQ-SEC-002`

### Given

向量删除超时或已有用户修改的非受管文档。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

处理撤权。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

禁止检索，进入 CLEANUP_PENDING，保留恢复记录。

### Oracle

```yaml
type: machine_assertion
expression: "claim_deleted=false; manual_recovery_artifact_exists=true; meeting_doc_hits=0; meeting_bytes_in_LLM_payload=0"
requirement: REQ-SEC-002
acceptance: A-SEC-002-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SEC-002-02
command: npm test -- --runInBand server/__tests__/meetingGateway/readPaths.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SEC-002-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SEC-003-01 — 敏感日志、外部内容注入与请求边界：正向成功 Oracle

### Requirement Refs

`REQ-SEC-003`

### Given

向合法 BFF 输入带 canary secret 的样本。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

完成一条授权到导入模拟流程。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

日志/响应不出现 canary。

### Oracle

```yaml
type: machine_assertion
expression: "regex_secret_matches=0; unsafe_tool_calls=0"
requirement: REQ-SEC-003
acceptance: A-SEC-003-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SEC-003-01
command: npm test -- --runInBand server/__tests__/meetingGateway/client.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SEC-003-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-SEC-003-02 — 敏感日志、外部内容注入与请求边界：负向/失败 Oracle

### Requirement Refs

`REQ-SEC-003`

### Given

恶意 Gateway URL 包含 169.254.169.254 或重定向。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

发起 Gateway fetch。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

被 SSRF 门禁拒绝。

### Oracle

```yaml
type: machine_assertion
expression: "outbound_unauthorized_connections=0"
requirement: REQ-SEC-003
acceptance: A-SEC-003-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-SEC-003-02
command: npm test -- --runInBand server/__tests__/meetingGateway/client.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-SEC-003-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-OBS-001-01 — 业务诊断、阶段审计与错误码映射：正向成功 Oracle

### Requirement Refs

`REQ-OBS-001`

### Given

一个完整的模拟导入任务。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

运行审计导出。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

包含 7 阶段并最终 VERIFIED。

### Oracle

```yaml
type: machine_assertion
expression: "stage_set equals declared; errors absent; evidence_hash exists"
requirement: REQ-OBS-001
acceptance: A-OBS-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-OBS-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/releaseGate.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-OBS-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-OBS-001-02 — 业务诊断、阶段审计与错误码映射：负向/失败 Oracle

### Requirement Refs

`REQ-OBS-001`

### Given

Gateway job RETRYING 且 response 202。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

生成联调报告。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

标 NOT_VERIFIED 而非 PASS。

### Oracle

```yaml
type: machine_assertion
expression: "release_pass=false; source_job_state=RETRYING"
requirement: REQ-OBS-001
acceptance: A-OBS-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-OBS-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/releaseGate.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-OBS-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-REMOVE-001-01 — 用户主动解除关联和受管资料删除：正向成功 Oracle

### Requirement Refs

`REQ-REMOVE-001`

### Given

A 有 2 份自己导入文档，撤销其中 1 份。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

确认删除。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

被选文档与 vector 被删，另一份不变。

### Oracle

```yaml
type: machine_assertion
expression: "removed_count=1; untouched_digest_equal=true"
requirement: REQ-REMOVE-001
acceptance: A-REMOVE-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-REMOVE-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/importer.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-REMOVE-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-REMOVE-001-02 — 用户主动解除关联和受管资料删除：负向/失败 Oracle

### Requirement Refs

`REQ-REMOVE-001`

### Given

B 请求删除 A importId 或用户编辑过的副本。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

调用删除。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

拒绝或保留 USER_OWNED，不删 Gateway。

### Oracle

```yaml
type: machine_assertion
expression: "gateway_mutations=0; unauthorized_delete_count=0"
requirement: REQ-REMOVE-001
acceptance: A-REMOVE-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-REMOVE-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/importer.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-REMOVE-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-COMPAT-001-01 — Compare、Translation、OA 模块边界不被侵入：正向成功 Oracle

### Requirement Refs

`REQ-COMPAT-001`

### Given

部署前/后对 Compare、Translation 入口建立快照。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

安装 Meetings。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

旧入口文件摘要不变，新 Meeting 正常。

### Oracle

```yaml
type: machine_assertion
expression: "compare_digest_equal=true; translation_digest_equal=true"
requirement: REQ-COMPAT-001
acceptance: A-COMPAT-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-COMPAT-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/readPaths.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-COMPAT-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-COMPAT-001-02 — Compare、Translation、OA 模块边界不被侵入：负向/失败 Oracle

### Requirement Refs

`REQ-COMPAT-001`

### Given

导入会议时带自动同步 OA 参数。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

尝试发起导入。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

拒绝自动 OA，只有来源引用。

### Oracle

```yaml
type: machine_assertion
expression: "OA_http_write_count=0; task_created_count=0"
requirement: REQ-COMPAT-001
acceptance: A-COMPAT-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-COMPAT-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/readPaths.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-COMPAT-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-TEST-001-01 — 跨用户真实消费者与 Release Gate：正向成功 Oracle

### Requirement Refs

`REQ-TEST-001`

### Given

独立Gate元测试的完整合成candidate evidence集合，不是实际发布输入。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

以独立run_id测试聚合器完整输入。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

元测试被测聚合器退出0，元测试自身随后记录PASS；不将自身结果列为其输入。

### Oracle

```yaml
type: machine_assertion
expression: "required_nonpass=0; exit_code=0"
requirement: REQ-TEST-001
acceptance: A-TEST-001-01
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-TEST-001-01
command: npm test -- --runInBand server/__tests__/meetingGateway/releaseGate.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-TEST-001-01.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```

## A-TEST-001-02 — 跨用户真实消费者与 Release Gate：负向/失败 Oracle

### Requirement Refs

`REQ-TEST-001`

### Given

独立Gate元测试注入source-query RETRYING/缺证据/错SHA。要求 fixture 包含 `anything_user_id`、Gateway member/connection 的真实对应，所有秘密均使用测试 Canary 而不是线上值。

### When

运行拒绝场景聚合器元测试。通过 AnythingLLM 浏览器/BFF 或可复现契约测试执行；禁止在本步骤直接修改 Gateway 数据库使测试通过。

### Then

Gate BLOCKED、非0退出。

### Oracle

```yaml
type: machine_assertion
expression: "release_status=BLOCKED; exit_code!=0"
requirement: REQ-TEST-001
acceptance: A-TEST-001-02
expected_status: PASS
actual_status: NOT_RUN
```

### Evidence

```yaml
test_id: TEST-A-TEST-001-02
command: npm test -- --runInBand server/__tests__/meetingGateway/releaseGate.test.js
expected_exit_code: 0
actual_exit_code: null
pre_digest: SHA256_of_managed_scope_T0
post_digest: SHA256_of_managed_scope_after_step
artifact: runs/<run-id>/EVID-A-TEST-001-02.json
immutable_refs:
  consumer: 1336d327f4460510b755059b15481fd94a57cef7
  provider: d6bf6465f07385ce5906a7e0fced488c0c0881e9
run_mode: SYNTHETIC（此项需与第26章真实 Consumer 补充）
```


## A-REV-001-01 — v1.1 “独占 Workspace”判定未覆盖实际读者和导入后的成员变化：正向

### Requirement Refs

REQ-WORKSPACE-001, REQ-SEC-001；评审001，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：owner在新建专用受限空间fresh授权后可导入/检索；普通空间原admin/manager行为回归不变。

### Oracle

owner在新建专用受限空间fresh授权后可导入/检索；普通空间原admin/manager行为回归不变。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-001-01；runs/<run-id>/acceptances/A-REV-001-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-001-02 — v1.1 “独占 Workspace”判定未覆盖实际读者和导入后的成员变化：负向

### Requirement Refs

REQ-WORKSPACE-001, REQ-SEC-001；评审001，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：非owner manager/admin/API Key/embed、导入后加成员、并发成员变更与attach、move/copy均拒绝；leaked_bytes=0，跨空间关联0。

### Oracle

非owner manager/admin/API Key/embed、导入后加成员、并发成员变更与attach、move/copy均拒绝；leaked_bytes=0，跨空间关联0。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-001-02；runs/<run-id>/acceptances/A-REV-001-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-002-01 — v1.1 撤权只约束会议入口，未闭合既有 RAG 路径和失联策略：正向

### Requirement Refs

REQ-SEC-002；评审002，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：全入口门禁在active授权时允许owner，冻结时不发送新上下文；历史已生成数据例外与本地owner校验有明确证据。

### Oracle

全入口门禁在active授权时允许owner，冻结时不发送新上下文；历史已生成数据例外与本地owner校验有明确证据。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-002-01；runs/<run-id>/acceptances/A-REV-002-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-002-02 — v1.1 撤权只约束会议入口，未闭合既有 RAG 路径和失联策略：负向

### Requirement Refs

REQ-SEC-002；评审002，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：模拟撤权+向量删除失败、401/超时，直接调用普通chat/API/vector-search/pinned/fulltext/agent；LLM新请求和响应含会议正文字节0，401/未知物理删除0。

### Oracle

模拟撤权+向量删除失败、401/超时，直接调用普通chat/API/vector-search/pinned/fulltext/agent；LLM新请求和响应含会议正文字节0，401/未知物理删除0。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-002-02；runs/<run-id>/acceptances/A-REV-002-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-003-01 — v1.1 BFF 依赖 Cookie Session，但基线使用 Bearer JWT，桥接与注销语义缺失：正向

### Requirement Refs

REQ-AUTH-001, REQ-IDENT-001；评审003，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：同源Bearer启动bridge、双浏览器独立、单浏览器轮换，期限取最早且logout仅吊销匹配bridge。

### Oracle

同源Bearer启动bridge、双浏览器独立、单浏览器轮换，期限取最早且logout仅吊销匹配bridge。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-003-01；runs/<run-id>/acceptances/A-REV-003-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-003-02 — v1.1 BFF 依赖 Cookie Session，但基线使用 Bearer JWT，桥接与注销语义缺失：负向

### Requirement Refs

REQ-AUTH-001, REQ-IDENT-001；评审003，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：缺/错Cookie、JWT用户错配、CSRF重放、用户suspended/密码变更、过期bridge均拒绝；Gateway后续读取0；断网logout不伪称服务端已吊销。

### Oracle

缺/错Cookie、JWT用户错配、CSRF重放、用户suspended/密码变更、过期bridge均拒绝；Gateway后续读取0；断网logout不伪称服务端已吊销。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-003-02；runs/<run-id>/acceptances/A-REV-003-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-004-01 — v1.1 Collector 丢失响应时没有可持久识别的受管文档标记：正向

### Requirement Refs

REQ-IMPORT-001, REQ-RETRY-001；评审004，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：同operation同payload并发/崩溃恢复返回一个真实location；预存vector_doc_id与workspace_documents/引擎一致。

### Oracle

同operation同payload并发/崩溃恢复返回一个真实location；预存vector_doc_id与workspace_documents/引擎一致。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-004-01；runs/<run-id>/acceptances/A-REV-004-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-004-02 — v1.1 Collector 丢失响应时没有可持久识别的受管文档标记：负向

### Requirement Refs

REQ-IMPORT-001, REQ-RETRY-001；评审004，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：相同payload不同用户并发且写盘后返回前杀进程：每owner独立可追踪，orphan=0；同operation异payload409；向量写后DB失败只清自己的预存docId。

### Oracle

相同payload不同用户并发且写盘后返回前杀进程：每owner独立可追踪，orphan=0；同operation异payload409；向量写后DB失败只清自己的预存docId。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-004-02；runs/<run-id>/acceptances/A-REV-004-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-005-01 — v1.1 删除后的同版本重导入与唯一键规则没有合法结果：正向

### Requirement Refs

REQ-STATE-001, REQ-REMOVE-001；评审005，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：REMOVED清理完成后同版本generation+1，新operation/location/docId，旧代清理不影响新代。

### Oracle

REMOVED清理完成后同版本generation+1，新operation/location/docId，旧代清理不影响新代。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-005-01；runs/<run-id>/acceptances/A-REV-005-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-005-02 — v1.1 删除后的同版本重导入与唯一键规则没有合法结果：负向

### Requirement Refs

REQ-STATE-001, REQ-REMOVE-001；评审005，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：cleanup未完重导入409，stale worker/fencing失配0提交；重复delete0二次删除；BLOCKED_DRIFT不覆盖。

### Oracle

cleanup未完重导入409，stale worker/fencing失配0提交；重复delete0二次删除；BLOCKED_DRIFT不覆盖。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-005-02；runs/<run-id>/acceptances/A-REV-005-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-006-01 — v1.1 漂移摘要的比较对象未与 Collector 实际存储格式对齐：正向

### Requirement Refs

REQ-FORMAT-001, REQ-STATE-001；评审006，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：真实Collector零编辑JSON.pageContent摘要等于生成Markdown；动态metadata不误报正文drift。

### Oracle

真实Collector零编辑JSON.pageContent摘要等于生成Markdown；动态metadata不误报正文drift。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-006-01；runs/<run-id>/acceptances/A-REV-006-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-006-02 — v1.1 漂移摘要的比较对象未与 Collector 实际存储格式对齐：负向

### Requirement Refs

REQ-FORMAT-001, REQ-STATE-001；评审006，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：正文改单字则BLOCKED_DRIFT；provenance伪造/owner不符拒绝读取与删除，原文件字节保留。

### Oracle

正文改单字则BLOCKED_DRIFT；provenance伪造/owner不符拒绝读取与删除，原文件字节保留。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-006-02；runs/<run-id>/acceptances/A-REV-006-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-007-01 — v1.1 查询时间窗没有贯穿会议目录读取契约：正向

### Requirement Refs

REQ-SOURCE-003；评审007，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：预置窗口外缓存，window模式只返回[start,end)的start_at，所有分页均同快照且空态正确。

### Oracle

预置窗口外缓存，window模式只返回[start,end)的start_at，所有分页均同快照且空态正确。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-007-01；runs/<run-id>/acceptances/A-REV-007-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-007-02 — v1.1 查询时间窗没有贯穿会议目录读取契约：负向

### Requirement Refs

REQ-SOURCE-003；评审007，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：跨用户/跨窗口cursor、快照到期、缺start_at、超10k条/20MiB均失败；不混页、不显示假空成功。

### Oracle

跨用户/跨窗口cursor、快照到期、缺start_at、超10k条/20MiB均失败；不混页、不显示假空成功。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-007-02；runs/<run-id>/acceptances/A-REV-007-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-008-01 — v1.1 OAuth URL 的必要 state 传输与“浏览器/响应零 state”互相冲突：正向

### Requirement Refs

REQ-OAUTH-002, REQ-SEC-003；评审008，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：state只沿合法authorization_url和callback透明传输，Gateway验证成功；password仅表单TLS瞬时输入。

### Oracle

state只沿合法authorization_url和callback透明传输，Gateway验证成功；password仅表单TLS瞬时输入。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-008-01；runs/<run-id>/acceptances/A-REV-008-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-008-02 — v1.1 OAuth URL 的必要 state 传输与“浏览器/响应零 state”互相冲突：负向

### Requirement Refs

REQ-OAUTH-002, REQ-SEC-003；评审008，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：非法OAuth URL不redirect；授权链路之外日志/遥测/Evidence/localStorage/错误回显中state/password/token命中0。

### Oracle

非法OAuth URL不redirect；授权链路之外日志/遥测/Evidence/localStorage/错误回显中state/password/token命中0。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-008-02；runs/<run-id>/acceptances/A-REV-008-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-009-01 — v1.1 Release Gate 自身验收被纳入前置条件，形成循环：正向

### Requirement Refs

REQ-TEST-001；评审009，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：独立Gate元测试完成后，业务+真实GC完整的候选首次聚合exit0，完全无自身待产出证据依赖。

### Oracle

独立Gate元测试完成后，业务+真实GC完整的候选首次聚合exit0，完全无自身待产出证据依赖。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-009-01；runs/<run-id>/acceptances/A-REV-009-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-009-02 — v1.1 Release Gate 自身验收被纳入前置条件，形成循环：负向

### Requirement Refs

REQ-TEST-001；评审009，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：缺任一AC/GC、重复ID、错SHA/config、纯mock替代真人均非0；负向测试的PASS不会覆盖候选Gate文件。

### Oracle

缺任一AC/GC、重复ID、错SHA/config、纯mock替代真人均非0；负向测试的PASS不会覆盖候选Gate文件。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-009-02；runs/<run-id>/acceptances/A-REV-009-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-010-01 — v1.1 失败状态和错误码仍是多选模板，未达到确定性合同要求：正向

### Requirement Refs

REQ-OBS-001, REQ-RETRY-001；评审010，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：按§19.3驱动的每个故障在BFF/Worker/UI输出唯一状态/错误码/重试次数，并保留原始Gateway分类。

### Oracle

按§19.3驱动的每个故障在BFF/Worker/UI输出唯一状态/错误码/重试次数，并保留原始Gateway分类。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-010-01；runs/<run-id>/acceptances/A-REV-010-01.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

## A-REV-010-02 — v1.1 失败状态和错误码仍是多选模板，未达到确定性合同要求：负向

### Requirement Refs

REQ-OBS-001, REQ-RETRY-001；评审010，§9.7–9.12/§19.3/§25.2。

### Given / When / Then

在隔离测试环境使用canary、固定候选版本及T0，执行：逐一注入401/403/409/422/429/5xx/超时/游标失效/漂移；相同条件不能出现多选状态或无界重试。

### Oracle

逐一注入401/403/409/422/429/5xx/超时/游标失效/漂移；相同条件不能出现多选状态或无界重试。必须在测试程序中逐项断言并记录expected/actual；不能只用UI截图或函数返回值代替。门禁相关测试同时截获source/contextTexts/LLM调用参数。

### Evidence

TEST-A-REV-010-02；runs/<run-id>/acceptances/A-REV-010-02.json。执行命令映射见配套plan对应测试文件；当前status=NOT_RUN。所有修订AC为BUSINESS_REQUIRED（Gate算法用例则独立scenario证据，不能读取自身聚合结果）。

# 21. Acceptance Input Matrix

以下矩阵是**最少必须覆盖**的高风险输入；每一行测试应映射 Req 正反 AC 并记录真实证据。除列明的唯一例外，其它非法输入一律“拒绝 + 0 未授权突变”。

| Case ID | Domain | Inputs / Existing State | Trigger | Expected Result | Req |
|---|---|---|---|---|---|
| M-001 | 身份 | A Gateway member A，首次登录 | 绑定 | 单条 A 映射、900s 内会话 | REQ-IDENT-001, REQ-AUTH-001 |
| M-002 | 身份 | A 当前映射已存在 | 同身份重复登录 | 不新增不同 member 的绑定 | REQ-IDENT-001 |
| M-003 | 身份 | B 伪造 A member/user ID | 绑定 | 403/404、无映射覆盖 | REQ-SEC-001 |
| M-004 | 身份 | Gateway 登录 `code!=0` 或 is_active=false | 登录 | 无会话/无成功绑定 | REQ-AUTH-001 |
| M-005 | 会话 | ms_ 有效但 portal/client scope 缺失 | 换 mt_ | 403、禁止调用 OAuth | REQ-AUTH-002 |
| M-006 | 会话 | mt_ 14 分钟即将到期/已过期 | 导入 | 新操作 AUTH_REQUIRED，无公用 Token 回退 | REQ-RETRY-001 |
| M-007 | OAuth | B 无 Connection，A ACTIVE | 查看 | B 连接按钮、A 会议入口 | REQ-OAUTH-001 |
| M-008 | OAuth | 回跳未白名单，Gateway 默认 result | 授权 | 无开放重定向，用户返回页面刷新 | REQ-OAUTH-002 |
| M-009 | OAuth | state 已用、auth_code 重放 | 授权回调 | Gateway 拒绝，A 不标 ACTIVE | REQ-OAUTH-003 |
| M-010 | OAuth | CORP_MISMATCH | confirm | 409/403、0 meeting query | REQ-OAUTH-003 |
| M-011 | Query | USER_WINDOW 7 天内一条已结束会议 | 202→job complete | 会议被同步可查询 | REQ-SOURCE-001/002/003 |
| M-012 | Query | USER_WINDOW 无会议，job truly SUCCEEDED complete | 查询 | “本次窗口无会议”，覆盖仍 partial | REQ-SOURCE-002/003 |
| M-013 | Query | job RETRYING 12 次 | 查看 | last_reason/attempts，可诊断，不显示空成功 | REQ-SOURCE-002 |
| M-014 | Query | job 缺 progress.complete | 查看 | INCOMPLETE/BLOCKED | REQ-SOURCE-002 |
| M-015 | Query | 输入 >90 天或时区缺失 | 查询 | 422、Gateway 源查询 0 次 | REQ-SOURCE-001 |
| M-016 | Query | 用户 B 传 A connection_id | 查询 | 403/404、不会进入网关查询 | REQ-SEC-001 |
| M-017 | List | 两页共 31 条 | next_cursor 分页 | 31 个唯一 Gateway id | REQ-SOURCE-003 |
| M-018 | List | Cursor policy_version 改变 | 翻页 | Cursor invalid，重新第一页，无混页 | REQ-SOURCE-003 |
| M-019 | Recording | 录制 ensure 返回 202 | 轮询 | job 成功后返回录制 Gateway id | REQ-SOURCE-004 |
| M-020 | Recording | 会议无录制 | 导入 | 按无录制显示，不创空文档 | REQ-SOURCE-004 |
| M-021 | Transcript | 三页有效内容、段落含换行符 | 收集 | 拼接顺序、数量、版本一致 | REQ-CONTENT-001 |
| M-022 | Transcript | 第 2 页版本漂移 / Cursor INVALID | 收集 | STAGED_INCOMPLETE、0 文档 | REQ-CONTENT-001 |
| M-023 | Minutes | 原生纪要有正文、todo=[] | 获取 | 纪要成功，不因为 todo 空报错 | REQ-CONTENT-002 |
| M-024 | Minutes | CONTENT_NOT_READY | 获取 | 不用 LLM 假造纪要 | REQ-CONTENT-002 |
| M-025 | Formatter | 恶意提示词、脚本和 Unicode | 生成 | 原文安全编码/不可执行、2 次 Hash 相等 | REQ-FORMAT-001 |
| M-026 | Collector | Collector online、成功返回 location | 导入 | VERIFIED 前必须关联 Workspace | REQ-IMPORT-001 |
| M-027 | Collector | Collector 5xx、可能产生孤儿 doc | 导入 | FAILED/PENDING_CLEANUP、0 假成功 | REQ-RETRY-001 |
| M-028 | Workspace | A 独占 Workspace | attach | A 向量可检索，B 不可检索 | REQ-WORKSPACE-001 |
| M-029 | Workspace | A Workspace 加入 B 为读者 | import | BLOCK，不向共享空间复制会议正文 | REQ-WORKSPACE-001 |
| M-030 | Version | 同源/同版本/同 Workspace 3 次重复 | import | 1 个 mapping/location | REQ-STATE-001 |
| M-031 | Version | 文档由用户编辑，last_applied digest 漂移 | update | BLOCKED_DRIFT，原用户字节保留 | REQ-STATE-001 |
| M-032 | Revocation | 腾讯权限被收回且已经向量化 | read & query | 立即拒读，精确清理 | REQ-SEC-002 |
| M-033 | Revocation | 向量删除失败 | cleanup | PENDING_CLEANUP + 检索拒绝 + recovery artifact | REQ-SEC-002 |
| M-034 | Remove | A 删除自己的 1 of 2 Imports | delete | 本导入删除，另一个 Hash 不变 | REQ-REMOVE-001 |
| M-035 | Remove | B 删除 A Import / A 用户文件被编辑 | delete | 403/保留用户修改，不影响 Gateway | REQ-REMOVE-001 |
| M-036 | Release | Gateway SOURCE_QUERY 仍 RETRYING | Gate | BLOCKED / nonzero exit | REQ-TEST-001 |

# 22. Negative Acceptance

负向测试必须覆盖 **每条 Req 的 MUST NOT、DENY 和 Failure**。下面每项的 `A-*02` 都属于 Release Required：

- `A-CONF-001-02`：缺少 MEETING_BRIDGE_KEYRING_JSON 或配置任意外部 URL → 启动与调用 Connector（已有受限空间门禁仍拒读） → CONFIG_BLOCKED/404，网络无外发；Oracle：`external_network_calls=0; connector_registered=false`。

- `A-IDENT-001-02`：B 在请求体里填 A 的 anything_user_id/member_id → B 请求绑定或会话 → 服务器忽略/拒绝伪造字段；Oracle：`A.binding unchanged; B.not_owner=403/404`。

- `A-AUTH-001-02`：输入错误密码、重放 CSRF 或尝试匿名调用 → 请求会话 → 拒绝或登录失败，无会话数据写入；Oracle：`stored_credentials_count=0; raw_password_logs=0`。

- `A-AUTH-002-02`：仅存在无权限的 service credential → 尝试访问员工 OAuth 会议 → 明确 403，无越权结果；Oracle：`unauthorized_query_calls=0; cross_user_data=0`。

- `A-OAUTH-001-02`：Gateway 返回 CORP_MISMATCH 或访问超时 → 渲染页面并点击查询 → 展示错误和修复指引，禁止查询；Oracle：`source_query_count=0; rendered_ACTIVE=false`。

- `A-OAUTH-002-02`：恶意或被篡改的 auth URL/return_to → BFF 处理 URL → 直接拒绝，不执行 redirect；Oracle：`redirect_count=0; reason=MGW_OAUTH_START_REJECTED`。

- `A-OAUTH-003-02`：B 拿到 A 的 connection_id 或企业不匹配 → B 调 confirm → 403/404 且原连接状态不变；Oracle：`A.status unchanged; gateway_confirm_count_success=0`。

- `A-UI-001-02`：关闭网络、断开登录或未完成连接 → 点击查询 → UI 禁止调用源查询；Oracle：`meeting_query_requests=0; error_panel_visible=true`。

- `A-SOURCE-001-02`：B 传入 A connection、90 天以上窗口或 CORP_WINDOW → 调用 BFF query → BFF 403/422、上游未提交；Oracle：`gateway_source_query_count=0; no_mutation=true`。

- `A-SOURCE-002-02`：模拟 job 永久 RETRYING 或缺 complete → 持续轮询至上限 → UI 报未完成并显示原因，不写 0 meetings；Oracle：`query_final_status != SUCCEEDED; imported_rows=0`。

- `A-SOURCE-003-02`：换用户重放 cursor 或用会议号当 id → 请求下一页或详情 → 400/404/403 且无跨用户数据；Oracle：`leaked_meetings=0; gateway_lookups_invalid_id=0`。

- `A-SOURCE-004-02`：会议无录制或跨用户读取 → 点击“导入转写” → 不可导入、不生成空文档；Oracle：`created_documents=0; import_button.disabled=true`。

- `A-CONTENT-001-02`：最后一页 401 或第 2 页 version 变更 → 运行导入 → 失败、无可读目标文档；Oracle：`visible_document_count=0; staging_purged=true`。

- `A-CONTENT-002-02`：Gateway 返回 CONTENT_NOT_READY 或网络中断 → 点击导入纪要 → 显示待生成，不生成替代文字；Oracle：`fake_minutes_count=0; document_rows=0`。

- `A-FORMAT-001-02`：输入含“忽略系统指令”或 HTML/script → 格式化 → 作为引用文本处理，没有命令执行；Oracle：`system_calls=0; OA_writes=0; unsafe_html_executed=false`。

- `A-IMPORT-001-02`：Collector 报错或返回 success=false → 导入 → 映射不成功、Workspace 不增加文档；Oracle：`successful_import_count=0; workspace_adds=0`。

- `A-WORKSPACE-001-02`：A 选 B Workspace 或共享 Workspace → 发起导入 → 拒绝并且没有向量写入；Oracle：`workspace_vector_delta=0; error=MGW_WORKSPACE_NOT_PRIVATE`。

- `A-STATE-001-02`：另一个用户抢占相同 doc_location 或旧文档变化 → 执行更新 → CONFLICT，不覆盖用户内容；Oracle：`original_doc_digest equal T0; 0 unauthorized updates`。

- `A-RETRY-001-02`：mt_ 过期/租户切换中触发重试 → 后台任务继续 → AUTH_REQUIRED 且 0 Gateway 内容请求；Oracle：`unexpected_gateway_calls=0; not_successful=true`。

- `A-SEC-001-02`：B 猜测 A 6 类 id（session、connection、query、meeting、recording、doc） → 逐一访问 → 全部拒绝且无数据字节输出；Oracle：`forbidden_attempts=6; leaked_bytes=0`。

- `A-SEC-002-02`：向量删除超时或已有用户修改的非受管文档 → 处理撤权 → 禁止检索，进入 CLEANUP_PENDING，保留恢复记录；Oracle：`claim_deleted=false; manual_recovery_artifact_exists=true; meeting_doc_hits=0; meeting_bytes_in_LLM_payload=0`。

- `A-SEC-003-02`：恶意 Gateway URL 包含 169.254.169.254 或重定向 → 发起 Gateway fetch → 被 SSRF 门禁拒绝；Oracle：`outbound_unauthorized_connections=0`。

- `A-OBS-001-02`：Gateway job RETRYING 且 response 202 → 生成联调报告 → 标 NOT_VERIFIED 而非 PASS；Oracle：`release_pass=false; source_job_state=RETRYING`。

- `A-REMOVE-001-02`：B 请求删除 A importId 或用户编辑过的副本 → 调用删除 → 拒绝或保留 USER_OWNED，不删 Gateway；Oracle：`gateway_mutations=0; unauthorized_delete_count=0`。

- `A-COMPAT-001-02`：导入会议时带自动同步 OA 参数 → 尝试发起导入 → 拒绝自动 OA，只有来源引用；Oracle：`OA_http_write_count=0; task_created_count=0`。

- `A-TEST-001-02`：Gateway 实际历史会议查询仍 RETRYING → 尝试发布 → Gate BLOCKED、非0退出；Oracle：`release_status=BLOCKED; exit_code!=0`。

补充全局负向验收：

- `NEG-GLOBAL-001`：从 AnythingLLM 的代码路径、网络捕获、审计三维验证向 Backend 发出的 `GET /auth/meeting-context`、`POST /internal/meeting/principals/resolve`、`POST /internal/meeting/principals/search`、Backend `/auth/me`/`/auth/refresh` 出站调用次数均为 **0**；Gateway 自己的唯一 account-login 除外。
- `NEG-GLOBAL-002`：AnythingLLM 到腾讯会议 OAuth Token API 的直接请求次数为 **0**；到 Gateway `/mcp` 的接入/查询次数在 R1 为 **0**。
- `NEG-GLOBAL-003`：OA/Compare/Translation 模块中已有文件内容哈希不变；R1 OA POST/PUT/PATCH/DELETE 调用计数为 **0**。
- `NEG-GLOBAL-004`：日志、脱敏Evidence、JS bundle、持久存储和错误回显内真实/Canary AppSecret/AccessToken/RefreshToken/state/password命中0；业务响应不得含令牌或密码。仅Gateway生成的state允许随已校验authorization_url/回调透明传输，密码允许交互表单TLS瞬时提交；例外链路独立抓取且不记录原值，A-REV-008验证。

# 23. Failure Injection

故障注入必须在测试环境执行，不得用真实用户的腾讯 OAuth Token 故意重放；以下每个点都要对应 `operation_id`、T0、期望 postcondition 和真实 exit code。

| Point | Failure Injection | Expected Postcondition | Acceptance |
|---|---|---|---|
| FI-001 | 账号登录前 Gateway 网络拒绝 | 0 本地 token/mapping；LOGIN_FAILED | A-AUTH-001-02 |
| FI-002 | account-login 返回非零 code | 0 secret 持久化；LOGIN_REJECTED | A-AUTH-001-02 |
| FI-003 | ms_→mt_ 交换时 Gateway 客户端不存在 | PERMISSION_BLOCKED，0 oauth 请求 | A-AUTH-002-02 |
| FI-004 | OAuth start 返回非允许域名 | 拒绝跳转，pending 状态结束 | A-OAUTH-002-02 |
| FI-005 | OAuth state 过期/重放 | 新 OAuth 事务，旧 Connection 不伪造 ACTIVE | A-OAUTH-003-02 |
| FI-006 | Query POST 后、保存 job_id 前中断 | 查询镜像BLOCKED，last_error_code=MGW_QUERY_RECOVERY_REQUIRED，前端不重复提交 | A-RETRY-001-01 |
| FI-007 | SOURCE_QUERY 12 次 RETRYING，last_reason=UPSTREAM_CONTRACT_ERROR | 页面 INCOMPLETE、0 imported rows | A-SOURCE-002-02 |
| FI-008 | 查询已 SUCCEEDED，但 progress.complete 不为 true | Gate BLOCKED，禁止缓存标覆盖完整 | A-SOURCE-002-02 |
| FI-009 | 转写第一页后断网 | staging 标 INCOMPLETE，0 doc | A-CONTENT-001-02 |
| FI-010 | 转写二页 source_version 变化 | 重新从第一页收集，禁止拼接版本 | A-CONTENT-001-02 |
| FI-011 | Collector 新建文档后、回传 location 前进程杀死 | 补偿精确找回受管 orphan 或 PENDING_CLEANUP | A-RETRY-001-01 |
| FI-012 | Workspace 向量写入前 API 403 | 0 Workspace 关联，收回孤儿 doc | A-WORKSPACE-001-02 |
| FI-013 | Workspace 向量已写，mapping COMMIT 前中断 | 重放幂等，verified once | A-RETRY-001-01 |
| FI-014 | 本地导入完成后 Gateway OAuth 撤销 | access_state SOURCE_REVOKED 且搜索 0 命中 | A-SEC-002-01 |
| FI-015 | 撤权时向量 DB 故障 | REVOKE_PENDING_CLEANUP，保留 recovery backup | A-SEC-002-02 |
| FI-016 | 用户编辑过受管 Markdown 后再次导入 | BLOCKED_DRIFT，原始字节不变 | A-STATE-001-02 |
| FI-017 | 用户 B 尝试读 A 私有导入来源 | 403/404、0 数据泄漏 | A-SEC-001-02 |
| FI-018 | 模板外多余 JSON 字段（user_id/token） | 422、不读取源内容 | A-SEC-001-02 |

# 24. Evidence Contract

## 24.1 Evidence 不是状态标签

每个 AC 必须输出以下格式的**真实运行结果**；下方是 Schema 示例，**不代表测试 PASS**：

```json
{
  "schema_version": "meeting-prd-evidence-v1",
  "acceptance_id": "A-SOURCE-002-02",
  "status": "NOT_RUN",
  "requirement_ids": ["REQ-SOURCE-002"],
  "test_ids": ["TEST-A-SOURCE-002-02"],
  "command": "node --test server/__tests__/meetingGateway/TEST-A-SOURCE-002-02.test.js",
  "exit_code": null,
  "oracle": {
    "type": "machine_assertion",
    "expression": "job RETRYING -> no fake empty success",
    "expected": "state=INCOMPLETE, imported_rows=0",
    "actual": null
  },
  "source_revisions": {
    "anythingllm": "1336d327f4460510b755059b15481fd94a57cef7",
    "gateway": "d6bf6465f07385ce5906a7e0fced488c0c0881e9"
  },
  "pre_digest": null,
  "post_digest": null,
  "evidence_files": [],
  "executed_at": null
}
```

注意：`NOT_RUN` 仅为本 PRD 写作时状态；Agent 执行后必须填真实值，不允许复制示例写出假证据。失败路径也要有可核验 Oracle。证据包必须脱敏，并且 Evidence 文件名/ID 与第27章逐项对应。

## 24.2 Evidence Integrity

每次运行产生 `runs/YYYYMMDDTHHMMSSZ-<run-id>/`，至少包含：

```text
manifest.json             # 双仓 SHA、dirty 状态、执行工具版本、UTC 时间
configuration-redacted.md # 配置存在性、Gateway base origin，不含 token
network-boundary.json     # Gateway/Backend/Tencent 出站域名与方法计数
identity-a-b.json         # 两用户绑定和不可交叉访问的脱敏结果
source-query.json         # 202、job_id digest、progress.complete、last_reason、上游错误码
meeting-catalogue.json    # 元数据字段数、数量、分页与 coverage，脱敏主题
content-pagination.json   # page count / paragraph count / asset version / hash
collector-import.json     # 文档 location digest、Workspace 关联与向量校验
revocation-cleanup.json   # 撤权后 Workspace 命中数、待补偿数
acceptances/*.json        # 全部 Required Acceptance 的实际 Evidence
release-gate.json         # 覆盖统计、必过数、失败数、退出码
```

禁止提交任何原生会议正文、Bearer、Tencent AppSecret、Webhook AESKey、auth_code/state 明文到公开仓库或聊天。`SHA256` 摘要必须有精确定义（第13章）；manifest 以只追加方式写入，测试后封存与验签。

# 25. Release Gate

## 25.1 分层 Gate

| Gate | 前提 | Required Proof | 失败处理 |
|---|---|---|---|
| G0 Gateway SOURCE 可用 | Gateway OAuth ACTIVE + 真实本人 `USER_WINDOW` | job SUCCEEDED、progress.complete=true、至少一个已知会议元数据可核对 | BLOCKED：不把历史 RETRYING 当成功 |
| G1 身份和 OAuth | AnythingLLM user A/B 已登录 | BFF 帐号验证、独立 member mapping、无跨用户 token；真实 Tencent Consent→Gateway ACTIVE | FAIL/BLOCKED |
| G2 会议目录和资源 | G0+G1 | 源查询、列表全部 cursor、录制 Gateway id、无冒充 meeting_code | FAIL/BLOCKED |
| G3 原生文本导入 | G2 + 可用录制 | 转写完整分页/纪要原生、Collector 真实 location、Workspace 向量命中 | FAIL/BLOCKED |
| G4 安全与撤权 | A/B 两名真人 + 受管资料 | B 不能读 A；撤权后命中 0；密钥泄露数0；OA 写入数0 | FAIL/BLOCKED |
| G5 发布 | G0–G4 PASS + BUSINESS_REQUIRED + 独立GATE_META全部PASS，见§25.2 | 真实 Evidence + release gate 程序 exit 0 | 非 PASS 则 exit 非0 |

## 25.2 v1.1 非循环 Release 集合

- BUSINESS_REQUIRED：第27章除REQ-TEST-001以外的全部原有AC，加A-REV-001-01至A-REV-010-02。
- GATE_META：A-TEST-001-01/02，独立synthetic run验证完整证据返回0、缺失/FAIL/BLOCKED/错SHA/缺真实Consumer返回非0。不读取其自身正在生成的结果。
- REAL_CONSUMER：GC-01至GC-08，同一candidate_build_id及配置摘要的真实证据；fixture不替代GC-03至GC-07。

Gate元测试先完成并保存独立run_id；候选manifest固定两仓SHA、构建/配置摘要、schema版本、完整required ID清单和每项选中的evidence run_id。负向发布测试的预期失败应记AC PASS，不能把它的release-gate.json覆写为候选发布结果。

    validate exact business required IDs (reject missing/duplicate/unexpected)
    validate revisions/config and all business oracles PASS
    validate independent GATE_META suite PASS
    validate real GC evidence complete and G0–G4 PASS
    if any validation failed: release_status=FAIL_OR_BLOCKED; exit_code=1
    else: release_status=PASS; exit_code=0

Gate不要求自己计算前已有自己PASS的证据。SKIPPED/BLOCKED/NOT_RUN均非PASS。当前未实施、真实源查询未独立复验，不能声明R1发布通过。

# 26. Golden Consumer / Real-world Acceptance

**Golden Consumer：**真实部署的 AnythingLLM 多用户版 + 独立部署 Gateway + 腾讯会议第三方应用 `33510141629`，由两个经过内部账号验证且各自腾讯授权的真实员工 A/B 测试，至少一个员工拥有已结束会议、完整转写或原生纪要。参加人员姓名、手机号、会议正文不写入对外报告。

| Golden Step | 操作 | Oracle | Evidence |
|---|---|---|---|
| GC-01 | 记录双仓 SHA、dirty/git status、Prisma DB/Workspace T0 | 原来用户文档 SHA 没有改变 | pre-snapshot.json |
| GC-02 | A/B 各自内部账号登录 Gateway，查询本人连接 | A.member != B.member，连接归属正确 | identity-a-b.json |
| GC-03 | 未授权 B 从 AnythingLLM 发起真正腾讯授权 | 跳转官方域、Gateway 消费 state、确认 ACTIVE | real-oauth.json（脱敏） |
| GC-04 | A/B 用各自连接执行 USER_WINDOW | 每个只得到本人可见目录；已知样本匹配 | source-query.json |
| GC-05 | A 选择原生完整转写、纪要分别导入 | Document/Workspace/Vector 分别验证 | collector-import.json |
| GC-06 | B 访问 A connection/meeting/recording/import/workspace | 全部被拒、泄露字节 0 | cross-user-negative.json |
| GC-07 | A 失效 Gateway 授权或撤销受管导入 | Workspace 中已撤销源资料不可再命中 | revoke-negative.json |
| GC-08 | 复验原用户文档、Compare/Translation、OA | 非受管文档哈希保持，OA mutation=0 | post-snapshot.json |

Synthetic fixture 仅验证规则/错误注入，**不能替代** GC-03 至 GC-07 的真实用户、网关和腾讯数据。Golden Consumer 的 `before/after` 快照必须包含实际 Consumer 工作目录、DB Schema 版本及 SHA，任何失败必须保留恢复工单。

# 27. Requirement Traceability Matrix

| Requirement | Invariant | Acceptance | Test | Evidence | Release Gate |
|---|---|---|---|---|---|

| REQ-CONF-001 | INV-CONF-001 | `A-CONF-001-01`, `A-CONF-001-02` | `TEST-A-CONF-001-01`, `TEST-A-CONF-001-02` | `EVID-A-CONF-001-01.json`, `EVID-A-CONF-001-02.json` | REQUIRED G5 |

| REQ-IDENT-001 | INV-IDENT-001 | `A-IDENT-001-01`, `A-IDENT-001-02` | `TEST-A-IDENT-001-01`, `TEST-A-IDENT-001-02` | `EVID-A-IDENT-001-01.json`, `EVID-A-IDENT-001-02.json` | REQUIRED G5 |

| REQ-AUTH-001 | INV-AUTH-001 | `A-AUTH-001-01`, `A-AUTH-001-02` | `TEST-A-AUTH-001-01`, `TEST-A-AUTH-001-02` | `EVID-A-AUTH-001-01.json`, `EVID-A-AUTH-001-02.json` | REQUIRED G5 |

| REQ-AUTH-002 | INV-AUTH-003 | `A-AUTH-002-01`, `A-AUTH-002-02` | `TEST-A-AUTH-002-01`, `TEST-A-AUTH-002-02` | `EVID-A-AUTH-002-01.json`, `EVID-A-AUTH-002-02.json` | REQUIRED G5 |

| REQ-OAUTH-001 | INV-OAUTH-001 | `A-OAUTH-001-01`, `A-OAUTH-001-02` | `TEST-A-OAUTH-001-01`, `TEST-A-OAUTH-001-02` | `EVID-A-OAUTH-001-01.json`, `EVID-A-OAUTH-001-02.json` | REQUIRED G5 |

| REQ-OAUTH-002 | INV-OAUTH-002 | `A-OAUTH-002-01`, `A-OAUTH-002-02` | `TEST-A-OAUTH-002-01`, `TEST-A-OAUTH-002-02` | `EVID-A-OAUTH-002-01.json`, `EVID-A-OAUTH-002-02.json` | REQUIRED G5 |

| REQ-OAUTH-003 | INV-OAUTH-004 | `A-OAUTH-003-01`, `A-OAUTH-003-02` | `TEST-A-OAUTH-003-01`, `TEST-A-OAUTH-003-02` | `EVID-A-OAUTH-003-01.json`, `EVID-A-OAUTH-003-02.json` | REQUIRED G5 |

| REQ-UI-001 | INV-UI-001 | `A-UI-001-01`, `A-UI-001-02` | `TEST-A-UI-001-01`, `TEST-A-UI-001-02` | `EVID-A-UI-001-01.json`, `EVID-A-UI-001-02.json` | REQUIRED G5 |

| REQ-SOURCE-001 | INV-SOURCE-001 | `A-SOURCE-001-01`, `A-SOURCE-001-02` | `TEST-A-SOURCE-001-01`, `TEST-A-SOURCE-001-02` | `EVID-A-SOURCE-001-01.json`, `EVID-A-SOURCE-001-02.json` | REQUIRED G5 |

| REQ-SOURCE-002 | INV-SOURCE-002 | `A-SOURCE-002-01`, `A-SOURCE-002-02` | `TEST-A-SOURCE-002-01`, `TEST-A-SOURCE-002-02` | `EVID-A-SOURCE-002-01.json`, `EVID-A-SOURCE-002-02.json` | REQUIRED G5 |

| REQ-SOURCE-003 | INV-SOURCE-003 | `A-SOURCE-003-01`, `A-SOURCE-003-02` | `TEST-A-SOURCE-003-01`, `TEST-A-SOURCE-003-02` | `EVID-A-SOURCE-003-01.json`, `EVID-A-SOURCE-003-02.json` | REQUIRED G5 |

| REQ-SOURCE-004 | INV-SOURCE-004 | `A-SOURCE-004-01`, `A-SOURCE-004-02` | `TEST-A-SOURCE-004-01`, `TEST-A-SOURCE-004-02` | `EVID-A-SOURCE-004-01.json`, `EVID-A-SOURCE-004-02.json` | REQUIRED G5 |

| REQ-CONTENT-001 | INV-CONTENT-001 | `A-CONTENT-001-01`, `A-CONTENT-001-02` | `TEST-A-CONTENT-001-01`, `TEST-A-CONTENT-001-02` | `EVID-A-CONTENT-001-01.json`, `EVID-A-CONTENT-001-02.json` | REQUIRED G5 |

| REQ-CONTENT-002 | INV-CONTENT-002 | `A-CONTENT-002-01`, `A-CONTENT-002-02` | `TEST-A-CONTENT-002-01`, `TEST-A-CONTENT-002-02` | `EVID-A-CONTENT-002-01.json`, `EVID-A-CONTENT-002-02.json` | REQUIRED G5 |

| REQ-FORMAT-001 | INV-FORMAT-001 | `A-FORMAT-001-01`, `A-FORMAT-001-02` | `TEST-A-FORMAT-001-01`, `TEST-A-FORMAT-001-02` | `EVID-A-FORMAT-001-01.json`, `EVID-A-FORMAT-001-02.json` | REQUIRED G5 |

| REQ-IMPORT-001 | INV-IMPORT-001 | `A-IMPORT-001-01`, `A-IMPORT-001-02` | `TEST-A-IMPORT-001-01`, `TEST-A-IMPORT-001-02` | `EVID-A-IMPORT-001-01.json`, `EVID-A-IMPORT-001-02.json` | REQUIRED G5 |

| REQ-WORKSPACE-001 | INV-WORKSPACE-001 | `A-WORKSPACE-001-01`, `A-WORKSPACE-001-02` | `TEST-A-WORKSPACE-001-01`, `TEST-A-WORKSPACE-001-02` | `EVID-A-WORKSPACE-001-01.json`, `EVID-A-WORKSPACE-001-02.json` | REQUIRED G5 |

| REQ-STATE-001 | INV-STATE-001 | `A-STATE-001-01`, `A-STATE-001-02` | `TEST-A-STATE-001-01`, `TEST-A-STATE-001-02` | `EVID-A-STATE-001-01.json`, `EVID-A-STATE-001-02.json` | REQUIRED G5 |

| REQ-RETRY-001 | INV-RETRY-001 | `A-RETRY-001-01`, `A-RETRY-001-02` | `TEST-A-RETRY-001-01`, `TEST-A-RETRY-001-02` | `EVID-A-RETRY-001-01.json`, `EVID-A-RETRY-001-02.json` | REQUIRED G5 |

| REQ-SEC-001 | INV-SEC-001 | `A-SEC-001-01`, `A-SEC-001-02` | `TEST-A-SEC-001-01`, `TEST-A-SEC-001-02` | `EVID-A-SEC-001-01.json`, `EVID-A-SEC-001-02.json` | REQUIRED G5 |

| REQ-SEC-002 | INV-SEC-002 | `A-SEC-002-01`, `A-SEC-002-02` | `TEST-A-SEC-002-01`, `TEST-A-SEC-002-02` | `EVID-A-SEC-002-01.json`, `EVID-A-SEC-002-02.json` | REQUIRED G5 |

| REQ-SEC-003 | INV-SEC-003 | `A-SEC-003-01`, `A-SEC-003-02` | `TEST-A-SEC-003-01`, `TEST-A-SEC-003-02` | `EVID-A-SEC-003-01.json`, `EVID-A-SEC-003-02.json` | REQUIRED G5 |

| REQ-OBS-001 | INV-OBS-001 | `A-OBS-001-01`, `A-OBS-001-02` | `TEST-A-OBS-001-01`, `TEST-A-OBS-001-02` | `EVID-A-OBS-001-01.json`, `EVID-A-OBS-001-02.json` | REQUIRED G5 |

| REQ-REMOVE-001 | INV-REMOVE-001 | `A-REMOVE-001-01`, `A-REMOVE-001-02` | `TEST-A-REMOVE-001-01`, `TEST-A-REMOVE-001-02` | `EVID-A-REMOVE-001-01.json`, `EVID-A-REMOVE-001-02.json` | REQUIRED G5 |

| REQ-COMPAT-001 | INV-COMPAT-001 | `A-COMPAT-001-01`, `A-COMPAT-001-02` | `TEST-A-COMPAT-001-01`, `TEST-A-COMPAT-001-02` | `EVID-A-COMPAT-001-01.json`, `EVID-A-COMPAT-001-02.json` | REQUIRED G5 |

| REQ-TEST-001 | INV-TEST-001 | `A-TEST-001-01`, `A-TEST-001-02` | `TEST-A-TEST-001-01`, `TEST-A-TEST-001-02` | 独立元测试Evidence | GATE_META（先运行，非自引用） |

任何 Requirement 没有至少一个 AC、任何 AC 没有 Test + Oracle、任何 Required AC 没有实际 Evidence，Release Gate 必须 BLOCK；不同阶段的阶段性通过不能假冒 G5 全链路通过。


## 27.1 v1.1 修订覆盖（追加到原有AC，不替代）

修订索引：R01 → A-REV-001-01/02；R02 → A-REV-002-01/02；R03 → A-REV-003-01/02；R04 → A-REV-004-01/02；R05 → A-REV-005-01/02；R06 → A-REV-006-01/02；R07 → A-REV-007-01/02；R08 → A-REV-008-01/02；R09 → A-REV-009-01/02；R10 → A-REV-010-01/02。


| Acceptance | Requirement | Contract | Test | Gate |
|---|---|---|---|---|
| A-REV-001-01/02 | REQ-WORKSPACE-001, REQ-SEC-001 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-001-01/02 | BUSINESS_REQUIRED |
| A-REV-002-01/02 | REQ-SEC-002 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-002-01/02 | BUSINESS_REQUIRED |
| A-REV-003-01/02 | REQ-AUTH-001, REQ-IDENT-001 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-003-01/02 | BUSINESS_REQUIRED |
| A-REV-004-01/02 | REQ-IMPORT-001, REQ-RETRY-001 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-004-01/02 | BUSINESS_REQUIRED |
| A-REV-005-01/02 | REQ-STATE-001, REQ-REMOVE-001 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-005-01/02 | BUSINESS_REQUIRED |
| A-REV-006-01/02 | REQ-FORMAT-001, REQ-STATE-001 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-006-01/02 | BUSINESS_REQUIRED |
| A-REV-007-01/02 | REQ-SOURCE-003 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-007-01/02 | BUSINESS_REQUIRED |
| A-REV-008-01/02 | REQ-OAUTH-002, REQ-SEC-003 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-008-01/02 | BUSINESS_REQUIRED |
| A-REV-009-01/02 | REQ-TEST-001 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-009-01/02 | BUSINESS_REQUIRED |
| A-REV-010-01/02 | REQ-OBS-001, REQ-RETRY-001 | §9.7–9.12/§19.3/§25.2 | TEST-A-REV-010-01/02 | BUSINESS_REQUIRED |

REQ-TEST-001的原A-TEST-001-01/02属于GATE_META；A-REV-009-01/02是独立scenario测试程序产出的先验算法证据，候选Gate仅读其结果，不等待自己结果。所有原有AC仍需执行；原有Oracle不足以证明新增条款时须同时满足以上修订AC。

# 28. Plan Generation Contract

用户在2026-10-18明确要求“根据review优化PRD，然后创建plan”。v1.1允许编写带阻塞项的待审实施计划，**不代表设计已批准、开始编码或允许发布**。PRD保持REVIEW，计划DRAFT_FOR_REVIEW；取消v1.0“REVIEW连计划草案也禁止创建”的限制。外部未核实事实不能被计划或本地mock测试自动升级为PASS。

## 28.1 就绪度分离

- DOC：R01–R10的语义修订/AC覆盖，由文档检查证明；不能替代产品验收。
- CONTRACT：Gateway owner提供固定SHA OpenAPI/脱敏响应、实际Token交换、资源级权限判定；未取得为BLOCKED。
- IMPLEMENTATION：计划获批准后可执行本地纯规则/迁移/mock任务；依赖未知Gateway字段的联调任务等待CONTRACT。
- LIVE：真实OAuth、USER_WINDOW成功、已知会议样本及A/B实测保留G0–G4。
- RELEASE：仅按§25非循环聚合器发布。文档/计划完成不代表IMPLEMENTED/VERIFIED。

## 28.2 每任务合同

每项列Req/AC、依赖与门禁、Create/Modify/Test文件、Interface输入输出、状态、T0/side effect/补偿、红绿命令和提交/证据条件。现有文件由扫描证据支持，新接口显式标拟新增。

## 28.3 不可跨越的外部阻塞

Gateway asset_id/content_version、resource权限端点、USER_WINDOW complete、目录start_at/分页、Token交换与scope未有固定契约时，先验证并更新契约，依赖步骤停止。OA/腾讯直连/企业AKSK/无人值守同步仍在范围外。

## 28.4 代码扫描与执行

代码阅读/扫描必须创建子代理，模型GPT-6 Luna（gpt-6-luna）；主代理整合设计和文档。编码执行另按工作区AGENTS与subagent-driven-development启动。本轮只产PRD和计划，不修改产品代码。

## 28.5 故障覆盖

每个retry/atomic/cleanup均列FI点、唯一状态和精确补偿。受限读取入口要有完整清单；新增入口缺上下文默认拒绝。普通空间语义不受改动，Gateway未知失败不映射成功。

# 29. `.plan.md` 输出标准

配套计划：docs/superpowers/plans/2026-10-18-anythingllm-meeting-gateway-r1.plan.md（DRAFT_FOR_REVIEW）。15项任务编号PLAN-MGW-000至014，Req/AC/Interface/依赖/测试/T0/补偿逐项列出；代码扫描证据记录在同目录2026-10-18-meeting-gateway-code-scan-evidence.md。

任务顺序以实际依赖为准：契约确认与本地台账/安全client/bridge → 受限空间 → OAuth/目录/内容 → managed Collector/向量docId → generation Saga → 全读取门禁 → UI → 非循环Gate → 真人GC。外部契约未核实时，可编写本地纯规则与隔离fixture测试，真实适配保持BLOCKED。功能默认disabled，全入口guard到位前不能启用导入。

planned=尚待执行；implemented=代码已写；verified=指定Oracle/Evidence满足。每个任务使用Jest命令，原v1.0的逐ID node --test路径改为配套计划具名测试文件；每AC按testName独立产证。构建/配置摘要和实际candidate SHA写运行manifest，不用文档基线SHA冒充实施后构建。


# 30. Code Review Contract

Review 按此顺序签核：

1. Req 实现范围是否与 R1 相同、是否误加入 OA/MCP/AKSK。
2. Gateway 状态 Owner 是否仍权威，AnythingLLM 无凭空 ACTIVE。
3. Gateway 与 Backend 网络出口是否严格唯一 account-login。
4. 本地 Side Effect 是否仅发生新表/受管 docs/vector；用户文档字节保持。
5. 输入/Output 字段是否有更改/漏掉 `content_version`、`next_cursor`、`coverage_is_partial`。
6. 导入崩溃、重试、撤权与 rollback 的 T0/补偿是否可证明。
7. 双用户 A/B、共享 Workspace/管理员 API Key 下的权限隔离是否满足负向 AC。
8. Token/password/原文在日志和 Evidence 里是否泄露。
9. 设计/计划执行批准是否单独记录；Golden Consumer及Release Gate是否真实通过，草案不冒充批准。
10. 代码质量、单测/类型检查、性能（不能代替前面 9 项）。

# 31. PRD Quality Gate

**文档静态结构审查与产品真实验收必须区分。** 本文自动校验能够确认 0–36 章连续、Req/AC/Evidence 引用完整、哈希清晰及示例 JSON 可解析；这不能宣称业务实现完成。

| Category | Required Check | 文档当前状态 |
|---|---|---|
| Architecture | Scope/Owner/Non-goal 清楚 | REVIEW，源码事实已核对 |
| State | Source of Truth/State Machine | SPECIFIED，运行未验 |
| Semantics | OAuth return_to/ID/分页/版本 | SPECIFIED，Gateway schema 变更时需复核 |
| Side Effects | DB/File/Network/Vector 变更范围 | SPECIFIED，尚未执行 |
| Failure | rollback/补偿/FI | SPECIFIED，尚未执行 |
| Acceptance | 逐 Req 2 AC + Oracle | SPECIFIED，全部 NOT_RUN |
| Evidence | 双仓 SHA/指令/脱敏事实证据 | SCHEMA_READY，尚无新运行证据 |
| Plan Readiness | 用户授权的草案可编写；执行须另批准并满足任务前置门禁 | **DRAFT_FOR_REVIEW；未授权实施** |
| Gateway G0 | 真人 OAuth ACTIVE + SourceQuery 真正成功 | **BLOCKED：历史 RETRYING 尚待复验** |
| Release R1 | Required 全 PASS | **BLOCKED：未实施本 PRD** |

# 32. PRD 禁止写法

本需求禁止“已授权所以会议一定能看”“调用接口成功即会议同步成功”“数据自动同步不丢”“智能识别权限”“文档上传后其他人不可见”“重新授权即可解决所有腾讯错误”“自动重试直到成功”“自动清理全部旧资料”。必须用可判断事实替代：

- Gateway `Connection.status=ACTIVE` + token权限 ≠ SourceJob SUCCEEDED。
- `HTTP 202` ≠ 上游已返回历史会议。
- `gateway.next_cursor=null` + `content_version fixed` + `complete` 才是转写完成。
- `Collector.success=true + actual location + Workspace confirmed index` 才可能 VERIFIED。
- 两真实用户越权读出 0 字节，才是交叉隔离证据。
- 删除具体 `import_id` 的受管向量，不能解释成任意向量批量重建。

# 33. 推荐 ID 体系

```text
PRD:   PRD-ANYTHINGLLM-MEETING-GATEWAY-20261017
REQ:   REQ-CONF-001 / REQ-AUTH-001 / REQ-SOURCE-001 / REQ-SEC-001
AC:    A-CONF-001-01 (positive), A-CONF-001-02 (negative)
TEST:  TEST-A-CONF-001-01
EVID:  EVID-A-CONF-001-01.json
FI:    FI-001 … FI-018
RUN:   YYYYMMDDTHHMMSSZ-<UUID>
IMPORT: UUID + identity_key SHA256
STATE: NOT_RUN / PASS / FAIL / BLOCKED / SKIPPED
```

本 PRD 不复用 Gateway 本身的 REQ/AC ID；无两个产品共用数据库主键的假设。

# 34. PRD 最小完整结构

本文件按原模板完整排列：`0 Principles`、`1 Meta`、`2 Goal`、`3 Background`、`4 Scope`、`5 Terms`、`6 Context`、`7 SOT`、`8 State Machine`、`9 Schema`、`10 Requirements`、`11 Side Effects`、`12 Ownership`、`13 Identity/Hash`、`14 Transaction`、`15 Conflict`、`16 Migration`、`17 Dependency`、`18 Security`、`19 Observability`、`20 Acceptance`、`21 Edge Cases`、`22 Negative Acceptance`、`23 Failure Injection`、`24 Evidence`、`25 Release Gate`、`26 Golden Consumer`、`27 Traceability`、`28 Plan Generation`、`29 Plan.md`、`30 Code Review`、`31 PRD Quality`、`32 Forbidden Phrases`、`33 IDs`、`34 Completeness`、`35 DoD`、`36 Principles`。

# 35. Definition of Done

R1 只能在以下全部成立后标记 VERIFIED：

- [ ] 两仓构建代码 SHA 被固定、变更清单审计完成、不是浮动 master。
- [ ] Gateway 真实 OAuth Connection ACTIVE，且 employee 与 AnythingLLM 本地用户绑定可证明。
- [ ] Gateway `/portal/session` 或严格受限 `/auth/exchange` 路径实测能为本人签发 `meeting.read` / `meeting.content.read` REST token。
- [ ] Gateway 真实 USER_WINDOW 查询源作业 SUCCEEDED + progress.complete=true；有已知会议样本验证；非 RETRYING。
- [ ] 会议本地列表分页完整，不把缓存、202、部分源覆盖等价于全量。
- [ ] 录制 ID、转写所有段落、纪要原生内容与 asset_version 均可追溯。
- [ ] Collector 返回真实 location，独占 Workspace 内 RAG 可命中，重复导入恰好一份。
- [ ] A/B 多用户交叉访问会议、录制、正文、Import、Workspace 均拒绝。
- [ ] 撤权后不再从本项目关联向量检索，失败清理保留 recovery artifact。
- [ ] 非受管用户文件、Compare/Translation、OA 状态不变。
- [ ] 所有 Req 的 positive 与 negative AC 均有可核验 Evidence，并归档测试退出码和 digest。
- [ ] 所有 Required AC PASS，Release Gate exit=0，真实 Consumer 证据齐全。
- [ ] Plan 与实施变更具备已批准版本；`IMPLEMENTED` 不自动意味着 `VERIFIED`。

**当前结论：**此文档是完整集成需求规格（REVIEW），并非现网 AnythingLLM 已二开部署通过；需要通过第25章 Gate 才能改变状态。

# 36. 最终原则

1. Gateway 对 Tencent OAuth、Token、source data 和权限保持唯一 Owner。
2. AnythingLLM 只负责按人消费获准资源，不能以 Service Token 模拟任一员工。
3. 首次连接需由用户浏览器跳转真实腾讯授权；已有 ACTIVE 连接不必每次弹窗。
4. Gateway member、Tencent open_id、AnythingLLM user_id 不可混为同一个身份。
5. 会议源历史查询异步受理与最终完成必须单独验收。
6. 用户会议目录与企业全部会议不同，支持部分覆盖明确展示。
7. 转写必须完整分页、保持顺序及来源版本。
8. 原生纪要与 AnythingLLM 自行生成的 AI 文本必须明确区分。
9. Gateway User OAuth 授权不会自动继承到共享 Workspace；R1 只允许独占 Workspace。
10. Document location 必须来自 Collector，不得手工伪造。
11. 版本、Hash、Owner 和幂等约束决定是否安全更新/移除。
12. Gateway/Tencent Token与AppSecret不能进入浏览器；密码仅交互输入/TLS请求瞬时存在，OAuth state仅必要授权URL/回调传输；全部禁止日志/Evidence持久化。
13. 越权、失权、重试、回滚每个路径必须有机器 Oracle 和 Evidence。
14. 跨系统写操作用 Saga + 补偿，不能假称跨服务 ACID。
15. `RETRYING`、`BLOCKED`、`SKIPPED`、`NOT_RUN` 不等价于 PASS。
16. Compare/Translation 为独立模块；会议导入不暗中启动 OA 写入。
17. 模拟测试帮助发现合同错误，但无法代替真实员工、腾讯 API 与 Corpus 验收。
18. 任何尚无确切上游响应的性能、配额或权限判断均不得写成已验证事实。
19. AI Coding 不得自行拓展第三方企业签名、后台用户目录或源删除逻辑。
20. 只有 Req → Code → Test → Oracle → Evidence → Gate 真正闭环，R1 才能结束。

