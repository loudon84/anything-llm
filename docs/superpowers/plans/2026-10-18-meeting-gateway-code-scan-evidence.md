# GPT-6 Luna：Meeting Gateway PRD/Plan代码扫描证据

日期：2026-10-18。用户要求所有代码阅读/扫描创建子代理并使用GPT-6 Luna。
本轮按要求创建以下3个子代理，均使用 `model=gpt-6-luna`、`reasoning_effort=high`、隔离上下文；均报告只读、未修改产品代码、未运行测试、未读取密钥。主代理整合扫描结论与文档；本文是静态源码证据，不是运行验证。

- /root/scan_identity_acl：身份、JWT、注销/密码/停用、Workspace与角色、成员写入、导航/构建脚本；有补扫。
- /root/scan_retrieval_revocation：聊天/检索/原文/全局API key/embed/history旁路与门禁位置。
- /root/scan_import_recovery：Collector落盘、operation恢复、向量docId、Prisma、Jest；有精确路径大小写补扫。

Consumer HEAD：1336d327f4460510b755059b15481fd94a57cef7。扫描时工作树已存在未提交文件与用户改动，不做reset。E:/git直接目录的meeting名称匹配检查未找到Gateway repo；不等于本机任意位置都不存在。未独立验证provider源码/生产契约。

## 身份与持续受限空间

- [validatedRequest.js:74](E:/git/anything-llm/server/utils/middleware/validatedRequest.js:74)：多用户从Authorization读Bearer，decodeJWT后查询当前User，拒绝suspended，再赋response.locals.user。
- [request.js:11](E:/git/anything-llm/frontend/src/utils/request.js:11)：前端从localStorage取JWT发Bearer。基线不提供PRD假定的Cookie主会话。
- [system.js:199](E:/git/anything-llm/server/endpoints/system.js:199)、[JWT签发:291](E:/git/anything-llm/server/endpoints/system.js:291)：request-token签发用户JWT，非设备会话registry。
- [UserButton:95](E:/git/anything-llm/frontend/src/components/UserMenu/UserButton/index.jsx:95)：注销只清localStorage，不通知服务端。
- [User.update:157](E:/git/anything-llm/server/models/user.js:157)：用户资料/密码/停用的统一模型入口。恢复码路径 [PasswordRecovery:87](E:/git/anything-llm/server/utils/PasswordRecovery/index.js:87) 也调用User.update；子代理已更正早期“恢复码绕过该入口”的初步判断。User.delete另需覆盖。
- [workspace.js:294](E:/git/anything-llm/server/models/workspace.js:294)、[415](E:/git/anything-llm/server/models/workspace.js:415)：admin/manager绕过普通membership。受限空间必须显式覆盖，不改普通空间分支。
- [workspace.js:498](E:/git/anything-llm/server/models/workspace.js:498)：updateUsers先删后建关系，无受限策略/原子epoch。
- [api/admin:497](E:/git/anything-llm/server/endpoints/api/admin/index.js:497)、[622](E:/git/anything-llm/server/endpoints/api/admin/index.js:622)：API-key增量/覆盖member入口。
- [validApiKey:4](E:/git/anything-llm/server/utils/middleware/validApiKey.js:4)：全局key不提供真实当前用户。key.createdBy不能当调用人的身份。

## RAG、正文与历史路径

