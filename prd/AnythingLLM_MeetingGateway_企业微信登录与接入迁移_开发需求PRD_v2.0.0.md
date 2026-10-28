---
title: "AnythingLLM × Meeting Gateway：接入迁移、企业微信登录与持续权限工程开发 PRD"
subtitle: "真实契约 → 运行装配 → 页面接通 → 导入与读取权限 → 迁移验收"
prd_id: "PRD-ANYTHINGLLM-MEETING-GATEWAY-20261017"
version: "2.0.4"
status: "REVIEW"
template_version: "1.0"
template_sha256: "b00234e6d103b2c102cbcc7b02fbcd961e71b0ce784ee736ead592c301e35eff"
created_at: "2026-10-19"
updated_at: "2026-10-19"
consumer_branch: "codex/meeting-intelligence"
consumer_baseline_sha: "7e465a04c1ad63166c7b952b41dfd316882329ea"
gateway_branch: "master"
gateway_baseline_sha: "d6bf6465f07385ce5906a7e0fced488c0c0881e9"
target_release: "R2-gateway-cutover-wecom"
document_type: "ENGINEERING_CONTRACT_PRD"
plan_generation_status: "BLOCKED_PENDING_REVIEW"
production_verification_status: "NOT_EXECUTED"
---

# AnythingLLM × Meeting Gateway 工程开发需求 PRD

**版本：2.0.4 ｜ 日期：2026-10-19 ｜ 状态：REVIEW**

修订说明：2026-10-19 用户进一步提供DEC-R2-EMPLOYEE-OAUTH-006实际调用链：account-login→ms_→exchange→业务access_token→腾讯会议授权URL→connection_id回跳；具体身份、凭据与展示语义以§4.8为准。此前新增DEC-R2-OAUTH-QR-005：AnythingLLM内显示Gateway OAuth企业微信二维码，扫码后接收并由后端保管Gateway API token。已记录DEC-R2-LOGIN-001及DEC-R2-PHASE-002/003/004：认证丢失仅本地检索、Gateway用户信息投影、本阶段暂缓导入交付、暂停导入验收。为保留已有附件引用，文件名暂沿用 v2.0.0；本文内容版本以元数据 2.0.4 为准。该决策已确认，但不等于整份 PRD、接口契约或生产发布已经批准。

R2总体设计仍分为 **D1 接入收口、D2 页面闭环、D3 身份与权限闭环**；当前阶段以§4.6的AUTH_LOCAL_SEARCH范围和独立验收门禁为准，导入交付及验收延后。工程推进主线为 **S1 真实接口与身份契约 → S2 运行装配 → S3 页面接通 → S4 导入与读取权限 → S5 迁移验收**。

本文是开发需求与验收契约，不是代码实施记录，也不是生产联调通过证明。本文不提交产品代码、不生成 `.plan.md`、不修改任何线上配置。新增页面、接口、字段及参数均标明为目标设计；现有源码事实与目标行为分开陈述。

Meeting Gateway已有OAuth授权入口与token兑换能力，AnythingLLM优先复用；后续核对现成扫码页、客户端/回调配置及用户信息来源，并取得实际扫码与API凭据调用证据。AnythingLLM 只消费 Gateway 的扫码认证能力；Gateway 内部采用直接企业微信接入或企业身份服务，均由 Gateway 负责，本 PRD 不新增独立身份服务建设任务。企业微信入口复用Gateway自身OAuth授权能力并在AnythingLLM显示其真实扫码界面；不能把仅完成腾讯会议连接授权的结果当作企业用户已认证，也不能模拟扫码。具体交互与token交付以§4.7为准。

---

# 0. PRD 使用原则

## 0.1 PRD 的职责

| 维度 | 本 PRD 的确定答案 |
|---|---|
| WHY | 消除腾讯直连与未装配网关并存，形成员工级认证、查询、导入、读取闭环 |
| WHAT | 三个交付结果；五个阶段；保留已有会议业务，不建设平行会议系统 |
| BOUNDARY | AnythingLLM 负责登录消费体验与本地加工；Gateway 负责企业微信认证/身份管理、腾讯接入与会议授权 |
| STATE | 身份、网关连接、源作业、导入代次、业务修订和 Evidence 分别有唯一事实源 |
| INPUT | 可信本地会话、经验证的企业身份、网关 REST 契约、已授权源资源、受控迁移清单 |
| OUTPUT | 可观察的授权状态、真实会议目录、完整来源资料、受限索引与问答、迁移验收证据 |
| SIDE EFFECT | 限于第 11、12、14 章规定的本地认证会话/结果投影、网关缓存、本地受管数据及审计；既有主体映射只读；不修改腾讯源会议和 OA |
| FAILURE | 失权即阻断；受理不等于成功；不明结果进入恢复；无 ownership 的历史内容保留并隔离 |
| ACCEPTANCE | 第 20 章逐项 Given / When / Then / Oracle / Evidence |
| EVIDENCE | 固定提交、候选构建、配置摘要与真实用户验收绑定，不能仅声明 PASS |

## 0.2 强制规范关键词

`MUST` 表示必须实现、测试并出具证据；`MUST NOT` 表示触犯即失败；`SHOULD/SHOULD NOT` 的偏离需要记录；`MAY` 不构成 Required Release 条件。

第 10 章是所有规范要求的登记入口。第 4–9、11–19、21–30、35 章的契约按章节中的 Requirement 映射纳入其对应 Acceptance。新增一句强制约束而没有登记到 REQ/AC，文档质量检查失败。治理规则统一归属 REQ-EVID-001。

## 0.3 No-Inference Rule

归属：REQ-CONTRACT-001、REQ-EVID-001。

对 SOT、所有权、选择语义、hash、事务、回滚、冲突或 Oracle 出现两种未裁决解释时，开发 Agent **MUST** 返回 `SPEC_SEMANTIC_GAP`，**MUST** 阻断计划生成，**MUST NOT** 用经验补齐。

外部服务未实现已明确的契约属于 `DEPENDENCY_NOT_READY`；实际响应与已冻结契约冲突属于 `MGW_UPSTREAM_CONTRACT_ERROR`。它们不允许被降级为空结果，也不允许通过关闭校验解决。

## 0.4 事实、目标与验证等级

- **EXISTING**：固定 SHA 中已读取的源码或接口；仅证明静态存在。
- **MODIFY**：在已存在的模块/路由上修改的目标行为。
- **NEW**：本 PRD 拟新增的契约、页面、表或脚本，不表示当前可调用。
- **EXTERNAL_REQUIRED**：由Gateway认证服务或部署负责人交付的依赖；未取得证据时相应阶段 BLOCKED。
- **VERIFIED**：对应候选构建已经运行 Acceptance 并生成有效 Evidence；文件存在、PR 合并不属于 VERIFIED。

---

# 1. 文档元数据

```yaml
title: AnythingLLM × Meeting Gateway 接入迁移与企业微信登录
prd_id: PRD-ANYTHINGLLM-MEETING-GATEWAY-20261017
version: 2.0.4
status: REVIEW
product: AnythingLLM Meeting Intelligence
repository:
  consumer: https://github.com/loudon84/anything-llm
  gateway: https://github.com/smc-copilot/meeting-gateway
branch:
  consumer: codex/meeting-intelligence
  gateway: master
owner: AnythingLLM 二开工程负责人
reviewers:
  - 会议业务负责人
  - AnythingLLM 负责人
  - Meeting Gateway 负责人
  - Gateway 企业微信认证负责人（内部身份服务负责人按其部署参与）
  - 安全与测试负责人
  - 部署与数据迁移负责人
created_at: 2026-10-19
updated_at: 2026-10-19
target_release: R2-gateway-cutover-wecom
change_type: [BROWNFIELD_CHANGE, ARCHITECTURE_CHANGE, INTEGRATION, MIGRATION, BUGFIX, GOVERNANCE]
golden_consumer: 企业多用户 Web；真实员工 A/B；真实企业微信身份；Gateway；已结束且有录制资料的腾讯会议
related_docs:
  - 需求PRD工程模板.md v1.0
  - prd/anythingllm-meeting-gateway-prd-v1.1.md
  - 2026-10-19 上轮接入迁移分析
supersedes: v1.1 同一范围内的身份入口、运行装配、页面路由、迁移与验收条款；不自动改写 Gateway 其他业务需求
```

## 1.1 基线与变更关系

Consumer 基线：`7e465a04c1ad63166c7b952b41dfd316882329ea`。Gateway 基线：`d6bf6465f07385ce5906a7e0fced488c0c0881e9`。执行时记录实际候选提交；与基线不同则先做差异核对，不能把当前分支名称当不可变版本。

v1.1 使用的 Consumer 基线为 `1336d327…`，其“尚未存在”描述不能直接套用到本次已合并 R1 的分支。[SRC-14]

| 变更项 | v1.1 / 当前旧链路 | R2 目标 |
|---|---|---|
| 员工身份 | AnythingLLM 登录后再用 Gateway 账号密码建立会话 | 增加Gateway企业微信登录消费与既有本地主体映射校验；账号桥仅作受控兼容入口 |
| 上游身份限制 | Gateway 账号登录的单一入口 | 冻结 Gateway 对 Consumer 的企业微信认证契约；不冒称原接口能验证企业微信 |
| 会议运行链路 | 原腾讯直连 + 未装配网关模块并存 | 单一 Gateway Adapter，不保留运行时直连 fallback |
| 页面 | 旧腾讯凭据设置与现有会议页面 | 原页面改造 + 登录入口/结果页 + 会议授权状态；不建设身份绑定管理页 |
| 受管数据 | R1 工作区导入与旧会议导入各有结构 | 单一导入代次/文档血缘，旧业务 ID 不变 |
| 发布证据 | R1 文档与测试资产 | R2 重新执行；R1 测试结果不自动继承为 R2 PASS |

## 1.2 来源索引

永久源码引用见文末“来源清单”。正文 `[SRC-xx]` 对应该清单。原文不足以证明的企业身份接口全部定义为 NEW / EXTERNAL_REQUIRED，而不是现有能力。截图仅用于旧页面字段与交互基线，不证明后端配置已经生效。

## 1.3 评审与依赖状态

| 条目 | 本次状态 | 进入下一步的条件 | 负责人 |
|---|---|---|---|
| PRD 业务/安全批准 | REVIEW | 各 owner 对范围、默认行为和验收要求签署评审记录 | 产品与技术负责人 |
| Gateway 企业微信认证能力 | EXTERNAL_REQUIRED / 未取得本次运行证据 | 交付第 9.4、17 章 Consumer 契约 lock、真实认证样本与身份状态证明；内部服务由 Gateway 负责 | Gateway 负责人 |
| Gateway 新增 API | NEW / 未实施验证 | 契约测试与真实部署版本一致 | Gateway 负责人 |
| Consumer 新运行装配 | MODIFY / 未实施验证 | 启动检查、生产模块装配测试与请求证据 | AnythingLLM 负责人 |
| 腾讯应用权益与正文访问 | 未取得本次候选环境证据 | A/B 真实用户及已知会议完成 Golden Consumer | 会议平台管理员 |
| 数据迁移授权 | 未执行 | 备份、清单、drift 检查、审批与演练完成 | 数据 owner |

以上是外部交付或评审状态，不授权实施者自行改变目标设计。没有真实企业身份依赖证据时，可以评审契约，但企业微信功能和最终 Release 都不能标记 PASS。

---

# 2. 一句话目标

让已获企业准入的员工，在 AnythingLLM 多用户 Web、真实企业身份认证及本人有效会议权限的前提下，通过企业微信登录、会议授权和现有会议页面，完成真实会议查询、完整转写/原生纪要导入及受限问答，同时保证正式会议流量只经 Meeting Gateway、腾讯凭据不进入 AnythingLLM、本地缓存不扩大权限、历史数据不被猜测迁移或误删。

---

# 3. 背景与问题定义

## 3.1 Current State

| 事实 | 证据 | 验证边界 |
|---|---|---|
| 现有会议模块有列表、详情、导入、补充资料、审核、索引和问答 | SRC-11 | 静态功能路径，不代表每个环境已通过测试 |
| 现有设置页仍收集腾讯 AppId、SDKId、操作员与 AK/SK，且混合 OCR | SRC-11；用户截图 | 页面现状 |
| 启动文件创建会话模块时 `gateway:null`，并设置 `oauth:null` | SRC-02 | 阻断真实装配的确定代码事实 |
| Gateway Client 的 `accountLogin/exchange` 仍抛契约不可用错误 | SRC-03 | 不是填写环境变量即可接通 |
| Gateway 返回 `session_token/expires_in/user`，会话模块期待归一化 token、绝对到期与 binding | SRC-04、06 | 需要服务端转换 |
| Gateway 腾讯 OAuth 地址含 `corp_id/sdk_id/redirect_uri/state`；客户端只接受后三项 | SRC-05、08 | 严格校验契约不一致 |
| Gateway exchange 只接受 `ms_`，业务 REST 使用 `mt_` | SRC-07 | AnythingLLM JWT、企业微信 userid 不能代替 `ms_` |
| Gateway 已有会议源查询、目录、录制、转写、纪要和作业接口 | SRC-09、10 | `202`、分页和完整性需要消费端处理 |
| R1 已有绑定、代次台账、受限工作区与受管文档资产 | SRC-12 | 可复用；不证明读取路径已全部接入 |
| 现有资料限制为 200 场/季度、10 场/单次问答、3 小时转写、100 MB/文件、20 文件/会议、500 MB/会议 | SRC-13 | 本轮默认保留，不借迁移放大限制 |

## 3.2 Problem

| ID | 可验证问题 | 目标需求 |
|---|---|---|
| P-01 | 开启网关开关后，生产实例仍缺少真实 client / oauth 依赖 | REQ-RUNTIME-001 |
| P-02 | 两端登录字段和 OAuth URL 校验不匹配，真实响应会被拒绝 | REQ-CONTRACT-001、REQ-AUTH-001、REQ-OAUTH-001 |
| P-03 | 企业微信身份未建立可验证的发行方、企业、员工与本地/网关映射 | REQ-IDENT-001、REQ-IDENT-002 |
| P-04 | 旧会议页面仍可触发腾讯直连；新接口保护不能覆盖旧路径 | REQ-RUNTIME-001、REQ-ACCESS-001 |
| P-05 | 源查询受理、历史目录缓存和本次窗口结果未形成唯一结果语义 | REQ-QUERY-001 |
| P-06 | 录制、正文版本、分页、源与本地 ID 混用会产生不完整或重复导入 | REQ-CONTENT-001、REQ-IMPORT-001 |
| P-07 | 导入后的文件、向量、历史回答可能绕过已撤销会议权限 | REQ-WORKSPACE-001、REQ-RAG-001、REQ-REVOKE-001 |
| P-08 | 历史凭据、共享索引和不明所有权数据缺少确定迁移与回滚规则 | REQ-MIGRATE-001、REQ-CUTOVER-001 |

## 3.3 Impact

业务影响：员工不能在统一页面完成身份、授权和会议资料消费。工程影响：平行链路、占位实现和响应差异导致重复开发。安全影响：全局操作员、共享工作区和旧路由可能扩大读取范围。运维影响：配置成功、上游受理和导入完成混为一体。AI Coding 影响：若不固定契约和 Owner，开发 Agent 可能伪造新端点、忽略依赖或用直连绕过网关。

---

# 4. Scope

## 4.1 In Scope 与三个交付结果

| Scope | 交付结果 | 内容 | Requirement |
|---|---|---|---|
| SCOPE-01 | D1 接入收口 | 双仓契约、错误、ID、网络和新增 Provider API | CONTRACT、PROVIDER、SEC |
| SCOPE-02 | D1 接入收口；D3 基础 | Gateway 企业认证消费、既有主体映射校验、双会话和业务令牌 | IDENT-001/002、AUTH |
| SCOPE-03 | D1 接入收口 | 配置分离、实际装配、单一 Provider、腾讯 OAuth | CONFIG、RUNTIME、OAUTH |
| SCOPE-04 | D2 页面闭环 | 登录入口/结果、会议授权状态、设置诊断、会议目录/详情/导入 | UI-001/002/003 |
| SCOPE-05 | D2 页面闭环；D3 数据基础 | 日期窗口源查询、所有录制、完整转写与原生纪要 | QUERY、CONTENT |
| SCOPE-06 | D3 身份与权限闭环 | 单一导入代次、原文/修订分层、受限工作区 | IMPORT、DATA、WORKSPACE、TXN |
| SCOPE-07 | D3 身份与权限闭环 | 所有读取、RAG、撤销、缓存与本地产物门禁 | ACCESS、RAG、REVOKE |
| SCOPE-08 | 三项结果共同验收 | 观测、迁移、切换、兼容、证据与发布 | OBS、MIGRATE、CUTOVER、COMPAT、EVID |

表内简写以第 10 章完整 `REQ-<名称>-001` 为准；`IDENT/UI` 带序号时使用表中对应编号。

## 4.2 Out of Scope

以下禁止项归属 REQ-RUNTIME-001、REQ-COMPAT-001、REQ-SEC-001，进入对应负向验收。

| Non-goal | R2 明确边界 |
|---|---|
| NON-GOAL-01 | 不实现 ASR、基础 AI 纪要生成，也不把本地 LLM 总结伪装为腾讯原生纪要 |
| NON-GOAL-02 | 不新增腾讯会议创建、修改、取消、代他人创建或无人值守企业全量采集 |
| NON-GOAL-03 | 不通过 MCP 驱动本次页面和固定导入流程 |
| NON-GOAL-04 | 不开发 Compare、Translation 核心功能；两者继续独立 |
| NON-GOAL-05 | 不提取并自动写 OA 任务，不触发任何 OA 写入 |
| NON-GOAL-06 | 不实现通用腾讯附件抓取、视频/音频全量下载；仅保留本地资料上传和原有 OCR |
| NON-GOAL-07 | 不把个人 OAuth 内容导入共享工作区，不建设企业会议全员共享策略 |
| NON-GOAL-08 | 不修改无关智能体平台，不搬移 Gateway 管理后台至 AnythingLLM |
| NON-GOAL-09 | 不整体替换 AnythingLLM 所有认证体系或数据库引擎；只增加本次必要的 SSO、会话撤销和受管隔离 |

## 4.3 Architecture Boundary

| Domain | Owner | Input | Output | 不负责 |
|---|---|---|---|---|
| 需求 | 会议业务负责人 | 使用场景与三个交付结果 | 评审批准的目标与验收 | 伪造平台权限 |
| Spec | 两仓架构负责人 | 本 PRD、真实 Schema、版本证据 | Consumer/Provider 可验证契约 | 以接口猜测替代实际实现 |
| Plan | 开发负责人 | APPROVED_FOR_PLAN 版本 | REQ/AC 绑定的任务与依赖图 | 自行更改 SOT 与权限 |
| Execution | Consumer/Gateway开发；Gateway认证Owner | 已批准 Plan | 受管代码、迁移和测试 | 无授权修改其他仓库 |
| Governance | 安全、测试、运维 | Evidence、候选构建、迁移清单 | 阶段与发布决策 | 以 CI 绿色覆盖 BLOCKED |
| 企业身份 | Gateway 负责认证、准入及 canonical member/alias 管理；其内部服务由自身 owner 管理 | 真实企业微信认证 | 经过验证的 Consumer 认证结果 | AnythingLLM 不承担认证源、申请审批或身份绑定管理 |
| 腾讯接入 | Gateway | 员工身份、连接、动作、资源 | 目录、源作业、内容、授权判定 | 本地文档审核、OA |
| 产品与本地加工 | AnythingLLM | 员工级网关结果、本地补充资料 | 页面、资料、索引、受限问答 | 腾讯签名与密钥托管 |

## 4.4 五阶段推进顺序与出口

归属：REQ-EVID-001。阶段门禁是工程集成条件，不是独立生产发布许可。

| 顺序 | 阶段 | 核心交付 | 前置 | 阶段出口 |
|---:|---|---|---|---|
| 1 | S1 真实接口与身份契约 | 固定两仓 SHA；字段映射；Gateway认证依赖；新增网关投影；身份 namespace；错误/状态/权限契约 | PRD 经 owner 批准 | G1：契约文件、适配样本、Gateway认证消费契约签约与测试符合第 25 章 |
| 2 | S2 运行装配 | accountLogin/exchange；SSO facade；client/session/oauth/access/worker 实例；仅网关调用；真实查询/内容基础 | G1 | G2：实际启动装配、不依赖 mock、本人连接与已知会议可读；无直连流量 |
| 3 | S3 页面接通 | 设置、登录入口/结果、会议授权状态、列表、详情和状态交互 | G2 | G3：真实用户从页面走通；模拟扫码、假成功不通过 |
| 4 | S4 导入与读取权限 | 单一导入代次、审核索引、全读路径授权、RAG、撤销和崩溃恢复 | G3；安全基础已从 S1/S2 建设 | G4：A/B 隔离、完整性、恢复、负向与 failure injection 全通过 |
| 5 | S5 迁移验收 | inventory/diff/adopt、隔离历史、切换演练、凭据处置、回滚、普通工作区回归 | G4 | G5：真实迁移与最终 Release Gate 通过 |

**结果验收顺序：D1 → D2 → D3。** 身份契约属于 D3 的基础，但在 S1 先完成定义和依赖确认，不等到最后才设计身份。D2 仅在验收环境开放；未通过 G4/G5 的界面不能向生产用户开放旧内容或受管正文。D3 以 S4 的身份/权限闭环和 S5 的迁移证明共同完成。

## 4.5 范围决策

**DEC-R2-LOGIN-001（2026-10-19，用户已确认）：AnythingLLM 只提供连接 Meeting Gateway、获得企业微信授权扫码登录验证的消费能力。**

AnythingLLM 的身份交付范围为：登录入口、在AnythingLLM页面加载Gateway OAuth扫码界面、向Gateway发起认证、处理回跳、服务端兑换并确认认证结果、取得Gateway API token并加密保管用于本人接口调用、获取用户信息并同步必要本地投影、建立/撤销本地登录态，以及取消/过期/失败/不可用结果展示。企业微信认证、企业成员真实性、准入与 canonical member/alias 管理由 Gateway 负责。AnythingLLM 不新增企业身份服务、企业微信 Secret、准入申请系统、身份绑定审批后台或双证明绑定页面；也不发起 Gateway alias 创建/修改。

DEC-R2-LOGIN-001确定身份职责；随后确认的DEC-R2-PHASE-002/003/004按§4.6调整丢失后的读取策略、用户来源和当前阶段范围。R2总体的会议能力设计保留，但导入功能及验收不作为本阶段完成条件。企业微信认证成功不等于腾讯会议资源授权成功；本地整数用户ID只是Gateway稳定主体的存储投影，不是另一套独立用户身份。

Gateway 内部认证实现属于外部依赖，不由本 PRD 要求 AnythingLLM 团队另建身份服务。第 9.4.3 的 API 仍为目标契约，不因本决策改标为 EXISTING 或 VERIFIED。

---

## 4.6 当前阶段决策与Required范围（2026-10-19，用户已确认）

当前阶段标识：`AUTH_LOCAL_SEARCH`。本节是DEC-R2-LOGIN-001之后确认的范围修订，优先于本文原有“所有本地读取必须在线校验Gateway”“本地用户须预置”“全部导入AC均Required”等总体R2条款。旧条款仅在未被本节修改的场景及后续完整R2阶段适用。

**DEC-R2-PHASE-002 — 认证结果丢失后仅本地检索。** 当Gateway认证/票据兑换响应丢失，Consumer不能证明当前Gateway认证结果或业务凭据有效时，记录`remote_access_mode=LOCAL_ONLY`。该模式只绑定当前本地session或未完成prelogin事务，不是全局开关，也不能改变其他员工的会话。不重放一次性票据，不凭Gateway事务“已兑换”推断本人已登录；不通过Gateway获取腾讯会议目录、详情、录制、转写、纪要、附件或新数据；不触发腾讯直连、源作业、刷新拉取、自动导入或后台补抓。前端远端操作禁用，远端请求BFF在出站前拒绝，提示“认证结果丢失，仅可检索本地已有会议数据；重新扫码后恢复远端访问”。恢复为`GATEWAY_ENABLED`必须由用户显式重新扫码、服务端验证并拉取用户信息成功，不能依赖盲目重试。

`LOCAL_ONLY`只允许使用本地已经持久化的会议数据、既有索引和本地来源进行检索/问答；不得以缓存miss为由访问Gateway补齐，检索上下文不得触发远端会议工具。现有批准模型调用策略不因该模式增加新的会议数据源。已有有效本地会话仍按Gateway主体投影的本地owner/workspace ACL及已知撤销/隔离状态授权；跨用户、未知归属、已知撤销、停用或本地会话过期仍拒绝。没有有效本地会话时，认证丢失不能产生新会话或以“本地模式”匿名读取。该模式本地读取不要求在线Gateway access decision，不宣称离线期间实时验证了上游新撤销；不得把“认证响应丢失”与已观察到的明确撤销/拒绝混为一类。

**DEC-R2-PHASE-003 — Gateway为唯一企业用户身份源。** 本次企业微信链路不独立注册、邀请、手工创建或维护一套本地用户作为登录前提。认证成功后由AnythingLLM服务端通过Gateway受认证用户信息接口拉取当前用户，再按稳定键`(gateway_instance_id,gateway_org_id,gateway_member_id)`事务性创建/更新必要本地用户投影；已有投影复用本地整数ID。显示资料与成员有效性来自Gateway，不接受浏览器自报资料、不按姓名/邮箱合并、不保存企业密码、不伪造本地密码。Gateway身份别名仍只由Gateway管理。新投影使用普通用户的最小权限，不因Gateway返回角色自动成为本地admin；本地停用/已知撤销继续阻断。

策略为`independent_local_user_creation=false`、`gateway_user_projection_sync=true`，替代旧`auto_provision=false`及预置映射前提（该旧策略已废止）。用户信息至少有稳定实例/组织/member/user标识、发行方、当前有效状态及展示信息；实际profile读取API路径、认证方式、字段映射和版本由Gateway Consumer契约lock固定，未交付则`DEPENDENCY_NOT_READY`，不虚构现有端点。认证或profile获取未完成/失败时不建立成功用户投影、不签发新会话；已验证的成员停用/撤销信息仍应更新本地拒绝状态；已有有效本地会话仅按上述LOCAL_ONLY规则使用本地数据。历史同名本地账号不自动合并，本次仅同步被稳定Gateway主体确定的投影；其他既有非企业微信登录功能保持兼容，不作为新企业用户开户入口。

**DEC-R2-PHASE-004 — 导入交付非本阶段必需、暂停导入验收。** 新的远端会议导入、单一代次编排、导入任务推进及其验收均记为`DEFERRED_CURRENT_PHASE`，不要求本阶段完成；不把延后标成PASS，也不为过门禁模拟导入成功。本阶段不新增导入开发/验收任务，不要求删除或全局停用既有导入代码；不以页面展示为由自动触发导入。LOCAL_ONLY中的远端导入与补抓仍按DEC-R2-PHASE-002禁用；保留已有本地会议、索引和历史数据用于本地检索，不删除既有资产。REQ-IMPORT-001与A-IMPORT-001-01/02/03，以及UI-003、CONTENT、DATA、TXN等条款中的新导入依赖部分均延后。后续恢复导入阶段时，必须先修订审核前/后验收断言，再重新批准范围；原完整R2设计仅作为未来阶段基线。

当前阶段的Required验收由以下三个独立case确定，均须留存真实执行结果与对应负向证据；其余完整R2 AC/GC不能作为本阶段强制前置：

- **PHASE-AUTH-01（REQ-IDENT-001/002、AUTH、UI-001）**：Given Gateway返回真实已验证主体及用户信息；When首次扫码及同主体重复扫码；Then首次只生成一份普通用户投影，重复登录复用同一local ID，资料刷新来自Gateway，浏览器无Gateway/Tencent token；同名不同主体不合并，未验证/停用主体不建立新会话。Oracle：`projection_count_for_stable_subject == 1 && local_id_reused && profile_source == GATEWAY && unintended_admin_grants == 0 && unverified_session_delta == 0`。
- **PHASE-LOCAL-02（REQ-IDENT-001、ACCESS、RAG、UI-001）**：Given A已有有效本地会话及本地会议M、B有独立会话；When注入Gateway兑换响应丢失；Then模式LOCAL_ONLY，A可检索其获本地授权的M，B不能读A的M；未知owner/已知撤销/过期本地会话不能读，远端列表/详情/正文操作不发Gateway或腾讯数据请求，也不自动导入；无本地会话的新登录不因丢失而成功。Oracle：`mode == LOCAL_ONLY && permitted_local_search_succeeds && cross_user_leaks == 0 && remote_tencent_data_requests == 0 && automatic_imports == 0 && unverified_session_delta == 0`。另显式重新扫码成功后才恢复远端访问；未部署身份依赖与认证响应丢失分别展示，不冒称扫码成功。
- **PHASE-SCOPE-03（REQ-UI-003、COMPAT、EVID）**：Given本阶段范围清单；When检查计划、验收清单与phase gate；Then新导入开发和验收不作为本阶段必需任务，旧本地资料/检索保持；导入case的scope_disposition为DEFERRED_CURRENT_PHASE且不伪造PASS，缺少本阶段Required证据仍使phase gate失败。Oracle：`import_development_required == false && import_acceptance_required == false && local_data_preserved && import_cases_not_counted_as_pass && required_phase_evidence_verified`。LOCAL_ONLY禁用远端导入仍由PHASE-LOCAL-02验证，不因导入延期而取消该取数禁令。

范围标记`scope_disposition=DEFERRED_CURRENT_PHASE`与测试执行`status`分离；本阶段不运行的导入case只登记在范围清单中，不生成虚假的PASS。既有Evidence的执行状态仍只允许PASS/FAIL/SKIPPED/BLOCKED，完整R2门禁仍不能把Required的SKIPPED/BLOCKED视为PASS。

阶段门禁：`Phase PASS = all(PHASE-AUTH-01,PHASE-LOCAL-02,PHASE-SCOPE-03) == PASS && source/config/build identities match && evidence integrity verified`。它只证明本阶段登录消费与本地检索，不代表完整R2的G1–G5/8个GC或生产迁移已经通过。第20/25/27/35章的全量Required/Release规则继续用于完整R2，不能将本阶段延期项误报为全量已完成。

---

## 4.7 OAuth扫码展示与Gateway API凭据交付（2026-10-19，用户已明确）

**DEC-R2-OAUTH-QR-005：AnythingLLM触发Meeting Gateway现有OAuth授权流程，在AnythingLLM页面加载并显示Gateway提供的企业微信二维码；用户扫码通过后，Gateway将经过身份验证的API调用token交付给AnythingLLM后端，用于后续接口存取。** 本节修订登录展示、OAuth接通方式和凭据交付，优先于旧文中将“另建专用企业微信扫码接口”作为前提、只做外跳而不显示扫码界面、或只取得本地登录token而不保留Gateway API凭据的理解。§4.6的Gateway用户投影、LOCAL_ONLY和导入延期继续有效。

交互与职责：

1. 用户在AnythingLLM点击企业微信登录；Consumer后端创建浏览器绑定的登录事务，按Gateway现有OAuth能力构造授权请求，使用既有client_id、注册redirect_uri、scope/resource及state；PKCE按该OAuth客户端的实际支持方式接入，不猜测字段。
2. Gateway负责与企业微信交互、生成真实二维码及二维码有效期。AnythingLLM在自己的登录界面加载显示Gateway提供的授权页/扫码组件或二维码展示数据。具体采用允许嵌入的授权页还是现有二维码资源，按实际Gateway能力选择；不把仅跳走到外部页面作为本条交互已完成，不自行生成、截取或模拟企业微信二维码，不通过去除CSP/X-Frame保护或代理任意HTML来强行嵌入。
3. 用户扫码、确认或取消均由Gateway处理。Gateway完成企业身份真实性验证后，按现有OAuth机制将结果回调Consumer；标准授权码模式下回调只携带code/state等短时结果，Consumer后端再兑换Gateway API token。若实际部署已有其他受保护的后端交付方式，复用其现有机制。用户所述“把token给AnythingLLM”指凭据最终由Consumer服务端取得，不要求把access_token放进URL、iframe消息或浏览器存储。
4. Consumer验证登录事务、state、回调归属和一次性结果，通过受信Gateway token端点取得凭据并检查实际token类型、scope/resource和期限。若使用JWT claims作为身份断言，则校验其签名、issuer、audience和有效期，不能仅decode后信任；对仅用于调用Gateway的access_token可按opaque凭据保管，并通过Gateway已有认证用户信息/验证能力确认主体，不因token外形为JWT而强制新建JWKS或内省服务。收到回跳本身不代表成功。Iframe嵌入时同时设计顶层页面完成/同源结果通知与cookie关联，校验消息origin/source，不能因跨站cookie问题关闭Secure/HttpOnly/SameSite保护。
5. Consumer使用已验证的Gateway API token获取或确认当前Gateway用户信息，事务性同步稳定主体的普通本地投影，并建立AnythingLLM本地会话。只在已核实签名、主体语义且包含全部必要字段时复用Gateway已有响应/claims；不因此强制新增独立profile服务。成员停用、身份冲突、权限不足与token获取失败不能冒称登录/接口授权成功。
6. Gateway access_token及实际返回的refresh_token、issuer/audience、scope/resource、期限和版本绑定到对应本地用户/session，并以现有服务端加密bridge/token store保存。后续AnythingLLM调用Gateway接口时使用该用户的Gateway凭据；不把AnythingLLM local JWT或腾讯上游token当Gateway访问凭据，不退回共享服务账号。浏览器仅持有本地会话和非敏感扫码状态。
7. 回调/兑换结果丢失、凭据状态无法确认时仍按§4.6进入当前session的LOCAL_ONLY，暂停Gateway/Tencent会议数据访问，不盲目兑换重试或自动恢复；已有有效本地会话可检索既有授权本地资料。显式重新扫码并取得当前有效Gateway凭据/用户信息后才恢复远端。

配置核对限于实际OAuth对接所需内容：授权入口、二维码展示方式、已注册客户端/回调地址、支持的grant/PKCE、API audience/scope、token响应和用户信息来源、过期/撤销语义。优先复用现有端点、响应及配置，不要求AnythingLLM团队另建企业微信认证服务或独立“扫码契约平台”。部署尚未确认的字段逐项登记，不把源码旧版本或未发现专用WeCom路径推断为现有OAuth一定不可用。

PHASE-AUTH-01追加Oracle：`qr_display_owner == ANYTHINGLLM && qr_issuer == GATEWAY && gateway_api_token_stored_server_side && gateway_api_calls_use_actor_token && gateway_tokens_in_browser == 0`。真实验收包含页面加载真实二维码、用户扫码、Gateway确认、Consumer收到并验证API凭据、重复用户复用投影、一次本人授权的Gateway只读接口调用及取消/过期/错误主体的负向结果；不执行本阶段延期的新会议导入。页面/协议接通与Evidence记录分别验证，不以fixture登录或自写JSON冒充真实扫码。

---
## 4.8 员工会话交换与腾讯会议授权的实际调用链（用户提供）

**DEC-R2-EMPLOYEE-OAUTH-006：按用户提供的现有Gateway员工授权链路接通，不再把获取静态二维码URL或新增WeCom接口作为Consumer实施前提。** 本节优先于§4.7中对具体grant/扫码来源/凭据交付的推测。§4.6的普通本地投影、LOCAL_ONLY及导入延期继续有效。

1. 员工通过Gateway `POST /api/v1/auth/account-login` 登录。Gateway仅向Backend账号登录接口核验一次账号密码。AnythingLLM如提供该登录入口，只将凭据经同源BFF转发至Gateway，不自行验证Backend密码、不持久化或记录密码，不创建独立企业账号。
2. Backend的 `access_token` 和 `refresh_token` 不落库、不返回内部系统或浏览器。Gateway另行签发 `ms_` 前缀的 `session_token`；Consumer以它关联当前员工，按Gateway已有身份响应或 `GET /api/v1/auth/session` 确认稳定用户信息并建立必要本地投影。不得将Backend JWT、浏览器userId或本地JWT替代ms_；不得将ms_送往浏览器。
3. Consumer后端使用当前员工ms_、已注册的 `client_id` / `client_secret` 调用 `POST /api/v1/auth/exchange`。`subject_token` 必须是ms_；旧Backend JWT应401。请求所需scope/resource依据已注册客户端和Gateway的REST资源地址设置，返回的access_token绑定该员工的MEMBER主体和REST audience。
4. `POST /api/v1/oauth/authorizations` 使用exchange取得的Gateway access_token作为Bearer。此处不使用ms_、本地JWT、Backend JWT、腾讯上游token或共享服务账号代替。Consumer后端在已有加密bridge/token store中保管本人ms_、业务access_token及实际返回的refresh资料/期限；不新增并行token库，不把业务凭据放URL、localStorage、iframe消息或浏览器DTO。
5. 成功响应从业务envelope `data` 解包得到 `authorization_url`、`transaction_id`、`expires_at`。URL形如 `https://meeting.tencent.com/marketplace/authorize.html?corp_id=...&sdk_id=...&redirect_uri=...&state=...`。四个参数均按Gateway实际应用配置校验；允许的origin/path固定，不删除corp_id校验。ENV应用redirect_uri固定为 `{PUBLIC_BASE_URL}/callbacks/tencent/oauth/<应用ID>`；这是腾讯回调Gateway的地址，不是AnythingLLM return_to。
6. Gateway管理一次性state，默认约300秒，Consumer尊重实际 `expires_at`，不能续期或重放。`authorization_url` 由员工浏览器打开/加载，Consumer服务端不得GET、代理、截图或抓取该URL来获取二维码。AnythingLLM显示授权入口/等待/过期/结果，浏览器承载方式遵守该页面实际嵌入政策；不得把未验证的内嵌能力或二维码图片API写成已存在。不能强行绕过CSP/X-Frame保护。
7. 腾讯授权回调Gateway后，Gateway按预先允许的 `return_to` 回到AnythingLLM；回跳只带 `connection_id`，不带令牌。Consumer核对本地发起事务/员工会话后，使用后端本人Gateway token查询连接状态，确认连接归属和服务端授权结果；不得仅凭query中的connection_id设置ACTIVE或建立新登录。任意外部return_to、跨员工connection_id、无事务/过期回跳均不能取得本人业务权限。

**身份与连接分离：** 该具体URL是腾讯会议授权页。员工身份由Gateway账号登录及ms_确认，exchange业务token用于Gateway API，腾讯连接状态由授权回调后Gateway查询确认。不能把腾讯会议扫码成功表述为新增企业微信身份认证证明；若未来Gateway提供真正企业微信免密登录，只替换员工身份入口，后续ms_/exchange/连接授权分层保持清楚。页面必须区分“员工已登录”“腾讯会议已授权”，不能用connection_id或授权页扫码本身替代登录凭证。

**本阶段验收修订：** 可独立实现上述现有协议的Consumer适配、服务端凭据保管、浏览器授权和回跳确认，使用受控测试验证ms_前缀、MEMBER/audience、四参数URL、state期限、连接归属和无token回跳。真实员工登录/授权未执行则如实记未验证；不再等待用户提供固定二维码图片链接，不另起通用身份服务。本阶段仍不开发或验收新会议导入；失去可确认Gateway凭据时仍LOCAL_ONLY，只查询本地既有获权资料。

---
# 5. Terminology / Domain Model

| 术语 | 唯一定义 |
|---|---|
| Local User | Gateway认证并拉取用户信息后的必要本地用户投影；整数ID供本地外键/权限使用，不独立建立企业用户；不直接继承Gateway管理员角色 |
| Enterprise Identity | Gateway经过真实企业微信认证验证的发行方、企业、员工三元组；不是前端提交的userid |
| Gateway Member | Gateway 内部成员 ID；不能与 Local User、企业微信 userid 或腾讯用户 ID 混用 |
| Identity Alias | 将一种发行方身份绑定到既有 canonical Gateway Member 的显式记录 |
| Local Principal Mapping | 从已验证Gateway用户信息按稳定主体键同步得到的本地投影对应关系；首次可幂等创建投影，不按姓名/邮箱认领，不提供申请/审批页面 |
| Authentication Projection | 本地保存的Gateway认证结果与会话绑定缓存；不等同于Gateway企业身份/alias管理 |
| Main Session | AnythingLLM 用户登录会话；SSO 登录附加可撤销 session_id / credential_epoch |
| Bridge Session | HttpOnly opaque Cookie 对应的服务端加密员工网关会话；不是用户共享 API Key |
| ms_ / mt_ / mr_ | Gateway 本地身份会话 / REST 或 MCP 业务访问令牌 / 刷新令牌；三者与腾讯令牌均不同 |
| Tencent Connection | Gateway 中员工拥有的腾讯 OAuth 连接；R2 用户流程只选择本人 `THIRD_PARTY_OAUTH` |
| Source Query | 请求 Gateway 从腾讯查询；与读取 Gateway 目录不同 |
| Query Snapshot | 某个成功源查询收集的资源 ID 集合及时间窗口；不是历史目录筛选的猜测结果 |
| Source Version | Gateway 原样返回的内容版本；按 opaque string 处理，不由 Consumer 重算替换 |
| Original | 版本化保存的源转写/源纪要；不可被人工编辑覆盖 |
| Business Revision | 用户在 AnythingLLM 的修订；与原文分层，单独审核、版本和 hash |
| Import Operation | 一次用户选择会议/录制/内容/范围/目标工作区的导入操作 |
| Import Generation | R1 `meeting_import_generations` 的一次可发布物理代次；失败重试不产生重复可见产物 |
| Restricted Workspace | 本人独占且持续受会议授权限制的工作区；不是普通工作区加一句“私有”提示 |
| Available | 本地审核/索引状态允许使用；不代表当前远端权限允许读取 |
| Access Valid | 当前请求得到网关允许且本地策略允许；不是长期授权承诺 |
| OUTCOME_UNKNOWN | 上游写请求可能受理但没有可靠结果；不能直接重发产生新事务 |
| Quarantine | 字节保留、所有新读取与检索被阻断的隔离状态；不等于删除 |
| Desired / Observed | 用户或部署期望 / 来自事实源的实际观察，两者不能互相覆盖 |
| Implemented / Verified | 已写代码 / 已有本候选构建的执行证据，不能互换 |
| PASS / BLOCKED | Oracle 全部满足 / 缺依赖或无法执行；BLOCKED 不是 PASS |

---

# 6. System Context

## 6.1 Context Diagram

```text
企业员工浏览器
  ├─ 企业微信登录入口
  └─ 现有 Meetings 页面
             │ 同源 /api；本地 JWT + HttpOnly bridge
             ▼
AnythingLLM BFF
  ├─ 消费Gateway认证结果、拉取用户信息并同步本地投影/会话
  ├─ 会议领域模型、修订、审核、查询/导入操作
  ├─ 持续受限 Workspace / 文件 / 向量 / 问答
  └─ 单一 Meeting Gateway Adapter
             │ HTTPS；可信客户端 + 员工级会话/业务令牌
             ▼
Meeting Gateway
  ├─ 企业微信扫码认证/身份管理 ──► 企业微信（内部服务由 Gateway 管理）
  ├─ 当前员工、别名、连接、权限、源作业
  ├─ 腾讯 OAuth / Webhook callbacks
  └─ 腾讯原生 API ──► 腾讯会议

AnythingLLM ──► 原有 OCR / Collector / 向量引擎 / 已批准模型
所有阶段 ──► 脱敏 Evidence / Audit
```

## 6.2 System Boundary

Inside：Consumer 登录接入、页面、本地会话、受管数据及测试；Gateway 对 Consumer 的认证/会议接口适配。企业身份服务建设不纳入 AnythingLLM 实施任务。
Outside：企业微信本身、腾讯会议自身、外部企业身份服务的内部账号体系、OCR/LLM/向量产品内部实现。
External dependency：真实企业身份依赖、腾讯权益与样本、HTTPS/证书/内网路由、数据库与存储。
Trusted input：验证后的主会话、Gateway 实时授权结果、已固定版本的契约、经过 owner 审批的映射清单。
Untrusted input：浏览器所有字段、OAuth 回跳 query、会议正文、文件名、模型输出、HTTP 重定向、DNS 解析结果、导入历史记录中的未核实 ID。

## 6.3 四种 URL 不能混淆

归属：REQ-CONFIG-001、REQ-IDENT-001、REQ-OAUTH-001。

| URL | Owner | 作用 |
|---|---|---|
| Gateway 内部 HTTPS Origin | 运维/适配层 | 服务端 REST 调用；不带 `/api/v1` 路径 |
| Gateway 公网回调入口 | Gateway | 接收腾讯 OAuth/Webhook 或企业身份回调；路径分别注册 |
| AnythingLLM 同源 SSO callback | AnythingLLM | 只接收当前登录事务关联的一次性结果票据，不接收长期 Gateway/Tencent token |
| 腾讯 OAuth 授权后 return_to | Gateway 白名单配置 | 回到 AnythingLLM 授权结果页；不能据 return_to query 自行判断授权成功 |

---

# 7. Authoritative State / Source of Truth

归属：REQ-CONTRACT-001、REQ-IDENT-002、REQ-DATA-001、REQ-ACCESS-001、REQ-EVID-001。

| State | Role | Authoritative? | Writer | Reader | 可否自动覆盖 |
|---|---|---:|---|---|---|
| 网关连接配置候选 | DESIRED_STATE | 仅对配置意图 | 本地管理员 | 配置校验器 | 仅匹配 revision 的显式保存 |
| 已应用配置与 revision | LAST_APPLIED_STATE | 是，本地配置事实 | 配置事务 | runtime/诊断 | 不以诊断结果改写 |
| 企业成员启停与企业身份 | OBSERVED_STATE | Gateway对Consumer提供权威验证结果；上游身份源由Gateway负责 | Gateway认证服务/验证器 | 会话与 access 判定 | 仅可信验证结果；Consumer不自行认证企业成员 |
| 企业身份到 canonical member 映射 | LAST_APPLIED_STATE | Gateway 权威 | Gateway 身份管理流程；Consumer 只读 | auth/迁移 | 冲突时 BLOCK；Consumer 不写 alias |
| Local User 投影与角色、credential_epoch | RUNTIME_STATE | Gateway为企业身份/资料源；Consumer负责本地投影/最小角色/session有效性 | Gateway认证后的用户信息同步；本地停用/撤销 | 本地认证/检索 | 不独立建企业用户；不由Gateway角色自动升级admin |
| 主会话、SSO事务、bridge | RUNTIME_STATE | 各自签发方权威 | 认证服务 | BFF/middleware/worker | 仅合法状态转移 |
| 腾讯 OAuth Connection/源权限 | OBSERVED_STATE | Gateway 权威；上游权限经其验证 | Gateway | BFF | UI 不可直接标记 ACTIVE |
| 源查询与查询结果快照 | OBSERVED_STATE | Gateway 权威 | Gateway Worker | 页面/BFF | 本地目录不能伪造补齐 |
| Asset version/state/is_complete | OBSERVED_STATE | Gateway 权威 | Gateway ContentService | Importer | Consumer 不改 READY/版本 |
| Import Operation/Generation | RUNTIME_STATE | 本地台账权威 | 单一导入编排器 | 页面/恢复器 | 通过 CAS 与 fence |
| 原始资料与来源映射 | LAST_APPLIED_STATE | 本地原样副本；来源仍指向网关 | 受管写入器 | 审核/检索 | 不接受人工覆盖 |
| 人工修订、审核、补充资料 | DESIRED_STATE / LAST_APPLIED_STATE | 本地用户内容权威 | 获权 owner | 业务与索引 | 不被源同步自动覆盖 |
| 检索可用状态 | RESOLVED_STATE | 派生，不授予权限 | 状态解析器 | UI | 按独立审核/索引事实派生 |
| 请求级 access decision | RESOLVED_STATE | 仅对该主体/动作/资源/时点有效 | Gateway + 本地策略交集 | 所有读取入口 | 失效后重新判定 |
| 迁移计划与 T0 备份 | DESIRED_STATE / EVIDENCE_STATE | 受管范围与恢复基准 | 迁移审批器/快照器 | migrator | hash 漂移阻断 |
| 测试/验收 Evidence | EVIDENCE_STATE | 执行证据，不是业务状态 | 测试工具 | Gate | 不覆盖旧 run，追加新 run |

状态优先级：`LOCAL_DISABLED/IDENTITY_REVOKED` > `ACCESS_DENIED/SOURCE_REMOVED` > `AUTH_REQUIRED` > `DEPENDENCY_UNAVAILABLE` > `CONTENT_PENDING` > `LOCAL_PROCESSING` > `AVAILABLE`。优先级只决定 UI 主提示；各状态轴独立保存，不能用一个 status 覆盖其他事实。

---

# 8. State Machine

归属：REQ-IDENT-001/002、REQ-AUTH-001、REQ-OAUTH-001、REQ-QUERY-001、REQ-IMPORT-001、REQ-TXN-001、REQ-REVOKE-001、REQ-MIGRATE-001。

## 8.1 状态转移表

| 生命周期 / 持久位置 | 合法转移 | 触发与前置条件 | 错误与恢复 |
|---|---|---|---|
| 本地 SSO 事务 / `meeting_sso_transactions` NEW | CREATED → REDIRECTED → IDENTITY_VERIFIED → BOUND → CONSUMED | 同一浏览器nonce；一次性票据；服务端身份验证；Gateway用户信息同步成功 | 任一非终态 → EXPIRED/DENIED/FAILED；重新发起新事务，不重放票据 |
| Gateway SSO 事务 / NEW identity transaction | PENDING → CALLBACK_VALIDATED → REDEEMED | 外部身份票据服务端兑换；企业 allowlist；PKCE；客户端校验 | PENDING → EXPIRED/DENIED；不明兑换结果 → RECOVERY_REQUIRED；查询原事务，不盲目兑换 |
| Consumer用户投影 / `meeting_gateway_bindings` | PROFILE_REQUIRED → BOUND → REVOKED | Gateway认证通过且成功拉取当前用户信息；按稳定键幂等upsert本地投影 | profile失败不建新会话；主体冲突/LOCAL_DISABLED拒绝；Consumer不写Gateway alias |
| 远端访问模式 / 本地认证与会话记录 | GATEWAY_ENABLED → LOCAL_ONLY；显式重新扫码验证并同步profile后→GATEWAY_ENABLED | 兑换响应丢失等§4.6明确条件；丢失后不再获取腾讯会议数据 | LOCAL_ONLY只允许已授权本地数据检索；无有效本地会话不能读；明确撤销仍拒绝 |
| 主会话 / NEW `meeting_login_sessions` | ACTIVE → EXPIRED/REVOKED | 服务端到期、注销、密码变化、用户停用 | 终态无复活；重新登录创建新 session_id |
| Bridge / R1 bridge 表扩展 | AUTH_REQUIRED → BOUND → EXPIRED/REVOKED | ms/mt/local session 均有效；最大 900 秒 | 需要重新认证；不自动改用管理员令牌 |
| 腾讯 OAuth / Gateway Connection + R1 transaction | NOT_AUTHORIZED → PENDING → PENDING_CONFIRMATION → ACTIVE | Gateway 验证 state、兑换、确认当前成员 | CORP_MISMATCH/IDENTITY_CONFLICT/EXPIRED/DENIED/BLOCKED；由上游真实状态驱动 |
| 源查询 / Gateway job + NEW snapshot | 本地归一化CREATED → QUEUED → RUNNING → SUCCEEDED（Gateway原始状态见§9.3） | 同一成员/连接/窗口，所有源页遍历完成 | RETRYING 可回 RUNNING；FAILED/DENIED 终止；未知提交结果为 OUTCOME_UNKNOWN |
| 本地导入操作 / NEW operation orchestration | RESERVED → WAITING_SOURCE → FETCHING → STAGED → WAITING_REVIEW → INDEXING → VERIFIED | 每一步满足来源完整性、owner、审核和 fence | AUTH_REQUIRED/RETRYABLE_FAILURE 可用原 operation 恢复；INCOMPLETE/CONFLICT/FAILED 不发布 |
| 物理代次 / R1 generations | PENDING → STAGED → INDEXING → VERIFIED → REVOKING → PENDING_CLEANUP → REMOVED | 扩展 R1 lifecycle 与台账；一个 import_id 只有一个 active generation | 失败进入 RECOVERY_REQUIRED/PENDING_CLEANUP；旧 fence 不得提交 |
| 访问状态 / import access_state 扩展 | UNVERIFIED → VALID → AUTH_REQUIRED/DENIED/QUARANTINED | 当前请求实时判定；不是永久准入 | 重新授权后重新校验原资源与版本；不直接把 DENIED 改 VALID |
| 人工业务修订 / existing meetings + revision extension | DRAFT → APPROVED → DRAFT | 审核以 revision 为条件；任何内容变更使旧审核失效 | 审核并发冲突返回 409，无覆盖 |
| 迁移 / NEW migration run | INVENTORIED → PLANNED → APPROVED → STAGED → APPLIED → VERIFIED | inventory/plan/T0 digest 一致，owner 与上游映射证明齐全 | DRIFTED/QUARANTINED/ROLLED_BACK/RECOVERY_REQUIRED；不明 owner 永不自动删除 |

## 8.2 非法转移

禁止 `202 → SUCCEEDED`、`PENDING_CONFIRMATION → ACTIVE` 的前端本地改值、`INCOMPLETE → VERIFIED`、失权后保留 AVAILABLE 即直接读取、清理未完成就复用旧 generation、回滚失败后删除备份。

本章保留的“本地解绑”仅指撤销R1本地bridge/认证投影及其会话，不创建或改写企业身份映射，不对Gateway member/alias执行管理操作，也不新增身份绑定管理页。

会话过期不是注销腾讯 OAuth；解除本地绑定也不是自动撤销腾讯连接。三种操作分别命名、分别记录：本地退出、解除本地身份绑定、前往 Gateway 管理腾讯连接。R2 页面不把前两者显示为“腾讯账号已撤销”。

## 8.3 状态解析规则

原 `reviewStatus` 与 `retrievalStatus` 保留；新增独立 `accessState`。页面能够进入问答的条件为：`reviewStatus == APPROVED`、`retrievalStatus == AVAILABLE`、本次请求 `access.allowed == true` 且活动 generation 有效。`accessState` 的本地缓存不能替代本次 access decision。

---

# 9. Data / Schema Contract

归属：REQ-CONTRACT-001、REQ-PROVIDER-001、REQ-IDENT-001/002、REQ-AUTH-001、REQ-CONFIG-001、REQ-QUERY-001、REQ-CONTENT-001、REQ-IMPORT-001、REQ-DATA-001、REQ-ACCESS-001、REQ-TXN-001。

## 9.1 Schema Rule

本文定义的 **NEW / MODIFY 对外 DTO** 采用 schema version `2.0`、`additionalProperties=false`；唯一扩展点是明确标为 `raw_provider_payload` 的服务端私有对象，不向浏览器传递。固定枚举拒绝未知值；非兼容新增字段、改变语义或放宽权限需提升主版本并重新过 G1。数据库的迁移可以新增字段，但不能把“DB 有新列”当作允许 DTO 任意扩展。

现有 Gateway REST 成功 envelope 为 `code:0,error_code:0,message_key,message,data,trace_id`。[SRC-09] `account-login` 和 `auth/exchange` 从 `data` 解包；`/oauth/token` 是 OAuth 原生响应，不能按业务 envelope 解析。HTTP 非成功、业务非零、JSON 类型错误或缺少 required 字段均不能返回成功 DTO。

共同字段规则：ID 按各发行方的 opaque string 原样保存；本地整数 ID 只接受正安全整数。时间为带 `Z` 的 UTC RFC3339 字符串；接口持续时间显式命名 `*_seconds` 或 `*_ms`。查询窗口统一半开区间 `[start_at,end_at)`。字符串不自动大小写转换；只有用户可编辑的名称去除首尾空白。

## 9.2 配置 Schema：`mgw.integration-config.v2`

| Field | Type | Required | Default | Authority | Meaning |
|---|---|---:|---|---|---|
| schema_version | string enum `2.0` | 是 | 2.0 | 契约 | 不是网关产品版本 |
| revision | int >= 0 | 是 | 0 | 本地 DB | 保存使用 If-Match/CAS |
| enabled | bool | 是 | false | 管理员意图 | 未过 readiness 不代表可用 |
| provider | enum `meeting_gateway` | 是 | meeting_gateway | 本 PRD | 不接受 tencent_direct |
| name | string 1–128 | 是 | Meeting Gateway | 管理员 | 连接显示名 |
| gateway_instance_id | UUID | 是 | 无 | 部署登记 | 迁移/去重命名空间；不能随域名变化重建 |
| gateway_origin | HTTPS origin | 是 | 无 | 运维允许源 + 管理员选择 | 必须在部署 allowlist 中；无路径/query/userinfo |
| gateway_client_id | string 1–64 | 是 | 无 | Gateway | CONFIDENTIAL 注册客户端 |
| gateway_application_ref | string 1–64 | 是 | 无 | Gateway 应用登记 | 只读网关内部应用引用；不是腾讯 sdk_id；与当前客户端允许的应用匹配 |
| client_secret_operation | enum `KEEP,REPLACE,CLEAR` | 是 | KEEP | 管理员 | REPLACE 要求 value；CLEAR 使新业务请求关闭 |
| client_secret_value | string 1–512 | 条件 | 无 | 仅服务端密钥写入 | 只在 REPLACE 请求出现；响应永不出现 |
| rest_resource | string | 是 | 无 | Gateway 冻结契约 | 使用网关声明的精确受众；不与 MCP 混用 |
| contract_revision / contract_sha256 | string / 64 hex | 是 | 无 | 部署契约包 | UI 只读；实际验证文件与契约，不仅验格式 |
| request_timeout_ms | int 1000–30000 | 是 | 10000 | 管理员 | 不等于异步作业总时间 |
| query_poll_seconds | int | 是 | 2 | 固定本版 | 前 30 秒 2 秒；之后 5 秒 |
| wecom_login_enabled | bool | 是 | false | 部署与管理员 | 身份依赖失败时显示不可用原因；不能假登录 |
| account_bridge_enabled | bool | 是 | false | 管理员/安全审批 | 仅已存在账号的诊断兼容入口，不代替企业微信交付 |
| public_return_uri | HTTPS URL | 是 | 无 | 受控配置 | 精确注册的 AnythingLLM 授权结果地址 |
| ocr | object | 是 | 原配置 | 本地解析 Owner | 与 Gateway 配置独立保存；保持原 token/timeout |

响应仅包含非敏感字段、`client_secret_present`、`configured` 和按项诊断状态。新配置与旧密钥不做“空字符串猜测删除”；保留/替换/清除是显式操作。配置错误不覆盖 last_applied。

## 9.3 现有 Gateway API 与 Consumer 适配

| 方法与路径 | 状态 | 认证 | 输入/输出要点 | Consumer 要求 |
|---|---|---|---|---|
| POST `/api/v1/auth/account-login` | EXISTING | 账号密码；仅服务端转发 | `{account,password}` → data.session_token/expires_in/org_id/user | 归一化为 msToken、绝对期限、binding；不保存密码 |
| GET `/api/v1/auth/session` | EXISTING | ms_ | org_id/member_id/user_id/expires_at | 确认身份，不把它当会议授权 |
| POST `/api/v1/auth/exchange` | EXISTING | body 客户端凭据 + ms_ | client_id/client_secret/subject_token/scopes/resource | 严格传 ms_；按请求 scopes 的最小集合签发 mt_ |
| GET `/api/v1/me/permissions` | EXISTING | mt_ REST audience | actions/policy_version/grant_summaries | 不等于某具体会议一定可读 |
| GET `/api/v1/me/connections` | EXISTING | mt_ | id/application_id/kind/status/owner_member_id | camelCase 只在 Adapter 内转换；不假定有完整 capabilities |
| POST `/api/v1/oauth/authorizations` | EXISTING | mt_ MEMBER | application_id、return_to → authorization_url/transaction_id/expires_at | application_id 为 Gateway 内部 ID，不是腾讯 sdk_id |
| POST `/api/v1/connections/{id}/confirm` | EXISTING | mt_ MEMBER | 当前员工确认 | 再读连接确认 ACTIVE，不能只信按钮点击 |
| POST `/api/v1/meeting-queries` | EXISTING，R2 扩展幂等头 | mt_ | USER_WINDOW/connection_ref/target_member_id/start_at/end_at | target_member_id 由可信绑定写入，浏览器不能指定 |
| GET `/api/v1/jobs/{id}` | EXISTING | mt_ | state/attempts/run_after/progress/last_reason | 当前原始状态 PENDING、PROCESSING、RETRYING、SUCCEEDED、FAILED [SRC-17] |
| GET `/api/v1/meetings` | EXISTING | mt_ | limit/cursor/q/connection_ref | Gateway 目录，不冒充本次窗口查询结果 |
| GET `/api/v1/meetings/{id}`、`…/{id}/recordings` | EXISTING | mt_ | fetch=ensure/cache；可返回 202 | id 是 Gateway ID，不是腾讯会议号 |
| GET `/api/v1/recordings/{id}/transcript` | EXISTING | mt_ | limit 1–500/cursor/fetch；content、next_cursor、is_complete、content_version | 全部分页一致；不可重算 source_version |
| GET `/api/v1/recordings/{id}/minutes` | EXISTING | mt_ | content、状态/版本 | 保留原生模型/类型语义与空 todo |
| POST `/api/v1/assets/{id}/download-tickets` | EXISTING，本版不开放一般下载 | mt_ + download 权限 | 主体绑定许可 | R2 默认不启用远端媒体/附件下载 |

日期窗口查询归一化状态：`PENDING→QUEUED`、`PROCESSING→RUNNING`、其余同名映射；保存 `raw_state` 便于诊断。未知 raw_state 返回契约错误，不显示“完成”。

时限转换：`expires_at = request_started_at + expires_in - 5 秒`；以服务端发起时钟作保守计算，不用浏览器时钟、不因响应延迟延长令牌期限。若已过期则返回 `MGW_BUSINESS_AUTH_REQUIRED`。

## 9.4 企业身份契约与主登录：NEW / EXTERNAL_REQUIRED

### 9.4.1 唯一身份接入路径与消费契约

遵循 DEC-R2-LOGIN-001：企业微信授权、扫码认证、企业准入和身份绑定管理由 Gateway 提供；AnythingLLM 只与 Gateway 通信并消费经过后台校验的认证结果。Gateway 是否复用其内部企业身份服务，由 Gateway 负责，不作为 AnythingLLM 另建服务的任务。

Gateway owner 交付 `meeting-gateway-wecom-consumer.lock.json`：固定 Gateway 实例/版本、对 Consumer 的 API 方法与路径、机密客户端认证方式、请求/响应 schema 摘要、允许认证 Origin/回调、issuer/corp/audience、一次性票据/事务 proof 语义、状态与错误枚举、golden sample 摘要。实际端点未提供时不伪造其已存在 URL。缺项为 `DEPENDENCY_NOT_READY`；新增目标 API 与已部署能力须分别标记。

Consumer 所需外部语义仅为：发起本人企业微信认证、服务端兑换一次性结果、查询原认证事务状态、获取可验证的当前身份与期限。Gateway 对其上游身份真实性和成员状态负责；Consumer 校验 Gateway 服务身份、事务关联、结果完整性与本地准入，不直接接受浏览器提交的企业 userid。

认证消费契约不授权 AnythingLLM 写 Gateway 的 member、alias、企业成员或准入状态。内部身份适配 lock 可以由 Gateway 自行维护，但不替代面向 Consumer 的契约，也不要求 Consumer 调用内部身份接口。

### 9.4.2 Gateway 内部断言参考：`mgw.enterprise-identity-assertion.v2`

以下仅为 Gateway 内部校验设计参考，不是 AnythingLLM 的入参 DTO、实施任务或必须新增的独立服务接口。Consumer 只接收 §9.4.3 后台兑换的受控认证投影；内部实现是否采用本断言不改变 Gateway 对真实性、期限及主体一致性的责任。

required：`issuer`、`corp_id`、`employee_id`、`subject_id`、`subject_version`、`active`、`display_name`、`auth_time`、`expires_at`、`transaction_id`、`nonce`、`audience`、`authentication_method`。

字段类型：标识均为非空 string（1–256），`subject_version` 为非负整数，`active` 为 bool，时间为 UTC，`authentication_method` 固定 `wecom`；`audience` 精确为 Gateway 的身份接收标识。缺省无；`additionalProperties=false`。

断言必须来自外部服务的经认证后台兑换结果，并与 Gateway 保存的事务匹配；浏览器 JSON 无权成为断言。企业 ID 由 allowlist 校验；企业微信 corp_id 与腾讯 corp_id/open_corp_id 分别保存，不能按字符串相等推定组织映射。

### 9.4.3 新增 Gateway facade API

| NEW API | 请求 | 响应及行为 |
|---|---|---|
| POST `/api/v1/auth/wecom/transactions` | 机密客户端认证；redirect_uri、client_state、code_challenge、code_challenge_method=S256 | 201；transaction_id、authorization_url、expires_at；事务 300 秒 |
| GET `/callbacks/identity/wecom` | Gateway 管理的认证回调；上游 wire 属 Gateway 内部实现 | Gateway 完成真实身份验证；成功 303 至已登记 Consumer callback，带一次性 result_ticket 与原 client_state；不带 ms_/mt_ |
| POST `/api/v1/auth/wecom/transactions/{id}/redeem` | 机密客户端认证；result_ticket、code_verifier、redirect_uri | 200；ms_ session、identity/binding、expires_at；按账号登录相同归一化出口 |
| GET `/api/v1/auth/wecom/transactions/{id}` | 同一机密客户端 + 事务 proof | 200；仅事务状态及可恢复性，不返回可消费票据或身份全文 |

以上均为新增 API，不能按现有 `/auth/exchange` 直接实现企业微信认证。`result_ticket` 60 秒、一次性、32 随机字节以上；持久化只保存 hash。Gateway 的 account-login 身份空间保持不变；WeCom 身份由 Gateway 自身身份管理流程关联 canonical member；Consumer 只消费已验证结果，不创建 alias，不直接修改现有 `account-login-v1` issuer。

### 9.4.4 AnythingLLM 登录消费 API

| API | 状态 | 行为 |
|---|---|---|
| GET `/api/auth/wecom/config` | NEW | 只输出 enabled/available/reason；不输出内部服务地址与密钥 |
| POST `/api/auth/wecom/start` | NEW | 无登录可调用；Origin 校验、限流，创建 prelogin 事务并调用 Gateway facade |
| GET `/api/auth/wecom/callback` | NEW | 顶级回跳；校验短时 Lax prelogin Cookie、state；只记录票据并 303 清理 URL |
| POST `/api/auth/wecom/complete` | NEW | 同源+CSRF；服务端验证Gateway认证结果、拉取用户信息、幂等同步本地投影并建立会话；返回本地登录结果，无Gateway/Tencent token；响应丢失按LOCAL_ONLY处理 |
| POST `/api/auth/logout` | MODIFY/新增统一入口 | 撤销本地 server session 与 bridge，清浏览器登录；不声称腾讯 OAuth 被撤销 |

账号策略采用§4.6的`independent_local_user_creation=false`与`gateway_user_projection_sync=true`。Gateway认证成功后服务端拉取当前用户信息，以实例/组织/canonical member稳定键创建或更新本地投影；无需预先独立创建本地用户或人工绑定。profile未获取/无效/主体冲突则不签发新会话，不接受姓名/邮箱或浏览器local_user_id匹配。认证响应丢失进入LOCAL_ONLY，不盲目兑换或回填；已有有效本地会话才能检索本地既有会议，显式重新扫码成功后才恢复远端访问。

本地 SSO 主会话最大 8 小时且不晚于身份断言允许的身份期限；复用现有前端本地登录处理，但回跳 URL 中不能包含 JWT。JWT 带 `session_id`、`credential_epoch`，服务端检查 session registry。账号密码登录的普通功能保持兼容；访问会议受管内容时同样要求当前员工绑定和 bridge。修改密码/停用递增 credential_epoch；密码字段不再是 passwordless 身份唯一有效性条件。

`__Host-meeting_login`：Secure、HttpOnly、Path=/、SameSite=Lax、300 秒，仅为跨站登录回跳；成功/失败消费后清除。`__Host-meeting_bridge`：Secure、HttpOnly、Path=/、SameSite=Strict，绑定实际本地登录主体，最大 900 秒。生产与联调使用可信 HTTPS；不通过关闭 Secure 支持截图中的普通 HTTP 部署。

### 9.4.5 认证丢失与本地检索

认证/兑换响应丢失时按§4.6进入LOCAL_ONLY；不尝试从Gateway取回腾讯会议数据以修复页面，不自动重放票据或refresh。已有本地会话的身份与权限独立校验；没有可验证本地会话则只显示重新扫码，不发本地正文。重新扫码并取回当前profile成功之前不开放远端功能。此分支必须进入A-IDENT-001-03、A-UI-001-03及PHASE-LOCAL-02证据，不采用旧“必须恢复原兑换事务才能继续本地检索”的设计。

## 9.5 业务会话与可信绑定 Schema

`mgw.binding.v2` required：`local_user_id:int`、`gateway_instance_id:UUID`、`gateway_org_id:string`、`gateway_member_id:string`、`gateway_user_id:string`、`identity_issuer:string`、`enterprise_corp_id:string|null`、`enterprise_employee_id:string|null`、`status`、`credential_epoch:int`、`verified_at:UTC`、`revision:int`。账号桥允许企业字段为 null，但不得显示“企业微信已认证”。

唯一键：`(gateway_instance_id,gateway_org_id,gateway_member_id)` 与 `local_user_id` 在该组织内一对一；企业身份三元组 `(issuer,corp_id,employee_id)` 只能指向一个 local user / canonical member。existing account alias 与 WeCom alias 允许共同指向同一个已证明的 member。

账号密码兼容路径首次进入会议时，为当前已验证JWT创建会议用途的local sub-session registry并绑定JWT HMAC与credential_epoch；不修改普通非会议请求的既有登录语义。SSO主会话与该sub-session都实现同一isBridgeCurrent接口。

Bridge 私有 payload：`ms_token`、`mt_token`、可选服务端 `mr_token`、各期限、local_session_id、binding_revision、credential_epoch、resource、scope。AES-256-GCM 存储；浏览器 DTO 只有 binding_status/expires_at/csrf_token/非敏感状态。refresh 串行轮换且不延长 ms/身份期限；无法验证刷新结果时使 bridge AUTH_REQUIRED，不重放旧 refresh。

### 9.5.1 Worker 的服务端凭据解析（MODIFY）

R1会话加密实现将浏览器opaque值纳入AAD，不能据此假定worker仅凭bridge_id就可解密。[SRC-04] R2密文格式版本固定为 `credential-envelope-v2`：先生成bridge_id，AAD为 `CJSON({gateway_instance_id,gateway_org_id,local_user_id,bridge_id,key_id,format_version})` 的UTF-8字节；这些字段来自服务端台账，opaque Cookie只用独立HMAC查找会话，不保存明文Cookie。

统一服务端接口 `withGatewayPrincipal({local_user_id,local_session_id,bridge_id,binding_revision,operation_id}, callback)`：从台账验证当前local session、epoch、bridge期限与binding后，在受控callback作用域内解密mt/ms；callback结束后不将令牌写入operation、queue、日志或DTO。读取请求和worker均调用同一接口；其运行凭据不是由浏览器传递进job payload。

旧版本密文不可通过猜测AAD迁移。旧bridge在R2切换时撤销，用户重新认证建立v2 envelope；永久身份映射保持。恢复worker找不到有效本人bridge时状态AUTH_REQUIRED，等待本人重新认证和显式恢复；禁止服务账号或管理员令牌替代。此约束进入A-AUTH-001-01/02/03和A-TXN-001-03。

## 9.6 Provider 增量 API：NEW，不能由 Consumer 伪造

| API / schema | 认证与输入 | 输出 / 约束 |
|---|---|---|
| GET `/api/v1/me/integration-status` / `mgw.status.v2` | mt_；当前主体 | identity、connection、effective capability 数组；每项 `state,reason,checked_at`；不返回密钥；无业务令牌时 Consumer 独立显示身份已登录、会议权限不足 |
| POST `/api/v1/access-decisions` / `mgw.access.v2` | mt_；`resources:[{type,id,action,version?}]`，最多 50；不接受 subject/member | 每项 `allowed,reason,policy_version,checked_at,expires_at`；绑定当前主体；资源不存在/跨组织统一不可访问；授权依据当前成员、连接、ACL、scope、来源状态 |
| GET `/api/v1/meeting-queries/{job_id}/results` / `mgw.query-snapshot.v2` | mt_；同一客户端/员工；limit 1–100，cursor | 成功后输出 query_id/window/connection_ref/snapshot_version/items/next_cursor/complete；源查询未成功返回 202，失败返回确定错误 |
| POST `/api/v1/meeting-queries` 的 `Idempotency-Key` | MODIFY；客户端/员工/操作类型/请求摘要共同绑定 | 同键同参返回同一 job；同键异参 409 `IDEMPOTENCY_CONFLICT` |
| POST `/api/v1/oauth/authorizations` 的 `Idempotency-Key` | MODIFY；同一员工/客户端/应用/return_to | 同键同参复用同一未过期事务；未明结果查询原事务；过期必须新操作键 |

`integration-status`同时为BFF返回只读 `oauth_policy`：`application_ref,authorization_origin,authorization_path,corp_id,sdk_id,redirect_uri`，其版本随冻结契约；BFF与部署允许值精确交叉核验。此内部对象不原样透传普通用户页面，不含应用Secret。不能继续依赖Consumer源码中的某一套固定应用常量适配所有部署。

能力状态 `SUPPORTED,UNSUPPORTED,UNKNOWN,FORBIDDEN` 与本场内容状态 `READY,NOT_READY,ABSENT,REMOVED` 分开。只有 Gateway 有真实检测/权限证据才能输出 SUPPORTED/UNSUPPORTED；UI 不修改这些值。通用附件固定显示“本版未接入”，不是“上游已验证没有附件”。

GATEWAY_ENABLED模式的Access decision在Consumer不作为跨请求allow缓存。该模式每次受保护请求在线获取；LOCAL_ONLY按§4.6本地权限检索，不调用Gateway权限/会议数据接口，不将旧Gateway allow当本地ACL；单次判定有效期最多 5 秒，LLM 发起前重新检查。Gateway 内部上游来源健康检查的最大陈旧时间固定 60 秒；成员停用/本地网关 ACL 撤销直接按当前 DB 拒绝。上游尚未被 Gateway 观察到的撤销不能宣称零延迟，本版承诺在来源复核成功观察后立即阻断；60 秒后无法复核时 fail-closed。

## 9.7 查询、录制与内容选择语义

`mgw.query-request.v2`：用户提交 `connection_ref,start_at,end_at`，required，无额外字段；后端写入 `selection=USER_WINDOW,target_member_id=可信member`。单窗口 `0 < end-start <= 90*24*3600秒`；不默认查询全企业。页面默认最近 7 天，按 Asia/Shanghai 展示，提交时转换 UTC。

查询 snapshot 在 Gateway Worker 完成全部源页后一次发布，包含其真实返回、去重后的 Gateway meeting IDs；按 `(start_at,id)` 升序。筛选语义是会议开始时间落在 `[start_at,end_at)`；重叠但开始于窗口前的会议不纳入。零结果只有 `SUCCEEDED && complete=true && item_count=0` 才显示“该范围无会议”。不使用旧目录数据补全本次 snapshot。

snapshot发布前必须验证每条候选会议有有效开始时间及完整ID；缺字段导致源契约错误，而不是静默跳过。结果读取时复核当前主体与每项meeting.read；cursor绑定actor、snapshot_version和policy_version。分页间权限变化使原snapshot读取返回 `MGW_QUERY_ACCESS_CHANGED`，不泄漏已失权条目，也不把移除后的剩余集合重新标成原始完整snapshot；用户重新发起当前权限下的新查询。

录制集合来自本次会议 recordings 的完整响应。若 gateway response 不声明可分页且契约定义为完整集合，按该完整集合处理；如果运行版本出现分页，必须在 G1 新增映射，不能静默忽略。用户可选择录制；默认全选本次返回的录制。记录选择快照后才开始导入。

转写选择按录制分别使用 `[from_ms,to_ms)`，全选时为 `selection=FULL`；默认导入所有录制，但全部选中转写范围时长相加不得超过 3 小时。超出时要求用户选择范围，不丢弃额外录制。段落交集规则：`start_ms < to_ms && end_ms > from_ms`；重叠边界段落保留全文并标注原始时间，不声称逐字裁切。原生纪要保持 `coverage=WHOLE_RECORDING`，不假装只总结选中转写区间。

内容类型默认选择 `transcript` 与 `minutes`；用户可以在manifest页显式取消其中一种，并将选择写入scope。至少选择一份实际非空可读取正文；R2不把纯元数据操作称为资料导入完成。被选中的任一内容NOT_READY/UNKNOWN会阻断完成，不能静默移除；明确取消的内容在coverage标注NOT_SELECTED，不算技术不完整。

完整转写条件：每页相同 asset_id、content_version；`is_complete=true`；cursor 不重复且最终 null；按原始顺序保留段落身份和时间；去重只能删除相同段落 ID 且字节相同项，同 ID 异文返回 CONFLICT。Gateway 源版本按原样保存，Consumer 内容 hash 是另一个字段。

请求 `fetch=ensure` 触发 202 时持久化 gateway_job_id 并轮询原作业；轮询 120 秒仍未完成只暂停前台等待，显示可恢复任务，不标 FAILED。作业失败后按错误类型恢复，不以重复 POST 代替 GET job。

`minutes` 映射保留原生 `minute/todo` 及模型/类型信息；`todo=[]` 不失败。正文为空但源状态未明确 ABSENT 时属于 NOT_READY，不能自动进入元数据导入成功。

## 9.8 Consumer BFF 路由契约

已有业务 `/api/meetings/*` 保留，远端访问和本地读取实现替换；不新增第二套 Meetings 页面。

| 方法与路由 | 状态 | 输入与结果 | 认证/副作用 |
|---|---|---|---|
| GET/PUT `/api/meetings/config` | MODIFY | §9.2；PUT 要 If-Match | 已登录；PUT admin + CSRF；GET 普通用户仅公开投影 |
| POST `/api/meetings/config/check` | NEW | 指定已保存 revision；返回分项检查 | admin；不自动开功能、不调用任意 URL |
| GET `/api/meeting-gateway/session` | EXISTING/MODIFY | 当前绑定及期限/CSRF | 本地认证；未绑定返回 401 + AUTH_REQUIRED |
| POST `/api/meeting-gateway/session` | EXISTING/MODIFY | 仅启用账号桥时接收 account/password | 本地认证 + Origin；不等同企业微信登录 |
| DELETE `/api/meeting-gateway/session`、`…/binding` | EXISTING/MODIFY | 本次退出 / 全部本地绑定会话撤销 | 主体本人 + CSRF；不撤销腾讯 OAuth |
| GET `/api/meeting-gateway/status` | NEW | 五轴状态及remote_access_mode：GATEWAY_ENABLED/LOCAL_ONLY；LOCAL_ONLY不触发Gateway腾讯数据请求 | 本人；mode由服务端当前session/事务确定，不由浏览器改值 |
| GET `/api/meeting-gateway/connections`、POST `…/oauth/start`、POST `…/connections/{id}/confirm` | EXISTING/MODIFY | 当前连接/授权事务 | 当前本人 + bridge；写操作 CSRF；不由前端提交 member ID |
| GET `/api/meetings/remote` | MODIFY | 只浏览 Gateway 当前可见目录 | 不隐式创建源查询；旧调用日期参数不被静默忽略，返回 QUERY_OPERATION_REQUIRED |
| POST `/api/meetings/remote/queries` | NEW | connection_ref、窗口 → 202/query_id | 员工 + bridge；Idempotency-Key |
| GET `/api/meetings/remote/queries/{id}`、`…/{id}/results` | NEW | 查询状态/分页 snapshot | 仅当前 owner；读网络仍可能产生 Gateway 审计 |
| GET `/api/meetings/remote/{gatewayMeetingId}/manifest` | MODIFY | 录制/内容可用性/版本；不等于正文完整 | Gateway ID opaque；同一选择快照 |
| POST `/api/meetings/import` | MODIFY | query_id、gateway_meeting_id、recording selections、restricted_workspace_id | 后端核 owner 与来源；202 本地 operation；不接受原始正文与自报 member |
| GET `/api/meetings/jobs`、POST `…/jobs/{id}/retry` | MODIFY | 本人本地任务投影；retry原operation | owner + bridge；已未知结果先恢复 |
| GET/PATCH/DELETE `/api/meetings/{localId}` 与 sources/approve/reindex/conversations | MODIFY | 保留本地 ID/业务语义，新增 revision、access 检查 | 全部数据流按 §18 门禁，拒绝 IDOR |
| 身份申请/绑定管理 API | OUT_OF_SCOPE | 不新增 `/api/auth/wecom/bind`、`/api/meetings/identity-bindings` 或 approve/reject 接口 | 身份管理归 Gateway；AnythingLLM 只做登录消费和既有映射校验 |

新增 BFF 统一 envelope：`{data,meta:{request_id,schema_version}}`；错误为 `{error:{code,message_key,retryable,recovery_action},request_id}`。现有旧业务 envelope 在同一主版本继续保留，由前端 model 显式兼容；新旧解析不根据“字段看起来像”猜测。所有敏感响应 `Cache-Control:no-store`。

## 9.9 本地持久化与复用规则

| 逻辑对象 / 物理落点 | 状态 | 关键字段 / SOT / 唯一性 |
|---|---|---|
| `meeting_connections` | MODIFY | provider、instance_id、config_revision；原腾讯密钥保留在受控迁移备份而非活跃配置 |
| `meeting_gateway_bindings` 及 R1 bridge 表 | MODIFY | §9.5；Gateway认证及profile读取后同步主体投影，增加local_session_id/credential_epoch；不平行建立身份系统 |
| `meeting_sso_transactions` | NEW | id、state_hash、nonce_hash、PKCE密文、Gateway事务ref、expires_at、state、local_user_id可空 |
| `meeting_login_sessions` | NEW | id、local_user_id、auth_method、credential_epoch、expires_at、revoked_at、remote_access_mode、profile_synced_at；SSO主会话registry；无本地session时mode只记录于对应prelogin事务 |
| `meetings` | MODIFY | 保留 id、createdBy、review/retrievalStatus；增加 gateway_instance_id/org/meeting_id、owner_user_id、migration_state |
| `meeting_jobs` | MODIFY | 旧 UI 任务投影；gateway_job_id、import_operation_id；不再独立写第二套导入文档 |
| `meeting_import_operations` | NEW | id、owner、scope_hash、query_snapshot_ref、selected_sources、state、active generation 集合、idempotency_key |
| `meeting_imports` / `meeting_import_generations` | EXISTING/MODIFY | R1 资产级唯一身份、version、generation、operation_id、fence、active_generation；复用为唯一受管文档台账 |
| `meeting_sources`（现有 `segments` 列）/ `meeting_chunks` | MODIFY | 复用基线既有来源与分块存储，增加 import_id/generation/recording/asset/version 血缘；不把不存在的 `meeting_source_segments` 当既有表，不平行建立第二个事实源 |
| `meeting_content_revisions` | NEW | meeting_id、revision、text、edited_by、base_source_version、review_status、content_hash；人工修订不可被同步覆盖 |
| `meeting_restricted_workspaces` | EXISTING/MODIFY | owner_user_id、policy_epoch、state；每位用户可有多个独占工作区 |
| Collector / `workspace_documents` / `document_vectors` | EXISTING/MODIFY | 受管 operation 预分配稳定 docId；docId 与 vector chunk ID 不混同 |
| `meeting_migration_runs` / `meeting_migration_items` | NEW | run_id、plan_digest、T0_manifest_ref、item owner proof、mapping proof、status、last_applied_digest |

新增 schema 的字段按本章及 §8 枚举，默认不推断 owner。非空绑定字段在迁移前允许 NULL 仅用于 `QUARANTINED` 旧记录；活跃 Gateway 内容要求全部绑定字段非空。索引/外键/唯一约束通过迁移建立，不只在 JavaScript 中判断。

原文、用户修订、格式化文档和向量仅通过 provenance 关联。`meeting_jobs` 是操作投影，`meeting_import_generations` 是物理导入提交事实源。禁止旧 importer 和 R1 managed pipeline 各自生成不同 docId 后同时写同一工作区。

## 9.10 导入 identity / 幂等 / 版本选择

Asset Identity 包含：gateway_instance_id、gateway_org_id、owner_user_id、gateway_member_id、connection_ref、gateway_meeting_id、gateway_recording_id、gateway_asset_id、content_type、source_version、selection_hash、workspace_id。§13 定义 hash。

同一 identity 正在处理：返回已有 operation/状态；已 VERIFIED：返回已导入及 existing localId，不再写文件/向量；同 idempotency key 不同 request hash：409。新 source_version 是新的资产版本，先 STAGED，再核验/审核后发布；不覆盖旧原文或旧修订。撤销后恢复需重新核验全部选中资源，清理未完成不复用旧 generation。

## 9.11 部署清单

required 部署输入：两个候选 SHA、Gateway instance/org、内部 HTTPS Origin、CA信任、固定客户端与 REST resource、契约包摘要、Consumer 同源 URL、腾讯注册回调与 return 白名单、Gateway 企业微信 Consumer 契约 lock、允许企业映射、密钥引用与版本、SQLite/存储备份位置、向量引擎/Collector版本、approved LLM/OCR出站目标。

真实值由部署负责人提供；样例值不构成缺省。缺失任一被启用能力所需项，readiness 返回逐项 `CONFIG_MISSING`，该能力关闭；企业微信和会议仍分别报告状态，不把一个依赖失败变成全系统假登录失败。

---

# 10. Requirement Unit

本章每个 Requirement 均是 Required。阶段顺序受第 4.4、25 章控制；文件列表是修改范围，不表示已经实施。每项 M1 由正向 AC 与输入矩阵验证，M2 由负向 AC 验证，M3 由 failure AC 与第 23 章注入点验证。

## REQ-CONTRACT-001 — 固定两仓契约、消除占位与字段歧义

**推进位置：**S1 / D1  
**实施触点：**`server/utils/meetingGateway/client.js；contracts/meeting-gateway-r2/ NEW；Gateway app/api/deps.py、schemas；契约导出工具`

### Goal
以实际 wire contract 而非接口猜测作为运行装配输入。

### Normative Requirement
- **REQ-CONTRACT-001-M1 — MUST：**冻结第 9.1–9.3、17 章的版本、envelope、token、ID、错误与分页语义；实际导出的字节摘要、路由清单及脱敏样本与候选 SHA 绑定。禁止通过只填写 64 位 hash 字符串认定契约成立。 → A-CONTRACT-001-01。
- **REQ-CONTRACT-001-M2 — MUST NOT：**修改生产凭据、开关、用户/会议记录；伪造真实样本；放宽安全校验消除差异。 → A-CONTRACT-001-02。
- **REQ-CONTRACT-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-CONTRACT-001-03。

### Inputs
两仓不可变 SHA、真实导出 Schema、脱敏登录/交换/查询/内容样本、Gateway企业微信Consumer契约lock。

### Preconditions
PRE-CONTRACT-001-01：两仓只读权限；Gateway Owner接受§9.4认证服务与Consumer契约交付职责。
PRE-CONTRACT-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
冻结契约包=LAST_APPLIED_STATE；运行响应=OBSERVED_STATE；匹配结果=RESOLVED_STATE。

### State Transition
Before: UNCONFIRMED；Event: 校验固定版本与样本；After: CONTRACT_CONFIRMED，或 CONTRACT_BLOCKED。

### Allowed Side Effects
ALLOW：写契约包、mapping manifest、脱敏验证报告；读取 Gateway 受控只读接口。

### Forbidden Side Effects
DENY：修改生产凭据、开关、用户/会议记录；伪造真实样本；放宽安全校验消除差异。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
首次导出固定 bytes；同 SHA/相同内容再次验证不改写契约；不同内容不得覆盖原包。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-CONTRACT-001-01 | 给定仅格式合法但字节摘要错误的契约；或 ms 字段缺失；或未知状态。 | 阻断；不建立可用业务会话，不返回空列表。 | `MGW_UPSTREAM_CONTRACT_ERROR` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-CONTRACT-001-02 | 导出到 staging 后，契约文件被改写，last_applied 存在。 | 保留旧契约，候选 readiness 关闭；生成 drift 报告。 | `MGW_CONTRACT_DRIFT` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |

### Postconditions
POST-CONTRACT-001-01：登录和业务响应解包一致；api路径/状态/ID不歧义；每个新增 API 明确 NEW。  
POST-CONTRACT-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-CONTRACT-001-01：未固定版本或样本与Schema不符时 transportAvailable=false。  
INV-CONTRACT-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_UPSTREAM_CONTRACT_ERROR`；`MGW_CONTRACT_DRIFT`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-CONTRACT-001-01（正向及边界）；A-CONTRACT-001-02（负向及禁止项）；A-CONTRACT-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-CONTRACT-001-01`、`TEST-A-CONTRACT-001-02`、`TEST-A-CONTRACT-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-PROVIDER-001 — 网关提供安全状态投影、权限判定和查询快照

**推进位置：**S1契约 / S2实现 / D1  
**实施触点：**`Gateway app/api/business.py、schemas、services/portal_service.py、permission_service.py、query_service.py；新增 snapshot storage`

### Goal
避免 Consumer 通过空 capability、目录缓存或自报身份伪造事实。

### Normative Requirement
- **REQ-PROVIDER-001-M1 — MUST：**实现 §9.6 新增 API 和幂等扩展；所有输出按当前 token 主体过滤；相同请求键绑定参数摘要。无业务权的真实身份可以继续本地登录，但不能获得会议 allow。 → A-PROVIDER-001-01。
- **REQ-PROVIDER-001-M2 — MUST NOT：**返回其他员工连接或资源存在性；为 UI 自动授予权限；将能力未知改为支持。 → A-PROVIDER-001-02。
- **REQ-PROVIDER-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-PROVIDER-001-03。

### Inputs
mt_、当前成员与客户端、资源数组/源查询ID、Idempotency-Key。

### Preconditions
PRE-PROVIDER-001-01：G1 新增接口 Schema 已冻结；Gateway action/resource/connection权限可调用。  
PRE-PROVIDER-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
Gateway 成员/连接/权限/源作业=OBSERVED_STATE；投影=RESOLVED_STATE。

### State Transition
Before: 未提供投影；Event: 当前主体请求；After: 返回最小状态/决定/已完成snapshot，不创建授权。

### Allowed Side Effects
ALLOW：追加审计；保存原查询结果成员集合和去重请求键；来源复核产生网关缓存。

### Forbidden Side Effects
DENY：返回其他员工连接或资源存在性；为 UI 自动授予权限；将能力未知改为支持。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同主体同键同参返回同一job/授权事务；同键异参409；新 snapshot 只随新源查询产生。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-PROVIDER-001-01 | B提交A的job/asset/connection；或请求体伪造member。 | 拒绝未知字段或返回不可访问；无正文与跨人状态。 | `MGW_RESOURCE_NOT_ACCESSIBLE` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-PROVIDER-001-02 | access或capability来源依赖不可达，已有上一轮allow。 | 输出不可用/UNKNOWN，不能返回缓存allow；源作业保留可诊断状态。 | `MGW_ACCESS_STATE_UNAVAILABLE` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | YES；依赖恢复后重新只读判定 |

### Postconditions
POST-PROVIDER-001-01：projection有reason/checked_at；access有主体绑定；失败查询无成功快照。  
POST-PROVIDER-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-PROVIDER-001-01：Consumer 无法自填 subject/member 改变网关的有效主体。  
INV-PROVIDER-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_RESOURCE_NOT_ACCESSIBLE`；`MGW_ACCESS_STATE_UNAVAILABLE`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-PROVIDER-001-01（正向及边界）；A-PROVIDER-001-02（负向及禁止项）；A-PROVIDER-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-PROVIDER-001-01`、`TEST-A-PROVIDER-001-02`、`TEST-A-PROVIDER-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-IDENT-001 — 真实企业微信认证与 Gateway 身份 facade

**推进位置：**S1契约 / S2服务 / D3基础  
**实施触点：**`AnythingLLM NEW auth/wecom消费BFF；Gateway对Consumer的认证契约；不建设EnterpriseIdentityProvider或身份管理服务`

### Goal
让企业微信按钮完成真实身份验证，不与腾讯OAuth混同。

### Normative Requirement
- **REQ-IDENT-001-M1 — MUST：**实现 §9.4 的唯一身份链路、nonce/state/PKCE/一次票据和 server-to-server 兑换；企业身份依赖不满足时阻断。身份已认证不自动获得会议scope。 → A-IDENT-001-01。
- **REQ-IDENT-001-M2 — MUST NOT：**AnythingLLM保存企业微信Secret；把腾讯OAuth当企业登录；接受浏览器userid断言；自动建管理员。 → A-IDENT-001-02。
- **REQ-IDENT-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-IDENT-001-03。

### Inputs
认证事务、Gateway企业微信Consumer实际契约lock、一次性票据、固定issuer/corp/audience。

### Preconditions
PRE-IDENT-001-01：Gateway已提供真实企业微信扫码认证能力；其企业应用、允许企业与Consumer回调已经由Gateway owner登记核验；Consumer不承担企业应用认证源建设。
PRE-IDENT-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
Gateway=Consumer认证结果与身份状态权威；Gateway内部身份源由其负责；本地事务=浏览器关联与本地登录状态。

### State Transition
CREATED → REDIRECTED → IDENTITY_VERIFIED；Gateway票据兑换并验证成功、profile拉取成功后才允许同步本地用户投影并建立会话，过期/拒绝终止。

### Allowed Side Effects
ALLOW：创建短时SSO消费事务、只调用Gateway认证接口、登记已验证结果投影与本地审计；不调用其内部身份服务。

### Forbidden Side Effects
DENY：AnythingLLM保存企业微信Secret；把腾讯OAuth当企业登录；接受浏览器userid断言；自动建管理员。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同一回跳票据一次消费；重复callback仅显示原事务结果，不再调用兑换；失败不生成可用主会话。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-IDENT-001-01 | 分别给出重放票据、不同state、PKCE错误、外企业、不同audience、自报userid。 | 各例拒绝；不创建可用本地会话或绑定。 | `MGW_IDENTITY_ASSERTION_INVALID` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-IDENT-001-02 | Gateway兑换响应丢失；另例认证依赖未部署。 | 丢失进入LOCAL_ONLY，禁止远端腾讯数据获取，仅已有有效本地会话可检索本地获权资料；无本地会话不视为登录成功；依赖未部署单独显示NOT_READY。 | `MGW_IDENTITY_RECOVERY_REQUIRED` | 不重放票据、不新建可信用户/会话；保留既有本地资料 | 用户显式重新扫码，成功验证并同步profile后才恢复远端访问 |

### Postconditions
POST-IDENT-001-01：身份发行方/企业/员工/版本明确；result_ticket不出日志；依赖不存在有可观察阻断。  
POST-IDENT-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-IDENT-001-01：身份来源验证失败时 local usable login sessions增量为0。  
INV-IDENT-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_IDENTITY_ASSERTION_INVALID`；`MGW_IDENTITY_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-IDENT-001-01（正向及边界）；A-IDENT-001-02（负向及禁止项）；A-IDENT-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-IDENT-001-01`、`TEST-A-IDENT-001-02`、`TEST-A-IDENT-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-IDENT-002 — Gateway用户信息同步、本地投影与可撤销登录消费

**推进位置：**S1模型 / S2实现 / D3基础  
**实施触点：**`server/models/user.js；meetingGateway/sessions.js；NEW login sessions；Gateway profile读取与稳定主体投影upsert；不新增Gateway alias写入或身份管理后台`

### Goal
消费Gateway已验证身份后拉取用户信息，同步必要本地投影并建立会话；不独立创建企业身份，不承担Gateway绑定管理，不产生重复用户或提权。

### Normative Requirement
- **REQ-IDENT-002-M1 — MUST：**按§9.4.4/9.5的Gateway稳定键拉取profile并幂等同步用户投影，执行independent_local_user_creation=false与gateway_user_projection_sync=true；保留 account-login-v1 与 canonical member；不创建/修改 Gateway alias；SSO会话检查session_id与credential_epoch，不依赖伪造密码。 → A-IDENT-002-01。
- **REQ-IDENT-002-M2 — MUST NOT：**按姓名/邮箱/手机号合并；自动创建或升级admin；替换旧member ID导致权限迁移；存企业密码。 → A-IDENT-002-02。
- **REQ-IDENT-002-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-IDENT-002-03。

### Inputs
Gateway已验证认证结果、服务端拉取的当前用户信息、稳定canonical member；不要求预建本地用户，不接收员工自报profile或身份申请。

### Preconditions
PRE-IDENT-002-01：认证事务有效；登录完成请求CSRF有效；Gateway主体/profile一致且有效，既有投影若存在不得处于本地停用状态。
PRE-IDENT-002-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
本地user/role/session registry；Gateway canonical member/alias；唯一binding行。

### State Transition
PROFILE_REQUIRED→Gateway用户信息核验及本地投影同步→BOUND；ACTIVE session→REVOKED/EXPIRED；主体冲突不改既有数据。

### Allowed Side Effects
ALLOW：Gateway认证后拉取profile、按稳定主体键事务性upsert必要本地用户/认证投影、建立或撤销本地session；更新credential_epoch；追加认证审计。不写Gateway身份/alias，不允许浏览器指定目标local_user。

### Forbidden Side Effects
DENY：按姓名/邮箱/手机号合并；自动创建或升级admin；替换旧member ID导致权限迁移；存企业密码。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同一Gateway稳定主体只对应一个本地投影；首次核验后可创建一份，重复认证复用local ID并同步profile；主体冲突返回409，不按同名合并；凭据变化只推进epoch。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-IDENT-002-01 | B伪造A的本地映射；同名未准入员工登录；上游返回admin角色。 | 冲突拒绝、未准入不建会话、local role不提升。 | `MGW_IDENTITY_BINDING_CONFLICT` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-IDENT-002-02 | Gateway认证兑换成功后、本地session commit前失败；另例停用/改密码后持旧JWT。 | 本地业务范围回到T0；不声称撤销Gateway已完成的认证；旧SSO会话拒绝。 | `MGW_LOCAL_SESSION_REVOKED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 本地失败按原事务恢复规则处理或重新认证；旧session不可恢复 |

### Postconditions
POST-IDENT-002-01：本地投影来源为Gateway当前已验证用户；首次/重复同步均唯一；未验证或profile失败不签发新主会话。
POST-IDENT-002-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-IDENT-002-01：同一Gateway实例/组织/member不会产生两个本地投影；本地角色不由Gateway角色自动提升。
INV-IDENT-002-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_IDENTITY_BINDING_CONFLICT`；`MGW_LOCAL_SESSION_REVOKED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-IDENT-002-01（正向及边界）；A-IDENT-002-02（负向及禁止项）；A-IDENT-002-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-IDENT-002-01`、`TEST-A-IDENT-002-02`、`TEST-A-IDENT-002-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-AUTH-001 — 归一化 ms_/mt_ 交换与员工 Bridge 会话

**推进位置：**S2 / D1  
**实施触点：**`server/utils/meetingGateway/client.js、sessions.js；meetingBridge middleware；Gateway auth/exchange与oauth/token`

### Goal
让正式客户端可以建立真实员工业务请求，防止令牌错用与跨人复用。

### Normative Requirement
- **REQ-AUTH-001-M1 — MUST：**实现 §9.3/9.5 的登录转换、精确resource和最小scope；bridge与本地主体/会话/epoch绑定；至多900秒且不晚于各令牌期限；刷新串行、轮换、不得延长身份上限。 → A-AUTH-001-01。
- **REQ-AUTH-001-M2 — MUST NOT：**浏览器持Gateway/Tencent令牌；把local JWT/userid当subject_token；使用服务账号替代员工。 → A-AUTH-001-02。
- **REQ-AUTH-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-AUTH-001-03。

### Inputs
本地认证主体；ms_；CONFIDENTIAL客户端；requested scopes；REST resource。

### Preconditions
PRE-AUTH-001-01：配置/契约有效；身份已验证；账号兼容入口需显式启用。  
PRE-AUTH-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
Gateway token/session；本地bridge registry；本地user/session registry。

### State Transition
AUTH_REQUIRED → BOUND；刷新只替换同主体令牌；过期/撤销 → AUTH_REQUIRED。

### Allowed Side Effects
ALLOW：发起员工token exchange/refresh；加密保存bridge；设置opaque Cookie；撤销本地会话。

### Forbidden Side Effects
DENY：浏览器持Gateway/Tencent令牌；把local JWT/userid当subject_token；使用服务账号替代员工。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
重复页面刷新读取同bridge；同一次refresh并发仅一次上游交换；登录新bridge撤销选定旧bridge。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-AUTH-001-01 | 分别使用local JWT、裸userid、B的bridge、MCP audience令牌或禁用账号桥。 | 拒绝，不退回公用token。 | `MGW_BUSINESS_AUTH_REQUIRED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-AUTH-001-02 | 两个并发请求需要刷新，第一次已兑换但返回丢失。 | 不重放旧refresh；会话要求重新认证；无重复可用令牌写入。 | `MGW_REFRESH_RECOVERY_REQUIRED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO；重新认证 |

### Postconditions
POST-AUTH-001-01：服务端持mt且audience正确；无权限时本地登录可继续但会议权限不足。  
POST-AUTH-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-AUTH-001-01：可用bridge期限不超过ms、mt、local session和900秒上限的最小值。  
INV-AUTH-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_BUSINESS_AUTH_REQUIRED`；`MGW_REFRESH_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-AUTH-001-01（正向及边界）；A-AUTH-001-02（负向及禁止项）；A-AUTH-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-AUTH-001-01`、`TEST-A-AUTH-001-02`、`TEST-A-AUTH-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-CONFIG-001 — 网关配置替代腾讯凭据并分离 OCR

**推进位置：**S2 / D1  
**实施触点：**`server/modules/meetings/config.js；现有config route；Gateway部署登记；OCR配置保持独立`

### Goal
避免界面和runtime仍接受腾讯直连参数，且不丢失现有解析服务。

### Normative Requirement
- **REQ-CONFIG-001-M1 — MUST：**按 §9.2 保存带revision配置；使用明确密钥操作、部署允许源、冻结resource/contract；OCR字段独立保留；禁用provider直连值。 → A-CONFIG-001-01。
- **REQ-CONFIG-001-M2 — MUST NOT：**回显密钥；用空字段误删；从旧腾讯Secret自动生成Gateway Secret；修改腾讯应用配置。 → A-CONFIG-001-02。
- **REQ-CONFIG-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-CONFIG-001-03。

### Inputs
管理员、If-Match revision、网关配置与独立OCR修改。

### Preconditions
PRE-CONFIG-001-01：本地admin + CSRF；候选origin属于运维allowlist；契约与客户端登记存在。  
PRE-CONFIG-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
Desired配置与last_applied配置分离；私有密钥存储为密钥事实源。

### State Transition
UNCONFIGURED → CONFIGURED；CHECK不自动ENABLED；CLEAR secret → NOT_READY。

### Allowed Side Effects
ALLOW：仅写指定配置revision/密钥版本/OCR字段；记录检查结果。

### Forbidden Side Effects
DENY：回显密钥；用空字段误删；从旧腾讯Secret自动生成Gateway Secret；修改腾讯应用配置。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同revision同内容不重复写新版本；过期revision409；KEEP保留原密钥版本。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-CONFIG-001-01 | 普通用户保存；过期If-Match；origin为任意外站；provider=tencent_direct。 | 各例拒绝，last_applied不变。 | `MGW_CONFIG_REJECTED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-CONFIG-001-02 | 更新密钥和配置事务中断，旧配置有效。 | 旧revision和secret引用仍一致；没有半更新配置。 | `MGW_CONFIG_COMMIT_FAILED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | YES；使用新If-Match重试 |

### Postconditions
POST-CONFIG-001-01：没有Tencent App/SDK/AKSK操作字段；OCR未改字段hash不变；状态可解释。  
POST-CONFIG-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-CONFIG-001-01：网关配置保存不改变OCR token/timeout，除非明确提交OCR修改。  
INV-CONFIG-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_CONFIG_REJECTED`；`MGW_CONFIG_COMMIT_FAILED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-CONFIG-001-01（正向及边界）；A-CONFIG-001-02（负向及禁止项）；A-CONFIG-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-CONFIG-001-01`、`TEST-A-CONFIG-001-02`、`TEST-A-CONFIG-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-RUNTIME-001 — 补完实际依赖装配并统一唯一网关运行链路

**推进位置：**S2 / D1  
**实施触点：**`server/index.js；NEW gatewayRuntime factory；modules/meetings/runtime.js、serverLifecycle.js；endpoints/meetingGateway.js`

### Goal
把已合并模块接成可运行的服务，停止旧client继续接受流量。

### Normative Requirement
- **REQ-RUNTIME-001-M1 — MUST：**实例化真实client、sessions、oauth、access、job worker、managed store；将旧会议remote/import接到同一Gateway Adapter；readiness检查方法实际可用而非nonnull；正常和错误路径均禁止Tencent fallback。 → A-RUNTIME-001-01。
- **REQ-RUNTIME-001-M2 — MUST NOT：**createTencentClient出现在生产会议调用路径；以null/mock模块宣称READY；绕过contract开关；新增OA/会议写入。 → A-RUNTIME-001-02。
- **REQ-RUNTIME-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-RUNTIME-001-03。

### Inputs
已冻结契约、应用配置、数据库、session store、approved dependency实例。

### Preconditions
PRE-RUNTIME-001-01：G1；所启用功能的密钥和实例存在；数据库迁移完成；单一worker owner策略。  
PRE-RUNTIME-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
部署desired；runtime实例；readiness观测；本地generation事实源。

### State Transition
BOOTSTRAPPING → READY或NOT_READY；缺依赖时503分项诊断；shutdown先停止领任务再释放租约。

### Allowed Side Effects
ALLOW：启动受控后台worker、数据库租约、内部REST网络、ready审计。

### Forbidden Side Effects
DENY：createTencentClient出现在生产会议调用路径；以null/mock模块宣称READY；绕过contract开关；新增OA/会议写入。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同进程重复初始化返回同runtime；多个进程通过租约不重复提交generation；关停可重复。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-RUNTIME-001-01 | sessions.gateway或oauth为null；或contract不匹配；Gateway返回403。 | 503/403准确暴露，直连构造器和请求不被触发。 | `MGW_RUNTIME_NOT_READY` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-RUNTIME-001-02 | 运行中Gateway断网且worker持有处理中operation；触发进程退出。 | 不新领任务，租约回收后原operation恢复，不产生重复文档。 | `MGW_UPSTREAM_UNAVAILABLE` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | YES；原operation恢复 |

### Postconditions
POST-RUNTIME-001-01：旧页面与新接口共用同一client和权限上下文；任何Gateway故障不会产生腾讯直连调用。  
POST-RUNTIME-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-RUNTIME-001-01：正式会议业务的上游域名流量只到配置Gateway；Consumer对腾讯API的调用数为0。  
INV-RUNTIME-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_RUNTIME_NOT_READY`；`MGW_UPSTREAM_UNAVAILABLE`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-RUNTIME-001-01（正向及边界）；A-RUNTIME-001-02（负向及禁止项）；A-RUNTIME-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-RUNTIME-001-01`、`TEST-A-RUNTIME-001-02`、`TEST-A-RUNTIME-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-OAUTH-001 — 修复腾讯会议 OAuth 契约并完成本人确认闭环

**推进位置：**S2 / D1  
**实施触点：**`server/utils/meetingGateway/oauth.js；Gateway connection_service.py幂等扩展；BFF OAuth routes`

### Goal
让网关正常授权URL被严格而正确地接受，且不混入企业微信登录。

### Normative Requirement
- **REQ-OAUTH-001-M1 — MUST：**严格校验https、host/path、唯一corp_id/sdk_id/redirect_uri/state及冻结值；四个参数均声明；app内部ID与sdk_id分离；事务与本地bridge绑定，回跳后查询Gateway并由本人确认。 → A-OAUTH-001-01。
- **REQ-OAUTH-001-M2 — MUST NOT：**删除corp_id校验或接受任意URL；Consumer保存腾讯token；前端伪造ACTIVE；确认别人的连接。 → A-OAUTH-001-02。
- **REQ-OAUTH-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-OAUTH-001-03。

### Inputs
当前员工bridge、Gateway应用ID、固定腾讯授权路径/回调/return_to、idempotency key。

### Preconditions
PRE-OAUTH-001-01：本人有效mt且连接属于本人；回调配置通过G1；无其他未过期本地授权事务。  
PRE-OAUTH-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
Gateway OAuth事务与Connection状态权威；本地事务仅关联和展示。

### State Transition
NOT_AUTHORIZED → PENDING → PENDING_CONFIRMATION → ACTIVE；CORP_MISMATCH等不自动确认。

### Allowed Side Effects
ALLOW：创建/复用本人授权事务；受控浏览器导航；Gateway保存本人腾讯token。

### Forbidden Side Effects
DENY：删除corp_id校验或接受任意URL；Consumer保存腾讯token；前端伪造ACTIVE；确认别人的连接。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同操作键复用原事务；重复确认ACTIVE仅验证并返回；参数改变用新事务。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-OAUTH-001-01 | 逐项篡改corp_id/sdk_id/redirect_uri/state；重复query；连接属于B或CORP_MISMATCH。 | 全部拒绝；不导航到恶意URL；不改变连接。 | `MGW_OAUTH_CONFIRM_DENIED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-OAUTH-001-02 | POST授权事务响应丢失，Gateway可能已创建事务。 | 复用同一事务，不二次消费腾讯auth_code；显示恢复中而非成功。 | `MGW_OAUTH_RECOVERY_REQUIRED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 只恢复原事务 |

### Postconditions
POST-OAUTH-001-01：企业微信/腾讯OAuth文案与事务分开；授权URL真实可用；ACTIVE只来自再读取的网关状态。  
POST-OAUTH-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-OAUTH-001-01：校验规则接受真实四参数URL，拒绝重复/额外/被替换参数。  
INV-OAUTH-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_OAUTH_CONFIRM_DENIED`；`MGW_OAUTH_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-OAUTH-001-01（正向及边界）；A-OAUTH-001-02（负向及禁止项）；A-OAUTH-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-OAUTH-001-01`、`TEST-A-OAUTH-001-02`、`TEST-A-OAUTH-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-UI-001 — 企业微信登录入口/结果与会议授权状态

**推进位置：**S3 / D2  
**实施触点：**`frontend/src/pages/Login/index.jsx；NEW SSOResult.jsx；现有/目标会议授权状态视图；main.jsx/paths；UserMenu；不新增IdentityBindings.jsx`

### Goal
用户通过Gateway完成企业微信扫码认证，并明确区分本地登录成功、未配置本地映射和会议已授权；AnythingLLM不提供身份申请/审批页面。

### Normative Requirement
- **REQ-UI-001-M1 — MUST：**实现 §9.4/9.8 与第19章状态文案；桌面/移动入口一致；主登录显示企业微信入口，结果页展示认证结果；会议授权状态分五轴；通过Gateway认证后拉取用户信息并同步本地投影；profile失败/认证丢失显示不可用或LOCAL_ONLY，不提供申请/绑定/审批动作；不可用状态给出原因与下一动作。 → A-UI-001-01。
- **REQ-UI-001-M2 — MUST NOT：**模拟扫码充当验收；浏览器持Gateway密钥；把企业登录失败与无会议权限混为一类；隐藏错误仍显示已连接。 → A-UI-001-02。
- **REQ-UI-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-UI-001-03。

### Inputs
公开login config、Gateway认证消费后的本地事务结果、status五轴、本人连接；无准入申请列表。

### Preconditions
PRE-UI-001-01：G2接口可调用；前端不硬编码成功；未过G5只在验收环境开放。  
PRE-UI-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
后端状态为SOT；前端loading/error只是临时UI状态。

### State Transition
未登录→Gateway扫码认证中→用户信息获取失败/已登录/LOCAL_ONLY；会议授权各状态独立；失权立即清理可见正文缓存。

### Allowed Side Effects
ALLOW：允许用户显式发起认证/授权/确认；写短时UI状态；调用同源BFF。

### Forbidden Side Effects
DENY：模拟扫码充当验收；浏览器持Gateway密钥；把企业登录失败与无会议权限混为一类；隐藏错误仍显示已连接。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
重复点击按钮期间只保留一个pending事务；刷新页面从本地BFF读取当前事务/会话的remote_access_mode，不猜认证成功；兑换结果丢失按LOCAL_ONLY，不自动恢复上游兑换。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-UI-001-01 | Gateway企业微信认证未就绪、外企业、profile读取失败、扫码认证取消、403和401各一例。 | 无假二维码/假成功；受限按钮不可触发数据读取。 | `MGW_IDENTITY_NOT_READY` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-UI-001-02 | 用户在callback回跳后刷新，网络中断，然后恢复。 | 读取本地事务/会话状态；不重复兑换。结果丢失显示LOCAL_ONLY，已有有效本地会话只检索本地资料；未完成新登录只显示重新扫码；不得自动恢复远端取数。 | `MGW_UI_RECOVERY_REQUIRED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 页面重新读取原事务 |

### Postconditions
POST-UI-001-01：所有状态有文案和可执行动作；取消/超时/外企业/未准入均可识别；账号应急入口受配置约束。  
POST-UI-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-UI-001-01：显示“企业微信已认证”仅当后端auth_method=wecom且当前身份有效。  
INV-UI-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_IDENTITY_NOT_READY`；`MGW_UI_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-UI-001-01（正向及边界）；A-UI-001-02（负向及禁止项）；A-UI-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-UI-001-01`、`TEST-A-UI-001-02`、`TEST-A-UI-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-UI-002 — 会议设置重构为网关、诊断与独立解析服务

**推进位置：**S3 / D2  
**实施触点：**`frontend/src/pages/Meetings/Settings.jsx；frontend/src/models/meetings.js与meetingGateway.js`

### Goal
替换截图中的腾讯AK/SK表单，避免人为选择能力造成假成功。

### Normative Requirement
- **REQ-UI-002-M1 — MUST：**实现 §9.2 设置字段；隐藏/移除腾讯AKSK、user/operator输入；OCR独立区；能力只读；检查结果按配置/可达/客户端/契约分项，不以一个绿色状态替代全部条件。 → A-UI-002-01。
- **REQ-UI-002-M2 — MUST NOT：**回显真实密钥；把UNKNOWN设为SUPPORTED；把网关内部URL展示给普通用户；保存即标授权成功。 → A-UI-002-02。
- **REQ-UI-002-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-UI-002-03。

### Inputs
管理员公开配置、secret_present、配置revision、只读诊断、OCR配置。

### Preconditions
PRE-UI-002-01：管理员身份；有效CSRF；实际config/check接口装配完成。  
PRE-UI-002-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
配置和Gateway状态权威；表单dirty状态只属于浏览器。

### State Transition
加载→编辑→保存→检查；并发409保留用户编辑而不覆盖服务端。

### Allowed Side Effects
ALLOW：显式提交配置/OCR更新；浏览器只显示secret存在与替换操作。

### Forbidden Side Effects
DENY：回显真实密钥；把UNKNOWN设为SUPPORTED；把网关内部URL展示给普通用户；保存即标授权成功。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
相同保存不清除原密钥；未改OCR不提交变化；检查可重复但不自动启用。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-UI-002-01 | 普通用户访问settings；管理员收到capability UNKNOWN；错误Gateway Origin。 | 无权限用户不可写；能力不可编辑；错误可定位。 | `MGW_CONFIG_REJECTED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-UI-002-02 | 另一个管理员已保存新revision，本页仍用旧revision。 | 显示冲突；保留本页未保存值；不覆盖新服务端revision。 | `MGW_CONFIG_REVISION_CONFLICT` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 刷新后显式重提交 |

### Postconditions
POST-UI-002-01：旧腾讯操作字段数量为0；状态与后端一致；错误不会清空整张表单。  
POST-UI-002-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-UI-002-01：任何secret输入保存后清空，页面返回数据不包含secret值。  
INV-UI-002-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_CONFIG_REJECTED`；`MGW_CONFIG_REVISION_CONFLICT`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-UI-002-01（正向及边界）；A-UI-002-02（负向及禁止项）；A-UI-002-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-UI-002-01`、`TEST-A-UI-002-02`、`TEST-A-UI-002-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-UI-003 — 现有会议列表、详情、导入与任务状态接通

**当前阶段只保留已有本地会议浏览/检索与LOCAL_ONLY提示；新导入、manifest选择、导入任务及依赖导入的AC部分均DEFERRED_CURRENT_PHASE。**

**推进位置：**S3 / D2  
**实施触点：**`frontend/src/pages/Meetings/index.jsx、Detail.jsx、Conversation.jsx、SourceViewer.jsx、models/meetings.js`

### Goal
复用已有页面完成真实查询/导入，不产生第二套会议系统。

### Normative Requirement
- **REQ-UI-003-M1 — MUST：**按 §9.7/9.8 使用异步查询与manifest；列表区分网关目录和本次查询结果；多录制选择、来源版本、原文/修订与任务进度明确；错误code不被通用字符串丢弃。 → A-UI-003-01。
- **REQ-UI-003-M2 — MUST NOT：**把202显示零会议/导入成功；默认忽略第二录制；未知capability默认为支持；错误丢失后自动重发写操作。 → A-UI-003-02。
- **REQ-UI-003-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-UI-003-03。

### Inputs
query snapshot、manifest、operation、本地会议、access状态。

### Preconditions
PRE-UI-003-01：G2接口真实；本人身份/bridge具备；旧页面路径继续可达。  
PRE-UI-003-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
源作业/operation/Gateway access为状态源；UI不自行推断完成。

### State Transition
空闲→查询中→源结果→选择→导入中→待审核/可用；缺权/未生成独立显示。

### Allowed Side Effects
ALLOW：用户显式发起查询、导入、审核、重试；本地导航和选择状态。

### Forbidden Side Effects
DENY：把202显示零会议/导入成功；默认忽略第二录制；未知capability默认为支持；错误丢失后自动重发写操作。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
重复点击导入使用相同operation key；刷新从任务ID恢复。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-UI-003-01 | 源作业RETRYING/FAILED；正文NOT_READY；权限DENIED各一例。 | 分别显示状态和下一动作；不能进入问答或把失败视为零结果。 | `MGW_SOURCE_NOT_READY` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-UI-003-02 | 导入提交成功但浏览器响应丢失，用户刷新页面再点击。 | 继续原operation，只显示一个导入；未收到成功结果不显示完成。 | `MGW_IMPORT_RECOVERY_REQUIRED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 读取原operation |

### Postconditions
POST-UI-003-01：已有详情/补充资料/审核操作保留；来源版本可追踪；无权时不残留正文。  
POST-UI-003-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-UI-003-01：零会议文案只在成功完整snapshot为0时出现。  
INV-UI-003-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_SOURCE_NOT_READY`；`MGW_IMPORT_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-UI-003-01（正向及边界）；A-UI-003-02（负向及禁止项）；A-UI-003-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-UI-003-01`、`TEST-A-UI-003-02`、`TEST-A-UI-003-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-QUERY-001 — 真实日期源查询、幂等作业与一致结果快照

**推进位置：**S2服务 / S3页面 / D1与D2  
**实施触点：**`Gateway query_service.py、NEW snapshot表/API；AnythingLLM Gateway Adapter、remote query BFF`

### Goal
确保页面的时间范围结果来自本次完整上游查询，而不是旧缓存。

### Normative Requirement
- **REQ-QUERY-001-M1 — MUST：**执行 §9.7 半开窗口、USER_WINDOW本人约束、幂等提交、全页收集与snapshot发布；120秒只停止前台等待，不结束后台作业；失败不使用缓存假结果。 → A-QUERY-001-01。
- **REQ-QUERY-001-M2 — MUST NOT：**传其他member；使用CORP_WINDOW；以目录旧记录补snapshot；重试时更换请求参数。 → A-QUERY-001-02。
- **REQ-QUERY-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-QUERY-001-03。

### Inputs
connection_ref、start_at/end_at、可信member、Idempotency-Key、opaque cursor。

### Preconditions
PRE-QUERY-001-01：本人THIRD_PARTY_OAUTH连接有效且meeting.read；窗口不超过90天。  
PRE-QUERY-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
Gateway job及snapshot为权威；Consumer operation仅映射与显示。

### State Transition
CREATED→QUEUED/RUNNING/RETRYING→SUCCEEDED/FAILED；只有完整成功发布snapshot。

### Allowed Side Effects
ALLOW：Gateway上游查询和目录upsert、job/snapshot/cache/audit；Consumer查询引用记录。

### Forbidden Side Effects
DENY：传其他member；使用CORP_WINDOW；以目录旧记录补snapshot；重试时更换请求参数。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同键同参一个源job；分页cursor属于同主体/窗口/snapshot；重复cursor拒绝。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-QUERY-001-01 | B使用A的query_id；大于90天窗口；伪造target_member_id；重复cursor。 | 对应拒绝；不创建越权源作业，不泄露结果。 | `MGW_QUERY_SCOPE_INVALID` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-QUERY-001-02 | 第二页源请求失败或POST响应丢失。 | 中途不发布完整结果；同键恢复同job；只有完成后发布。 | `MGW_QUERY_RECOVERY_REQUIRED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 原job或原幂等键恢复 |

### Postconditions
POST-QUERY-001-01：快照结果集合、窗口边界和数量可机器验证；job原始状态可追踪。  
POST-QUERY-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-QUERY-001-01：没有SUCCEEDED且complete=true时成功结果集不对外发布。  
INV-QUERY-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_QUERY_SCOPE_INVALID`；`MGW_QUERY_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-QUERY-001-01（正向及边界）；A-QUERY-001-02（负向及禁止项）；A-QUERY-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-QUERY-001-01`、`TEST-A-QUERY-001-02`、`TEST-A-QUERY-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-CONTENT-001 — 多录制、完整转写、原生纪要与版本一致性

**推进位置：**S2适配 / S4验收 / D3  
**实施触点：**`Gateway ContentService契约；Consumer formatter.js、NEW content adapter、现有importer范围校验`

### Goal
防止导入一页当全文或把某录制纪要冒充整场范围摘要。

### Normative Requirement
- **REQ-CONTENT-001-M1 — MUST：**按 §9.7 读取选择快照内所有录制/内容；完整分页、version一致、cursor终止与时间边界校验；原生纪要保留模型/类型和WHOLE_RECORDING覆盖；不生成伪腾讯摘要。 → A-CONTENT-001-01。
- **REQ-CONTENT-001-M2 — MUST NOT：**截断后仍标全文；跨版本拼页；空todo判失败；通用附件无接口仍标支持；未证明ABSENT而降级。 → A-CONTENT-001-02。
- **REQ-CONTENT-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-CONTENT-001-03。

### Inputs
Gateway meeting/recording/asset IDs、内容类型、每录制选择范围、content_version/is_complete/cursor。

### Preconditions
PRE-CONTENT-001-01：每个资源均有content.read；所选转写累计不超过3小时；Gateway响应可验证。  
PRE-CONTENT-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
Gateway Asset/原始内容为权威；本地原样来源副本与selection为last_applied。

### State Transition
NOT_READY→WAITING_SOURCE→FETCHING→COMPLETE或INCOMPLETE/CHANGED/BLOCKED。

### Allowed Side Effects
ALLOW：网关ensure作业；受管staging文件和内容hash；来源元数据。

### Forbidden Side Effects
DENY：截断后仍标全文；跨版本拼页；空todo判失败；通用附件无接口仍标支持；未证明ABSENT而降级。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同版本/选择重取不生成新可见文档；版本变更创建新source identity，不混合旧页。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-CONTENT-001-01 | 游标循环、页间version变化、相同段落ID异文、无时间戳或累计超过3小时。 | 返回确定完整性/范围错误，不发布部分全文。 | `MGW_CONTENT_INCOMPLETE` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-CONTENT-001-02 | 第N页网络失败；上游202尚未完成。 | 保留恢复记录但不发布；继续时重新校验version，变化则从新版本开始。 | `MGW_CONTENT_RECOVERY_REQUIRED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 同job与version恢复；变化时新版本重取 |

### Postconditions
POST-CONTENT-001-01：每条可发布来源有recording/asset/version/selection/完整性证明。  
POST-CONTENT-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-CONTENT-001-01：任一选中必需资源不完整，整个导入operation不进入VERIFIED。  
INV-CONTENT-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_CONTENT_INCOMPLETE`；`MGW_CONTENT_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-CONTENT-001-01（正向及边界）；A-CONTENT-001-02（负向及禁止项）；A-CONTENT-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-CONTENT-001-01`、`TEST-A-CONTENT-001-02`、`TEST-A-CONTENT-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-IMPORT-001 — 统一现有会议导入与 R1 受管文档代次

**范围归属：scope_disposition=DEFERRED_CURRENT_PHASE。本单元及其三个AC不属于AUTH_LOCAL_SEARCH阶段的Required集合，不执行导入交付或验收、不计PASS；仅保留后续R2设计。**

**推进位置：**S4 / D3  
**实施触点：**`modules/meetings/importer.js、runtime.js；models/meetingGateway.js；managedDocuments.js；meeting_jobs投影`

### Goal
复用两套已有资产，但只产生一套有血缘的本地资料和索引。

### Normative Requirement
- **REQ-IMPORT-001-M1 — MUST：**按 §9.9/9.10 由单一编排器驱动R1 generation；旧meeting_jobs作为投影；clientFactory接收可信user context；保留local meeting ID和已有业务接口。 → A-IMPORT-001-01。
- **REQ-IMPORT-001-M2 — MUST NOT：**旧importer与R1各写一份docId；以connectionId+外部ID跨owner去重合并；直接信任浏览器正文或createdBy。 → A-IMPORT-001-02。
- **REQ-IMPORT-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-IMPORT-001-03。

### Inputs
已完成query snapshot、选中资源/范围、restricted workspace、当前owner、操作键。

### Preconditions
PRE-IMPORT-001-01：所有资源获权、workspace本人独占；源内容完整；通过本地容量配额检查。  
PRE-IMPORT-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
operation/meeting_import_generations为导入权威；meeting_jobs与UI为投影。

### State Transition
RESERVED→FETCHING→STAGED→WAITING_REVIEW→INDEXING→VERIFIED；错误不发布。

### Allowed Side Effects
ALLOW：创建/引用本地meeting与sources；写operation/generation/受管文档与对应向量；审计。

### Forbidden Side Effects
DENY：旧importer与R1各写一份docId；以connectionId+外部ID跨owner去重合并；直接信任浏览器正文或createdBy。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
相同identity已有VERIFIED返回existing引用；处理中返回同operation；同键异参409。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-IMPORT-001-01 | B使用A的来源/目标工作区；同键不同选择；浏览器提交自报member或正文。 | 拒绝并保持配额/文档/向量T0。 | `MGW_IMPORT_SCOPE_CONFLICT` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-IMPORT-001-02 | Collector已写文件但Consumer未收到响应。 | 查询原operation receipt复用稳定docId，不重新生成随机文件。 | `MGW_IMPORT_RECOVERY_REQUIRED` | 已公开业务指针保持T0；未核实副作用进入RECOVERY_REQUIRED，不声称已完整回滚；保留backup/receipt，孤儿不可读 | 原operation恢复 |

### Postconditions
POST-IMPORT-001-01：一个版本/范围/owner/工作区只有一个活动可见导入；localId与来源映射稳定。  
POST-IMPORT-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-IMPORT-001-01：每个活跃workspace文档都能回查唯一operation、generation与源version。  
INV-IMPORT-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_IMPORT_SCOPE_CONFLICT`；`MGW_IMPORT_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-IMPORT-001-01（正向及边界）；A-IMPORT-001-02（负向及禁止项）；A-IMPORT-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-IMPORT-001-01`、`TEST-A-IMPORT-001-02`、`TEST-A-IMPORT-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-DATA-001 — 原文、人工修订、审核与引用分层

**推进位置：**S4 / D3  
**实施触点：**`meetings/sources.js、meetingService.js、source segments；NEW meeting_content_revisions；详情来源投影`

### Goal
保护用户加工成果并保留腾讯来源证据。

### Normative Requirement
- **REQ-DATA-001-M1 — MUST：**实施 §9.9、12、13 的原文不可变与用户修订分层；任何人工修改生成新revision并撤销旧审核；原生来源与本地修订在UI/引用中明确区分。 → A-DATA-001-01。
- **REQ-DATA-001-M2 — MUST NOT：**覆盖源minute/transcript；删用户修订；把本地LLM文本贴腾讯原生标记；旧审核覆盖新内容。 → A-DATA-001-02。
- **REQ-DATA-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-DATA-001-03。

### Inputs
已导入original、修改正文、base_revision、current source_version、有效owner。

### Preconditions
PRE-DATA-001-01：本次读取/编辑获权；If-Match revision；来源存在。  
PRE-DATA-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
Original=last_applied不可变；BusinessRevision=本地用户事实；APPROVED绑定精确revision。

### State Transition
DRAFT→APPROVED；编辑→新DRAFT；source更新不覆盖旧revision。

### Allowed Side Effects
ALLOW：追加revision/审核记录/引用元数据；更新活动业务revision指针；触发受控reindex。

### Forbidden Side Effects
DENY：覆盖源minute/transcript；删用户修订；把本地LLM文本贴腾讯原生标记；旧审核覆盖新内容。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同revision同摘要的重复保存返回原revision；不同内容在相同If-Match并发时仅一个成功。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-DATA-001-01 | 直接PATCH原文或以旧revision提交覆盖；模型输出请求改写原生标签。 | 拒绝，原文和用户revision不变。 | `MGW_CONTENT_REVISION_CONFLICT` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-DATA-001-02 | 用户修订写入后、活动指针切换前DB失败。 | 可见指针与原文/修订集合回到T0；审计标失败。 | `MGW_REVISION_COMMIT_FAILED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | YES；读取最新revision后提交 |

### Postconditions
POST-DATA-001-01：任一引用能区分源、录制、version、段落/时间与本地revision。  
POST-DATA-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-DATA-001-01：用户修订和补充文件在源同步前后hash保持不变，除非用户明确编辑。  
INV-DATA-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_CONTENT_REVISION_CONFLICT`；`MGW_REVISION_COMMIT_FAILED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-DATA-001-01（正向及边界）；A-DATA-001-02（负向及禁止项）；A-DATA-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-DATA-001-01`、`TEST-A-DATA-001-02`、`TEST-A-DATA-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-WORKSPACE-001 — 持续受限工作区与存储隔离

**推进位置：**S4 / D3  
**实施触点：**`meetingGateway/workspacePolicy.js；models/workspace.js、workspaceUsers.js、embedConfig.js；Collector受管目录`

### Goal
防止个人OAuth会议被导入后变成普通共享知识。

### Normative Requirement
- **REQ-WORKSPACE-001-M1 — MUST：**延续R1 owner-only workspace；限制新增成员/share/embed/copy/move/sync；受管文件不进入普通picker或原始下载路径；管理员无隐式正文读取特权。 → A-WORKSPACE-001-01。
- **REQ-WORKSPACE-001-M2 — MUST NOT：**将源导入普通workspace；管理员自动越权；把受管资料复制到普通文档目录或public embed。 → A-WORKSPACE-001-02。
- **REQ-WORKSPACE-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-WORKSPACE-001-03。

### Inputs
local owner、restricted workspace、policy_epoch、受管docId/operation。

### Preconditions
PRE-WORKSPACE-001-01：owner有效；workspace policy ACTIVE；会议实时access允许。  
PRE-WORKSPACE-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
meeting_restricted_workspaces为本地策略事实；Gateway为源授权事实。

### State Transition
创建即RESTRICTED/ACTIVE；不允许用户自行降级普通；失权QUARANTINED。

### Allowed Side Effects
ALLOW：创建本人独占workspace与成员关系；写policy epoch；受管路径/文档关联。

### Forbidden Side Effects
DENY：将源导入普通workspace；管理员自动越权；把受管资料复制到普通文档目录或public embed。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同一创建操作复用工作区；重放成员/分享变更始终拒绝；重复隔离不改变原文件字节。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-WORKSPACE-001-01 | owner尝试添加成员、share/embed/copy/move/sync或导入到普通workspace。 | 全部拒绝，不改变成员/位置/共享配置。 | `MGW_WORKSPACE_POLICY_DENIED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-WORKSPACE-001-02 | 成员变更与导入commit并发，policy_epoch变化。 | 旧代次提交失败并隔离staging，工作区未扩权。 | `MGW_WORKSPACE_POLICY_CONFLICT` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 在当前policy重新评估后恢复 |

### Postconditions
POST-WORKSPACE-001-01：普通文档选择器看不到受管源；工作区可见性与owner一致。  
POST-WORKSPACE-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-WORKSPACE-001-01：非owner可读受管正文/向量数量为0，即使是admin或持全局API key。  
INV-WORKSPACE-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_WORKSPACE_POLICY_DENIED`；`MGW_WORKSPACE_POLICY_CONFLICT`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-WORKSPACE-001-01（正向及边界）；A-WORKSPACE-001-02（负向及禁止项）；A-WORKSPACE-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-WORKSPACE-001-01`、`TEST-A-WORKSPACE-001-02`、`TEST-A-WORKSPACE-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-ACCESS-001 — 远端在线授权与LOCAL_ONLY本地读取授权

**模式边界：下述在线Gateway授权要求用于GATEWAY_ENABLED；LOCAL_ONLY读取既有数据按§4.6的本地权限规则及PHASE-LOCAL-02验收，不要求在线Gateway判定。**

**推进位置：**S4 / D3  
**实施触点：**`旧endpoints/meetings.js；Gateway access-decisions；meetingGateway/access.js、sessions.js；文件/详情/job routes`

### Goal
避免只保护新接口而留下旧会议和本地文件旁路。

### Normative Requirement
- **REQ-ACCESS-001-M1 — MUST：**执行 §9.6、18 的本地session∩bridge∩Gateway具体资源动作∩workspace策略交集；补齐isBridgeCurrent真实实现；本地缓存不跨请求授予allow；403/404/不可用均不直连。 → A-ACCESS-001-01。
- **REQ-ACCESS-001-M2 — MUST NOT：**仅凭本地AVAILABLE或管理员角色放行；信任body.userId；旧文件路径绕过；缓存allow覆盖当前deny。 → A-ACCESS-001-02。
- **REQ-ACCESS-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-ACCESS-001-03。

### Inputs
服务端actor、本地会议/文件/job/来源引用、Gateway资源与动作、bridge。

### Preconditions
PRE-ACCESS-001-01：真实本地主体存在；资源可映射；身份/客户端/连接未停用。  
PRE-ACCESS-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
各层权威不被本地projection覆盖；请求allow仅派生。

### State Transition
请求UNVERIFIED→ALLOW/DENY/UNAVAILABLE；失权不改变原数据所有权。

### Allowed Side Effects
ALLOW：只读权限网络、审计和拒绝缓存；必要时标本地access隔离。

### Forbidden Side Effects
DENY：仅凭本地AVAILABLE或管理员角色放行；信任body.userId；旧文件路径绕过；缓存allow覆盖当前deny。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
每次新请求重新授权；同一请求资源批量最多50；失权重复请求始终拒绝。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-ACCESS-001-01 | 管理员/global key/body.userId=A/直接localId/已过期bridge分别访问受管资料。 | 全部拒绝；对资源不存在和跨人返回统一不可访问。 | `MGW_RESOURCE_NOT_ACCESSIBLE` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-ACCESS-001-02 | Gateway实时access断网，或读取文件中途撤销后在发送前复查。 | fail-closed，无当前请求正文；保留可恢复数据。 | `MGW_ACCESS_STATE_UNAVAILABLE` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 依赖恢复后新请求重新判定 |

### Postconditions
POST-ACCESS-001-01：列表只呈现当前可见项；详情/源文件/job均防IDOR；未知映射默认拒绝。  
POST-ACCESS-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-ACCESS-001-01：GATEWAY_ENABLED的受保护远端路径必须通过在线授权；LOCAL_ONLY可返回经过本地会话/owner/workspace权限校验的既有本地内容，远端会议数据请求为0；已知撤销仍阻断。
INV-ACCESS-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_RESOURCE_NOT_ACCESSIBLE`；`MGW_ACCESS_STATE_UNAVAILABLE`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-ACCESS-001-01（正向及边界）；A-ACCESS-001-02（负向及禁止项）；A-ACCESS-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-ACCESS-001-01`、`TEST-A-ACCESS-001-02`、`TEST-A-ACCESS-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-RAG-001 — 问答、固定文档、历史、引用与旁路的统一门禁

**LOCAL_ONLY中检索、pinned、历史和引用只使用本地已有数据与本地权限校验；禁用Gateway取数/源补抓工具。其余条款的在线复核仅适用于GATEWAY_ENABLED；明确已知撤销/跨用户访问在两模式均拒绝。**

**推进位置：**S4 / D3  
**实施触点：**`chats/authorizedRetrieval.js；stream.js、apiChatHandler.js、openaiCompatible.js、embed.js；meetings/qa.js；vector-search/history/export/file paths`

### Goal
防止失权内容通过非向量路径重新进入模型或响应。

### Normative Requirement
- **REQ-RAG-001-M1 — MUST：**在读取pinned/parsed/history、检索和LLM调用前执行准入与最终复查；所有受管命中文档逐源校验；无真实员工主体的global API key、public embed和兼容API默认拒绝受限空间。 → A-RAG-001-01。
- **REQ-RAG-001-M2 — MUST NOT：**先发模型再检查；从旧history回填已撤销内容；全局key冒充owner；无授权引用/导出/TTS。 → A-RAG-001-02。
- **REQ-RAG-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-RAG-001-03。

### Inputs
actor、conversation、所选会议/工作区、pinned/parsed/history/vector results、引用。

### Preconditions
PRE-RAG-001-01：所有选中会议APPROVED/AVAILABLE且当前资源授权；最多10场；有效受限workspace策略。  
PRE-RAG-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
本地资料版本/审核与Gateway授权分别为事实源；模型结果不成为授权依据。

### State Transition
ADMITTED→CONTEXT_AUTHORIZED→FINAL_CHECK→GENERATING；任何deny中止/清空本次context。

### Allowed Side Effects
ALLOW：获权后读取向量与文本、调用已批准LLM、写有provenance的回答；审计。

### Forbidden Side Effects
DENY：先发模型再检查；从旧history回填已撤销内容；全局key冒充owner；无授权引用/导出/TTS。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同操作重试不沿用过期admission；旧会话需按当前资料访问权重查；不自动重发模型输出。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-RAG-001-01 | B、全局API key、public embed或已失权历史会话包含canary。 | 拒绝受限资料，不调用模型，不返回canary。 | `MGW_RAG_ACCESS_DENIED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-RAG-001-02 | 向量检索后、模型调用前授权撤销；另例生成过程中撤销。 | 前者不调用模型；后者最迟5秒停止后续输出，不宣称收回已发送字节。 | `MGW_RAG_ACCESS_REVOKED` | 未调用模型时丢弃本次context；已发送内容无法收回，停止后续生成/输出并记录边界 | NO；重新获权后新问答 |

### Postconditions
POST-RAG-001-01：被拒资源不进入context或新回答；历史回答后续读取也通过本地依赖门禁。  
POST-RAG-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-RAG-001-01：拒绝发生在模型调用前时，LLM请求计数为0且canary不出现在任何context。  
INV-RAG-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_RAG_ACCESS_DENIED`；`MGW_RAG_ACCESS_REVOKED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-RAG-001-01（正向及边界）；A-RAG-001-02（负向及禁止项）；A-RAG-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-RAG-001-01`、`TEST-A-RAG-001-02`、`TEST-A-RAG-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-REVOKE-001 — 退出、停用、解除绑定与本地资料失效

**推进位置：**S4 / D3  
**实施触点：**`UserMenu/logout；models/user.js；bridge/session registry；access/lifecycle/cleanup worker；回答读取门禁`

### Goal
使已有资料的后续读取随身份和源授权变化而停止。

### Normative Requirement
- **REQ-REVOKE-001-M1 — MUST：**按 §8/18 区分本地退出、解绑、腾讯连接撤销；注销/停用/epoch变化立即阻断本地会话；网关来源撤销按当前判定和最大60秒来源健康边界执行；先锁访问再清理向量。 → A-REVOKE-001-01。
- **REQ-REVOKE-001-M2 — MUST NOT：**用删除文件代替即时门禁；把本地退出显示成腾讯OAuth撤销；删除用户补充原件；宣称已发送数据可回收。 → A-REVOKE-001-02。
- **REQ-REVOKE-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-REVOKE-001-03。

### Inputs
退出事件、local user change、Gateway deny/source removed、current import dependencies。

### Preconditions
PRE-REVOKE-001-01：已存在绑定、session和受管导入；事件来源可验证。  
PRE-REVOKE-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
本地session/epoch与Gateway当前授权；本地access状态只作拒绝/清理派生。

### State Transition
BOUND/VALID→REVOKED/DENIED/QUARANTINED→PENDING_CLEANUP；重新获权需资源/版本复核。

### Allowed Side Effects
ALLOW：撤销当前或本人全部本地会话、失效access、更新policy_epoch、删除明确受管向量/生成文件；保留审计与用户原件。

### Forbidden Side Effects
DENY：用删除文件代替即时门禁；把本地退出显示成腾讯OAuth撤销；删除用户补充原件；宣称已发送数据可回收。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
重复logout/disable/cleanup幂等；不存在已撤销session返回已撤销，不创建新令牌。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-REVOKE-001-01 | 用户试图凭本地READY恢复已撤销源；或owner以外调用解绑。 | 拒绝，不恢复权限，不操作他人会话。 | `MGW_ACCESS_REVOKED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-REVOKE-001-02 | 访问锁已提交，向量删除超时或进程中断。 | 保持PENDING_CLEANUP和deny；保留恢复记录，不能因为清理失败放行。 | `MGW_CLEANUP_PENDING` | 保留已提交DENY，不回滚为ALLOW；仅幂等重试受管清理 | 仅幂等清理重试 |

### Postconditions
POST-REVOKE-001-01：新请求不能读失权内容；旧回答在本地后续读取受控；未完成清理保持拒绝。  
POST-REVOKE-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-REVOKE-001-01：访问锁提交早于任何可失败的外部向量清理。  
INV-REVOKE-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_ACCESS_REVOKED`；`MGW_CLEANUP_PENDING`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-REVOKE-001-01（正向及边界）；A-REVOKE-001-02（负向及禁止项）；A-REVOKE-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-REVOKE-001-01`、`TEST-A-REVOKE-001-02`、`TEST-A-REVOKE-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-TXN-001 — 跨 DB/文件/Collector/向量的提交与恢复

**推进位置：**S4 / D3  
**实施触点：**`managedDocuments.js、worker.js、models/meetingGateway.js；Collector managedDocumentStore；NEW operation recovery CLI`

### Goal
防止半成品可检索、随机docId重试和陈旧worker覆盖新结果。

### Normative Requirement
- **REQ-TXN-001-M1 — MUST：**执行 §13/14/23 的稳定identity、T0、fence、stage/verify/publish和恢复语义；DB事务不包网络；active指针最后发布；未明写入查询receipt而不盲目重发。 → A-TXN-001-01。
- **REQ-TXN-001-M2 — MUST NOT：**将DB事务称跨系统原子事务；过期fence提交；失败后删恢复备份；未获权恢复执行。 → A-TXN-001-02。
- **REQ-TXN-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-TXN-001-03。

### Inputs
operation/generation、fence、stable docId、T0 manifest、source/user digests。

### Preconditions
PRE-TXN-001-01：租约有效、源授权有效、目标owner匹配、operation范围已冻结。  
PRE-TXN-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
本地generation台账/Collector receipt/向量docId核验分别为对应副作用事实源。

### State Transition
RESERVED→STAGED→INDEXING→VERIFIED；失败→RECOVERY_REQUIRED/PENDING_CLEANUP；恢复后同operation继续。

### Allowed Side Effects
ALLOW：仅受管staging、已登记docId向量、台账/receipt/恢复记录和备份。

### Forbidden Side Effects
DENY：将DB事务称跨系统原子事务；过期fence提交；失败后删恢复备份；未获权恢复执行。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同operation/代次/文档只写一个确定identity；删除可重放；清理未完成不得启动相同identity新发布。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-TXN-001-01 | 陈旧worker、错误owner、篡改receipt或docId、越界路径。 | 拒绝且不覆盖当前活动版本、不删除他人文件。 | `MGW_TRANSACTION_CONFLICT` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-TXN-001-02 | 逐一注入 §23 全部事务失败点，包含rollback失败。 | 可见范围回T0或完成核验后发布；失败回滚保留备份，孤儿不进入RAG。 | `MGW_RECOVERY_REQUIRED` | 已公开业务指针保持T0；未核实副作用进入RECOVERY_REQUIRED，不声称已完整回滚；保留backup/receipt，孤儿不可读 | 只按receipt/fence恢复；禁止盲重发 |

### Postconditions
POST-TXN-001-01：可见业务状态要么T0，要么完整核验后的新版本；孤儿仅可在不可见受管范围等待清理。  
POST-TXN-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-TXN-001-01：任何失败点不能产生未经VERIFY的active_generation。  
INV-TXN-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_TRANSACTION_CONFLICT`；`MGW_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-TXN-001-01（正向及边界）；A-TXN-001-02（负向及禁止项）；A-TXN-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-TXN-001-01`、`TEST-A-TXN-001-02`、`TEST-A-TXN-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-SEC-001 — 凭据、网络、路径与不可信内容边界

**推进位置：**S1规则 / S2基础 / S4全量 / D1与D3  
**实施触点：**`Gateway Client transport、redact、SSO callbacks；上传/下载/file readers；deployment allowlist；HTTP logger`

### Goal
保护员工令牌与会议资料，不因可配置网关引入代理和文件读取漏洞。

### Normative Requirement
- **REQ-SEC-001-M1 — MUST：**落实 §18 全部威胁控制和性能/内存边界：固定HTTPS源/路径/方法、DNS逐连接核验、受控私网allowlist、无重定向、令牌加密、禁日志泄漏、CSRF、symlink/path containment、正文不执行。 → A-SEC-001-01。
- **REQ-SEC-001-M2 — MUST NOT：**任意URL代签/代理；关闭TLS；跨目录/符号链接写入；记录全文/token/callback query；将正文指令执行为工具。 → A-SEC-001-02。
- **REQ-SEC-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-SEC-001-03。

### Inputs
不可信URL/path/filename/query/正文/模型输出；密钥引用；运行配置。

### Preconditions
PRE-SEC-001-01：安全测试使用专用canary，禁止生产密钥进入fixture；外发模型在批准列表。  
PRE-SEC-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
部署允许源/密钥库/当前身份策略权威；浏览器与文档内容不可信。

### State Transition
输入→VALIDATED或DENIED；密钥轮换old→new但保留解密仍引用数据的旧key。

### Allowed Side Effects
ALLOW：受控Gateway/OCR/LLM网络；仅受管目录文件；脱敏审计；密钥版本更新。

### Forbidden Side Effects
DENY：任意URL代签/代理；关闭TLS；跨目录/符号链接写入；记录全文/token/callback query；将正文指令执行为工具。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
拒绝请求无受管业务变更；同nonce/state重放拒绝；密钥轮换重复不丢旧数据。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-SEC-001-01 | 注入SSRF、DNS rebinding、重定向、path traversal、symlink、CSRF、正文工具指令。 | 对应拒绝；无上游越界、文件越界、任意工具执行。 | `MGW_SECURITY_REJECTED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-SEC-001-02 | 密钥轮换过程中进程失败；旧数据仍引用旧key；另例TLS检查失败。 | 旧密文仍可解；TLS失败不自动降级HTTP；无密钥丢失。 | `MGW_SECURITY_DEPENDENCY_FAILED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 修复可信配置后重试 |

### Postconditions
POST-SEC-001-01：秘密不入前端、错误、日志、Evidence；路径/出站均可机器观测。  
POST-SEC-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-SEC-001-01：所有越界fixture的网络/文件/业务副作用为0。  
INV-SEC-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_SECURITY_REJECTED`；`MGW_SECURITY_DEPENDENCY_FAILED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-SEC-001-01（正向及边界）；A-SEC-001-02（负向及禁止项）；A-SEC-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-SEC-001-01`、`TEST-A-SEC-001-02`、`TEST-A-SEC-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-OBS-001 — 阶段日志、错误语义与诊断证据

**推进位置：**S2基础 / S3呈现 / S5审计  
**实施触点：**`meetingGateway/errors.js、redact.js；BFF error envelope；job投影；日志与诊断页面`

### Goal
明确故障位于身份、网关、源内容、导入还是权限，避免通用错误掩盖事实。

### Normative Requirement
- **REQ-OBS-001-M1 — MUST：**记录 §19 规定的operation/stage/status/time/identity摘要/error/recovery；401/403/409/202/429/5xx与未知写入结果分开；使用非循环trace链，不记录秘密或正文。 → A-OBS-001-01。
- **REQ-OBS-001-M2 — MUST NOT：**仅写PASS标签；把202当错误或成功全文；error_message泄露原始token/正文；metrics成为授权输入。 → A-OBS-001-02。
- **REQ-OBS-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-OBS-001-03。

### Inputs
各阶段结果、网关reason/trace_id、HTTP状态、operation/query/generation引用。

### Preconditions
PRE-OBS-001-01：日志脱敏器先于路由；error_code白名单；所有敏感响应no-store。  
PRE-OBS-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
原始状态来自各SOT；日志仅证据，不驱动业务成功。

### State Transition
事件追加；同operation跨阶段关联；未知reason转换为契约/通用安全错误而非成功。

### Allowed Side Effects
ALLOW：结构化脱敏日志、指标、只读诊断、失败Evidence引用。

### Forbidden Side Effects
DENY：仅写PASS标签；把202当错误或成功全文；error_message泄露原始token/正文；metrics成为授权输入。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
事件有event_id去重；重试attempt追加不覆盖前次失败；重复读取不新增成功业务状态。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-OBS-001-01 | 上游error带token与会议全文，未知reason和重复header。 | 只输出安全code与脱敏trace，不回显上游body。 | `MGW_UPSTREAM_CONTRACT_ERROR` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-OBS-001-02 | 业务事务完成后日志sink暂时不可达。 | 持久outbox或本地审计仍能证明业务；不重复业务写入为补日志。 | `MGW_AUDIT_DELIVERY_PENDING` | 不回滚已成功业务；通过持久审计outbox重投日志，禁止重放业务写入 | 只重试审计投递 |

### Postconditions
POST-OBS-001-01：用户可根据error/recovery_action采取确定动作；技术可追溯两仓操作。  
POST-OBS-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-OBS-001-01：每个失败operation至少有一个有stage与code的终态/恢复事件。  
INV-OBS-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_UPSTREAM_CONTRACT_ERROR`；`MGW_AUDIT_DELIVERY_PENDING`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-OBS-001-01（正向及边界）；A-OBS-001-02（负向及禁止项）；A-OBS-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-OBS-001-01`、`TEST-A-OBS-001-02`、`TEST-A-OBS-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-MIGRATE-001 — 历史盘点、可信映射与不明所有权隔离

**推进位置：**S5 / D3  
**实施触点：**`NEW migration CLI与migration run/item表；原meetings/sources/jobs映射；受管目录与向量隔离`

### Goal
迁移既有会议而不覆盖local ID、用户加工资料或误把旧源ID当网关ID。

### Normative Requirement
- **REQ-MIGRATE-001-M1 — MUST：**执行 §16 detect/adopt/migrate/preserve/remove与只读diff；仅凭完整namespace+upstream identity+owner证明映射；不明ownership保留字节并隔离；计划hash/CAS漂移则阻断。 → A-MIGRATE-001-01。
- **REQ-MIGRATE-001-M2 — MUST NOT：**按标题/时间/会议号猜同一会议；复制成新localId替代；删unknown来源；无计划force覆盖。 → A-MIGRATE-001-02。
- **REQ-MIGRATE-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-MIGRATE-001-03。

### Inputs
旧DB/文件/向量inventory、Gateway映射证明、owner批准、T0与plan digest。

### Preconditions
PRE-MIGRATE-001-01：维护窗口、可验证备份、目标Gateway只读可用；mapping与去重规则审核完成。  
PRE-MIGRATE-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
旧字节/业务ID与T0为迁移基准；Gateway资源身份权威；显式owner映射为批准事实。

### State Transition
INVENTORIED→PLANNED→APPROVED→STAGED→APPLIED→VERIFIED；未知QUARANTINED；漂移DRIFTED。

### Allowed Side Effects
ALLOW：写目标映射、新schema、隔离标记、受管向量清理记录、迁移审计；保留local IDs和用户内容。

### Forbidden Side Effects
DENY：按标题/时间/会议号猜同一会议；复制成新localId替代；删unknown来源；无计划force覆盖。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
相同plan/基线再执行零新增迁移；已匹配项返回原映射；scope变化需要新批准plan。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-MIGRATE-001-01 | 仅标题/时间匹配；owner不一致；plan后文件漂移。 | 阻断对应项或全run；无猜测映射、删除和自动覆盖。 | `MGW_MIGRATION_DRIFT` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-MIGRATE-001-02 | 第N条映射写入后或隔离向量清理时失败。 | 受管可见状态回T0或隔离；用户字节不变；回滚失败保留恢复manifest。 | `MGW_MIGRATION_RECOVERY_REQUIRED` | 已公开业务指针保持T0；未核实副作用进入RECOVERY_REQUIRED，不声称已完整回滚；保留backup/receipt，孤儿不可读 | 按run manifest恢复 |

### Postconditions
POST-MIGRATE-001-01：每条历史记录有已验证映射或隔离结果；用户内容digest保持；重复导入不会复制历史已映射会议。  
POST-MIGRATE-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-MIGRATE-001-01：无法证明ownership的内容不被删除且不可通过普通检索继续泄漏。  
INV-MIGRATE-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_MIGRATION_DRIFT`；`MGW_MIGRATION_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-MIGRATE-001-01（正向及边界）；A-MIGRATE-001-02（负向及禁止项）；A-MIGRATE-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-MIGRATE-001-01`、`TEST-A-MIGRATE-001-02`、`TEST-A-MIGRATE-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-CUTOVER-001 — 正式切换、旧凭据退出与不绕权回滚

**推进位置：**S5 / D1最终收口  
**实施触点：**`deployment config；meeting runtime provider switch；NEW cutover/recovery操作；凭据引用迁移`

### Goal
使生产请求可证明只经网关，且回滚不会重新暴露旧宽权限链路。

### Normative Requirement
- **REQ-CUTOVER-001-M1 — MUST：**执行 §16 切换序列和 §14 回滚边界；停止直连worker/入口；迁移旧活跃凭据为不可运行备份；故障只维护模式或回到已具同等权限门禁版本，不能自动回旧直连。 → A-CUTOVER-001-01。
- **REQ-CUTOVER-001-M2 — MUST NOT：**请求级fallback；恢复无读门禁旧构建访问R2资料；未恢复成功先清理备份；操作其他应用的腾讯密钥。 → A-CUTOVER-001-02。
- **REQ-CUTOVER-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-CUTOVER-001-03。

### Inputs
G4证据、审批plan、T0、候选build/config摘要、目标Gateway健康、用户维护通知。

### Preconditions
PRE-CUTOVER-001-01：先完成演练及备份恢复验证；没有旧worker运行或旧入站写入未排空。  
PRE-CUTOVER-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
last_applied deployment与migration run；运行流量证据。

### State Transition
PREPARED→QUIESCED→CUTOVER→OBSERVING→VERIFIED；失败→MAINTENANCE/ROLLED_BACK。

### Allowed Side Effects
ALLOW：更换受控配置/构建、停止旧worker、轮换/清理本地旧凭据引用、记录网络证据。

### Forbidden Side Effects
DENY：请求级fallback；恢复无读门禁旧构建访问R2资料；未恢复成功先清理备份；操作其他应用的腾讯密钥。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
相同cutover operation重复执行复用状态；清理凭据仅限证明归属本应用的副本。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-CUTOVER-001-01 | Gateway返回403或不可达；操作者试图打开legacy fallback或运行旧无门禁构建。 | 维持拒绝或维护模式；不绕权、不恢复旧直连。 | `MGW_CUTOVER_BLOCKED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-CUTOVER-001-02 | 切换配置后候选启动失败，或回滚存储恢复失败。 | 仅恢复已验证安全状态或停留维护；备份不删，恢复可重入。 | `MGW_CUTOVER_RECOVERY_REQUIRED` | 已公开业务指针保持T0；未核实副作用进入RECOVERY_REQUIRED，不声称已完整回滚；保留backup/receipt，孤儿不可读 | 按审批恢复步骤重入 |

### Postconditions
POST-CUTOVER-001-01：所有会议流量经Gateway；旧凭据不被runtime读取；异常回滚仍拒绝未获权数据。  
POST-CUTOVER-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-CUTOVER-001-01：故障/回滚期间Consumer腾讯直连请求始终为0。  
INV-CUTOVER-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_CUTOVER_BLOCKED`；`MGW_CUTOVER_RECOVERY_REQUIRED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-CUTOVER-001-01（正向及边界）；A-CUTOVER-001-02（负向及禁止项）；A-CUTOVER-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-CUTOVER-001-01`、`TEST-A-CUTOVER-001-02`、`TEST-A-CUTOVER-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-COMPAT-001 — 保留既有会议规则、OCR与普通工作区行为

**推进位置：**S5 / 三项结果共同  
**实施触点：**`constants.js、policy.js、parser.js；现有会议详情/补充/审核；普通workspace/collector非受管分支`

### Goal
连接迁移不引入与需求无关的功能删除、配额放宽或普通用户回归。

### Normative Requirement
- **REQ-COMPAT-001-M1 — MUST：**保持 §9.7、SRC-13 的已定义配额及原有OCR默认/边界；普通非受管文档与Workspace走原权限和处理管道；Compare/Translation/OA不新增业务写入。 → A-COMPAT-001-01。
- **REQ-COMPAT-001-M2 — MUST NOT：**修改配额数值以通过测试；把普通workspace全锁死；重做ASR或OA自动写；将普通raw-text随机ID规则强制变成受管规则。 → A-COMPAT-001-02。
- **REQ-COMPAT-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-COMPAT-001-03。

### Inputs
旧功能回归集、配额边界、OCR配置、普通workspace/用户、非受管文档。

### Preconditions
PRE-COMPAT-001-01：候选构建已装配网关；数据库为本次声明的原SQLite类型，未切引擎。  
PRE-COMPAT-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
原常量/本地业务规则与普通数据为baseline；目标变化仅在本PRDscope。

### State Transition
迁移前功能状态→迁移后相同行为；受管内容才附加新限制。

### Allowed Side Effects
ALLOW：受控测试数据创建/清理；原有OCR处理；合法普通文档操作。

### Forbidden Side Effects
DENY：修改配额数值以通过测试；把普通workspace全锁死；重做ASR或OA自动写；将普通raw-text随机ID规则强制变成受管规则。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
普通文档保持原生成identity行为；会议受管导入按新幂等规则；两者不混淆。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-COMPAT-001-01 | 配额各超1单位、OCR timeout 4999/300001、请求ASR/Compare/Translation/OA新写入。 | 边界拒绝；无范围外实现或业务写入。 | `MGW_COMPAT_SCOPE_VIOLATION` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-COMPAT-001-02 | 第一份OCR文件超时，第二份合法；网关不可用时操作普通非受管文档。 | 第一份失败，第二份按原规则完成；普通工作区不被网关故障锁死。 | `MGW_OCR_SOURCE_FAILED` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 仅重试失败文件；不重置整个会议 |

### Postconditions
POST-COMPAT-001-01：非目标回归集通过；OCR密钥不丢、超时继续后续任务；配额边界明确。  
POST-COMPAT-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-COMPAT-001-01：仅受管来源受新约束；普通功能受管匹配误判数量为0。  
INV-COMPAT-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_COMPAT_SCOPE_VIOLATION`；`MGW_OCR_SOURCE_FAILED`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-COMPAT-001-01（正向及边界）；A-COMPAT-001-02（负向及禁止项）；A-COMPAT-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-COMPAT-001-01`、`TEST-A-COMPAT-001-02`、`TEST-A-COMPAT-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

## REQ-EVID-001 — 可执行验收、追溯矩阵与不可伪绿发布门禁

**推进位置：**S1起全程 / S5最终  
**实施触点：**`NEW scripts/meeting-gateway-r2/run-acceptance.cjs、validate-spec.cjs；R1 release-gate.cjs版本化升级；fixture/golden/review证据`

### Goal
把代码完成与产品验证分开，按三个结果和五阶段证明交付。

### Normative Requirement
- **REQ-EVID-001-M1 — MUST：**实现 §20–30/35 全部Evidence、Golden和Gate规则；每个REQ的正向、负向、失败AC都有测试与Oracle；Required非PASS时最终退出非0；不得用旧R1或mock证据替代真实候选验收。 → A-EVID-001-01。
- **REQ-EVID-001-M2 — MUST NOT：**手改PASS；无执行Evidence验收；空测试/skip伪绿；测试脚本写入生产非测试会议。 → A-EVID-001-02。
- **REQ-EVID-001-M3 — MUST：**执行本项 Failure Semantics；恢复时重新校验主体、版本、所有权和副作用范围；无法证明恢复结果时保持 BLOCKED/RECOVERY_REQUIRED。→ A-EVID-001-03。

### Inputs
本PRD版本、结构映射、fixture/golden运行、candidate_build_id、source SHAs、configuration_digest。

### Preconditions
PRE-EVID-001-01：测试入口在计划中明确NEW；真实验收环境授权；Evidence目录独立于产品数据。  
PRE-EVID-001-02：固定候选版本、已批准本项契约；不能用 frontend 字段代替可信服务端主体。

### Authoritative State
EVIDENCE_STATE仅由执行工具产生；Gate是确定性校验输出。

### State Transition
PLANNED→IMPLEMENTED→VERIFIED；缺依赖BLOCKED；FAIL/SKIPPED/BLOCKED不能成为Release PASS。

### Allowed Side Effects
ALLOW：创建脱敏Evidence/test logs/manifests/review records；运行授权fixture/golden；只在测试数据scope mutation。

### Forbidden Side Effects
DENY：手改PASS；无执行Evidence验收；空测试/skip伪绿；测试脚本写入生产非测试会议。

### Ownership Scope
ROW / RECORD / RESOURCE：仅本项明确 owner、operation 与 generation 的记录。FILE / SECTION：仅上述实施触点和第 12 章受管路径。NONE：未声明的第三方业务源。用户拥有的正文/补充原件按 USER_OWNED 保留。

### Idempotency
同run_id不覆写证据；重跑新run_id；Gate对相同有效输入返回相同状态。

### Failure Semantics
| Failure | Trigger | Expected state | Error code | Rollback / recovery | Retryable |
|---|---|---|---|---|---|
| F-EVID-001-01 | 逐项移除AC证据、改候选SHA、伪造Oracle、SKIPPED、BLOCKED、空测试或旧run。 | 各例FAIL/BLOCKED且退出非0；不得汇总PASS。 | `MGW_RELEASE_EVIDENCE_INVALID` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | NO |
| F-EVID-001-02 | 测试在生成部分证据后中断，或Evidence文件hash被篡改。 | 不覆盖原run；候选不能发布；重跑使用新run并重验hash。 | `MGW_EVIDENCE_INCOMPLETE` | 业务受管范围等于 T0；审计/恢复记录追加并单独计量 | 使用新run_id重新执行 |

### Postconditions
POST-EVID-001-01：所有REQ/AC/test/evidence/gate引用完整；Gate不依赖自己通过的证据形成循环。  
POST-EVID-001-02：所有副作用在第 11 章范围内；失败输出保留 operation/stage/code，不含秘密。

### Invariants
INV-EVID-001-01：任一Required AC非PASS或证据不匹配候选版本，Release exit_code非0。  
INV-EVID-001-02：没有当前有效主体或明确所有权时，不扩大任何资源可读范围。

### Error Codes
`MGW_RELEASE_EVIDENCE_INVALID`；`MGW_EVIDENCE_INCOMPLETE`；输入缺失 `MGW_INPUT_INVALID`；实际契约冲突 `MGW_UPSTREAM_CONTRACT_ERROR`。更细业务错误见第 19 章映射，不能返回含敏感上游响应的自由字符串。

### Acceptance
A-EVID-001-01（正向及边界）；A-EVID-001-02（负向及禁止项）；A-EVID-001-03（失败注入与恢复）。完整定义见第 20 章。

### Evidence
required test：`TEST-A-EVID-001-01`、`TEST-A-EVID-001-02`、`TEST-A-EVID-001-03`。  
required artifact：各 AC 的 `result.json`、`assertions.json`、副作用清单、脱敏执行日志；UI 另有截图/DOM断言。  
required digest：本候选 source/config/fixture 与 pre/post managed/user-owned digest。  
required runtime output：第 20 章 Oracle 观测值、HTTP/code/state、执行命令及退出码。真实集成另满足第 26 章 GC，不以本条 fixture 代替。

---

# 11. Side-Effect Contract

归属：所有业务 REQ 的 Allowed/Forbidden Side Effects；REQ-TXN-001、REQ-SEC-001、REQ-EVID-001负责跨域证明。

## 11.1 副作用矩阵

YES=在本章限定范围内发生；NO=禁止；LIMITED=仅注明对象。网关缓存、审计和本地Evidence都是副作用，不能因为请求用GET就宣称无副作用。

| Operation | Consumer DB | Gateway DB | File Write | Network | Cache / Log | User Data | 腾讯/OA业务源 |
|---|---|---|---|---|---|---|---|
| 静态 analyze/schema diff | NO | NO | LIMITED：Evidence输出目录 | NO | 脱敏报告 | NO | NO |
| 配置保存 | 指定config/secret引用 | NO | 密钥库/审计 | NO | 审计 | 仅配置 | NO |
| 连接检查 | 诊断行 | 审计/来源健康 | NO | 固定Gateway只读接口 | YES | NO | 不修改源；只读探测 |
| 企业认证 start/redeem | 本地认证事务/结果投影/session；只读既有映射 | Gateway事务/认证结果/ms；不写member/alias | 加密会话 | 仅Gateway认证接口 | YES | 本地认证会话记录 | 不写企业身份管理/腾讯/OA |
| ms→mt / refresh | 加密bridge | token/审计 | 密钥受管存储 | Gateway | YES | 当前会话 | NO |
| 腾讯 OAuth / confirm | 关联事务 | 本人connection/token | Gateway私有密文 | Gateway/腾讯授权端点 | YES | 本人授权关系 | 仅授权，不创建/改会议 |
| 源查询/ensure内容 | 操作引用 | job/目录/snapshot/asset | Gateway缓存、Consumer私有staging | Gateway→腾讯只读 | YES | 受管来源副本 | NO |
| 查询结果/详情/权限检查 | 拒绝状态/审计 | 审计/来源健康缓存 | NO | Gateway | YES | 不改正文 | NO |
| 导入/索引 | operation/generation/meeting/source/文档映射 | 只读访问审计 | 受管文件 | Gateway/Collector/向量/批准embedder | YES | 明确选中来源的副本 | NO |
| 人工修订/补充/审核 | revision/来源/审核 | 权限审计 | 用户明确提交的补充文件 | OCR/批准模型/权限检查 | YES | 显式用户变更 | NO |
| 问答 | 当前回答与provenance | 权限审计 | NO，除已批准回答导出 | 受控向量/LLM/Gateway | YES | 新回答；不改原文 | NO |
| 本地退出/解绑 | session/binding/access锁 | 仅可调用对应token/logout；不撤销腾讯连接 | NO | Gateway会话端点 | YES | 当前本人会话 | NO |
| 隔离/清理 | access/generation/清理台账 | 权限审计 | 只删已证明受管生成物 | 向量按docId删除 | YES | 用户原件与修订保留 | NO |
| migration inventory/diff | NO | NO | 指定只读Evidence目录 | NO | 报告 | NO | NO |
| migration resolve | mapping证据缓存，不提交业务映射 | 只读/审计 | Evidence | Gateway只读 | YES | NO | NO |
| migration apply/rollback | 审批范围内行 | NO | T0受管范围与备份 | 受管向量/验证 | YES | 保留未授权修改的用户内容 | NO |
| cutover | last_applied部署/审计 | NO | 配置与恢复清单 | 健康与受控验证 | YES | NO | NO |
| acceptance fixture | 独立测试库 | 独立测试网关库 | 独立测试root | 明确的fixture服务 | YES | 仅fixture | NO |
| acceptance golden | 经批准测试用户范围 | 实际授权、查询、缓存 | 独立验收工作区/备份 | 真实服务 | YES | 经授权验收样本 | 源会议只读；OA NO |

## 11.2 只读的精确定义

`migration inventory/diff` 对产品DB、受管文件、用户文件、向量及Gateway均为零变更；只在指定Evidence目录写报告。`source query` 对腾讯源会议只读，但会写Gateway目录/作业/缓存。`access decision` 可以记录网关审计和来源健康，不能授予新权限。网络和日志均计入副作用清单。

若无法读取某受管范围，不能把其digest记为“未变化”；应记录 `SNAPSHOT_UNAVAILABLE` 并阻断需要该范围证明的验收。

---

# 12. Ownership Contract

归属：REQ-DATA-001、REQ-WORKSPACE-001、REQ-TXN-001、REQ-MIGRATE-001、REQ-CUTOVER-001。

## 12.1 Ownership Type 与范围

| 对象 | Type | Owner | 创建/更新/remove规则 |
|---|---|---|---|
| 腾讯应用密钥与OAuth token | WHOLE_RESOURCE | Gateway应用/连接 | Consumer不可创建副本；不通过本地清理撤销其他应用凭据 |
| 企业身份原始认证记录 | WHOLE_RESOURCE | 企业身份服务 | Gateway仅验证投影；Consumer不可伪造或覆盖 |
| Gateway身份alias | ROW | Gateway组织与canonical member | 仅Gateway身份管理流程创建/修改；Consumer只读、不补偿删除 |
| 本地binding/session | ROW | Local User | 本人或明确停用流程修改；撤销不改变用户角色 |
| 新受管原文文件 | GENERATED_ONLY | owner + import identity + generation | 仅受管写入器；不接收人工覆盖；remove核路径与digest |
| 用户补充原件/手工修订 | USER_OWNED | 有权业务owner | 只接受显式编辑/删除，不被上游同步或清理任务删除 |
| 格式化文档与向量 | GENERATED_ONLY | operation/generation | 只按台账document ID定位，不通过模糊前缀批量删除 |
| 普通工作区与非受管文档 | USER_OWNED | 原AnythingLLM owner | R2不改变其普通处理语义 |
| 旧未知归属会议文件 | USER_OWNED保护性处理 | 尚无可证明owner | PRESERVE + QUARANTINE + REPORT；不自动认领/删除 |
| 历史共享向量 | SHARED | 原workspaces | 能证明涉及受管源则门禁隔离；不能证明具体chunk时冻结受影响读取入口并报告，不做全库清除 |
| 配置 | FIELD / ROW | 指定管理员/部署owner | If-Match/CAS；secret与OCR分别所有权 |
| Evidence/T0备份 | FILE | 本次run与恢复流程 | 追加、只读归档；回滚失败不清理 |

## 12.2 用户修改后的处理

原文修改入口直接拒绝。对受管生成文件检测 `current_digest != last_applied_digest`，状态 DRIFTED，停止索引、替换和删除，保留字节与差异报告；不直接用上游重新生成覆盖。用户通过合法revision接口修改则产生新的 USER_OWNED revision，不归类为文件drift。

## 12.3 Drift 默认行为

| Drift | 检测 | 默认行为 |
|---|---|---|
| 受管源/生成文件被手工改写 | 文件字节hash不同 | BLOCK + PRESERVE + 报告，不force |
| 用户revision在迁移计划后变化 | row revision/hash不同 | BLOCK当前迁移run，重做快照和审批 |
| Owner映射变化 | binding revision/epoch不同 | BLOCK并重新授权，不继承旧allow |
| 契约或网络允许源变化 | contract/config digest不同 | readiness关闭，重新G1/G2 |
| 普通非受管资料变化 | 不属于本次ownership | PRESERVE，不越界管理 |

R2 不提供 `--force`、last-writer-wins 或“最佳努力覆盖”选项。

---

# 13. Hash / Identity Contract

归属：REQ-CONTRACT-001、REQ-IDENT-002、REQ-IMPORT-001、REQ-DATA-001、REQ-TXN-001、REQ-MIGRATE-001、REQ-EVID-001。

## 13.1 公共编码

`H(x)` 为 SHA-256，输出小写64位hex。字符串用UTF-8，无BOM；不做Unicode NFC/NFKC折叠，不改换行。`NUL` 是单字节0x00。身份/字段中出现NUL直接拒绝。`LP(x)=ASCII(byte_length(x))+":"+UTF8(x)`，解决多字段拼接歧义。

`CJSON` 是本版受限确定性JSON编码：对象键按Unicode code point升序递归排序；数组保持业务顺序，集合型数组在Schema明确排序后编码；无空白；字符串按JSON规则转义、非ASCII保持UTF-8；整数用十进制，不允许NaN/Infinity/浮点业务身份；时间在进入hash前转换为UTC到毫秒；缺失字段与显式null不相同，只有Schema指定null的字段才可null。跨语言固定测试向量作为G1契约，不能用各语言默认JSON编码冒充相同算法。

## 13.2 各摘要的准确范围

| 名称 | 定义 | 包含/排除 |
|---|---|---|
| contract_sha256 | H(导出契约文件原始bytes) | 包括全部契约内容；不是Git SHA；不包含另存的运行秘密 |
| enterprise_identity_key | H(`identity:v2`+NUL+LP(issuer)+LP(corp_id)+LP(employee_id)) | 不含姓名/邮箱/手机号；case敏感 |
| source_version | Gateway返回原字符串 | opaque，Consumer不重算、不截断；不是本地hash |
| selection_hash | H(`selection:v2`+NUL+CJSON(按recording_id排序的内容类型/范围/coverage)) | 包含每录制FULL或[from_ms,to_ms)；不含前端勾选顺序 |
| import_identity_key | H(`import:v2`+NUL+CJSON(§9.10全部身份字段)) | 包含owner/instance/org/connection/资源/version/selection/workspace；不含文件路径和生成时间 |
| request_hash | H(`request:v2`+NUL+LP(method)+LP(normalized_route)+CJSON(白名单业务请求)) | 包含窗口/选择；不含token、trace、时间戳、重试计数、幂等键本身 |
| content_sha256 | H(`content:v2`+NUL+CJSON(选中原生内容语义对象)) | 转写含recording/paragraph ID、speaker、time、text；纪要含原生minute/todo/模型/类型；不含抓取时间和URL |
| formatted_doc_sha256 | H(格式化文档UTF-8原始bytes) | 包括标题、source/provenance标记与实际文本；不含存储容器路径 |
| user_revision_sha256 | H(`revision:v2`+NUL+LP(meeting_local_id)+LP(revision)+LP(原样text)) | 包含用户文字、换行；编辑时间与姓名另作metadata |
| row_digest | H(CJSON(对应SOT表中本次操作前声明的业务字段)) | 不含审计/outbox/retry计数；字段清单必须在T0 manifest明确，不得事后缩小 |
| configuration_digest | H(CJSON(脱敏配置+secret引用ID/版本+allowlist+Gateway企业微信Consumer契约lock摘要)) | 不含secret明文或可离线猜密码的摘要；不因日志时间变化 |
| artifact_digest | H(artifact bytes) | 用于Evidence完整性；不把源正文hash当可分享内容 |

## 13.3 Tree Digest / Path Identity

规范相对路径用 `/`，拒绝绝对路径、`..`、空路径、NUL、符号链接。按UTF-8路径bytes升序；每条项包含 type、LP(relative_path)、mode、LP(size)、file_hash。目录项只记录类型和路径，不跟随链接。

```text
tree_digest = H("tree:v2" + NUL + concat(sorted(manifest_entry_bytes)))
manifest_entry_bytes = LP(type) + LP(relative_path) + LP(mode) + LP(size) + LP(file_sha256)
```

明确覆盖 managed、user_owned、business_source 三个独立范围；业务源不能抓取全腾讯库，golden只对授权的验收样本做前后只读字段与内容摘要。不存在的文件用 manifest 类型 `ABSENT`，不使用空文件hash伪装。

## 13.4 Token 与随机标识

token/state/nonce/opaque Cookie 使用密码学随机源，至少32随机字节；Gateway既有票据长度由其冻结契约保持，Consumer不得截短。日志身份使用单独密钥的 HMAC-SHA256 脱敏，不直接记录员工完整ID。登录密码既不持久化也不写hash入Evidence。

数据库事务/operation的UUID采用随机UUID；它们不是业务幂等identity。`vector_doc_id` 是文档关联ID，不能与底层分块vector ID互换。清理以固定文档ID和generation receipt核对，不能按标题猜文件。

---

# 14. Transaction Contract

归属：REQ-AUTH-001、REQ-DATA-001、REQ-IMPORT-001、REQ-TXN-001、REQ-REVOKE-001、REQ-MIGRATE-001、REQ-CUTOVER-001。

## 14.1 事务边界

| Transaction | TXN includes | TXN excludes | 发布点 |
|---|---|---|---|
| TX-IDENT | 单库内既有映射一致性校验、local session、epoch与认证结果投影 | Gateway认证兑换；不包含任何member/alias写入 | 本地可用session发布；上游结果需先验证；失败只回滚本地，不回滚Gateway认证 |
| TX-GW-IDENT | Gateway认证session、已消费票据状态；其身份管理由Gateway独立负责 | Consumer本地session与映射 | Gateway ms签发状态commit；Consumer不发起alias管理mutation |
| TX-CONFIG | 配置revision、密钥引用、启用意图 | DNS/HTTP诊断、外部密钥库非事务写入 | last_applied指针；孤儿secret版本只做清理 |
| TX-IMPORT-RESERVE | 幂等identity、operation、配额预占、generation | Gateway/Collector/向量/embedding网络 | 仅预占，不可检索 |
| TX-IMPORT-PUBLISH | 当前fence/epoch核验、文件/向量receipt引用、active_generation与meeting投影 | 先前已完成的外部写入 | 最后一个单库commit公开新代次 |
| TX-REVISION | 新revision、审核状态、活动业务指针 | 源获取、重新索引 | revision可见指针；索引另有代次 |
| TX-REVOKE | session撤销/epoch、access拒绝、policy_epoch、cleanup outbox | 向量/文件删除 | **先提交拒绝**，不因清理失败回滚拒绝 |
| TX-MIGRATE | 每run审批、mapping变更/当前状态、迁移item台账 | 向量清理/文件复制/备份写入 | 完整验证且所有受影响读路径隔离后切换 |

不持有数据库事务跨HTTP调用。不宣称两个数据库、文件系统和向量引擎构成分布式ACID事务。

## 14.2 Commit Order

```text
解析并验证主体/owner/契约/配额
→ 持久化 operation 与稳定identity（隔离业务预占）
→ 记录 T0 及明确作用域
→ 获取当前 source/version，创建私有 staging
→ Collector 以 operation_id + generation + stable_doc_id 写入
→ 取得或查询已落盘 receipt
→ embedding / 向量写入同一个 stable_doc_id
→ 校验文件hash、向量文档存在性与完整分块清单
→ 重查权限、当前epoch、generation fence和用户revision
→ 单库提交active_generation与本地业务引用
→ 暴露可检索状态
→ 追加验收证据；清理已确认的过期staging
```

待人工审核的operation停在WAITING_REVIEW；审核绑定精确revision，用户修改后必须新审核。没有审核不发布可检索活动代次。

## 14.3 T0 与 Failure Atomicity

`T0` 是本次业务mutation前，已声明受管业务行、受管发布文件/向量及用户拥有内容的完整快照。operation/审计/outbox/恢复台账是独立追加证据，不纳入“业务回滚为T0”比较；这个排除范围在预快照时固定，不能失败后再扩大。

成功回滚的定义：`AfterRollback(declared_managed_business_scope) == T0`，并且 `user_owned_digest_after == before`。未知外部结果或尚有受管孤儿未清理时不能使用ROLLED_BACK状态；状态为RECOVERY_REQUIRED/PENDING_CLEANUP，保证旧活动指针不变且新孤儿不可通过任何读取/检索路径访问。

源查询、身份兑换、OAuth授权属于外部已发生操作，Consumer不能伪称已回滚上游。它们通过原事务/作业引用恢复；不能为了达到本地T0删除或撤销未经用户授权的上游业务。

## 14.4 Rollback Failure

错误：`MGW_RECOVERY_REQUIRED` 或具体迁移/切换恢复错误。记录 `recovery-manifest.json`：operation/run、scope、T0摘要、已知/未知副作用、稳定docId、receipt、未恢复项、执行者、下一步命令与所需权限。

恢复备份在 `recovery_state != VERIFIED_CLEAN` 时没有自动过期清理。恢复核验完成后保留30天，再由数据owner显式批准删除；业务正文备份位于加密受控恢复库，不进入可公开Evidence包。备份恢复失败时维持维护或隔离，不删除备份、不重新开放旧无门禁服务。

## 14.5 Lease、Fencing 与重试预算

Consumer租约60秒、每20秒续租、到期前1秒停止新副作用；失租立即中止当前执行，过期fence提交为409。续租/重启不替换业务owner。Gateway沿用其实际job状态与租约配置，两个系统的job/fence不得互相替代。

纯GET读失败最多3次尝试，间隔1秒、2秒；429按受控Retry-After，最大等待60秒，不循环无限等待。Gateway source job用其job状态与run_after，不由Consumer重复新建替代。

无可靠幂等/receipt的POST在响应不明后不自动重发；具备§9.6幂等保证的源查询/OAuth创建，可使用原key恢复结果。401先验证主会话，最多进行一次串行业务token刷新；403/无权/错企业不重试。identity票据兑换与refresh结果不明时重新认证或查询原事务，不重放一次性凭据。

---

# 15. Conflict Contract

归属：REQ-CONFIG-001、REQ-IDENT-002、REQ-OAUTH-001、REQ-QUERY-001、REQ-CONTENT-001、REQ-IMPORT-001、REQ-DATA-001、REQ-TXN-001、REQ-MIGRATE-001。

| Conflict | Detection | Default Behavior | Error | Business Mutation |
|---|---|---|---|---|
| 同企业身份绑定不同local user | 三元组/反向唯一索引 | BLOCK | MGW_IDENTITY_BINDING_CONFLICT | 0 |
| 同local user擅自换Gateway member | binding revision与owner不一致 | BLOCK；显式解绑后重新准入，历史资料继续隔离 | MGW_IDENTITY_BINDING_CONFLICT | 0 |
| 同key同参 | request_hash相同 | RETURN_EXISTING | NONE | 不新增业务对象 |
| 同key异参 | request_hash不同 | BLOCK | MGW_IDEMPOTENCY_CONFLICT | 0 |
| 已VERIFIED同一导入identity | identity_key/active_generation | RETURN_EXISTING | NONE | 0 |
| 相同source版本但同段落ID异文 | version相同、content不同 | BLOCK | MGW_CONTENT_INCOMPLETE | 0发布 |
| 获取中source version变化 | version逐页比较 | STOP；新版本重新完整获取 | MGW_CONTENT_CHANGED | 0发布 |
| 配置revision或业务revision过期 | If-Match/CAS | BLOCK；保留客户端未保存编辑 | MGW_CONFIG_REVISION_CONFLICT / MGW_CONTENT_REVISION_CONFLICT | 0 |
| 当前policy_epoch变化 | 最终发布CAS不匹配 | BLOCK | MGW_WORKSPACE_POLICY_CONFLICT | 0发布 |
| 租约竞争/陈旧fence | owner/deadline/fence不符 | BLOCK旧执行 | MGW_TRANSACTION_CONFLICT | 0旧提交 |
| 同路径同bytes但owner不同 | manifest ownership不符 | BLOCK | MGW_TRANSACTION_CONFLICT | 0 |
| 同路径不同bytes或用户drift | current != last_applied | BLOCK + PRESERVE | MGW_MIGRATION_DRIFT | 0覆盖 |
| 历史映射多候选或无创建/归属证明 | identity/owner证明不足 | QUARANTINE + REPORT | MGW_MIGRATION_MAPPING_UNPROVEN | 只写隔离标记 |
| 合法源更新与用户修订并存 | base source不同 | 保留用户revision，新源独立记录 | NONE；需要新审核 | 仅新增源版本 |

不提供last writer wins、隐式merge、覆盖force。返回existing不会使旧失效权限恢复。

---

# 16. Compatibility / Migration

归属：REQ-MIGRATE-001、REQ-CUTOVER-001、REQ-COMPAT-001、REQ-REVOKE-001。

## 16.1 Existing State

旧会议业务使用本地整数meeting/connection ID、腾讯外部ID、review/retrievalStatus；原导入activeKey以本地connection与externalId组合。R1又增加员工bridge、资产导入identity/generation和受限workspace。[SRC-11、12] R2复用这些结构，新增必要字段和关联，不重新生成local meeting IDs。

本版不切换Consumer数据库引擎。Gateway继续其现有独立数据库和缓存Owner；Consumer迁移不直接操作Gateway数据库，只调用受控只读接口取得映射证明。

## 16.2 迁移序列

| 步骤 | 行为 | 必需证明 | 默认失败结果 |
|---:|---|---|---|
| 1 detect | inventory旧配置、会议、来源、revision、文档、向量、工作区和旧worker | 全范围manifest、计数、clean/dirty、旧配置摘要 | 缺范围即BLOCKED |
| 2 classify | 分类为KNOWN_MAPPED、KNOWN_UNMAPPED、UNKNOWN_OWNER、DRIFTED、ORPHAN_GENERATED | 每项source namespace/owner/provenance | unknown保留隔离 |
| 3 resolve | 通过Gateway取得resource映射 | gateway_instance/org/connection/实际upstream identity/owner证明 | 多候选或仅标题/时间相似不映射 |
| 4 plan | 固定预期changes与T0、逐项逆操作 | plan_digest、source_digest、user_owned_digest、secret处置清单 | 未批准不apply |
| 5 approve | 数据owner批准具体run与范围 | approver、timestamp、plan_digest | 不接受整库模糊授权 |
| 6 stage | 维护模式、停止旧导入、隔离受影响读取/共享向量入口、备份 | in-flight排空、无旧worker、备份恢复测试 | 维护状态保留 |
| 7 migrate | additive schema、可信映射、owner和provenance、受限索引引用 | 每item状态/逆操作/receipt | 失败项不公开 |
| 8 preserve | 保持localId、用户revision/补充文件、历史引用；无法证明的保留字节 | 用户字节hash前后相等 | 任何差异即失败 |
| 9 cutover | 原页面/BFF指向单一Gateway runtime | 配置revision、build、实际流量 | Gateway失败不fallback |
| 10 verify | A/B读取、历史检索、重复导入、普通workspace与回滚演练 | 第26章GC、G5 evidence | 非PASS不对生产开放 |
| 11 remove | 清理明确受管孤儿和本应用旧活跃腾讯凭据引用 | owner证明、备份保留策略、审批 | 无证明不删除 |

## 16.3 Unknown Ownership

所有无法证明所有权、源命名空间或网关映射的历史记录设置 `migration_state=QUARANTINED`，保留原始数据和用户内容，拒绝新读取/检索/导出。对于无法定位源chunk的旧共享索引，冻结涉及工作区的会议来源读取，出具修复清单；不能把“没有映射”解释为普通文档继续放行，也不能全向量库清空。

人工解除隔离需补齐证据、重新审批mapping、按当前Gateway权限核验，然后单独发布；不提供管理员一键忽略所有隔离。

## 16.4 容量、索引与重复导入

现有200场/季度按本部署未删除本地会议业务记录计数，季度以Asia/Shanghai会议开始时间计算；新source版本/重新索引不重复占会议数。原有配额预占计入并发导入，不能先检查后无锁写入。不同owner合法导入同一上游会议时不共用个人内容容器，不因物理来源相同扩张访问；新本地业务记录计入部署额度。

10场/问答、转写选中范围合计3小时、100,000,000 bytes/文件、20文件/会议、500,000,000 bytes/会议保持。OCR默认120000ms、范围5000–300000ms；单文件失败继续后续任务。版本化受管代次与临时staging不能通过无限重试绕过存储治理：每operation最多保留1个未完成代次，超出前先恢复/清理。

## 16.5 旧凭据退出与回滚

旧腾讯Secret从活跃Consumer配置退出，迁移到不被runtime加载的受控恢复备份；新请求无法引用。稳定期和恢复保留按§14.4处理；只清理本应用副本，不未经授权轮换其他应用正在使用的腾讯密钥。

回滚目标仅允许已实施相同受管读取门禁的上一安全构建，或进入维护模式并恢复T0。旧无门禁构建不能读取R2数据库/索引；在备份恢复失败时继续维护，保留run/backup，禁止用直连“临时救急”。

---

# 17. External Dependency Contract

归属：REQ-CONTRACT-001、REQ-IDENT-001、REQ-PROVIDER-001、REQ-SEC-001、REQ-EVID-001。

| Dependency | Immutable identity / version | Required APIs / paths | Fallback / offline | Failure behavior |
|---|---|---|---|---|
| AnythingLLM | 基线固定SHA见§1；候选构建另记Git SHA与dirty patch摘要 | 指定分支现有Meetings/R1模块 | 不用另一个未经审查分支代替 | 版本不符重新差异检查 |
| Meeting Gateway | 基线 `d6bf6465…`；实施新增功能后候选SHA重新固定 | §9.3 EXISTING与§9.4/9.6 NEW | 无Consumer腾讯直连fallback | 401/403/202/契约错误分别处理 |
| Gateway企业微信认证 | EXTERNAL_REQUIRED；Gateway owner提供Consumer契约lock、真实发行方/企业与不可变部署版本 | §9.4.3发起/兑换/状态及注册Consumer回调 | 不要求AnythingLLM另建身份服务；无模拟登录或自持WeCom Secret替代 | 无依赖时MGW_IDENTITY_NOT_READY；不通过企业微信验收 |
| 企业微信 | 外部托管平台；准入应用与配置指纹进入deployment manifest | 由Gateway负责真实企业微信认证；内部实现不向Consumer暴露 | 不改为腾讯OAuth；无密码收集模拟 | 取消/外企业/成员停用有确定失败 |
| 腾讯会议 | 外部托管平台；Gateway应用/连接/能力证据 | Gateway实际已验证只读接口与OAuth | 不绕开权益限制；不伪造summary/ASR | 对无权益、未生成、无权、源移除分别记录 |
| Collector | 候选源码/镜像digest，managed协议版本 | 受管operation写入、receipt查询、删除 | 不退回非幂等raw-text随机写入 | 未明结果进入恢复 |
| 向量引擎 / embedder | 现有部署版本与镜像digest | 稳定docId写/查/删；声明的命名空间 | 不更换provider以跳过失败 | 未核验不发布；失权先门禁 |
| OCR | 原部署服务版本、固定origin/schema | 原文档解析接口，原token与timeout | 本地原允许的非OCR解析可继续；不伪造识别文本 | 单文件失败可重试，不reset整任务 |
| LLM | 实际模型服务ID、版本/配置摘要、批准出站origin | 已有AnythingLLM问答接口 | 不自动发往未批准模型 | 资料未获权时调用数为0；生成错误不改原文 |
| TLS/DNS/Storage/DB | 部署manifest固定CA、allowlist、数据库类型与备份位置 | 宿主与容器可达、私有staging/恢复目录 | 不关闭TLS；不从容器localhost猜宿主机 | readiness逐项失败；受管读取fail-closed |

托管平台不存在可由本项目固定的Git提交；用应用配置指纹、接口文档版本、请求/响应契约和本次运行时间绑定证据，不杜撰平台版本。

**依赖接入完成条件：** `meeting-gateway-wecom-consumer.lock.json` 和Gateway新增接口契约均通过owner签约、合成契约验证及真实认证/读取样本验证。没有这些材料时，阶段结果是BLOCKED；开发方不能填一个看似合法的URL/版本号把依赖状态改为PASS。

安全参考仅补充协议设计：OAuth回跳精确匹配、PKCE、重放防护参考RFC 9700。[SRC-16] 该标准不是你们企业身份服务已经支持某接口的证明。企业微信官方页面本轮读取未成功，因此本PRD不把未读取到的具体扫码API字段列为现有事实；由Gateway Owner以Consumer契约lock附实际已核验文档与配置。

---

# 18. Security Contract

归属：REQ-IDENT-001/002、REQ-AUTH-001、REQ-WORKSPACE-001、REQ-ACCESS-001、REQ-RAG-001、REQ-REVOKE-001、REQ-SEC-001。

## 18.1 Threat / Control / Acceptance

| Threat | Control | Acceptance |
|---|---|---|
| 企业登录伪造、跨企业、错issuer | 后台兑换、固定发行方/企业/audience/nonce、准入映射 | A-IDENT-001-02、A-IDENT-002-02 |
| state/票据重放、登录CSRF | 300秒prelogin、一次票据60秒、PKCE S256、Origin与CSRF、事务CAS消费 | A-IDENT-001-02/03 |
| 错误本地映射/管理员提权 | 既有唯一映射校验、independent_local_user_creation=false + gateway_user_projection_sync=true、本地角色独立；Consumer不写身份绑定 | A-IDENT-002-01/02/03 |
| 主会话/bridge跨人复用 | session registry、epoch、JWT/opaque bridge绑定、900秒上限 | A-AUTH-001-01/02、A-REVOKE-001-01 |
| Credential exposure | AES-256-GCM、response白名单、No-store、redact、日志不含callback query/请求body | A-AUTH-001-01、A-SEC-001-01/02、A-OBS-001-02 |
| SSRF / arbitrary proxy | 固定origin+route+method；结构化参数；逐连接DNS/IP检查；拒绝重定向 | A-SEC-001-02 |
| 合法内网接入被误拒或私网被任意放开 | 仅运维配置准确FQDN+CIDR；验证CA与证书主机名；禁止metadata/link-local；不接受浏览器CIDR | A-SEC-001-01/02 |
| Path traversal / symlink | 受管root realpath校验、拒绝链接、原子创建、不信文件名、写前/删除前核对owner/digest | A-SEC-001-02、A-TXN-001-02 |
| 任意执行/提示注入 | 会议正文和模型输出作为数据；不执行shell、不由内容增加工具/审批/授权 | A-SEC-001-02、A-COMPAT-001-02 |
| IDOR / data leakage | 当前主体、Gateway具体资源动作、source mapping、本地owner/workspace交集 | A-ACCESS-001-01/02/03 |
| 管理员或global key扩大权限 | 管理配置不授正文read；无当前员工principal的入口拒绝受管资源 | A-WORKSPACE-001-01/02、A-RAG-001-02 |
| RAG旁路 | pinned/parsed/history/vector/citations/export/TTS均纳入门禁；LLM前二次检查 | A-RAG-001-01/02/03 |
| 撤销与读的竞态 | online决策、发送/模型前复查；流式最长5秒复核一次；失权立即停止后续输出 | A-ACCESS-001-03、A-RAG-001-03 |
| 清理失败放行 | 先提交access拒绝再清理；pending cleanup保持不可读 | A-REVOKE-001-03 |
| Dependency provenance | 固定source SHA/镜像/lock/契约digest，运行前核验 | A-CONTRACT-001-01/02/03、A-EVID-001-02 |
| 越界写/迁移误删 | inventory/T0/plan批准、exact ownership、未知保留隔离、无force | A-MIGRATE-001-02/03、A-CUTOVER-001-03 |

## 18.2 全读取路径登记

Required清单：旧`/api/meetings`列表、详情、source segments/file、job详情/重试、会话列表/历史、问答、引用源查看、补充/审核/reindex；Workspace常规chat/stream、API同步/stream、OpenAI-compatible、public embed、独立vector-search、pinned/parsed读取、全局文档picker/raw/download、历史导出、会话TTS、文档move/copy/sync、受管生成文件任何下载入口。

每个入口登记 `route/symbol → actor来源 → resource resolver → access gate → context/response sink → 对应测试`。无法提供真实员工主体的路径对受管资料返回拒绝；不影响普通非受管内容。发现新增入口不在清单，read-path coverage非100%，G4失败。

本地问答将每个回答绑定其来源依赖集合和scope digest。历史答案、缓存摘要以及含源内容的用户问句在服务器后续读取/回填时也执行依赖门禁；未知历史依赖按受影响会话隔离。已经送达浏览器、下载至终端或发给已批准模型的字节无法撤回，验收只证明停止后续读取/生成/传输，不宣称擦除外部已知内容。

## 18.3 性能与安全边界

LOCAL_ONLY是用户确认的本地读取策略，不是继续远端拉取的降级通道。在线Gateway实时复查/5秒流式复核条款仅约束GATEWAY_ENABLED；LOCAL_ONLY以本地可验证会话、owner/ACL、撤销和隔离状态复核，不承诺未联网期间观察新的上游权限变更。无本地有效主体、已知撤销或未知归属始终拒绝。

会话/status本地处理预算：fixture稳定网络下100并发请求，服务端非上游时间p95不超过300ms；普通Gateway请求默认10秒超时、上限30秒。未满足性能指标不允许通过缓存allow或移除权限检查达成。

内存/内容边界：Consumer单次解码响应最大100,000,000 bytes；单个内容资产最多10000页；超过边界明确返回 `MGW_CONTENT_LIMIT`，不截断为成功。下载/原文响应采用受控流式或有限大小缓冲；大文件不整体读入浏览器Blob作为默认实现。远端音视频一般下载在本版关闭。

Token/密码/全文日志canary泄漏数目标为0；非owner正文返回bytes目标为0；当前请求失败时不把数据送入LLM，调用次数目标为0。这些是硬验收指标，不是仅作监控参考。

---

# 19. Observability

归属：REQ-OBS-001、REQ-UI-001/002/003、REQ-QUERY-001、REQ-TXN-001、REQ-EVID-001。

## 19.1 阶段与最小事件

阶段枚举：`ANALYZE, CONTRACT, IDENTITY, BIND, EXCHANGE, CONNECT, QUERY, FETCH, PROJECT, REVIEW, INDEX, ACCESS_CHECK, GENERATE, MIGRATE, CUTOVER, ROLLBACK, REMOVE, CHECK`。

每次事件required：`event_id`、`operation_id`、`stage`、`status`、`timestamp`、`consumer_sha`、`gateway_sha`、`gateway_instance_id`、`resource_ref_hash`、`actor_ref_hash`、`attempt`、`result`、`error_code`（无错误为null）、`request_id`、`upstream_trace_id`（无上游为null）。stage-specific可追加经过schema允许的job_id/generation/fence；禁止任意request body。

状态为STARTED/SUCCEEDED/FAILED/WAITING/RETRYING/BLOCKED/RECOVERY_REQUIRED；日志SUCCEEDED表示当前阶段，不自动表示整个operation已VERIFIED。

## 19.2 错误类别、HTTP 与用户动作

| Error / 类别 | HTTP | 重试规则 | 页面文案 / recovery_action |
|---|---:|---|---|
| MGW_INPUT_INVALID / QUERY_SCOPE_INVALID / CONTENT_LIMIT | 422；文件大小原兼容413 | 修改输入后新提交 | 参数或范围不符合要求；EDIT_INPUT |
| MGW_IDENTITY_NOT_READY / RUNTIME_NOT_READY | 503 | 依赖修复后重查 | 企业认证或会议服务尚未就绪；CONTACT_ADMIN |
| MGW_IDENTITY_ASSERTION_INVALID | 401/403按身份错误类别 | 不重放票据 | 认证结果无效或企业不匹配；REAUTHENTICATE |
| MGW_BUSINESS_AUTH_REQUIRED / LOCAL_SESSION_REVOKED | 401 | 主会话有效时最多一次串行refresh；否则新登录 | 需要重新认证；REAUTHENTICATE |
| MGW_RESOURCE_NOT_ACCESSIBLE / RAG_ACCESS_DENIED | 404；明确自身动作不足用403 | 不自动重试 | 无法访问该资源；REQUEST_PERMISSION |
| MGW_ACCESS_REVOKED / RAG_ACCESS_REVOKED | 403 | 重新获得授权后新请求 | 访问权限已失效；REAUTHORIZE |
| MGW_CONFIG_REJECTED / SECURITY_REJECTED | 403/422 | 修正配置或输入；不降级 | 请求被安全策略拒绝；CONTACT_ADMIN/EDIT_INPUT |
| MGW_CONFIG_REVISION_CONFLICT / CONTENT_REVISION_CONFLICT | 409 | 获取最新revision后显式提交 | 内容已发生变化；RELOAD_AND_REVIEW |
| MGW_IDENTITY_BINDING_CONFLICT / IMPORT_SCOPE_CONFLICT / IDEMPOTENCY_CONFLICT | 409 | 不自动覆盖；核对身份或新操作 | 绑定/操作存在冲突；REVIEW_CONFLICT |
| MGW_OAUTH_CONFIRM_DENIED | 403 | 不确认他人/错企业连接 | 无法确认此连接；REAUTHORIZE |
| MGW_QUERY_RECOVERY_REQUIRED / OAUTH_RECOVERY_REQUIRED / IMPORT_RECOVERY_REQUIRED | 202（操作已记录） | 查询原operation，不新建替代 | 正在恢复结果；POLL_OPERATION |
| MGW_SOURCE_NOT_READY / CONTENT_NOT_READY | 202仅当有可查询job；否则409 | 有job则轮询 | 内容仍在处理；WAIT_SOURCE |
| MGW_CONTENT_INCOMPLETE / CONTENT_CHANGED / QUERY_ACCESS_CHANGED | 409/502按源数据错误 | 新版本从头完整读取；不拼页 | 内容不完整或已更新；REFETCH_VERSION |
| MGW_ACCESS_STATE_UNAVAILABLE / UPSTREAM_UNAVAILABLE | 503 | 仅按§14.5读重试；fail-closed | 服务不可用，资料读取已暂停；RETRY_READ |
| MGW_UPSTREAM_CONTRACT_ERROR / CONTRACT_DRIFT | 502/503 | 关闭能力并重新契约验证 | 接口契约不匹配；CONTACT_ADMIN |
| MGW_WORKSPACE_POLICY_DENIED / POLICY_CONFLICT | 403/409 | 不放宽owner-only；重新核当前epoch | 受限工作区不允许该操作；REVIEW_POLICY |
| MGW_CLEANUP_PENDING / RECOVERY_REQUIRED | 202操作状态；读取仍403/503 | 幂等恢复/清理 | 数据已锁定，清理或恢复中；POLL_OPERATION |
| MGW_MIGRATION_DRIFT / MAPPING_UNPROVEN / CUTOVER_BLOCKED | 409或CLI非0 | 新证据/审批；无force | 迁移已阻断；REVIEW_MIGRATION |
| 其他明确COMMIT_FAILED / RECOVERY_REQUIRED / AUDIT_DELIVERY_PENDING | 503或已记录operation 202 | 对应§14，不重放业务副作用 | 根据operation恢复动作显示 |
| RATE_LIMITED | 429 | Retry-After，预算受§14.5限制 | 请求过于频繁；RETRY_AFTER |

浏览器model保留`code,status,retryable,recovery_action,request_id`；不能丢成只有message的Error。已存在旧业务error envelope按路径显式解析后归一化。

## 19.3 五轴状态呈现

| 轴 | 状态与主按钮 |
|---|---|
| 系统配置 | NOT_CONFIGURED→联系管理员；NOT_READY→查看分项原因；READY→不代表已授权 |
| 企业身份 | NOT_AUTHENTICATED→企业微信登录；PROFILE_REQUIRED→拉取Gateway用户信息；失败需重新认证，无本地开户/绑定按钮；VERIFIED→展示当前身份；EXPIRED→重新认证 |
| Gateway业务会话 | AUTH_REQUIRED→建立本人会话；BOUND→显示期限；PERMISSION_MISSING→申请权限 |
| 腾讯连接 | NOT_AUTHORIZED→授权腾讯会议；PENDING→等待；PENDING_CONFIRMATION→本人确认；ACTIVE→进入目录；CORP_MISMATCH→更换正确账号 |
| 内容/本地处理 | SOURCE_PENDING→查询作业；WAITING_REVIEW→审核；INDEXING→显示进度；AVAILABLE→仅获权后问答；ACCESS_DENIED→锁定 |

诊断区按“配置、网络可达、客户端认证、契约匹配”四项显示；员工连接/权限另列。管理员拥有配置管理权不代表可读取员工正文。

## 19.4 性能与安全观测

指标：各阶段延迟、源job状态分布、token刷新冲突、查询完整率、导入重复抑制数、active generation数量、stale fence拒绝数、access拒绝/不可用数、source revocation observed时间、清理积压、旧直连请求数、canary泄漏数。指标label只含低基数类别，不含会议标题、员工明文ID或全文。

---

# 20. Acceptance Design Standard

**范围说明：本章原有78个AC是完整R2验收基线；AUTH_LOCAL_SEARCH阶段的Required集合仅为§4.6三个PHASE case。导入AC及依赖导入的流程均延后，不用其未执行状态阻断本阶段，也不得称全量R2已PASS。**

归属：全部Requirement；Evidence实现与非循环Gate由REQ-EVID-001负责。

## 20.1 执行规则

每个 AC 使用固定 `TEST-<AC-ID>`，必须执行正向、负向或failure对应的参数化case，不允许空test suite。每个AC的case清单写入对应fixture manifest并在G1评审时固定digest；第21、22、23章是其必需输入，不是可选参考。每个case至少有一个实际assertion；expected来自固定fixture/契约而非被测程序输出。

以下命令和脚本是 **NEW 交付要求**，本次文档生成没有执行这些产品测试。命令入口由REQ-EVID-001实现：

```text
node scripts/meeting-gateway-r2/run-acceptance.cjs --id <AC-ID> --mode fixture --out "$EVIDENCE_ROOT"
node scripts/meeting-gateway-r2/run-acceptance.cjs --golden <GC-ID> --mode golden --profile "$GOLDEN_PROFILE" --out "$EVIDENCE_ROOT"
```

`--mode fixture` 使用隔离测试DB、私有测试root和受控模拟上游；必须使用实际Consumer模块装配和真实HTTP解析，不以mock整个被测函数跳过逻辑。`--mode golden` 使用批准的真实员工与服务，不允许环境变量将其降级fixture。

## 20.2 Oracle 观测来源

除明确测试“未认证/过期/未准入”的case外，A/B都是已通过本地登录、企业准入和本人Gateway bridge的两个独立员工。B缺少的是A的资源权限，不是缺少登录凭据；资源隔离测试不能用所有请求都401代替。未准入员工单独记为C；管理员负向样本也要区分具有效本人会话的非owner管理员与不具员工主体的global key。

下列Oracle为JavaScript布尔表达式形式；变量来自 `assertions.json` 的可追溯观测：HTTP原始状态与脱敏body、实际DB查询结果、文件/向量manifest、出站请求计数、DOM状态及真实模块调用记录。每个观测记录 `name,type,value,source_artifact,source_locator`，不允许只有人为填写的true。

`*_digest_before/after` 按§13计算；`*_count` 由实际记录计数；`*_equal/valid/matches` 需附逐项差异列表；`requested_negative_cases/expected_dependency_count/required_*_total` 来自固定manifest且大于0。总assertion数为0、没有实际网络/DB/DOM证据、对空集合计算“全部满足”均失败。

Oracle提及HTTP、error_code、state时由实际结果解析；跨源身份/权限的fixture还必须在第26章对应GC做真实重复验证。单元测试的绿色不证明腾讯生产权限或企业身份依赖可用。

## A-CONTRACT-001-01 — 固定两仓契约、消除占位与字段歧义：正向与边界

### Requirement Refs
`REQ-CONTRACT-001`；对应 `REQ-CONTRACT-001-M1`；共同约束第 11–19、21–24 章。

### Given
固定两仓构建，真实样本 envelope 与 §9.3 一致。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
导出并比较契约与 mapping fixtures。

### Then
生成可复查契约包；ms/mt、opaque ID、expires 映射均匹配。

### Oracle
```text
contract_digest_match === true && mapping_mismatch_count === 0 && undeclared_endpoint_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CONTRACT-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CONTRACT-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CONTRACT-001-01/result.json
assertions: <run_id>/A-CONTRACT-001-01/assertions.json
side_effect_manifest: <run_id>/A-CONTRACT-001-01/side-effects.json
evidence_id: EVID-A-CONTRACT-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CONTRACT-001-02 — 固定两仓契约、消除占位与字段歧义：负向与禁止项

### Requirement Refs
`REQ-CONTRACT-001`；对应 `REQ-CONTRACT-001-M2`；共同约束第 11–19、21–24 章。

### Given
给定仅格式合法但字节摘要错误的契约；或 ms 字段缺失；或未知状态。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
尝试初始化 Client 或解析响应。

### Then
阻断；不建立可用业务会话，不返回空列表。

### Oracle
```text
error_code === "MGW_UPSTREAM_CONTRACT_ERROR" && usable_sessions_delta === 0 && success_dto_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CONTRACT-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CONTRACT-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CONTRACT-001-02/result.json
assertions: <run_id>/A-CONTRACT-001-02/assertions.json
side_effect_manifest: <run_id>/A-CONTRACT-001-02/side-effects.json
evidence_id: EVID-A-CONTRACT-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CONTRACT-001-03 — 固定两仓契约、消除占位与字段歧义：失败注入与恢复

### Requirement Refs
`REQ-CONTRACT-001`；对应 `REQ-CONTRACT-001-M3`；共同约束第 11–19、21–24 章。

### Given
导出到 staging 后，契约文件被改写，last_applied 存在。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
在启用前重新计算 hash。

### Then
保留旧契约，候选 readiness 关闭；生成 drift 报告。

### Oracle
```text
error_code === "MGW_CONTRACT_DRIFT" && last_applied_digest_after === last_applied_digest_before && readiness === false
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CONTRACT-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CONTRACT-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CONTRACT-001-03/result.json
assertions: <run_id>/A-CONTRACT-001-03/assertions.json
side_effect_manifest: <run_id>/A-CONTRACT-001-03/side-effects.json
evidence_id: EVID-A-CONTRACT-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-PROVIDER-001-01 — 网关提供安全状态投影、权限判定和查询快照：正向与边界

### Requirement Refs
`REQ-PROVIDER-001`；对应 `REQ-PROVIDER-001-M1`；共同约束第 11–19、21–24 章。

### Given
A有一个ACTIVE连接与两份可读资产；源查询真实返回M1、M2。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
A调用三个新增API并重发同参查询键。

### Then
仅返回A范围；源snapshot为M1、M2；源查询只创建一次。

### Oracle
```text
visible_foreign_items === 0 && snapshot_ids_equal_fixture === true && query_jobs_for_key === 1
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-PROVIDER-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-PROVIDER-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-PROVIDER-001-01/result.json
assertions: <run_id>/A-PROVIDER-001-01/assertions.json
side_effect_manifest: <run_id>/A-PROVIDER-001-01/side-effects.json
evidence_id: EVID-A-PROVIDER-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-PROVIDER-001-02 — 网关提供安全状态投影、权限判定和查询快照：负向与禁止项

### Requirement Refs
`REQ-PROVIDER-001`；对应 `REQ-PROVIDER-001-M2`；共同约束第 11–19、21–24 章。

### Given
B提交A的job/asset/connection；或请求体伪造member。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
调用投影/权限/查询结果。

### Then
拒绝未知字段或返回不可访问；无正文与跨人状态。

### Oracle
```text
denied_cases === requested_negative_cases && foreign_content_bytes === 0 && grants_delta === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-PROVIDER-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-PROVIDER-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-PROVIDER-001-02/result.json
assertions: <run_id>/A-PROVIDER-001-02/assertions.json
side_effect_manifest: <run_id>/A-PROVIDER-001-02/side-effects.json
evidence_id: EVID-A-PROVIDER-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-PROVIDER-001-03 — 网关提供安全状态投影、权限判定和查询快照：失败注入与恢复

### Requirement Refs
`REQ-PROVIDER-001`；对应 `REQ-PROVIDER-001-M3`；共同约束第 11–19、21–24 章。

### Given
access或capability来源依赖不可达，已有上一轮allow。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
再次判定。

### Then
输出不可用/UNKNOWN，不能返回缓存allow；源作业保留可诊断状态。

### Oracle
```text
error_code === "MGW_ACCESS_STATE_UNAVAILABLE" && allow_count === 0 && fabricated_ready_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-PROVIDER-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-PROVIDER-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-PROVIDER-001-03/result.json
assertions: <run_id>/A-PROVIDER-001-03/assertions.json
side_effect_manifest: <run_id>/A-PROVIDER-001-03/side-effects.json
evidence_id: EVID-A-PROVIDER-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-IDENT-001-01 — 真实企业微信认证与 Gateway 身份 facade：正向与边界

### Requirement Refs
`REQ-IDENT-001`；对应 `REQ-IDENT-001-M1`；共同约束第 11–19、21–24 章。

### Given
Gateway真实认证接口或等契约fixture给出A的active企业身份；nonce/issuer/corp/audience正确。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
从start经callback到后台redeem。

### Then
身份被验证，发放仅服务端可见的ms_；浏览器只持本地结果票据。

### Oracle
```text
identity_method === "wecom" && verified_employee === fixture_employee && gateway_tokens_in_browser === 0 && redemption_count === 1
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-IDENT-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-IDENT-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-IDENT-001-01/result.json
assertions: <run_id>/A-IDENT-001-01/assertions.json
side_effect_manifest: <run_id>/A-IDENT-001-01/side-effects.json
evidence_id: EVID-A-IDENT-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-IDENT-001-02 — 真实企业微信认证与 Gateway 身份 facade：负向与禁止项

### Requirement Refs
`REQ-IDENT-001`；对应 `REQ-IDENT-001-M2`；共同约束第 11–19、21–24 章。

### Given
分别给出重放票据、不同state、PKCE错误、外企业、不同audience、自报userid。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
完成登录回跳。

### Then
各例拒绝；不创建可用本地会话或绑定。

### Oracle
```text
all_attack_cases_denied === true && usable_sessions_delta === 0 && bindings_delta === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-IDENT-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-IDENT-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-IDENT-001-02/result.json
assertions: <run_id>/A-IDENT-001-02/assertions.json
side_effect_manifest: <run_id>/A-IDENT-001-02/side-effects.json
evidence_id: EVID-A-IDENT-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-IDENT-001-03 — 真实企业微信认证与 Gateway 身份 facade：失败注入与恢复

**2.0.2本阶段覆盖规则：本case的兑换响应丢失分支以PHASE-LOCAL-02为唯一预期；不再要求自动恢复原兑换。远端取数为0，有效本地会话可检索本地获权资料；无本地会话不能登录，显式重新扫码才恢复远端。对应Oracle按响应丢失与依赖未部署两个case分别验证，不能以一个状态替代两者。**

### Requirement Refs
`REQ-IDENT-001`；对应 `REQ-IDENT-001-M3`；共同约束第 11–19、21–24 章。

### Given
身份兑换请求已发出但响应丢失；或实际身份依赖未部署。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
停止自动重放兑换；验证LOCAL_ONLY本地检索及远端禁止；再测试用户显式重新扫码。

### Then
兑换结果丢失进入LOCAL_ONLY；不重放票据或获取腾讯会议数据；有效本地会话按本地权限检索，无本地会话不登录成功；依赖未部署单独NOT_READY。

### Oracle
```text
identity_exchange_replay_count === 0 && fake_login_count === 0 && (case_kind === "REDEEM_RESPONSE_LOST" ? remote_access_mode === "LOCAL_ONLY" && remote_tencent_data_requests === 0 && local_search_matches_local_acl === true : state === "NOT_READY")
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-IDENT-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-IDENT-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-IDENT-001-03/result.json
assertions: <run_id>/A-IDENT-001-03/assertions.json
side_effect_manifest: <run_id>/A-IDENT-001-03/side-effects.json
evidence_id: EVID-A-IDENT-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-IDENT-002-01 — Gateway用户信息同步、本地投影与可撤销登录消费：正向与边界

### Requirement Refs
`REQ-IDENT-002`；对应 `REQ-IDENT-002-M1`；共同约束第 11–19、21–24 章。

### Given
A在Gateway有已验证企业用户，Consumer尚无其投影；另有同名不同主体B；Gateway返回当前用户profile，Consumer不参与alias写入。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
首次扫码认证后拉取Gateway用户信息，再重复扫码；检查稳定主体对应的本地投影和Gateway身份管理写请求。

### Then
首次创建一份Gateway用户投影，重复登录复用原local ID并刷新profile；无本地独立开户步骤；B不因同名并入A。

### Oracle
```text
local_user_projection_delta_on_first_login === 1 && local_user_projection_delta_on_repeat_login === 0 && same_subject_local_id_reused === true && profile_fetched_from_gateway === true && gateway_identity_management_write_count === 0 && local_role === "default"
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-IDENT-002-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-IDENT-002-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-IDENT-002-01/result.json
assertions: <run_id>/A-IDENT-002-01/assertions.json
side_effect_manifest: <run_id>/A-IDENT-002-01/side-effects.json
evidence_id: EVID-A-IDENT-002-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-IDENT-002-02 — Gateway用户信息同步、本地投影与可撤销登录消费：负向与禁止项

### Requirement Refs
`REQ-IDENT-002`；对应 `REQ-IDENT-002-M2`；共同约束第 11–19、21–24 章。

### Given
B伪造A的本地映射；同名未准入员工登录；上游返回admin角色。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
执行认证结果消费及本地映射校验。

### Then
冲突拒绝、未准入不建会话、local role不提升。

### Oracle
```text
binding_conflicts_rejected === true && unapproved_sessions_delta === 0 && privileged_role_changes === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-IDENT-002-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-IDENT-002-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-IDENT-002-02/result.json
assertions: <run_id>/A-IDENT-002-02/assertions.json
side_effect_manifest: <run_id>/A-IDENT-002-02/side-effects.json
evidence_id: EVID-A-IDENT-002-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-IDENT-002-03 — Gateway用户信息同步、本地投影与可撤销登录消费：失败注入与恢复

### Requirement Refs
`REQ-IDENT-002`；对应 `REQ-IDENT-002-M3`；共同约束第 11–19、21–24 章。

### Given
Gateway认证兑换成功后、本地session commit前失败；另例停用/改密码后持旧JWT。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
回滚本地session事务并再次读取；确认未对Gateway认证或alias发起补偿删除。

### Then
本地业务范围回到T0；不声称撤销Gateway已完成的认证；旧SSO会话拒绝。

### Oracle
```text
local_business_scope_digest_after === local_business_scope_digest_before && stale_session_allow_count === 0 && gateway_identity_management_write_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-IDENT-002-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-IDENT-002-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-IDENT-002-03/result.json
assertions: <run_id>/A-IDENT-002-03/assertions.json
side_effect_manifest: <run_id>/A-IDENT-002-03/side-effects.json
evidence_id: EVID-A-IDENT-002-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-AUTH-001-01 — 归一化 ms_/mt_ 交换与员工 Bridge 会话：正向与边界

### Requirement Refs
`REQ-AUTH-001`；对应 `REQ-AUTH-001-M1`；共同约束第 11–19、21–24 章。

### Given
真实账号登录样本包含session_token/expires_in/user；A有read/content.read；不同过期时间。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
归一化、exchange、建立bridge并发读取。

### Then
正确员工令牌；期限保守计算；浏览器无上游密钥。

### Oracle
```text
subject_token_prefix === "ms_" && business_token_prefix === "mt_" && audience_matches === true && deadline_within_minimum === true && gateway_tokens_in_browser === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-AUTH-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-AUTH-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-AUTH-001-01/result.json
assertions: <run_id>/A-AUTH-001-01/assertions.json
side_effect_manifest: <run_id>/A-AUTH-001-01/side-effects.json
evidence_id: EVID-A-AUTH-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-AUTH-001-02 — 归一化 ms_/mt_ 交换与员工 Bridge 会话：负向与禁止项

### Requirement Refs
`REQ-AUTH-001`；对应 `REQ-AUTH-001-M2`；共同约束第 11–19、21–24 章。

### Given
分别使用local JWT、裸userid、B的bridge、MCP audience令牌或禁用账号桥。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
尝试业务读取。

### Then
拒绝，不退回公用token。

### Oracle
```text
forbidden_subjects_allowed === 0 && shared_token_fallback_calls === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-AUTH-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-AUTH-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-AUTH-001-02/result.json
assertions: <run_id>/A-AUTH-001-02/assertions.json
side_effect_manifest: <run_id>/A-AUTH-001-02/side-effects.json
evidence_id: EVID-A-AUTH-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-AUTH-001-03 — 归一化 ms_/mt_ 交换与员工 Bridge 会话：失败注入与恢复

### Requirement Refs
`REQ-AUTH-001`；对应 `REQ-AUTH-001-M3`；共同约束第 11–19、21–24 章。

### Given
两个并发请求需要刷新，第一次已兑换但返回丢失。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
刷新与恢复同一bridge。

### Then
不重放旧refresh；会话要求重新认证；无重复可用令牌写入。

### Oracle
```text
refresh_replay_count === 0 && state === "AUTH_REQUIRED" && active_bridge_count_for_old_id === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-AUTH-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-AUTH-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-AUTH-001-03/result.json
assertions: <run_id>/A-AUTH-001-03/assertions.json
side_effect_manifest: <run_id>/A-AUTH-001-03/side-effects.json
evidence_id: EVID-A-AUTH-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CONFIG-001-01 — 网关配置替代腾讯凭据并分离 OCR：正向与边界

### Requirement Refs
`REQ-CONFIG-001`；对应 `REQ-CONFIG-001-M1`；共同约束第 11–19、21–24 章。

### Given
已有腾讯配置和OCR token；管理员提交合法网关配置且secret_operation=KEEP。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
保存并读取配置。

### Then
新provider生效但不越过readiness；OCR和密钥未误改；response不含秘密。

### Oracle
```text
provider === "meeting_gateway" && ocr_digest_after === ocr_digest_before && secret_leak_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CONFIG-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CONFIG-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CONFIG-001-01/result.json
assertions: <run_id>/A-CONFIG-001-01/assertions.json
side_effect_manifest: <run_id>/A-CONFIG-001-01/side-effects.json
evidence_id: EVID-A-CONFIG-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CONFIG-001-02 — 网关配置替代腾讯凭据并分离 OCR：负向与禁止项

### Requirement Refs
`REQ-CONFIG-001`；对应 `REQ-CONFIG-001-M2`；共同约束第 11–19、21–24 章。

### Given
普通用户保存；过期If-Match；origin为任意外站；provider=tencent_direct。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
提交配置。

### Then
各例拒绝，last_applied不变。

### Oracle
```text
denied_cases === requested_negative_cases && config_digest_after === config_digest_before
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CONFIG-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CONFIG-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CONFIG-001-02/result.json
assertions: <run_id>/A-CONFIG-001-02/assertions.json
side_effect_manifest: <run_id>/A-CONFIG-001-02/side-effects.json
evidence_id: EVID-A-CONFIG-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CONFIG-001-03 — 网关配置替代腾讯凭据并分离 OCR：失败注入与恢复

### Requirement Refs
`REQ-CONFIG-001`；对应 `REQ-CONFIG-001-M3`；共同约束第 11–19、21–24 章。

### Given
更新密钥和配置事务中断，旧配置有效。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
回滚后再读运行配置。

### Then
旧revision和secret引用仍一致；没有半更新配置。

### Oracle
```text
runtime_revision === previous_revision && secret_reference_resolves === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CONFIG-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CONFIG-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CONFIG-001-03/result.json
assertions: <run_id>/A-CONFIG-001-03/assertions.json
side_effect_manifest: <run_id>/A-CONFIG-001-03/side-effects.json
evidence_id: EVID-A-CONFIG-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-RUNTIME-001-01 — 补完实际依赖装配并统一唯一网关运行链路：正向与边界

### Requirement Refs
`REQ-RUNTIME-001`；对应 `REQ-RUNTIME-001-M1`；共同约束第 11–19、21–24 章。

### Given
候选构建安装真实模块，测试TLS Gateway或真实验收Gateway具备冻结契约。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
从实际server启动后调用旧remote和新status并执行源查询。

### Then
调用真实Adapter；所有依赖注册完整；无placeholder异常。

### Oracle
```text
runtime_dependency_count === expected_dependency_count && placeholder_call_count === 0 && tencent_direct_call_count === 0 && ready === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-RUNTIME-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-RUNTIME-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-RUNTIME-001-01/result.json
assertions: <run_id>/A-RUNTIME-001-01/assertions.json
side_effect_manifest: <run_id>/A-RUNTIME-001-01/side-effects.json
evidence_id: EVID-A-RUNTIME-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-RUNTIME-001-02 — 补完实际依赖装配并统一唯一网关运行链路：负向与禁止项

### Requirement Refs
`REQ-RUNTIME-001`；对应 `REQ-RUNTIME-001-M2`；共同约束第 11–19、21–24 章。

### Given
sessions.gateway或oauth为null；或contract不匹配；Gateway返回403。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
启动或调用旧会议接口。

### Then
503/403准确暴露，直连构造器和请求不被触发。

### Oracle
```text
ready === false && tencent_direct_call_count === 0 && forbidden_business_writes === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-RUNTIME-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-RUNTIME-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-RUNTIME-001-02/result.json
assertions: <run_id>/A-RUNTIME-001-02/assertions.json
side_effect_manifest: <run_id>/A-RUNTIME-001-02/side-effects.json
evidence_id: EVID-A-RUNTIME-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-RUNTIME-001-03 — 补完实际依赖装配并统一唯一网关运行链路：失败注入与恢复

### Requirement Refs
`REQ-RUNTIME-001`；对应 `REQ-RUNTIME-001-M3`；共同约束第 11–19、21–24 章。

### Given
运行中Gateway断网且worker持有处理中operation；触发进程退出。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
关停并重启真实runtime。

### Then
不新领任务，租约回收后原operation恢复，不产生重复文档。

### Oracle
```text
new_claims_after_shutdown === 0 && visible_duplicate_documents === 0 && tencent_direct_call_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-RUNTIME-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-RUNTIME-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-RUNTIME-001-03/result.json
assertions: <run_id>/A-RUNTIME-001-03/assertions.json
side_effect_manifest: <run_id>/A-RUNTIME-001-03/side-effects.json
evidence_id: EVID-A-RUNTIME-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-OAUTH-001-01 — 修复腾讯会议 OAuth 契约并完成本人确认闭环：正向与边界

### Requirement Refs
`REQ-OAUTH-001`；对应 `REQ-OAUTH-001-M1`；共同约束第 11–19、21–24 章。

### Given
Gateway按冻结配置返回四参数授权URL；A完成腾讯授权形成待确认连接。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
发起、回跳、本人确认、再次查询。

### Then
URL被接受；同一连接最终ACTIVE，令牌只留在Gateway。

### Oracle
```text
authorization_url_accepted === true && connection_status === "ACTIVE" && tencent_tokens_in_consumer === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-OAUTH-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-OAUTH-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-OAUTH-001-01/result.json
assertions: <run_id>/A-OAUTH-001-01/assertions.json
side_effect_manifest: <run_id>/A-OAUTH-001-01/side-effects.json
evidence_id: EVID-A-OAUTH-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-OAUTH-001-02 — 修复腾讯会议 OAuth 契约并完成本人确认闭环：负向与禁止项

### Requirement Refs
`REQ-OAUTH-001`；对应 `REQ-OAUTH-001-M2`；共同约束第 11–19、21–24 章。

### Given
逐项篡改corp_id/sdk_id/redirect_uri/state；重复query；连接属于B或CORP_MISMATCH。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
发起校验或确认。

### Then
全部拒绝；不导航到恶意URL；不改变连接。

### Oracle
```text
invalid_url_navigation_count === 0 && foreign_confirm_count === 0 && false_active_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-OAUTH-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-OAUTH-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-OAUTH-001-02/result.json
assertions: <run_id>/A-OAUTH-001-02/assertions.json
side_effect_manifest: <run_id>/A-OAUTH-001-02/side-effects.json
evidence_id: EVID-A-OAUTH-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-OAUTH-001-03 — 修复腾讯会议 OAuth 契约并完成本人确认闭环：失败注入与恢复

### Requirement Refs
`REQ-OAUTH-001`；对应 `REQ-OAUTH-001-M3`；共同约束第 11–19、21–24 章。

### Given
POST授权事务响应丢失，Gateway可能已创建事务。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
使用同一幂等键查询/恢复。

### Then
复用同一事务，不二次消费腾讯auth_code；显示恢复中而非成功。

### Oracle
```text
gateway_authorization_count_for_key === 1 && tencent_code_replay_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-OAUTH-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-OAUTH-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-OAUTH-001-03/result.json
assertions: <run_id>/A-OAUTH-001-03/assertions.json
side_effect_manifest: <run_id>/A-OAUTH-001-03/side-effects.json
evidence_id: EVID-A-OAUTH-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-UI-001-01 — 企业微信登录入口/结果与会议授权状态：正向与边界

### Requirement Refs
`REQ-UI-001`；对应 `REQ-UI-001-M1`；共同约束第 11–19、21–24 章。

### Given
A在Gateway已准入；首次登录前无本地投影；Gateway企业微信认证/profile真实；另一个账号已登录但无会议权限。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
通过桌面与移动登录入口/结果页完成扫码流程，刷新结果/会议授权状态视图；检查无身份申请/绑定审批入口。

### Then
分别显示身份、bridge、腾讯连接与权限，不因会议无权宣告登录失败。

### Oracle
```text
required_ui_states_rendered === required_ui_states_total && mislabeled_identity_count === 0 && accessible_actions_match === true && consumer_identity_management_entry_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-UI-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-UI-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-UI-001-01/result.json
assertions: <run_id>/A-UI-001-01/assertions.json
side_effect_manifest: <run_id>/A-UI-001-01/side-effects.json
evidence_id: EVID-A-UI-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-UI-001-02 — 企业微信登录入口/结果与会议授权状态：负向与禁止项

### Requirement Refs
`REQ-UI-001`；对应 `REQ-UI-001-M2`；共同约束第 11–19、21–24 章。

### Given
Gateway企业微信认证未就绪、外企业、profile读取失败、扫码认证取消、403和401各一例。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
打开页面并点击可见动作。

### Then
无假二维码/假成功；受限按钮不可触发数据读取。

### Oracle
```text
fake_success_count === 0 && disabled_action_network_calls === 0 && secrets_in_dom === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-UI-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-UI-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-UI-001-02/result.json
assertions: <run_id>/A-UI-001-02/assertions.json
side_effect_manifest: <run_id>/A-UI-001-02/side-effects.json
evidence_id: EVID-A-UI-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-UI-001-03 — 企业微信登录入口/结果与会议授权状态：失败注入与恢复

**2.0.2本阶段覆盖规则：本case的兑换响应丢失分支以PHASE-LOCAL-02为唯一预期；不再要求自动恢复原兑换。远端取数为0，有效本地会话可检索本地获权资料；无本地会话不能登录，显式重新扫码才恢复远端。对应Oracle按响应丢失与依赖未部署两个case分别验证，不能以一个状态替代两者。**

### Requirement Refs
`REQ-UI-001`；对应 `REQ-UI-001-M3`；共同约束第 11–19、21–24 章。

### Given
用户在callback回跳后刷新，网络中断，然后恢复。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
重新进入SSO结果/授权页。

### Then
读取本地事务/会话状态；不重复兑换。结果丢失显示LOCAL_ONLY，已有有效本地会话只检索本地资料；未完成新登录只显示重新扫码；不得自动恢复远端取数。

### Oracle
```text
duplicate_redemption_count === 0 && terminal_ui_matches_backend === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-UI-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-UI-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-UI-001-03/result.json
assertions: <run_id>/A-UI-001-03/assertions.json
side_effect_manifest: <run_id>/A-UI-001-03/side-effects.json
evidence_id: EVID-A-UI-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-UI-002-01 — 会议设置重构为网关、诊断与独立解析服务：正向与边界

### Requirement Refs
`REQ-UI-002`；对应 `REQ-UI-002-M1`；共同约束第 11–19、21–24 章。

### Given
旧配置存在且OCR已配置；管理员切换网关设置。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
保存、重新加载、检查。

### Then
正确展示网关字段、只读能力与OCR；密钥输入清空但存在状态保留。

### Oracle
```text
legacy_tencent_input_count === 0 && secret_value_in_dom === false && ocr_roundtrip_equal === true && diagnostic_sections === 4
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-UI-002-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-UI-002-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-UI-002-01/result.json
assertions: <run_id>/A-UI-002-01/assertions.json
side_effect_manifest: <run_id>/A-UI-002-01/side-effects.json
evidence_id: EVID-A-UI-002-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-UI-002-02 — 会议设置重构为网关、诊断与独立解析服务：负向与禁止项

### Requirement Refs
`REQ-UI-002`；对应 `REQ-UI-002-M2`；共同约束第 11–19、21–24 章。

### Given
普通用户访问settings；管理员收到capability UNKNOWN；错误Gateway Origin。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
尝试保存和修改能力。

### Then
无权限用户不可写；能力不可编辑；错误可定位。

### Oracle
```text
unauthorized_config_mutations === 0 && editable_capability_controls === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-UI-002-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-UI-002-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-UI-002-02/result.json
assertions: <run_id>/A-UI-002-02/assertions.json
side_effect_manifest: <run_id>/A-UI-002-02/side-effects.json
evidence_id: EVID-A-UI-002-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-UI-002-03 — 会议设置重构为网关、诊断与独立解析服务：失败注入与恢复

### Requirement Refs
`REQ-UI-002`；对应 `REQ-UI-002-M3`；共同约束第 11–19、21–24 章。

### Given
另一个管理员已保存新revision，本页仍用旧revision。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
点击保存。

### Then
显示冲突；保留本页未保存值；不覆盖新服务端revision。

### Oracle
```text
http_status === 409 && server_revision_unchanged === true && unsaved_form_preserved === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-UI-002-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-UI-002-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-UI-002-03/result.json
assertions: <run_id>/A-UI-002-03/assertions.json
side_effect_manifest: <run_id>/A-UI-002-03/side-effects.json
evidence_id: EVID-A-UI-002-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-UI-003-01 — 现有会议列表、详情、导入与任务状态接通：正向与边界

### Requirement Refs
`REQ-UI-003`；对应 `REQ-UI-003-M1`；共同约束第 11–19、21–24 章。

### Given
源作业先202再成功；两条录制；原文已READY。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
用现有列表、详情、导入和任务页完成流程。

### Then
状态连续、两条录制可见、待审核不显示索引成功。

### Oracle
```text
false_empty_messages === 0 && displayed_recording_count === 2 && displayed_state_matches_backend === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-UI-003-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-UI-003-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-UI-003-01/result.json
assertions: <run_id>/A-UI-003-01/assertions.json
side_effect_manifest: <run_id>/A-UI-003-01/side-effects.json
evidence_id: EVID-A-UI-003-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-UI-003-02 — 现有会议列表、详情、导入与任务状态接通：负向与禁止项

### Requirement Refs
`REQ-UI-003`；对应 `REQ-UI-003-M2`；共同约束第 11–19、21–24 章。

### Given
源作业RETRYING/FAILED；正文NOT_READY；权限DENIED各一例。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
查看页面。

### Then
分别显示状态和下一动作；不能进入问答或把失败视为零结果。

### Oracle
```text
false_success_count === 0 && unauthorized_question_requests === 0 && exact_error_codes_preserved === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-UI-003-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-UI-003-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-UI-003-02/result.json
assertions: <run_id>/A-UI-003-02/assertions.json
side_effect_manifest: <run_id>/A-UI-003-02/side-effects.json
evidence_id: EVID-A-UI-003-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-UI-003-03 — 现有会议列表、详情、导入与任务状态接通：失败注入与恢复

### Requirement Refs
`REQ-UI-003`；对应 `REQ-UI-003-M3`；共同约束第 11–19、21–24 章。

### Given
导入提交成功但浏览器响应丢失，用户刷新页面再点击。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
恢复任务与重试。

### Then
继续原operation，只显示一个导入；未收到成功结果不显示完成。

### Oracle
```text
unique_operation_count_for_key === 1 && visible_duplicate_jobs === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-UI-003-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-UI-003-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-UI-003-03/result.json
assertions: <run_id>/A-UI-003-03/assertions.json
side_effect_manifest: <run_id>/A-UI-003-03/side-effects.json
evidence_id: EVID-A-UI-003-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-QUERY-001-01 — 真实日期源查询、幂等作业与一致结果快照：正向与边界

### Requirement Refs
`REQ-QUERY-001`；对应 `REQ-QUERY-001-M1`；共同约束第 11–19、21–24 章。

### Given
旧目录含窗口内M0；本次上游只返回M1/M2，边界会议恰在end_at。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
查询并读完整snapshot。

### Then
只有M1/M2且不含M0或end_at边界项；所有页完成。

### Oracle
```text
snapshot_ids === "M1,M2" && stale_catalogue_items === 0 && complete === true && source_jobs_for_key === 1
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-QUERY-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-QUERY-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-QUERY-001-01/result.json
assertions: <run_id>/A-QUERY-001-01/assertions.json
side_effect_manifest: <run_id>/A-QUERY-001-01/side-effects.json
evidence_id: EVID-A-QUERY-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-QUERY-001-02 — 真实日期源查询、幂等作业与一致结果快照：负向与禁止项

### Requirement Refs
`REQ-QUERY-001`；对应 `REQ-QUERY-001-M2`；共同约束第 11–19、21–24 章。

### Given
B使用A的query_id；大于90天窗口；伪造target_member_id；重复cursor。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
查询/读结果。

### Then
对应拒绝；不创建越权源作业，不泄露结果。

### Oracle
```text
foreign_result_bytes === 0 && invalid_scope_source_calls === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-QUERY-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-QUERY-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-QUERY-001-02/result.json
assertions: <run_id>/A-QUERY-001-02/assertions.json
side_effect_manifest: <run_id>/A-QUERY-001-02/side-effects.json
evidence_id: EVID-A-QUERY-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-QUERY-001-03 — 真实日期源查询、幂等作业与一致结果快照：失败注入与恢复

### Requirement Refs
`REQ-QUERY-001`；对应 `REQ-QUERY-001-M3`；共同约束第 11–19、21–24 章。

### Given
第二页源请求失败或POST响应丢失。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
恢复原作业与查询快照。

### Then
中途不发布完整结果；同键恢复同job；只有完成后发布。

### Oracle
```text
premature_snapshot_count === 0 && job_count_for_key === 1 && eventual_snapshot_complete === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-QUERY-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-QUERY-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-QUERY-001-03/result.json
assertions: <run_id>/A-QUERY-001-03/assertions.json
side_effect_manifest: <run_id>/A-QUERY-001-03/side-effects.json
evidence_id: EVID-A-QUERY-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CONTENT-001-01 — 多录制、完整转写、原生纪要与版本一致性：正向与边界

### Requirement Refs
`REQ-CONTENT-001`；对应 `REQ-CONTENT-001-M1`；共同约束第 11–19、21–24 章。

### Given
两条录制，转写各3页；相同version；纪要含非空minute与空todo。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
完整读取并格式化。

### Then
所有段落可追溯，两份纪要保持各录制覆盖，空todo不失败。

### Oracle
```text
paragraph_ids_equal_fixture === true && source_recording_count === 2 && minutes_model_preserved === true && complete === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CONTENT-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CONTENT-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CONTENT-001-01/result.json
assertions: <run_id>/A-CONTENT-001-01/assertions.json
side_effect_manifest: <run_id>/A-CONTENT-001-01/side-effects.json
evidence_id: EVID-A-CONTENT-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CONTENT-001-02 — 多录制、完整转写、原生纪要与版本一致性：负向与禁止项

### Requirement Refs
`REQ-CONTENT-001`；对应 `REQ-CONTENT-001-M2`；共同约束第 11–19、21–24 章。

### Given
游标循环、页间version变化、相同段落ID异文、无时间戳或累计超过3小时。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
尝试完成导入。

### Then
返回确定完整性/范围错误，不发布部分全文。

### Oracle
```text
published_documents_delta === 0 && incomplete_marked_verified === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CONTENT-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CONTENT-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CONTENT-001-02/result.json
assertions: <run_id>/A-CONTENT-001-02/assertions.json
side_effect_manifest: <run_id>/A-CONTENT-001-02/side-effects.json
evidence_id: EVID-A-CONTENT-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CONTENT-001-03 — 多录制、完整转写、原生纪要与版本一致性：失败注入与恢复

### Requirement Refs
`REQ-CONTENT-001`；对应 `REQ-CONTENT-001-M3`；共同约束第 11–19、21–24 章。

### Given
第N页网络失败；上游202尚未完成。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
重试读取原asset/job。

### Then
保留恢复记录但不发布；继续时重新校验version，变化则从新版本开始。

### Oracle
```text
cross_version_join_count === 0 && premature_publication_count === 0 && source_job_reused === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CONTENT-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CONTENT-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CONTENT-001-03/result.json
assertions: <run_id>/A-CONTENT-001-03/assertions.json
side_effect_manifest: <run_id>/A-CONTENT-001-03/side-effects.json
evidence_id: EVID-A-CONTENT-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-IMPORT-001-01 — 统一现有会议导入与 R1 受管文档代次：正向与边界

**DEFERRED_CURRENT_PHASE：本阶段暂停本项验收；下文为未来阶段规范，不要求本阶段运行。**

### Requirement Refs
`REQ-IMPORT-001`；对应 `REQ-IMPORT-001-M1`；共同约束第 11–19、21–24 章。

### Given
A选择两条录制的完整来源到本人受限工作区。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
从旧会议import接口导入两次同一选择。

### Then
保留单一operation/代次血缘，无重复文档；旧详情接口可回查。

### Oracle
```text
active_imports_equal_selected_assets === true && duplicate_docids === 0 && lineage_complete === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-IMPORT-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-IMPORT-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-IMPORT-001-01/result.json
assertions: <run_id>/A-IMPORT-001-01/assertions.json
side_effect_manifest: <run_id>/A-IMPORT-001-01/side-effects.json
evidence_id: EVID-A-IMPORT-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-IMPORT-001-02 — 统一现有会议导入与 R1 受管文档代次：负向与禁止项

**DEFERRED_CURRENT_PHASE：本阶段暂停本项验收；下文为未来阶段规范，不要求本阶段运行。**

### Requirement Refs
`REQ-IMPORT-001`；对应 `REQ-IMPORT-001-M2`；共同约束第 11–19、21–24 章。

### Given
B使用A的来源/目标工作区；同键不同选择；浏览器提交自报member或正文。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
调用导入。

### Then
拒绝并保持配额/文档/向量T0。

### Oracle
```text
forbidden_imports === 0 && managed_digest_after === managed_digest_before
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-IMPORT-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-IMPORT-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-IMPORT-001-02/result.json
assertions: <run_id>/A-IMPORT-001-02/assertions.json
side_effect_manifest: <run_id>/A-IMPORT-001-02/side-effects.json
evidence_id: EVID-A-IMPORT-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-IMPORT-001-03 — 统一现有会议导入与 R1 受管文档代次：失败注入与恢复

**DEFERRED_CURRENT_PHASE：本阶段暂停本项验收；下文为未来阶段规范，不要求本阶段运行。**

### Requirement Refs
`REQ-IMPORT-001`；对应 `REQ-IMPORT-001-M3`；共同约束第 11–19、21–24 章。

### Given
Collector已写文件但Consumer未收到响应。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
worker恢复同一operation。

### Then
查询原operation receipt复用稳定docId，不重新生成随机文件。

### Oracle
```text
collector_visible_documents_for_operation === 1 && active_vector_docids_for_asset === 1
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-IMPORT-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-IMPORT-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-IMPORT-001-03/result.json
assertions: <run_id>/A-IMPORT-001-03/assertions.json
side_effect_manifest: <run_id>/A-IMPORT-001-03/side-effects.json
evidence_id: EVID-A-IMPORT-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-DATA-001-01 — 原文、人工修订、审核与引用分层：正向与边界

### Requirement Refs
`REQ-DATA-001`；对应 `REQ-DATA-001-M1`；共同约束第 11–19、21–24 章。

### Given
已APPROVED原文v1，用户保存修订r2，随后上游提供v2。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
更新源并重新查看详情/引用。

### Then
原文v1/v2分开，r2保持，审核状态明确为DRAFT。

### Oracle
```text
user_revision_digest_preserved === true && original_versions === 2 && review_status === "DRAFT" && citations_resolvable === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-DATA-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-DATA-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-DATA-001-01/result.json
assertions: <run_id>/A-DATA-001-01/assertions.json
side_effect_manifest: <run_id>/A-DATA-001-01/side-effects.json
evidence_id: EVID-A-DATA-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-DATA-001-02 — 原文、人工修订、审核与引用分层：负向与禁止项

### Requirement Refs
`REQ-DATA-001`；对应 `REQ-DATA-001-M2`；共同约束第 11–19、21–24 章。

### Given
直接PATCH原文或以旧revision提交覆盖；模型输出请求改写原生标签。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
执行写入。

### Then
拒绝，原文和用户revision不变。

### Oracle
```text
original_digest_after === original_digest_before && stale_write_applied === false
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-DATA-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-DATA-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-DATA-001-02/result.json
assertions: <run_id>/A-DATA-001-02/assertions.json
side_effect_manifest: <run_id>/A-DATA-001-02/side-effects.json
evidence_id: EVID-A-DATA-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-DATA-001-03 — 原文、人工修订、审核与引用分层：失败注入与恢复

### Requirement Refs
`REQ-DATA-001`；对应 `REQ-DATA-001-M3`；共同约束第 11–19、21–24 章。

### Given
用户修订写入后、活动指针切换前DB失败。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
回滚并读取已批准版本。

### Then
可见指针与原文/修订集合回到T0；审计标失败。

### Oracle
```text
visible_revision_after === visible_revision_before && revision_scope_digest_after === revision_scope_digest_before
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-DATA-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-DATA-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-DATA-001-03/result.json
assertions: <run_id>/A-DATA-001-03/assertions.json
side_effect_manifest: <run_id>/A-DATA-001-03/side-effects.json
evidence_id: EVID-A-DATA-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-WORKSPACE-001-01 — 持续受限工作区与存储隔离：正向与边界

### Requirement Refs
`REQ-WORKSPACE-001`；对应 `REQ-WORKSPACE-001-M1`；共同约束第 11–19、21–24 章。

### Given
A创建受限工作区并导入来源，普通工作区C另有普通文档。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
分别使用A、B、管理员和picker访问。

### Then
仅A在获权时读受管内容；C仍保持原功能。

### Oracle
```text
restricted_foreign_reads === 0 && managed_items_in_global_picker === 0 && ordinary_workspace_regression === false
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-WORKSPACE-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-WORKSPACE-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-WORKSPACE-001-01/result.json
assertions: <run_id>/A-WORKSPACE-001-01/assertions.json
side_effect_manifest: <run_id>/A-WORKSPACE-001-01/side-effects.json
evidence_id: EVID-A-WORKSPACE-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-WORKSPACE-001-02 — 持续受限工作区与存储隔离：负向与禁止项

### Requirement Refs
`REQ-WORKSPACE-001`；对应 `REQ-WORKSPACE-001-M2`；共同约束第 11–19、21–24 章。

### Given
owner尝试添加成员、share/embed/copy/move/sync或导入到普通workspace。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
经UI与直接API执行。

### Then
全部拒绝，不改变成员/位置/共享配置。

### Oracle
```text
denied_mutation_count === attempted_mutation_count && policy_scope_digest_after === policy_scope_digest_before
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-WORKSPACE-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-WORKSPACE-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-WORKSPACE-001-02/result.json
assertions: <run_id>/A-WORKSPACE-001-02/assertions.json
side_effect_manifest: <run_id>/A-WORKSPACE-001-02/side-effects.json
evidence_id: EVID-A-WORKSPACE-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-WORKSPACE-001-03 — 持续受限工作区与存储隔离：失败注入与恢复

### Requirement Refs
`REQ-WORKSPACE-001`；对应 `REQ-WORKSPACE-001-M3`；共同约束第 11–19、21–24 章。

### Given
成员变更与导入commit并发，policy_epoch变化。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
提交旧epoch generation。

### Then
旧代次提交失败并隔离staging，工作区未扩权。

### Oracle
```text
stale_epoch_commits === 0 && effective_reader_count === 1
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-WORKSPACE-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-WORKSPACE-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-WORKSPACE-001-03/result.json
assertions: <run_id>/A-WORKSPACE-001-03/assertions.json
side_effect_manifest: <run_id>/A-WORKSPACE-001-03/side-effects.json
evidence_id: EVID-A-WORKSPACE-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-ACCESS-001-01 — 覆盖旧接口与所有本地读取的实时双层授权：正向与边界

### Requirement Refs
`REQ-ACCESS-001`；对应 `REQ-ACCESS-001-M1`；共同约束第 11–19、21–24 章。

### Given
A有meeting.read与content.read，B无权；包括新旧列表/详情/source/job/file路径。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
逐一请求并记录后台access调用。

### Then
每条路径绑定正确actor与资源，B均无内容。

### Oracle
```text
protected_paths_tested === protected_paths_declared && unauthorized_content_bytes === 0 && bypassed_access_calls === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-ACCESS-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-ACCESS-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-ACCESS-001-01/result.json
assertions: <run_id>/A-ACCESS-001-01/assertions.json
side_effect_manifest: <run_id>/A-ACCESS-001-01/side-effects.json
evidence_id: EVID-A-ACCESS-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-ACCESS-001-02 — 覆盖旧接口与所有本地读取的实时双层授权：负向与禁止项

### Requirement Refs
`REQ-ACCESS-001`；对应 `REQ-ACCESS-001-M2`；共同约束第 11–19、21–24 章。

### Given
管理员/global key/body.userId=A/直接localId/已过期bridge分别访问受管资料。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
读取各受保护入口。

### Then
全部拒绝；对资源不存在和跨人返回统一不可访问。

### Oracle
```text
negative_allow_count === 0 && resource_existence_leaks === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-ACCESS-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-ACCESS-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-ACCESS-001-02/result.json
assertions: <run_id>/A-ACCESS-001-02/assertions.json
side_effect_manifest: <run_id>/A-ACCESS-001-02/side-effects.json
evidence_id: EVID-A-ACCESS-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-ACCESS-001-03 — 覆盖旧接口与所有本地读取的实时双层授权：失败注入与恢复

### Requirement Refs
`REQ-ACCESS-001`；对应 `REQ-ACCESS-001-M3`；共同约束第 11–19、21–24 章。

### Given
Gateway实时access断网，或读取文件中途撤销后在发送前复查。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
执行本地内容返回。

### Then
fail-closed，无当前请求正文；保留可恢复数据。

### Oracle
```text
current_response_content_bytes === 0 && local_source_deleted === false
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-ACCESS-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-ACCESS-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-ACCESS-001-03/result.json
assertions: <run_id>/A-ACCESS-001-03/assertions.json
side_effect_manifest: <run_id>/A-ACCESS-001-03/side-effects.json
evidence_id: EVID-A-ACCESS-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-RAG-001-01 — 问答、固定文档、历史、引用与旁路的统一门禁：正向与边界

### Requirement Refs
`REQ-RAG-001`；对应 `REQ-RAG-001-M1`；共同约束第 11–19、21–24 章。

### Given
A获权，受管资料分别位于pinned/parsed/history/vector，均有provenance。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
经会议问答、普通聊天和引用查看走完整流程。

### Then
每种上下文来源获权；引用能定位；最终检查有日志。

### Oracle
```text
context_source_auth_coverage === 1 && citation_lineage_valid === true && final_check_before_llm === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-RAG-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-RAG-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-RAG-001-01/result.json
assertions: <run_id>/A-RAG-001-01/assertions.json
side_effect_manifest: <run_id>/A-RAG-001-01/side-effects.json
evidence_id: EVID-A-RAG-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-RAG-001-02 — 问答、固定文档、历史、引用与旁路的统一门禁：负向与禁止项

### Requirement Refs
`REQ-RAG-001`；对应 `REQ-RAG-001-M2`；共同约束第 11–19、21–24 章。

### Given
B、全局API key、public embed或已失权历史会话包含canary。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
从全部聊天/检索/导出旁路请求。

### Then
拒绝受限资料，不调用模型，不返回canary。

### Oracle
```text
llm_calls === 0 && leaked_canary_count === 0 && untested_declared_read_paths === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-RAG-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-RAG-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-RAG-001-02/result.json
assertions: <run_id>/A-RAG-001-02/assertions.json
side_effect_manifest: <run_id>/A-RAG-001-02/side-effects.json
evidence_id: EVID-A-RAG-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-RAG-001-03 — 问答、固定文档、历史、引用与旁路的统一门禁：失败注入与恢复

### Requirement Refs
`REQ-RAG-001`；对应 `REQ-RAG-001-M3`；共同约束第 11–19、21–24 章。

### Given
向量检索后、模型调用前授权撤销；另例生成过程中撤销。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
执行最终复查或流式检查。

### Then
前者不调用模型；后者最迟5秒停止后续输出，不宣称收回已发送字节。

### Oracle
```text
pre_llm_revocation_calls === 0 && post_detection_output_bytes === 0 && stop_latency_ms <= 5000
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-RAG-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-RAG-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-RAG-001-03/result.json
assertions: <run_id>/A-RAG-001-03/assertions.json
side_effect_manifest: <run_id>/A-RAG-001-03/side-effects.json
evidence_id: EVID-A-RAG-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-REVOKE-001-01 — 退出、停用、解除绑定与本地资料失效：正向与边界

### Requirement Refs
`REQ-REVOKE-001`；对应 `REQ-REVOKE-001-M1`；共同约束第 11–19、21–24 章。

### Given
A已导入且有历史问答，随后本地退出/停用/解除绑定各一例。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
重用旧JWT/bridge并访问历史与文件。

### Then
当前受限读取拒绝；状态准确；无腾讯连接被隐式撤销。

### Oracle
```text
stale_session_allow_count === 0 && implicit_tencent_revocations === 0 && deny_before_cleanup === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-REVOKE-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-REVOKE-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-REVOKE-001-01/result.json
assertions: <run_id>/A-REVOKE-001-01/assertions.json
side_effect_manifest: <run_id>/A-REVOKE-001-01/side-effects.json
evidence_id: EVID-A-REVOKE-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-REVOKE-001-02 — 退出、停用、解除绑定与本地资料失效：负向与禁止项

### Requirement Refs
`REQ-REVOKE-001`；对应 `REQ-REVOKE-001-M2`；共同约束第 11–19、21–24 章。

### Given
用户试图凭本地READY恢复已撤销源；或owner以外调用解绑。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
再次读取/解绑。

### Then
拒绝，不恢复权限，不操作他人会话。

### Oracle
```text
unauthorized_session_mutations === 0 && invalid_access_restored === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-REVOKE-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-REVOKE-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-REVOKE-001-02/result.json
assertions: <run_id>/A-REVOKE-001-02/assertions.json
side_effect_manifest: <run_id>/A-REVOKE-001-02/side-effects.json
evidence_id: EVID-A-REVOKE-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-REVOKE-001-03 — 退出、停用、解除绑定与本地资料失效：失败注入与恢复

### Requirement Refs
`REQ-REVOKE-001`；对应 `REQ-REVOKE-001-M3`；共同约束第 11–19、21–24 章。

### Given
访问锁已提交，向量删除超时或进程中断。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
清理重试并读取。

### Then
保持PENDING_CLEANUP和deny；保留恢复记录，不能因为清理失败放行。

### Oracle
```text
access_allowed === false && cleanup_state === "PENDING_CLEANUP" && recovery_record_exists === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-REVOKE-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-REVOKE-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-REVOKE-001-03/result.json
assertions: <run_id>/A-REVOKE-001-03/assertions.json
side_effect_manifest: <run_id>/A-REVOKE-001-03/side-effects.json
evidence_id: EVID-A-REVOKE-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-TXN-001-01 — 跨 DB/文件/Collector/向量的提交与恢复：正向与边界

### Requirement Refs
`REQ-TXN-001`；对应 `REQ-TXN-001-M1`；共同约束第 11–19、21–24 章。

### Given
两worker竞争同generation；稳定docId/operation receipt均可查询。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
执行完整导入并模拟正常重复请求。

### Then
只有当前fence提交；一个active generation；文件与向量可核验。

### Oracle
```text
active_generation_count === 1 && stale_fence_commit_count === 0 && file_vector_identity_match === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-TXN-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-TXN-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-TXN-001-01/result.json
assertions: <run_id>/A-TXN-001-01/assertions.json
side_effect_manifest: <run_id>/A-TXN-001-01/side-effects.json
evidence_id: EVID-A-TXN-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-TXN-001-02 — 跨 DB/文件/Collector/向量的提交与恢复：负向与禁止项

### Requirement Refs
`REQ-TXN-001`；对应 `REQ-TXN-001-M2`；共同约束第 11–19、21–24 章。

### Given
陈旧worker、错误owner、篡改receipt或docId、越界路径。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
尝试提交/清理。

### Then
拒绝且不覆盖当前活动版本、不删除他人文件。

### Oracle
```text
unauthorized_mutations === 0 && active_digest_after === active_digest_before
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-TXN-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-TXN-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-TXN-001-02/result.json
assertions: <run_id>/A-TXN-001-02/assertions.json
side_effect_manifest: <run_id>/A-TXN-001-02/side-effects.json
evidence_id: EVID-A-TXN-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-TXN-001-03 — 跨 DB/文件/Collector/向量的提交与恢复：失败注入与恢复

### Requirement Refs
`REQ-TXN-001`；对应 `REQ-TXN-001-M3`；共同约束第 11–19、21–24 章。

### Given
逐一注入 §23 全部事务失败点，包含rollback失败。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
重启并执行原operation恢复。

### Then
可见范围回T0或完成核验后发布；失败回滚保留备份，孤儿不进入RAG。

### Oracle
```text
all_failure_points_asserted === true && partial_visible_count === 0 && rollback_failure_backups_preserved === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-TXN-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-TXN-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-TXN-001-03/result.json
assertions: <run_id>/A-TXN-001-03/assertions.json
side_effect_manifest: <run_id>/A-TXN-001-03/side-effects.json
evidence_id: EVID-A-TXN-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-SEC-001-01 — 凭据、网络、路径与不可信内容边界：正向与边界

### Requirement Refs
`REQ-SEC-001`；对应 `REQ-SEC-001-M1`；共同约束第 11–19、21–24 章。

### Given
合法内部HTTPS FQDN解析到显式批准CIDR，合法受管路径，密钥已配置。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
建立bridge、取内容、保存受管文件，执行脱敏扫描。

### Then
请求只到允许源；文件只在允许root；可轮换密钥且不泄漏。

### Oracle
```text
unexpected_network_destinations === 0 && outside_root_writes === 0 && secret_canary_leaks === 0 && local_processing_p95_ms <= 300
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-SEC-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-SEC-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-SEC-001-01/result.json
assertions: <run_id>/A-SEC-001-01/assertions.json
side_effect_manifest: <run_id>/A-SEC-001-01/side-effects.json
evidence_id: EVID-A-SEC-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-SEC-001-02 — 凭据、网络、路径与不可信内容边界：负向与禁止项

### Requirement Refs
`REQ-SEC-001`；对应 `REQ-SEC-001-M2`；共同约束第 11–19、21–24 章。

### Given
注入SSRF、DNS rebinding、重定向、path traversal、symlink、CSRF、正文工具指令。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
经全部相关输入入口提交。

### Then
对应拒绝；无上游越界、文件越界、任意工具执行。

### Oracle
```text
forbidden_network_calls === 0 && outside_root_mutations === 0 && arbitrary_execution_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-SEC-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-SEC-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-SEC-001-02/result.json
assertions: <run_id>/A-SEC-001-02/assertions.json
side_effect_manifest: <run_id>/A-SEC-001-02/side-effects.json
evidence_id: EVID-A-SEC-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-SEC-001-03 — 凭据、网络、路径与不可信内容边界：失败注入与恢复

### Requirement Refs
`REQ-SEC-001`；对应 `REQ-SEC-001-M3`；共同约束第 11–19、21–24 章。

### Given
密钥轮换过程中进程失败；旧数据仍引用旧key；另例TLS检查失败。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
恢复或发起请求。

### Then
旧密文仍可解；TLS失败不自动降级HTTP；无密钥丢失。

### Oracle
```text
referenced_keys_preserved === true && plaintext_fallback_count === 0 && insecure_transport_calls === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-SEC-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-SEC-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-SEC-001-03/result.json
assertions: <run_id>/A-SEC-001-03/assertions.json
side_effect_manifest: <run_id>/A-SEC-001-03/side-effects.json
evidence_id: EVID-A-SEC-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-OBS-001-01 — 阶段日志、错误语义与诊断证据：正向与边界

### Requirement Refs
`REQ-OBS-001`；对应 `REQ-OBS-001-M1`；共同约束第 11–19、21–24 章。

### Given
依次产生401、403、202、429、版本冲突、上游5xx与正常成功。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
处理并查询诊断输出。

### Then
状态/错误/recovery_action正确关联，敏感字段脱敏。

### Oracle
```text
error_mapping_mismatch_count === 0 && missing_stage_events === 0 && secret_canary_leaks === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-OBS-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-OBS-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-OBS-001-01/result.json
assertions: <run_id>/A-OBS-001-01/assertions.json
side_effect_manifest: <run_id>/A-OBS-001-01/side-effects.json
evidence_id: EVID-A-OBS-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-OBS-001-02 — 阶段日志、错误语义与诊断证据：负向与禁止项

### Requirement Refs
`REQ-OBS-001`；对应 `REQ-OBS-001-M2`；共同约束第 11–19、21–24 章。

### Given
上游error带token与会议全文，未知reason和重复header。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
返回错误到浏览器/日志/Evidence。

### Then
只输出安全code与脱敏trace，不回显上游body。

### Oracle
```text
sensitive_error_bytes === 0 && false_success_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-OBS-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-OBS-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-OBS-001-02/result.json
assertions: <run_id>/A-OBS-001-02/assertions.json
side_effect_manifest: <run_id>/A-OBS-001-02/side-effects.json
evidence_id: EVID-A-OBS-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-OBS-001-03 — 阶段日志、错误语义与诊断证据：失败注入与恢复

### Requirement Refs
`REQ-OBS-001`；对应 `REQ-OBS-001-M3`；共同约束第 11–19、21–24 章。

### Given
业务事务完成后日志sink暂时不可达。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
恢复日志投递与状态查询。

### Then
持久outbox或本地审计仍能证明业务；不重复业务写入为补日志。

### Oracle
```text
business_write_replay_count === 0 && audit_event_eventually_persisted === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-OBS-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-OBS-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-OBS-001-03/result.json
assertions: <run_id>/A-OBS-001-03/assertions.json
side_effect_manifest: <run_id>/A-OBS-001-03/side-effects.json
evidence_id: EVID-A-OBS-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-MIGRATE-001-01 — 历史盘点、可信映射与不明所有权隔离：正向与边界

### Requirement Refs
`REQ-MIGRATE-001`；对应 `REQ-MIGRATE-001-M1`；共同约束第 11–19、21–24 章。

### Given
历史样本含可证明映射、重复项、人工修订与unknown owner。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
inventory/diff/approve/apply/reapply。

### Then
localId保留，修订不变；unknown保留并隔离；再次执行无新增变化。

### Oracle
```text
local_ids_preserved === true && user_content_digest_equal === true && unknown_bytes_preserved === true && second_apply_mutations === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-MIGRATE-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-MIGRATE-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-MIGRATE-001-01/result.json
assertions: <run_id>/A-MIGRATE-001-01/assertions.json
side_effect_manifest: <run_id>/A-MIGRATE-001-01/side-effects.json
evidence_id: EVID-A-MIGRATE-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-MIGRATE-001-02 — 历史盘点、可信映射与不明所有权隔离：负向与禁止项

### Requirement Refs
`REQ-MIGRATE-001`；对应 `REQ-MIGRATE-001-M2`；共同约束第 11–19、21–24 章。

### Given
仅标题/时间匹配；owner不一致；plan后文件漂移。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
尝试adopt/apply。

### Then
阻断对应项或全run；无猜测映射、删除和自动覆盖。

### Oracle
```text
guessed_mappings === 0 && unknown_deletions === 0 && unauthorized_mutations === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-MIGRATE-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-MIGRATE-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-MIGRATE-001-02/result.json
assertions: <run_id>/A-MIGRATE-001-02/assertions.json
side_effect_manifest: <run_id>/A-MIGRATE-001-02/side-effects.json
evidence_id: EVID-A-MIGRATE-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-MIGRATE-001-03 — 历史盘点、可信映射与不明所有权隔离：失败注入与恢复

### Requirement Refs
`REQ-MIGRATE-001`；对应 `REQ-MIGRATE-001-M3`；共同约束第 11–19、21–24 章。

### Given
第N条映射写入后或隔离向量清理时失败。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
回滚/恢复同一migration run。

### Then
受管可见状态回T0或隔离；用户字节不变；回滚失败保留恢复manifest。

### Oracle
```text
partial_public_mappings === 0 && user_content_digest_equal === true && recovery_manifest_retained === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-MIGRATE-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-MIGRATE-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-MIGRATE-001-03/result.json
assertions: <run_id>/A-MIGRATE-001-03/assertions.json
side_effect_manifest: <run_id>/A-MIGRATE-001-03/side-effects.json
evidence_id: EVID-A-MIGRATE-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CUTOVER-001-01 — 正式切换、旧凭据退出与不绕权回滚：正向与边界

### Requirement Refs
`REQ-CUTOVER-001`；对应 `REQ-CUTOVER-001-M1`；共同约束第 11–19、21–24 章。

### Given
G4通过、历史迁移已核验，维护窗口内旧worker停止。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
执行切换并从旧/新页面发业务请求。

### Then
Gateway唯一出站；旧配置不可被实际使用；两端trace可关联。

### Oracle
```text
tencent_direct_call_count === 0 && active_legacy_workers === 0 && runtime_legacy_secret_reads === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CUTOVER-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CUTOVER-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CUTOVER-001-01/result.json
assertions: <run_id>/A-CUTOVER-001-01/assertions.json
side_effect_manifest: <run_id>/A-CUTOVER-001-01/side-effects.json
evidence_id: EVID-A-CUTOVER-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CUTOVER-001-02 — 正式切换、旧凭据退出与不绕权回滚：负向与禁止项

### Requirement Refs
`REQ-CUTOVER-001`；对应 `REQ-CUTOVER-001-M2`；共同约束第 11–19、21–24 章。

### Given
Gateway返回403或不可达；操作者试图打开legacy fallback或运行旧无门禁构建。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
请求/回滚。

### Then
维持拒绝或维护模式；不绕权、不恢复旧直连。

### Oracle
```text
fallback_enabled === false && old_unguarded_runtime_serving === false && tencent_direct_call_count === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CUTOVER-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CUTOVER-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CUTOVER-001-02/result.json
assertions: <run_id>/A-CUTOVER-001-02/assertions.json
side_effect_manifest: <run_id>/A-CUTOVER-001-02/side-effects.json
evidence_id: EVID-A-CUTOVER-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-CUTOVER-001-03 — 正式切换、旧凭据退出与不绕权回滚：失败注入与恢复

### Requirement Refs
`REQ-CUTOVER-001`；对应 `REQ-CUTOVER-001-M3`；共同约束第 11–19、21–24 章。

### Given
切换配置后候选启动失败，或回滚存储恢复失败。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
执行回滚演练。

### Then
仅恢复已验证安全状态或停留维护；备份不删，恢复可重入。

### Oracle
```text
maintenance_or_safe_rollback === true && rollback_failure_backups_preserved === true && unguarded_reads === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-CUTOVER-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-CUTOVER-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-CUTOVER-001-03/result.json
assertions: <run_id>/A-CUTOVER-001-03/assertions.json
side_effect_manifest: <run_id>/A-CUTOVER-001-03/side-effects.json
evidence_id: EVID-A-CUTOVER-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-COMPAT-001-01 — 保留既有会议规则、OCR与普通工作区行为：正向与边界

### Requirement Refs
`REQ-COMPAT-001`；对应 `REQ-COMPAT-001-M1`；共同约束第 11–19、21–24 章。

### Given
普通workspace、原会议补充文件/文本/OCR；所有配额恰好边界。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
运行旧回归与R2边界矩阵。

### Then
原功能保持；200/10/3小时/100MB/20/500MB边界一致。

### Oracle
```text
ordinary_regression_failures === 0 && quota_constants_changed === false && ocr_config_preserved === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-COMPAT-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-COMPAT-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-COMPAT-001-01/result.json
assertions: <run_id>/A-COMPAT-001-01/assertions.json
side_effect_manifest: <run_id>/A-COMPAT-001-01/side-effects.json
evidence_id: EVID-A-COMPAT-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-COMPAT-001-02 — 保留既有会议规则、OCR与普通工作区行为：负向与禁止项

### Requirement Refs
`REQ-COMPAT-001`；对应 `REQ-COMPAT-001-M2`；共同约束第 11–19、21–24 章。

### Given
配额各超1单位、OCR timeout 4999/300001、请求ASR/Compare/Translation/OA新写入。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
运行负向接口与scope检查。

### Then
边界拒绝；无范围外实现或业务写入。

### Oracle
```text
over_limit_accepts === 0 && oa_writes === 0 && forbidden_feature_calls === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-COMPAT-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-COMPAT-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-COMPAT-001-02/result.json
assertions: <run_id>/A-COMPAT-001-02/assertions.json
side_effect_manifest: <run_id>/A-COMPAT-001-02/side-effects.json
evidence_id: EVID-A-COMPAT-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-COMPAT-001-03 — 保留既有会议规则、OCR与普通工作区行为：失败注入与恢复

### Requirement Refs
`REQ-COMPAT-001`；对应 `REQ-COMPAT-001-M3`；共同约束第 11–19、21–24 章。

### Given
第一份OCR文件超时，第二份合法；网关不可用时操作普通非受管文档。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
继续既有处理队列。

### Then
第一份失败，第二份按原规则完成；普通工作区不被网关故障锁死。

### Oracle
```text
first_source_failed === true && second_source_processed === true && ordinary_operations_succeeded === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-COMPAT-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-COMPAT-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-COMPAT-001-03/result.json
assertions: <run_id>/A-COMPAT-001-03/assertions.json
side_effect_manifest: <run_id>/A-COMPAT-001-03/side-effects.json
evidence_id: EVID-A-COMPAT-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-EVID-001-01 — 可执行验收、追溯矩阵与不可伪绿发布门禁：正向与边界

### Requirement Refs
`REQ-EVID-001`；对应 `REQ-EVID-001-M1`；共同约束第 11–19、21–24 章。

### Given
独立校准fixture具有完整业务AC/GC/阶段manifest结构，标为synthetic，不使用本次待发布run或本AC自身结果。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
运行Gate校准测试和结构检查；实际发布另按第25章校验真实候选manifest。

### Then
校准完整输入返回PASS、退出0；输出仅证明Gate校准，不替代真实产品Evidence。

### Oracle
```text
missing_refs === 0 && mismatched_candidate_evidence === 0 && release_status === "PASS" && exit_code === 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-EVID-001-01
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-EVID-001-01 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-EVID-001-01/result.json
assertions: <run_id>/A-EVID-001-01/assertions.json
side_effect_manifest: <run_id>/A-EVID-001-01/side-effects.json
evidence_id: EVID-A-EVID-001-01
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-EVID-001-02 — 可执行验收、追溯矩阵与不可伪绿发布门禁：负向与禁止项

### Requirement Refs
`REQ-EVID-001`；对应 `REQ-EVID-001-M2`；共同约束第 11–19、21–24 章。

### Given
逐项移除AC证据、改候选SHA、伪造Oracle、SKIPPED、BLOCKED、空测试或旧run。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
运行Gate参数化测试。

### Then
各例FAIL/BLOCKED且退出非0；不得汇总PASS。

### Oracle
```text
negative_gate_accepts === 0 && all_negative_exit_codes_nonzero === true
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-EVID-001-02
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-EVID-001-02 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-EVID-001-02/result.json
assertions: <run_id>/A-EVID-001-02/assertions.json
side_effect_manifest: <run_id>/A-EVID-001-02/side-effects.json
evidence_id: EVID-A-EVID-001-02
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

## A-EVID-001-03 — 可执行验收、追溯矩阵与不可伪绿发布门禁：失败注入与恢复

### Requirement Refs
`REQ-EVID-001`；对应 `REQ-EVID-001-M3`；共同约束第 11–19、21–24 章。

### Given
测试在生成部分证据后中断，或Evidence文件hash被篡改。 固定输入/边界与保护范围见第21章，本case开始前计算T0及用户内容摘要。

### When
重新运行Gate并尝试恢复。

### Then
不覆盖原run；候选不能发布；重跑使用新run并重验hash。

### Oracle
```text
partial_run_released === false && old_run_bytes_preserved === true && exit_code !== 0
```
另验证禁止副作用：`undeclared_mutations === 0`、`secret_canary_leaks === 0`；相关case总数和assertion数大于0。对应输入矩阵的每个适用case都要满足自身断言，不能以一次成功平均覆盖其他失败。

### Evidence
```yaml
test_id: TEST-A-EVID-001-03
command: 'node scripts/meeting-gateway-r2/run-acceptance.cjs --id A-EVID-001-03 --mode fixture --out "$EVIDENCE_ROOT"'
exit_code_for_pass: 0
pre_digest: 按第13章从执行前真实受管与用户范围生成
post_digest: 按第13章从执行后相同范围生成
artifact: <run_id>/A-EVID-001-03/result.json
assertions: <run_id>/A-EVID-001-03/assertions.json
side_effect_manifest: <run_id>/A-EVID-001-03/side-effects.json
evidence_id: EVID-A-EVID-001-03
```
UI Acceptance另有同run截图与DOM/a11y断言；失败Acceptance另有注入点ID、recovery manifest与重启后结果。产物中的 `<run_id>` 是工具本次生成的UUID，不是可以保留的字面占位值。

---

# 21. Acceptance Input Matrix

归属：所有REQ；输入manifest完整性归属REQ-EVID-001。

## 21.1 公共高风险输入分类

| Case | 输入定义 | 预期类别 | 最低适用范围 |
|---|---|---|---|
| normal | 真实合法owner、已批准scope、完整数据 | 按正向Oracle | 全部REQ |
| empty | 空列表/空todo/空正文/空输入分别区分 | 空snapshot可成功；空todo可成功；未知空正文不可READY | QUERY、CONTENT、UI、CONFIG |
| missing | 缺ms、member、scope、source_version、字段、依赖文件 | 明确错误、零业务扩权 | 身份/契约/配置/内容/导入/安全 |
| existing | 已绑定/已导入/已配置/已撤销状态 | 返回现有或按状态拒绝，不重复写 | IDENT、AUTH、OAUTH、IMPORT、REVOKE |
| duplicate | 同键同参、同键异参、重复cursor/段落 | 复用/409/完整性失败分别处理 | QUERY、CONTENT、IMPORT、TXN |
| drifted | 配置、用户revision、文件、owner/epoch、契约在计划后变化 | BLOCK + PRESERVE | CONTRACT、CONFIG、DATA、TXN、MIGRATE |
| partial | 第N页未完成、第二录制缺内容、Collector/向量只写一边 | 不发布完整可用状态 | QUERY、CONTENT、IMPORT、TXN |
| invalid | 外企业、错误audience、非法路径、未知enum、自报member | 拒绝、无秘密或内容泄漏 | 全部涉及输入REQ |
| boundary | 恰好/超过期限、窗口、配额、大小、并发和分页最大值 | 明确边界，不截断假成功 | AUTH、QUERY、CONTENT、COMPAT、SEC |
| retry | 同operation、相同version、refresh并发与未知结果 | 同主体原操作恢复；禁止盲重发 | AUTH、OAUTH、QUERY、IMPORT、TXN |
| failure | 401/403/429/5xx/timeout/进程kill/权限撤销 | §19确定错误与恢复 | 全部REQ |
| rollback | 业务写后失败；逆操作失败；证据写失败 | T0或不可见RECOVERY_REQUIRED；备份保留 | IDENT、CONFIG、DATA、IMPORT、TXN、MIGRATE、CUTOVER、EVID |

每个高风险REQ的manifest至少含normal、一个invalid/deny、一个failure，并执行下表所有与该REQ语义相关的类别。新接口无真实依赖不允许标N/A；其golden为BLOCKED。

## 21.2 Requirement 输入映射

| Requirement | 输入覆盖 | Acceptance | 保护范围 |
|---|---|---|---|
| REQ-CONTRACT-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-CONTRACT-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-PROVIDER-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-PROVIDER-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-IDENT-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-IDENT-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-IDENT-002 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-IDENT-002-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-AUTH-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-AUTH-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-CONFIG-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-CONFIG-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-RUNTIME-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-RUNTIME-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-OAUTH-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-OAUTH-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-UI-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-UI-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-UI-002 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-UI-002-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-UI-003 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-UI-003-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-QUERY-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-QUERY-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-CONTENT-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-CONTENT-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-IMPORT-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-IMPORT-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-DATA-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-DATA-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-WORKSPACE-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-WORKSPACE-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-ACCESS-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-ACCESS-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-RAG-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-RAG-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-REVOKE-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-REVOKE-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-TXN-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-TXN-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-SEC-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-SEC-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-OBS-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-OBS-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-MIGRATE-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-MIGRATE-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-CUTOVER-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-CUTOVER-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-COMPAT-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-COMPAT-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |
| REQ-EVID-001 | 正向fixture、empty/missing、existing/duplicate、invalid/boundary；适用的drift/partial/retry/failure/rollback | A-EVID-001-01 / 02 / 03 | owner/session、契约、DB/file/vector/network范围按本项固定；非适用项需写N/A理由，不得跳过负向或失败case |

## 21.3 关键边界数值

SSO事务299/300/301秒；result ticket59/60/61秒；bridge899/900/901秒与任意上游更短期限；source健康59/60/61秒；query窗口0/1秒/90天/90天+1秒；半开窗口起点与终点；1/2录制、1/2/10000/10001页；转写总范围3小时及+1ms；会议199/200/201条；问答9/10/11场；文件99,999,999/100,000,000/100,000,001 bytes；文件数19/20/21；会议499,999,999/500,000,000/500,000,001 bytes；OCR4999/5000/120000/300000/300001ms。

并发最少覆盖同身份2个登录完成请求（不创建/改写映射）、2个refresh、2个query同key、2个import同identity、2个worker抢同generation，以及100个并发只读状态请求。超时测试使用可控时钟/网络，不要求测试真实等待900秒，但真实TTL来源须在golden核验。

---

# 22. Negative Acceptance

归属：第10章全部M2；对应下表。每个负向case附“拒绝之前与之后”的受管/用户/源范围证明，不能只断言HTTP不是200。

| Negative AC | 攻击/禁止输入 | 错误类别 | 必须证明的拒绝行为 |
|---|---|---|---|
| A-CONTRACT-001-02 | 给定仅格式合法但字节摘要错误的契约；或 ms 字段缺失；或未知状态。 | MGW_UPSTREAM_CONTRACT_ERROR | 阻断；不建立可用业务会话，不返回空列表。 |
| A-PROVIDER-001-02 | B提交A的job/asset/connection；或请求体伪造member。 | MGW_RESOURCE_NOT_ACCESSIBLE | 拒绝未知字段或返回不可访问；无正文与跨人状态。 |
| A-IDENT-001-02 | 分别给出重放票据、不同state、PKCE错误、外企业、不同audience、自报userid。 | MGW_IDENTITY_ASSERTION_INVALID | 各例拒绝；不创建可用本地会话或绑定。 |
| A-IDENT-002-02 | B伪造A的本地映射；同名未准入员工登录；上游返回admin角色。 | MGW_IDENTITY_BINDING_CONFLICT | 冲突拒绝、未准入不建会话、local role不提升。 |
| A-AUTH-001-02 | 分别使用local JWT、裸userid、B的bridge、MCP audience令牌或禁用账号桥。 | MGW_BUSINESS_AUTH_REQUIRED | 拒绝，不退回公用token。 |
| A-CONFIG-001-02 | 普通用户保存；过期If-Match；origin为任意外站；provider=tencent_direct。 | MGW_CONFIG_REJECTED | 各例拒绝，last_applied不变。 |
| A-RUNTIME-001-02 | sessions.gateway或oauth为null；或contract不匹配；Gateway返回403。 | MGW_RUNTIME_NOT_READY | 503/403准确暴露，直连构造器和请求不被触发。 |
| A-OAUTH-001-02 | 逐项篡改corp_id/sdk_id/redirect_uri/state；重复query；连接属于B或CORP_MISMATCH。 | MGW_OAUTH_CONFIRM_DENIED | 全部拒绝；不导航到恶意URL；不改变连接。 |
| A-UI-001-02 | Gateway企业微信认证未就绪、外企业、profile读取失败、扫码认证取消、403和401各一例。 | MGW_IDENTITY_NOT_READY | 无假二维码/假成功；受限按钮不可触发数据读取。 |
| A-UI-002-02 | 普通用户访问settings；管理员收到capability UNKNOWN；错误Gateway Origin。 | MGW_CONFIG_REJECTED | 无权限用户不可写；能力不可编辑；错误可定位。 |
| A-UI-003-02 | 源作业RETRYING/FAILED；正文NOT_READY；权限DENIED各一例。 | MGW_SOURCE_NOT_READY | 分别显示状态和下一动作；不能进入问答或把失败视为零结果。 |
| A-QUERY-001-02 | B使用A的query_id；大于90天窗口；伪造target_member_id；重复cursor。 | MGW_QUERY_SCOPE_INVALID | 对应拒绝；不创建越权源作业，不泄露结果。 |
| A-CONTENT-001-02 | 游标循环、页间version变化、相同段落ID异文、无时间戳或累计超过3小时。 | MGW_CONTENT_INCOMPLETE | 返回确定完整性/范围错误，不发布部分全文。 |
| A-IMPORT-001-02 | B使用A的来源/目标工作区；同键不同选择；浏览器提交自报member或正文。 | MGW_IMPORT_SCOPE_CONFLICT | 拒绝并保持配额/文档/向量T0。 |
| A-DATA-001-02 | 直接PATCH原文或以旧revision提交覆盖；模型输出请求改写原生标签。 | MGW_CONTENT_REVISION_CONFLICT | 拒绝，原文和用户revision不变。 |
| A-WORKSPACE-001-02 | owner尝试添加成员、share/embed/copy/move/sync或导入到普通workspace。 | MGW_WORKSPACE_POLICY_DENIED | 全部拒绝，不改变成员/位置/共享配置。 |
| A-ACCESS-001-02 | 管理员/global key/body.userId=A/直接localId/已过期bridge分别访问受管资料。 | MGW_RESOURCE_NOT_ACCESSIBLE | 全部拒绝；对资源不存在和跨人返回统一不可访问。 |
| A-RAG-001-02 | B、全局API key、public embed或已失权历史会话包含canary。 | MGW_RAG_ACCESS_DENIED | 拒绝受限资料，不调用模型，不返回canary。 |
| A-REVOKE-001-02 | 用户试图凭本地READY恢复已撤销源；或owner以外调用解绑。 | MGW_ACCESS_REVOKED | 拒绝，不恢复权限，不操作他人会话。 |
| A-TXN-001-02 | 陈旧worker、错误owner、篡改receipt或docId、越界路径。 | MGW_TRANSACTION_CONFLICT | 拒绝且不覆盖当前活动版本、不删除他人文件。 |
| A-SEC-001-02 | 注入SSRF、DNS rebinding、重定向、path traversal、symlink、CSRF、正文工具指令。 | MGW_SECURITY_REJECTED | 对应拒绝；无上游越界、文件越界、任意工具执行。 |
| A-OBS-001-02 | 上游error带token与会议全文，未知reason和重复header。 | MGW_UPSTREAM_CONTRACT_ERROR | 只输出安全code与脱敏trace，不回显上游body。 |
| A-MIGRATE-001-02 | 仅标题/时间匹配；owner不一致；plan后文件漂移。 | MGW_MIGRATION_DRIFT | 阻断对应项或全run；无猜测映射、删除和自动覆盖。 |
| A-CUTOVER-001-02 | Gateway返回403或不可达；操作者试图打开legacy fallback或运行旧无门禁构建。 | MGW_CUTOVER_BLOCKED | 维持拒绝或维护模式；不绕权、不恢复旧直连。 |
| A-COMPAT-001-02 | 配额各超1单位、OCR timeout 4999/300001、请求ASR/Compare/Translation/OA新写入。 | MGW_COMPAT_SCOPE_VIOLATION | 边界拒绝；无范围外实现或业务写入。 |
| A-EVID-001-02 | 逐项移除AC证据、改候选SHA、伪造Oracle、SKIPPED、BLOCKED、空测试或旧run。 | MGW_RELEASE_EVIDENCE_INVALID | 各例FAIL/BLOCKED且退出非0；不得汇总PASS。 |

共通负向Oracle：无跨人正文、无越界网络、无未声明业务写入、无秘密泄漏、无直连fallback、无未知所有权删除。对允许追加审计的操作，审计变化不被误计为“0 bytes changed”；业务/文件/源范围分别统计。

---

# 23. Failure Injection

归属：REQ-IDENT-001/002、REQ-AUTH-001、REQ-OAUTH-001、REQ-QUERY-001、REQ-CONTENT-001、REQ-IMPORT-001、REQ-DATA-001、REQ-TXN-001、REQ-REVOKE-001、REQ-MIGRATE-001、REQ-CUTOVER-001、REQ-EVID-001。

| FI ID | 注入点 | 预期持久状态 / postcondition | Acceptance |
|---|---|---|---|
| FI-01 | 首次业务写入前validation失败 | 业务T0不变，无源写入，只有拒绝审计 | 各REQ的02；A-TXN-001-03 |
| FI-02 | 外部身份票据兑换已发出、receipt返回前断网 | 不重放票据；SSO恢复/阻断；无假本地登录 | A-IDENT-001-03、A-AUTH-001-03 |
| FI-03 | Gateway认证兑换成功后、本地session commit前失败 | 本地单库业务回T0；上游认证结果不宣称回滚；Gateway member/alias写请求为0 | A-IDENT-002-03 |
| FI-04 | OAuth/源查询提交后response丢失 | 原Idempotency-Key/事务恢复；一个事务/job | A-OAUTH-001-03、A-QUERY-001-03 |
| FI-05 | 源查询/转写第N页失败、游标停滞、版本改变 | 未完整不发布；旧snapshot/版本不拼接 | A-QUERY-001-03、A-CONTENT-001-03 |
| FI-06 | Collector写文件后、返回receipt前kill | 通过稳定operation/docId查询receipt；无随机重写 | A-IMPORT-001-03、A-TXN-001-03 |
| FI-07 | receipt已收、Consumer关联DB commit前kill | orphan保持私有；恢复关联同docId或受控清理 | A-TXN-001-03 |
| FI-08 | 向量写入第N批后失败 | 无active_generation；按同docId核验/补偿；部分向量不被RAG使用 | A-TXN-001-03 |
| FI-09 | 文件/向量verify阶段权限撤销或epoch变化 | 不发布；access锁定；原owner不替换 | A-WORKSPACE-001-03、A-ACCESS-001-03 |
| FI-10 | 检索后、LLM前失权 | LLM调用数0，本次context丢弃 | A-RAG-001-03 |
| FI-11 | 生成流式期间观察到撤销 | 停止后续输出；最多5秒复核周期；已发送字节不声称回收 | A-RAG-001-03 |
| FI-12 | 租约续租hang/过期，另一worker接管 | 旧worker停止新副作用、旧fence提交0；一个active generation | A-TXN-001-01/03 |
| FI-13 | 拒绝锁commit后向量删除超时 | 保持DENIED/PENDING_CLEANUP，不恢复allow | A-REVOKE-001-03 |
| FI-14 | migration第N项后失败、rollback逆操作失败 | 维护/隔离；用户内容digest不变；备份与恢复清单保留 | A-MIGRATE-001-03、A-CUTOVER-001-03 |
| FI-15 | 配置/密钥引用提交中断或key轮换中断 | last_applied配置一致；仍被引用的旧key保留 | A-CONFIG-001-03、A-SEC-001-03 |
| FI-16 | 业务commit成功、日志sink/Evidence写入失败 | 不重放业务；审计outbox重试；无Evidence则Release不通过 | A-OBS-001-03、A-EVID-001-03 |
| FI-17 | 用户修订行已写、活动revision未commit | 可见revision与业务范围回T0 | A-DATA-001-03 |
| FI-18 | 首个OCR任务超时、队列仍有后续文件 | 单源失败、后续继续；普通workspace不受网关故障影响 | A-COMPAT-001-03 |

每个FI记录注入时刻、实际阶段、operation/generation/fence、pre/post manifests、HTTP/network记录、恢复命令、重启后读取结果。只抛异常但未检查落盘/向量/可见状态，不算该FI通过。

---

# 24. Evidence Contract

归属：REQ-EVID-001、REQ-OBS-001；各业务REQ的Evidence字段共同适用。

## 24.1 Evidence Schema：`meeting-r2-evidence.v2`

required：schema_version、evidence_id、acceptance_id、requirement_ids、test_ids、case_ids、run_id、candidate_build_id、status、command、exit_code、executed_at、tool_versions、source_revisions、configuration_digest、fixture_or_golden_profile_digest、pre_digest、post_digest、oracle、assertion_count、evidence_files、evidence_file_digests、side_effect_manifest_ref。

`status` 为PASS/FAIL/SKIPPED/BLOCKED。未执行的BLOCKED允许exit_code和executed_at为null，但它永远不满足PASS。PASS要求：命令实际执行、exit_code=0、assertion_count>0、case_ids满足固定manifest、oracle expected/actual类型相同并相等、所有文件存在且hash匹配、候选版本/配置一致。数组字段不能用空数组绕过必需测试。

`source_revisions` 包含Consumer/Gateway各自repo、branch、full SHA、clean/dirty；dirty必须附精确patch文件与摘要。真实验收还包含Gateway企业微信Consumer契约lock/部署版本、Gateway部署镜像digest、Collector/向量/模型版本。

`oracle`：`{type:"machine_assertion",expression:string,expected:typed-value,actual:typed-value,observation_refs:[...]}`。不得只写“结果正确”，不得以实际输出反向生成expected。

## 24.2 产物结构

```text
evidence/<candidate_build_id>/<run_id>/
  run-manifest.json
  source-manifest.json
  configuration.redacted.json
  <AC-ID>/
    result.json
    assertions.json
    fixture-manifest.json
    side-effects.json
    pre-manifest.json
    post-manifest.json
    execution.redacted.log
    screenshots/                 # 仅UI用例
    recovery-manifest.redacted.json  # 仅恢复用例
  golden/<GC-ID>/...
  gates/G1.json ... G5.json
  release-result.json
```

每项evidence_files列出实际文件；不能预先填不存在的路径。机密身份/正文的原始HTTP材料只存在隔离验收库，分享Evidence仅包含结构断言、脱敏值与摘要。

## 24.3 执行工具契约（NEW，不宣称已实现）

| 工具 | 必须支持的输入 | 输出 / 退出码 |
|---|---|---|
| `validate-spec.cjs` | `--prd <path>` | 37章、REQ/AC/Invariant/Test/Evidence引用校验；错误退出2 |
| `run-acceptance.cjs` | `--id <AC>` 或 `--golden <GC>`，mode、profile、out | 每个case实际assertion及manifest；PASS=0、FAIL=1、BLOCKED=2 |
| `release-gate.cjs` R2模式 | `--manifest <path>` | 检查全Required集合、候选/配置、文件hash、GC/G1-G5、meta测试；PASS=0，否则1/2 |
| `migration.cjs` | `inventory,diff,resolve,apply,verify,rollback`；`--run`、`--plan-digest`、`--out` | 副作用清单、mapping、T0、逐项结果；无审批apply拒绝；无force选项 |

工具名/参数在计划中按照本文实现。测试入口文件存在不表示运行过；运行工具输出的真实状态进入Gate。

## 24.4 Evidence Integrity 与保留

Evidence manifest附HMAC-SHA256签名，密钥由CI/验收环境持有，不与Gateway/用户密码共用；manifest包括每个文件sha256。Gate验证签名与文件，而不是信任任意磁盘JSON。最终可分享报告只含签名验证结果，不含签名密钥。

同run不能覆盖旧证据；重跑创建新UUID。对同一候选选择一组明确run_id，不能拼接不同配置或不同源码的PASS。Evidence保留180天；含正文的恢复备份按§14.4独立管理，不能以Evidence保留到期删除正在恢复的数据。

---

# 25. Release Gate

**以下G1–G5与最终Release Oracle针对完整R2，不是AUTH_LOCAL_SEARCH阶段的完成条件。当前阶段用§4.6独立Phase gate；导入与相关G4/G5验收为后续阶段，不伪造PASS。**

归属：REQ-EVID-001；业务与安全Owner不得用进度百分比替代Gate。

## 25.1 五阶段 Gate

| Gate | 对应阶段/结果 | Required证明 | 不能依赖的未来结果 |
|---|---|---|---|
| G1 | S1 / D1契约基础 | PRD批准；固定基线；EXISTING样本与字段映射；NEW API schema与契约fixture；Gateway Owner的实际Consumer契约lock和责任签约；无未裁决语义 | 不要求NEW API先通过生产验收，避免先实现才允许定义契约 |
| G2 | S2 / D1接入收口 | CONTRACT/PROVIDER/IDENT/AUTH/CONFIG/RUNTIME/OAUTH的服务级测试；真实装配；新增API可调用；真实员工身份与已知会议读样本；无直连 | 不以UI已完成作为条件；依赖接口未部署则BLOCKED |
| G3 | S3 / D2页面闭环 | UI-001/002/003全部AC；QUERY/CONTENT对应服务测试；真实企业微信登录/会议授权页面链路 | 不能凭截图证明权限闭环或允许生产开放 |
| G4 | S4 / D3权限数据闭环 | IMPORT/DATA/WORKSPACE/ACCESS/RAG/REVOKE/TXN/SEC的全部AC；全部FI；read-path coverage=100%；真实A/B越权/撤销 | 不依赖最终release-result自身 |
| G5 | S5 / D3迁移验收 | MIGRATE/CUTOVER/COMPAT/OBS/EVID测试；真实迁移/回滚GC；旧流量与凭据退出；普通workspace回归 | 只汇总本阶段Evidence，不以最终Release PASS为前置 |

阶段门禁清单在run manifest列出准确AC/GC集合与证据run。任一阶段BLOCKED，后续阶段不能标完成；前期可以准备不依赖该结果的测试/文档，但不能跨越真实运行与生产开放门禁。

## 25.2 最终 Release Oracle

集合定义：`BUSINESS_AC = 第20章除A-EVID-001-01/02/03外的全部AC`；`GATE_META_AC = A-EVID-001-01/02/03`；`GOLDEN = GC-01…GC-08`；`STAGES = G1…G5`。

```text
Release PASS =
  PRD.status == APPROVED_FOR_PLAN or later approved implementation state
  AND all BUSINESS_AC == PASS
  AND all GATE_META_AC == PASS
  AND all GOLDEN == PASS
  AND all STAGES == PASS
  AND source/config/build identities match selected evidence
  AND all evidence signatures/files/digests verify
  AND no unreviewed scope/ownership drift
```

门禁状态只允许PASS/FAIL/SKIPPED/BLOCKED。Required项`!=PASS`则最终Release非PASS，进程退出码非0；SKIPPED/BLOCKED不被权重或平均值抵消。当前PRD仍REVIEW，因此本次不能生成Release PASS。

## 25.3 避免自证循环

Gate自身的三个测试使用独立标记为synthetic的校准manifest验证完整输入、缺失/篡改输入、执行中断行为，校准数据不包含这些测试自己的运行结果，不用于证明真实业务通过。最终Gate读取这三个独立测试的执行Evidence，加上真实业务/GC/阶段Evidence；它不要求自己先生成release-result=PASS再证明自己通过。

R1已有release-gate工具仅作复用资产，R2的Required集合/版本和Oracle显式升级。R1的旧PASS不能替代R2任意AC。[SRC-14]

---

# 26. Golden Consumer / Real-world Acceptance

**下述8个GC是完整R2的未来验收基线；涉及远端导入、迁移、完整性和审核的GC不属于当前AUTH_LOCAL_SEARCH阶段Required集合。本阶段真实验收按§4.6执行，不以尚未执行的导入GC阻断，也不将其标PASS。**

归属：REQ-EVID-001及所列业务REQ。下面8项全部Required；Synthetic Fixture不能替代真实Consumer。

| Golden ID | 真实场景 / Given与When | Then / Machine Oracle | 关联REQ |
|---|---|---|---|
| GC-01 | 真实企业已准入员工A、B，从实际Consumer企业微信入口完成认证；另一个真实未准入员工C尝试登录 | A/B各自身份issuer/corp/member与实际记录一致；C无可用本地主会话；浏览器无Gateway/Tencent token | IDENT-001/002、AUTH、UI-001 |
| GC-02 | A在真实页面发起腾讯OAuth，完成本人待确认/确认；用真实Gateway再读连接 | ACTIVE来源为Gateway；授权URL四参数匹配；Consumer未保存腾讯token；错企业case在fixture补充 | OAUTH、UI-001、PROVIDER |
| GC-03 | A查询一个有已知会议样本M1的真实时间窗口并等待实际源job终态 | job=SUCCEEDED且snapshot complete；真实样本M1存在；202/RETRYING未被当空；窗口外样本不进入 | QUERY、UI-003、RUNTIME |
| GC-04 | 真实有转写/纪要的录制样本导入本人受限workspace，审核后问答 | 段落/版本/录制关联可核验；原生纪要类型保留；active generation与稳定docId一致；引用可定位 | CONTENT、IMPORT、DATA、TXN、RAG |
| GC-05 | B及非owner本地管理员使用A的真实localId、源文件、会话、workspace、job；另测全局key/public embed | 未授权正文bytes=0；source存在性无额外泄漏；被拒问答LLM调用=0；全部登记路径有Evidence | WORKSPACE、ACCESS、RAG、SEC |
| GC-06 | 在验收账号范围撤销A本地会话/停用或Gateway权限；访问已导入内容与历史 | 撤销后新请求deny；来源健康期限到后无法复核即不可用；清理失败仍deny；不宣称擦除已下载资料 | REVOKE、ACCESS、RAG、AUTH |
| GC-07 | 对授权副本的真实历史会议DB/文件/向量执行inventory/diff/映射/隔离/切换，包含一条unknown owner和一条人工修订 | localId及用户内容digest保持；unknown字节保留且不可读；再apply零新增变更；Consumer腾讯直连请求=0 | MIGRATE、CUTOVER、CONFIG、DATA |
| GC-08 | 在同一候选构建执行中断恢复/切换回滚演练，并运行实际普通workspace/OCR流程 | T0或明确RECOVERY_REQUIRED且不可见；备份可恢复；普通workspace不被会议网关故障锁死；无OA写 | TXN、CUTOVER、COMPAT、OBS |

## 26.1 Golden Consumer Record

每次记录：两个repo完整身份/HEAD SHA/branch/clean或dirty patch摘要；候选镜像/构建ID；实际Gateway/Collector/向量版本（Gateway内部身份服务版本由其owner持有证据，不要求Consumer直接调用）；配置与Gateway企业微信Consumer契约lock摘要；真实用户脱敏ID、角色与授权范围；会前已知样本清单；before/after DB与文件/向量快照；腾讯样本business_source_digest；用户自有content_digest；执行命令、时间、结果与原始受控Evidence位置。

真实正文不放进可公开报告，但验证执行者必须在受控验收库中核对段落/来源，不能仅凭自己填写的“文本正确”。腾讯源业务前后digest只比较本次授权样本的稳定业务字段；查询导致网关缓存/审计变化不误判为腾讯源写入。

## 26.2 真实环境副作用授权

身份/连接授权、验收workspace写入、权限撤销与清理只对批准的测试员工/样本执行。任何不在清单内的用户、会议、工作区、腾讯应用或OA系统都是禁止写入范围。无权限做真实撤销演练时GC-06为BLOCKED，不用fixture替代为PASS。

---

# 27. Requirement Traceability Matrix

**本矩阵REQUIRED表示完整R2范围；当前阶段执行§4.6的Required映射。REQ-IMPORT-001及其AC明确为DEFERRED_CURRENT_PHASE，其余条款的导入依赖部分同样延后。**

归属：REQ-EVID-001。所有ID映射以本表与第10/20章为准，不以文件存在替代覆盖。

| Requirement | Invariant | Acceptance | Test | Evidence | Release Gate / 推进位置 |
|---|---|---|---|---|---|
| REQ-CONTRACT-001 | INV-CONTRACT-001-01/02 | A-CONTRACT-001-01<br>A-CONTRACT-001-02<br>A-CONTRACT-001-03 | TEST-A-CONTRACT-001-01<br>TEST-A-CONTRACT-001-02<br>TEST-A-CONTRACT-001-03 | EVID-A-CONTRACT-001-01<br>EVID-A-CONTRACT-001-02<br>EVID-A-CONTRACT-001-03 | REQUIRED；S1 / D1 |
| REQ-PROVIDER-001 | INV-PROVIDER-001-01/02 | A-PROVIDER-001-01<br>A-PROVIDER-001-02<br>A-PROVIDER-001-03 | TEST-A-PROVIDER-001-01<br>TEST-A-PROVIDER-001-02<br>TEST-A-PROVIDER-001-03 | EVID-A-PROVIDER-001-01<br>EVID-A-PROVIDER-001-02<br>EVID-A-PROVIDER-001-03 | REQUIRED；S1契约 / S2实现 / D1 |
| REQ-IDENT-001 | INV-IDENT-001-01/02 | A-IDENT-001-01<br>A-IDENT-001-02<br>A-IDENT-001-03 | TEST-A-IDENT-001-01<br>TEST-A-IDENT-001-02<br>TEST-A-IDENT-001-03 | EVID-A-IDENT-001-01<br>EVID-A-IDENT-001-02<br>EVID-A-IDENT-001-03 | REQUIRED；S1契约 / S2服务 / D3基础 |
| REQ-IDENT-002 | INV-IDENT-002-01/02 | A-IDENT-002-01<br>A-IDENT-002-02<br>A-IDENT-002-03 | TEST-A-IDENT-002-01<br>TEST-A-IDENT-002-02<br>TEST-A-IDENT-002-03 | EVID-A-IDENT-002-01<br>EVID-A-IDENT-002-02<br>EVID-A-IDENT-002-03 | REQUIRED；S1模型 / S2实现 / D3基础 |
| REQ-AUTH-001 | INV-AUTH-001-01/02 | A-AUTH-001-01<br>A-AUTH-001-02<br>A-AUTH-001-03 | TEST-A-AUTH-001-01<br>TEST-A-AUTH-001-02<br>TEST-A-AUTH-001-03 | EVID-A-AUTH-001-01<br>EVID-A-AUTH-001-02<br>EVID-A-AUTH-001-03 | REQUIRED；S2 / D1 |
| REQ-CONFIG-001 | INV-CONFIG-001-01/02 | A-CONFIG-001-01<br>A-CONFIG-001-02<br>A-CONFIG-001-03 | TEST-A-CONFIG-001-01<br>TEST-A-CONFIG-001-02<br>TEST-A-CONFIG-001-03 | EVID-A-CONFIG-001-01<br>EVID-A-CONFIG-001-02<br>EVID-A-CONFIG-001-03 | REQUIRED；S2 / D1 |
| REQ-RUNTIME-001 | INV-RUNTIME-001-01/02 | A-RUNTIME-001-01<br>A-RUNTIME-001-02<br>A-RUNTIME-001-03 | TEST-A-RUNTIME-001-01<br>TEST-A-RUNTIME-001-02<br>TEST-A-RUNTIME-001-03 | EVID-A-RUNTIME-001-01<br>EVID-A-RUNTIME-001-02<br>EVID-A-RUNTIME-001-03 | REQUIRED；S2 / D1 |
| REQ-OAUTH-001 | INV-OAUTH-001-01/02 | A-OAUTH-001-01<br>A-OAUTH-001-02<br>A-OAUTH-001-03 | TEST-A-OAUTH-001-01<br>TEST-A-OAUTH-001-02<br>TEST-A-OAUTH-001-03 | EVID-A-OAUTH-001-01<br>EVID-A-OAUTH-001-02<br>EVID-A-OAUTH-001-03 | REQUIRED；S2 / D1 |
| REQ-UI-001 | INV-UI-001-01/02 | A-UI-001-01<br>A-UI-001-02<br>A-UI-001-03 | TEST-A-UI-001-01<br>TEST-A-UI-001-02<br>TEST-A-UI-001-03 | EVID-A-UI-001-01<br>EVID-A-UI-001-02<br>EVID-A-UI-001-03 | REQUIRED；S3 / D2 |
| REQ-UI-002 | INV-UI-002-01/02 | A-UI-002-01<br>A-UI-002-02<br>A-UI-002-03 | TEST-A-UI-002-01<br>TEST-A-UI-002-02<br>TEST-A-UI-002-03 | EVID-A-UI-002-01<br>EVID-A-UI-002-02<br>EVID-A-UI-002-03 | REQUIRED；S3 / D2 |
| REQ-UI-003 | INV-UI-003-01/02 | A-UI-003-01<br>A-UI-003-02<br>A-UI-003-03 | TEST-A-UI-003-01<br>TEST-A-UI-003-02<br>TEST-A-UI-003-03 | EVID-A-UI-003-01<br>EVID-A-UI-003-02<br>EVID-A-UI-003-03 | REQUIRED；S3 / D2 |
| REQ-QUERY-001 | INV-QUERY-001-01/02 | A-QUERY-001-01<br>A-QUERY-001-02<br>A-QUERY-001-03 | TEST-A-QUERY-001-01<br>TEST-A-QUERY-001-02<br>TEST-A-QUERY-001-03 | EVID-A-QUERY-001-01<br>EVID-A-QUERY-001-02<br>EVID-A-QUERY-001-03 | REQUIRED；S2服务 / S3页面 / D1与D2 |
| REQ-CONTENT-001 | INV-CONTENT-001-01/02 | A-CONTENT-001-01<br>A-CONTENT-001-02<br>A-CONTENT-001-03 | TEST-A-CONTENT-001-01<br>TEST-A-CONTENT-001-02<br>TEST-A-CONTENT-001-03 | EVID-A-CONTENT-001-01<br>EVID-A-CONTENT-001-02<br>EVID-A-CONTENT-001-03 | REQUIRED；S2适配 / S4验收 / D3 |
| REQ-IMPORT-001 | INV-IMPORT-001-01/02 | A-IMPORT-001-01<br>A-IMPORT-001-02<br>A-IMPORT-001-03 | TEST-A-IMPORT-001-01<br>TEST-A-IMPORT-001-02<br>TEST-A-IMPORT-001-03 | EVID-A-IMPORT-001-01<br>EVID-A-IMPORT-001-02<br>EVID-A-IMPORT-001-03 | REQUIRED；S4 / D3 |
| REQ-DATA-001 | INV-DATA-001-01/02 | A-DATA-001-01<br>A-DATA-001-02<br>A-DATA-001-03 | TEST-A-DATA-001-01<br>TEST-A-DATA-001-02<br>TEST-A-DATA-001-03 | EVID-A-DATA-001-01<br>EVID-A-DATA-001-02<br>EVID-A-DATA-001-03 | REQUIRED；S4 / D3 |
| REQ-WORKSPACE-001 | INV-WORKSPACE-001-01/02 | A-WORKSPACE-001-01<br>A-WORKSPACE-001-02<br>A-WORKSPACE-001-03 | TEST-A-WORKSPACE-001-01<br>TEST-A-WORKSPACE-001-02<br>TEST-A-WORKSPACE-001-03 | EVID-A-WORKSPACE-001-01<br>EVID-A-WORKSPACE-001-02<br>EVID-A-WORKSPACE-001-03 | REQUIRED；S4 / D3 |
| REQ-ACCESS-001 | INV-ACCESS-001-01/02 | A-ACCESS-001-01<br>A-ACCESS-001-02<br>A-ACCESS-001-03 | TEST-A-ACCESS-001-01<br>TEST-A-ACCESS-001-02<br>TEST-A-ACCESS-001-03 | EVID-A-ACCESS-001-01<br>EVID-A-ACCESS-001-02<br>EVID-A-ACCESS-001-03 | REQUIRED；S4 / D3 |
| REQ-RAG-001 | INV-RAG-001-01/02 | A-RAG-001-01<br>A-RAG-001-02<br>A-RAG-001-03 | TEST-A-RAG-001-01<br>TEST-A-RAG-001-02<br>TEST-A-RAG-001-03 | EVID-A-RAG-001-01<br>EVID-A-RAG-001-02<br>EVID-A-RAG-001-03 | REQUIRED；S4 / D3 |
| REQ-REVOKE-001 | INV-REVOKE-001-01/02 | A-REVOKE-001-01<br>A-REVOKE-001-02<br>A-REVOKE-001-03 | TEST-A-REVOKE-001-01<br>TEST-A-REVOKE-001-02<br>TEST-A-REVOKE-001-03 | EVID-A-REVOKE-001-01<br>EVID-A-REVOKE-001-02<br>EVID-A-REVOKE-001-03 | REQUIRED；S4 / D3 |
| REQ-TXN-001 | INV-TXN-001-01/02 | A-TXN-001-01<br>A-TXN-001-02<br>A-TXN-001-03 | TEST-A-TXN-001-01<br>TEST-A-TXN-001-02<br>TEST-A-TXN-001-03 | EVID-A-TXN-001-01<br>EVID-A-TXN-001-02<br>EVID-A-TXN-001-03 | REQUIRED；S4 / D3 |
| REQ-SEC-001 | INV-SEC-001-01/02 | A-SEC-001-01<br>A-SEC-001-02<br>A-SEC-001-03 | TEST-A-SEC-001-01<br>TEST-A-SEC-001-02<br>TEST-A-SEC-001-03 | EVID-A-SEC-001-01<br>EVID-A-SEC-001-02<br>EVID-A-SEC-001-03 | REQUIRED；S1规则 / S2基础 / S4全量 / D1与D3 |
| REQ-OBS-001 | INV-OBS-001-01/02 | A-OBS-001-01<br>A-OBS-001-02<br>A-OBS-001-03 | TEST-A-OBS-001-01<br>TEST-A-OBS-001-02<br>TEST-A-OBS-001-03 | EVID-A-OBS-001-01<br>EVID-A-OBS-001-02<br>EVID-A-OBS-001-03 | REQUIRED；S2基础 / S3呈现 / S5审计 |
| REQ-MIGRATE-001 | INV-MIGRATE-001-01/02 | A-MIGRATE-001-01<br>A-MIGRATE-001-02<br>A-MIGRATE-001-03 | TEST-A-MIGRATE-001-01<br>TEST-A-MIGRATE-001-02<br>TEST-A-MIGRATE-001-03 | EVID-A-MIGRATE-001-01<br>EVID-A-MIGRATE-001-02<br>EVID-A-MIGRATE-001-03 | REQUIRED；S5 / D3 |
| REQ-CUTOVER-001 | INV-CUTOVER-001-01/02 | A-CUTOVER-001-01<br>A-CUTOVER-001-02<br>A-CUTOVER-001-03 | TEST-A-CUTOVER-001-01<br>TEST-A-CUTOVER-001-02<br>TEST-A-CUTOVER-001-03 | EVID-A-CUTOVER-001-01<br>EVID-A-CUTOVER-001-02<br>EVID-A-CUTOVER-001-03 | REQUIRED；S5 / D1最终收口 |
| REQ-COMPAT-001 | INV-COMPAT-001-01/02 | A-COMPAT-001-01<br>A-COMPAT-001-02<br>A-COMPAT-001-03 | TEST-A-COMPAT-001-01<br>TEST-A-COMPAT-001-02<br>TEST-A-COMPAT-001-03 | EVID-A-COMPAT-001-01<br>EVID-A-COMPAT-001-02<br>EVID-A-COMPAT-001-03 | REQUIRED；S5 / 三项结果共同 |
| REQ-EVID-001 | INV-EVID-001-01/02 | A-EVID-001-01<br>A-EVID-001-02<br>A-EVID-001-03 | TEST-A-EVID-001-01<br>TEST-A-EVID-001-02<br>TEST-A-EVID-001-03 | EVID-A-EVID-001-01<br>EVID-A-EVID-001-02<br>EVID-A-EVID-001-03 | REQUIRED；S1起全程 / S5最终 |

所有代码改动与测试文件须在后续Plan和review记录附精确 `file/symbol → REQ → AC`，基础触点已在第10章登记。一个工具函数服务多个REQ时列出全部关系，不把整个目录一律声明“全部覆盖”。

任何MUST/MUST NOT未映射AC、AC无Test、Test无Oracle，PRD为BLOCKED；Required AC没有真实Evidence，Release为BLOCKED。治理章节的强制行为对应A-EVID-001-01/02/03；各业务章节的约束分别对应其开头声明的Requirement和正/负/失败AC。

---

# 28. Plan Generation Contract

归属：REQ-CONTRACT-001、REQ-EVID-001。

只有本文状态由owner评审改为 `APPROVED_FOR_PLAN`，且以下检查通过，才生成实施`.plan.md`。本次产物保持REVIEW；DEC-R2-LOGIN-001职责边界已确认，但不代表具体新增API契约或生产变更已获批准。

## 28.1 Semantic Gap Check

扫描未裁决行为、模糊默认、来源与目标混淆、隐含owner、缺失wire映射、歧义rollback/selection/hash。发现任何一项返回 `SPEC_SEMANTIC_GAP` 并停止Plan生成，不允许Plan作者补全。

Gateway企业微信Consumer契约lock是真实依赖输入，不是示例配置；未交付时相应依赖状态BLOCKED。若Owner交付的认证模式/字段语义与§9.4不一致，必须修订本PRD后再生成相关Plan，不在Plan里暗改架构。

## 28.2 Requirement Coverage Check

每个REQ具备Goal、Normative、Inputs、Preconditions、SOT、State Transition、Side Effects、Ownership、Idempotency、Failure、Postconditions、Invariant、Error、AC、Evidence。每条M1/M2/M3有对应AC，每个AC有执行入口、输入manifest和可判断Oracle。

## 28.3 Side Effect Check

所有计划任务指明允许修改的仓库、代码范围、DB行/表、文件目录、第三方网络与测试用户范围；只读分析和写Evidence分开。既有用户dirty内容不能被reset或覆盖；未知ownership不能删除。

## 28.4 State Authority Check

主会话、企业身份、Gateway member/connection/job/asset、本地operation/generation/revision、检索状态、access decision、migration manifest和Evidence分别对应第7章SOT。不得在Plan中引入另一个独立的成功状态表成为竞争事实源。

## 28.5 Failure-path Check

涉及retry/atomic/rollback/recover的任务必须引用具体第23章FI、其预期状态和证据。包含未知外部写入的任务必须列receipt/幂等恢复路径；缺少该路径不能进入“实施中”。

## 28.6 本版评审记录入口

2026-10-19修订：DEC-R2-LOGIN-001移除Consumer企业身份申请/审批职责；DEC-R2-PHASE-002/003/004进一步确认LOCAL_ONLY、Gateway profile同步投影及导入延期。对应原评审项裁决见§28.7；实际Gateway认证/profile wire仍待契约输入，不把文档裁决当运行证据。

| Decision | 需要确认的确定目标 | 当前文档状态 |
|---|---|---|
| ADR-R2-01 | 单一Gateway Adapter；不保留运行时直连fallback | 拟定，随PRD评审 |
| ADR-R2-02 / DEC-R2-LOGIN-001 | AnythingLLM只消费Gateway企业微信扫码登录验证；认证/准入/身份管理归Gateway，不建设Consumer身份管理后台 | 用户已于2026-10-19确认职责边界；实际接口及运行证据仍待提供 |
| ADR-R2-03 | Gateway认证后的用户信息同步投影；无独立本地开户；canonical member/alias仍由Gateway管理 | 以DEC-R2-PHASE-003为准；profile实际wire待Gateway交付 |
| ADR-R2-04 | Gateway新增状态、access decision、query snapshot及幂等扩展 | 拟新增Provider需求，需两仓Owner签约 |
| ADR-R2-05 | 本人受限workspace、全读取门禁、来源健康60秒边界、流式5秒复查 | 拟定，随安全/数据Owner评审 |
| ADR-R2-06 | 历史未知ownership保留隔离；回滚仅安全构建或维护模式 | 拟定，随迁移审批 |
| DEC-R2-PHASE-002 | 认证结果丢失→LOCAL_ONLY，仅已有本地数据检索，禁止Gateway腾讯取数 | 用户已确认；当前阶段Required |
| DEC-R2-PHASE-003 | Gateway认证后拉取profile，幂等同步本地用户投影，不独立开户 | 用户已确认；替代旧预置用户/映射方案 |
| DEC-R2-PHASE-004 | 导入功能与验收延期，不属于本阶段完成条件 | 用户已确认；DEFERRED_CURRENT_PHASE，不记PASS |

DEC-R2-LOGIN-001的职责边界已由用户确认，替代本文件原有Consumer申请/身份绑定审批设计。其余记录及具体wire契约仍待对应owner评审；局部决策确认不等于整份PRD变更为APPROVED_FOR_PLAN。

---

## 28.7 第二轮评审与用户裁决（2026-10-19）

第二轮审阅对象为2.0.1；当时的代码检索/阅读由GPT-6 Luna对照Consumer基线7e465a04完成。2.0.2记录用户随后对三个未关闭项的裁决；此次只编辑文档，不代表运行测试或产品功能已完成。

- **RV2-01 / CLOSED_DECISION（原P1）**：DEC-R2-PHASE-002确定认证兑换结果丢失后LOCAL_ONLY，不再要求恢复原兑换结果才能使用本地已有会议检索；禁止Gateway腾讯数据请求，不重放票据。有效本地会话与权限仍必需，重新扫码并拉取profile成功后才恢复远端。实际callback/Cookie/DTO字段仍需Gateway契约lock与后续实现测试，不冒称已联调。
- **RV2-02 / CLOSED_DECISION（原本地映射问题）**：DEC-R2-PHASE-003取代预建本地用户/预置映射方案。Gateway认证后拉取当前用户信息，按稳定实例/组织/member键幂等同步本地投影，重复登录复用local ID，无独立本地企业用户建立/绑定审批。Gateway profile路径、字段与认证证据仍是实际契约输入，不以此恢复本地开户后台。
- **RV2-03 / DEFERRED_CURRENT_PHASE（原P2）**：DEC-R2-PHASE-004延后本阶段新导入交付并暂停导入验收，A-IMPORT-001-01/02/03及相关导入依赖退出本阶段Required集合；不记PASS。审核前后断言缺口保留为后续导入阶段恢复时的必修项，不再阻断当前阶段。

此前修正继续保留：Consumer身份申请/审批后台与Gateway alias写职责已移除；`meeting_gateway_bindings`、`meeting_sources.segments`及`meeting_chunks`物理落点名称已与基线核对。

复审状态：三个问题的业务方向已由用户裁定，不能再把旧方案作为未决选择或本阶段必做项。真实Gateway认证/profile wire、Consumer DTO、状态与配置装配仍需实现前冻结和验收；本文保持REVIEW，不自动批准完整R2/生产变更。完整R2的37章、26个REQ和78个AC保留为未来总体基线；本阶段Required及单独Oracle见§4.6。

---

# 29. `.plan.md` 输出标准

归属：REQ-EVID-001。下面为批准后Plan的结构和排序要求，不是本次已生成的Plan。

## 29.1 Plan Todo Schema

```yaml
id: TODO-S2-01
requirement_refs: [REQ-AUTH-001, REQ-RUNTIME-001]
acceptance_refs: [A-AUTH-001-01, A-AUTH-001-02, A-AUTH-001-03, A-RUNTIME-001-01]
files_or_symbols:
  - server/utils/meetingGateway/client.js::accountLogin
  - server/utils/meetingGateway/client.js::exchange
  - server/index.js::GatewayRuntimeAssembly
implementation_goal: 将真实Gateway响应归一化并注入员工会话，停止使用null占位
preconditions: G1通过，相关配置与Schema固定
state_transition: NOT_READY -> READY或确定失败
side_effect_scope: Consumer代码；隔离测试DB与HTTP服务；不改生产配置
failure_cases: [字段缺失, 错误audience, 交换403, 交换响应丢失, Gateway不可用]
verification:
  - 运行对应AC与FI并保存Evidence
status: planned
evidence: []
```

Todo状态只允许 `planned,implemented,verified,blocked`；implemented=代码已写，verified=对应AC已执行并有本候选Evidence。不得因为测试文件存在就设verified。

## 29.2 开发任务包排序

本表为完整R2历史任务基线；本阶段计划只分解§4.6的登录消费、Gateway用户投影、LOCAL_ONLY和本地权限/检索及对应测试。涉及新导入、代次、审核发布、迁移的任务包延后，不因本表出现便自动进入本阶段实施。

| 顺序 | Task Package | 主要REQ | 依赖与出口 |
|---:|---|---|---|
| 01 | 契约包与来源核对 | CONTRACT、PROVIDER、IDENT-001/002、EVID基础 | 固定源/目标、schema/Gateway企业微信Consumer契约lock；G1 |
| 02 | 配置与transport | CONFIG、SEC基础、AUTH | 有真实契约，完成字段/期限/网络适配 |
| 03 | Gateway身份/投影/幂等与查询基础 | IDENT、PROVIDER、QUERY、CONTENT、OAUTH | API实现与本地fixture验证，实际依赖可用 |
| 04 | Consumer runtime装配与旧remote切换 | RUNTIME、AUTH、OAUTH | 真实实例依赖链；G2 |
| 05 | 企业登录与个人授权UI | UI-001、IDENT配套 | 使用实际BFF；不做假二维码 |
| 06 | 网关设置与现有Meetings页面 | UI-002/003、QUERY/CONTENT配套 | 原页面复用，异步状态正确；G3 |
| 07 | 单一导入代次与原文/修订 | IMPORT、DATA、TXN | 稳定identity、审核和发布指针 |
| 08 | 受限workspace和全部读取/RAG门禁 | WORKSPACE、ACCESS、RAG、SEC | 不向生产开放尚未门禁路径 |
| 09 | 撤销、清理、崩溃恢复与全面负向 | REVOKE、TXN、OBS | FI覆盖、A/B真实隔离；G4 |
| 10 | 历史迁移与切换回滚 | MIGRATE、CUTOVER | 明确审批run/T0/maintenance |
| 11 | 普通功能回归、Golden、发布证据 | COMPAT、OBS、EVID | G5与最终Release Gate |

身份与安全规则从01/02开始编码，不等到08才设计。07/08可在已冻结接口下分支开发，但合并验证按依赖完成；任何生产开放都等待最终Gate。

## 29.3 文件与数据库所有权

Plan应优先修改第10章列出的现有模块；新增模块必须解释为什么现有模块不能承担该单一职责。不得建立平行的第二套Meeting CRUD、第二套token store或第二套独立文档导入台账。数据库扩展采用additive迁移，逐项列出正向/逆向步骤及T0保护范围。

---

# 30. Code Review Contract

归属：REQ-EVID-001；各代码Owner对自身REQ负责。

Review顺序：需求是否实现 → SOT是否一致 → 副作用是否越界 → 失败postcondition是否成立 → ownership是否正确 → drift是否阻断/保留 → 正向/负向/FI覆盖 → Evidence是否真实 → 边界遗漏 → 代码质量。

| Review Focus | 阻断条件 |
|---|---|
| R1复用 | 声称重做模块但未说明现有资产；平行导入双docId；旧runtime仍直连 |
| 身份 | 用用户ID代token；通过Gateway角色提升local admin；passwordless靠伪密码绕过；企业身份无adapter证据 |
| OAuth | 去掉corp_id校验代替修复；未区分内外app ID；回跳后UI直接ACTIVE |
| 数据 | 只读第一页、跨version拼接、伪造完整、人工修订被源更新覆盖 |
| 权限 | 只保护新接口；admin/API-key旁路；先发LLM后验权；旧历史context回填 |
| 事务 | 随机docId重试；陈旧fence可commit；没有receipt；回滚失败删备份 |
| 迁移 | 标题/时间猜映射；未知owner自动认领；普通文档被全量清理 |
| 验收 | fixture替代golden、skip计PASS、无候选绑定或可手写校验bool、Gate自证循环 |

Review记录包括reviewer、source SHA、REQ/AC、发现项、严重程度、修复提交与复验Evidence。Blocker未关闭不得合并到可发布候选；重新提交代码后，受影响AC必须在新候选重新运行。

---

# 31. PRD Quality Gate

本章记录文档层面的结构与评审要求，不把产品实现状态写为已通过。

| 分类 | 文档检查点 | 对应章节 / 本版状态 |
|---|---|---|
| Architecture | 唯一目标、三个结果、五阶段、Scope/Non-goal、Owner边界 | §2–6 已定义；业务评审状态REVIEW |
| State | 每个持久状态有SOT，状态轴与合法/非法转移 | §7–9 已定义 |
| Semantics | 默认值、选择窗口、recording范围、ID、版本、错误与冲突 | §9、13、15 已定义 |
| Side Effects | 操作矩阵、只读范围、日志/cache均计副作用 | §11–12 已定义 |
| Failure | T0、外部不明结果、fence、恢复失败与备份保留 | §14、23 已定义 |
| Acceptance | 每REQ有正/负/失败AC、输入矩阵与机器Oracle | §10、20–23、27；由结构校验器检查ID引用 |
| Evidence | 候选/source/config/hash/签名、fixture/golden区别、非循环Gate | §24–26 已定义；没有本次产品执行Evidence |
| Plan Readiness | 无未裁决语义且owner批准、身份adapter实际依赖形成输入 | 当前不满足批准条件；保持REVIEW |

完成文档结构检查不等于企业身份依赖、源会议权限或生产迁移通过。文档生成阶段的任何统计只证明本文件的结构，不属于A-EVID-001的产品工具验收。

---

# 32. PRD 禁止写法

归属：REQ-EVID-001。后续Plan、代码Review和验收材料采用如下替换规则：

| 禁止的模糊结论 | 本项目要求的表达 |
|---|---|
| “接口已经接通” | 指定候选SHA、实际路由、可信主体、HTTP/业务code、字段Schema与请求Evidence |
| “登录成功就是授权成功” | 分别给企业身份、Local Session、Bridge、Tencent Connection与资源权限状态 |
| “安全兼容原功能” | 指定普通工作区回归、原配额、OCR前后digest、零受管误判 |
| “失败后合理回滚” | 指定T0范围、恢复receipt、可见指针、逆操作及回滚失败后状态 |
| “完整转写” | 指定recording/asset/version、所有cursor终止、段落集合、selection与is_complete |
| “权限正常” | A/B/admin/global-key/public-embed逐路径Oracle，拒绝时正文bytes与LLM次数 |
| “测试都通过” | Required AC/GC/G1-G5明细、候选绑定、assertion与artifact hash、最终退出码 |
| “当前实现支持企业微信” | 实际Gateway企业微信认证依赖+登录消费+既有映射校验+会话撤销的真实GC，而不是按钮或腾讯授权二维码 |

---

# 33. 推荐 ID 体系

本版实际采用：

```text
PRD: PRD-ANYTHINGLLM-MEETING-GATEWAY-20261017
Requirement: REQ-<DOMAIN>-<三位序号>
Normative: <REQ-ID>-M1/M2/M3
Invariant: INV-<DOMAIN>-<三位序号>-01/02
Acceptance: A-<DOMAIN>-<三位序号>-01/02/03
Test: TEST-<Acceptance-ID>
Evidence: EVID-<Acceptance-ID>
Phase: S1…S5
Deliverable: D1…D3
Stage Gate: G1…G5
Golden Consumer: GC-01…GC-08
Failure Injection: FI-01…FI-18
Decision: ADR-R2-01…ADR-R2-06；已确认边界 DEC-R2-LOGIN-001
Source: SRC-02…SRC-19
```

业务operation_id/generation_id/query_id/run_id是运行数据标识，不与Requirement/Test ID混用。原R1 ID保持在旧文档与旧Evidence中；R2 Gate按本文件版本识别，避免同名REQ导致错误继承旧PASS。

---

# 34. PRD 最小完整结构

本文采用模板完整0–36章而非删减版；以下确认最小结构已由完整章节承载。

| 最小必需结构 | 本文位置 |
|---|---|
| Document Meta / Goal / Background | §1–3 |
| Scope / Non-goal / Architecture Boundary | §4–6 |
| State / SOT / State Machine | §7–8 |
| Schema / Requirements | §9–10 |
| Side Effects / Ownership / Identity-Hash | §11–13 |
| Transaction / Failure / Conflict | §14–15、23 |
| Migration / External Dependency / Security | §16–18 |
| Observability / Acceptance | §19–20 |
| Edge-case / Negative / Failure Injection | §21–23 |
| Evidence / Release Gate / Golden | §24–26 |
| Traceability / Plan Gate / Plan标准 / Review | §27–30 |
| Quality / 禁止写法 / ID | §31–33 |
| DoD / 最终原则 | §35–36 |

---

# 35. Definition of Done

归属：REQ-EVID-001及全部Required业务REQ。

## 35.1 PRD 可以进入 Plan 的条件

所有MUST语义唯一；所有状态有SOT；所有mutation有副作用与ownership范围；所有hash有算法/编码/范围；所有事务有T0/提交/失败/恢复规则；所有冲突有确定行为；所有REQ有AC；每个禁止项有负向AC；高风险输入与FI覆盖；Oracle机器可判断；Evidence与候选源码绑定；缺项不计PASS；Gateway企业微信Consumer实际输入契约已由Owner提交且无语义冲突；PRD经Owner改为APPROVED_FOR_PLAN。

当前本文是REVIEW，不把“文档已生成”视为上述批准动作。

## 35.2 三个交付结果的完成定义

以下为完整R2的Done基线，不要求本阶段全部完成。本阶段只验证Gateway扫码登录/profile投影、认证丢失后本地检索与导入范围延期；以§4.6为准，不能继续要求“预置本地账号”或“新导入完成”作为阶段Done。

| 交付结果 | Done 的可观察标准 |
|---|---|
| D1 接入收口 | 真实Client/session/OAuth实例装配；账号/SSO身份出口可归一；SOURCE_QUERY/内容读取真实可调用；旧会议流量全部经Gateway；正常、403、断网和回滚场景直连请求均为0；旧活跃腾讯凭据不被Consumer读取 |
| D2 页面闭环 | 企业微信登录入口/结果、未配置映射错误、会议授权状态、只读能力、网关/OCR设置、现有列表/详情/导入/任务都连接真实接口；202/失败/过期/未准入/错企业可区分；桌面移动和刷新恢复通过 |
| D3 身份与权限闭环 | 企业身份/本地主体/Gateway member唯一可信关联；单一代次完整导入；原文和修订保留；全读取与RAG门禁；真实A/B隔离/撤销；未知历史保留隔离；迁移/切换/回滚/普通回归有有效Evidence |

## 35.3 产品可发布的条件

本节“全部Required/8个GC/G1–G5”是完整R2发布条件；本阶段通过Phase gate不代表完整R2或生产迁移通过，导入延期不是本阶段失败或伪造的PASS。

第20章全部Required AC、8个GC、G1–G5均PASS；代码Review无Blocker；dirty代码有明确补丁来源；部署和用户数据owner批准本次操作范围；真实平台权限和内容完整性证据齐全；rollback失败备份不会被删除；没有依赖或测试BLOCKED/SKIPPED被当作PASS；最终Release进程退出0。

实施完成但任何一项缺Evidence，只能记录implemented，不能记录verified或宣布已上线可用。

---

# 36. 最终原则

R2的目标不是再写一套会议系统，而是把现有会议业务、已合并R1安全资产和真实Gateway能力接成唯一可验证链路。企业身份认证、腾讯会议授权和本地资料访问是三个不同的判定，不允许以一个按钮或状态互相替代。

事实源不由UI覆盖；源查询受理不等于成功；分页终止与source version决定完整性；用户修订不被同步覆盖；副作用、ownership和恢复范围事先声明；失权先阻断读取再清理；未知历史保留并隔离；Gateway故障不触发腾讯直连；真实Consumer验收不能被fixture替代。

最终交付按 **真实契约 → 运行装配 → 页面接通 → 导入与读取权限 → 迁移验收** 推进，并依次证明 **接入收口、页面闭环、身份与权限闭环**。是否完成由REQ/AC/Oracle/Evidence共同判断，不由代码行数、PR合并或截图判断。

## 来源清单与证据边界

以下链接全部为事实来源或设计参考。固定Git SHA用于复查静态代码；不是生产可用性证明。字段、页面和行为标为NEW/MODIFY的段落是本文目标设计，不声称来源已经实现。

- **SRC-02｜Consumer 启动装配**：[server/index.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/index.js)。确认gateway:null、oauth:null与契约开关装配现状。
- **SRC-03｜Gateway Client占位与transport边界**：[server/utils/meetingGateway/client.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/utils/meetingGateway/client.js)。确认accountLogin/exchange未完成真实调用，HTTPS origin/path约束。
- **SRC-04｜R1 Bridge会话**：[server/utils/meetingGateway/sessions.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/utils/meetingGateway/sessions.js)。确认ms/mt归一化输入、900秒上限、Cookie、密码/JWT绑定及当前接口。
- **SRC-05｜Consumer腾讯OAuth**：[server/utils/meetingGateway/oauth.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/utils/meetingGateway/oauth.js)。确认三参数校验与固定回调限制，R2按真实四参数修复。
- **SRC-06｜Gateway身份服务**：[app/services/identity_service.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/services/identity_service.py)。确认account-login-v1、LocalMember投影、session_token/expires_in/user字段。
- **SRC-07｜Gateway授权服务**：[app/services/auth_service.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/services/auth_service.py)。确认ms_交换限制、mt_/mr_、audience、刷新与成员复核。
- **SRC-08｜Gateway连接服务**：[app/services/connection_service.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/services/connection_service.py)。确认腾讯OAuth URL的corp_id/sdk_id/redirect_uri/state与本人确认。
- **SRC-09｜Gateway业务接口**：[app/api/business.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/api/business.py)。确认会议/查询/录制/正文/job路由，202异步返回；envelope另见deps.py。
- **SRC-10｜Gateway完整内容**：[app/services/content_service.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/services/content_service.py)。确认is_complete/content_version、转写分页、minutes及来源健康校验。
- **SRC-11｜现有会议业务接口**：[server/endpoints/meetings.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/endpoints/meetings.js)。确认旧会议config/remote/import/detail/source/QA入口；配合现有runtime/importer与页面。
- **SRC-12｜R1受管导入台账**：[server/models/meetingGateway.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/models/meetingGateway.js)。确认meeting_imports/generations、稳定identity、fencing与active_generation。
- **SRC-13｜现有会议常量**：[server/modules/meetings/constants.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/modules/meetings/constants.js)。200场/季度、10场/问答、3小时、100MB/文件、20文件、500MB/会议。
- **SRC-14｜R1历史PRD v1.1**：[prd/anythingllm-meeting-gateway-prd-v1.1.md](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/prd/anythingllm-meeting-gateway-prd-v1.1.md)。历史需求与资产参考；其基线早于本次Consumer，不把旧描述当当前事实。
- **SRC-17｜Gateway job实际状态**：[app/services/job_service.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/services/job_service.py)。确认PENDING/PROCESSING/RETRYING/SUCCEEDED/FAILED及get/租约/重试语义。

SRC-09/11/12的配套源码（同一固定SHA）：
- [frontend/src/pages/Meetings/Settings.jsx](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/frontend/src/pages/Meetings/Settings.jsx)
- [server/modules/meetings/runtime.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/modules/meetings/runtime.js)
- [server/modules/meetings/importer.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/modules/meetings/importer.js)
- [server/utils/meetingGateway/workspacePolicy.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/utils/meetingGateway/workspacePolicy.js)
- [server/utils/meetingGateway/access.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/utils/meetingGateway/access.js)
- [server/utils/chats/authorizedRetrieval.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/server/utils/chats/authorizedRetrieval.js)
- [frontend/src/models/meetingGateway.js](https://github.com/loudon84/anything-llm/blob/7e465a04c1ad63166c7b952b41dfd316882329ea/frontend/src/models/meetingGateway.js)
- [app/api/identity.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/api/identity.py)
- [app/api/deps.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/api/deps.py)
- [app/services/query_service.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/services/query_service.py)
- [app/services/portal_service.py](https://github.com/smc-copilot/meeting-gateway/blob/d6bf6465f07385ce5906a7e0fced488c0c0881e9/app/services/portal_service.py)

- **SRC-15｜用户截图**：本会话提供的 `/meetings/settings` 旧界面；只证明字段布局，不证明后端已运行。
- **SRC-16｜OAuth安全设计参考**：[RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)，2025-01发布，本轮读取于2026-10-19；仅用于精确回跳、PKCE和重放防护设计参考，不代表企业身份服务已具相关接口。
- **SRC-18｜用户提供模板**：《需求PRD工程模板.md》v1.0；SHA-256 `b00234e6d103b2c102cbcc7b02fbcd961e71b0ce784ee736ead592c301e35eff`；采用完整0–36章组织。
- **SRC-19｜本会话确认的业务方向**：2026-10-19上轮分析及用户本轮明确的五阶段顺序与三个交付结果。新增目标选择、默认值与Provider增量均为本PRD待评审内容。

---

**文档结束。状态：REVIEW。没有本次候选构建的产品测试、真实企业认证、腾讯读取或生产迁移通过声明。**