- 普通stream：[stream.js:159](E:/git/anything-llm/server/utils/chats/stream.js:159)，pinned/parsed内容先于vector search直接进入context。
- API sync/stream：[apiChatHandler.js:325](E:/git/anything-llm/server/utils/chats/apiChatHandler.js:325)、[716](E:/git/anything-llm/server/utils/chats/apiChatHandler.js:716)。
- OpenAI-compatible：[openaiCompatible.js:84](E:/git/anything-llm/server/utils/chats/openaiCompatible.js:84)、[326](E:/git/anything-llm/server/utils/chats/openaiCompatible.js:326)。
- Public embed：[embed.js:99](E:/git/anything-llm/server/utils/chats/embed.js:99)，入口 [embed/index.js:19](E:/git/anything-llm/server/endpoints/embed/index.js:19) 无owner用户。
- 独立vector-search：[api/workspace:900](E:/git/anything-llm/server/endpoints/api/workspace/index.js:900)，不经过chat Module。
- API chat手工user:null：[api/workspace:660](E:/git/anything-llm/server/endpoints/api/workspace/index.js:660)；thread body.userId是自报，不能提升可信Actor。
- 全局picker/raw：[api/document:650](E:/git/anything-llm/server/endpoints/api/document/index.js:650)、[900](E:/git/anything-llm/server/endpoints/api/document/index.js:900)；move/remove/[system local-files:510](E:/git/anything-llm/server/endpoints/system.js:510)也需受管排除与owner gate。
- 历史导出：[utils.js:35](E:/git/anything-llm/server/endpoints/utils.js:35)、[system.js:1225](E:/git/anything-llm/server/endpoints/system.js:1225)；TTS：[workspaces.js:670](E:/git/anything-llm/server/endpoints/workspaces.js:670)。R1明确既有产物不回溯擦除，但冻结后新LLM请求不可回填旧内容再生新产物。
- chatPrompt只管prompt/memory，不能作为唯一文档授权seam。

## Collector与向量恢复

- [processRawText:92](E:/git/anything-llm/collector/processRawText/index.js:92)：每次随机UUID，metadata白名单，pageContent原样保留；现有测试也要求普通raw-text每次fresh ID。
- [writeToServerDocuments:120](E:/git/anything-llm/collector/utils/files/index.js:120)：JSON落custom-documents，写完才返回location。
- [collector/index.js:189](E:/git/anything-llm/collector/index.js:189)：原接口只解构textContent/metadata，无operation key。
- Git精确大小写为 [server/utils/collectorApi/index.js:191](E:/git/anything-llm/server/utils/collectorApi/index.js:191)，不是CollectorApi；网络/JSON失败未提供查询键。
- [documents.js:119](E:/git/anything-llm/server/models/documents.js:119)：随机docId先写VectorDb，再写workspace_documents；写后DB失败存在孤儿窗口。
- [documents.js:324](E:/git/anything-llm/server/models/documents.js:324)：uploadToWorkspace成功true、失败可能undefined且仅日志，不是完整成功Oracle。
- [documents.js:204](E:/git/anything-llm/server/models/documents.js:204)：remove先向量后DB，异常可能留下残留，不能把删除当门禁。
- [schema:27](E:/git/anything-llm/server/prisma/schema.prisma:27)、[113](E:/git/anything-llm/server/prisma/schema.prisma:113)：workspace_documents.docId是文档关联ID；document_vectors存provider分块vectorId。v1.1预存vector_doc_id明确指前者，继续复用provider按docId删除接口。
- 数据源与migration_lock是SQLite，暂无导入台账。真实生产切provider需另确认迁移方案。

## 导航与验证工具

- 路由注册：[frontend/src/main.jsx:18](E:/git/anything-llm/frontend/src/main.jsx:18)，不是App.jsx。
- 主导航：[Sidebar/index.jsx:63](E:/git/anything-llm/frontend/src/components/Sidebar/index.jsx:63)，桌面/移动入口需覆盖；不是SettingsSidebar。
- 根test脚本是Jest；[jest.config.cjs](E:/git/anything-llm/jest.config.cjs)用默认发现、排除node_modules/open-computer。
- 前端没有既有test script/组件测试runner。可运行 `npm run build --prefix frontend`、`npm run lint:check --prefix frontend`；lint --fix会改文件不用于只读验证。
- 现有回归可用 `npm test -- --runInBand collector/__tests__/processRawText/index.test.js server/__tests__/models/workspace.test.js server/__tests__/models/embedConfig.test.js`。本次仅确认命令来源，未运行产品测试。

所有新增实现仍须在执行时复核最新源码及改动；以上结论不是对任意未来commit的保证。

