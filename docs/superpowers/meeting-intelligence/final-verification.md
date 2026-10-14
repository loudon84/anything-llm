# 会议知识检索交付验证记录

代码分支：`codex/meeting-intelligence`。基线：`1336d327f4460510b755059b15481fd94a57cef7`。最近代码提交：`f67163dfad0677061da90b412bf8073ed241a13f`。本记录由主代理在当前代码上执行验证后整理；整体代码审查结果另行记录，不能把此记录解释为发布验收通过。

## 自动化验证

在 `server/` 执行：

```powershell
node ../node_modules/jest/bin/jest.js __tests__/meetings __tests__/utils/boot.test.js __tests__/models/documentSyncQueue.test.js __tests__/utils/files/moveProcessedDocsToFolder.test.js __tests__/utils/files/isWithin.test.js --runInBand
```

结果：**21 个测试套件、222 项测试全部通过**，退出码 0，耗时约 55.7 秒。覆盖全部会议测试、后台启动及相邻的文档同步、文件路径检查、文档移动测试。输出包含预期的文档身份不匹配、数据库写入失败负向测试日志，以及现有加密管理器、流中止日志；没有测试失败。

在 `frontend/` 执行：

```powershell
node --test src/models/meetings.node-test.mjs
```

结果：**26 项测试全部通过**，退出码 0。覆盖范围/状态/日期限制、真实问答历史客户端契约、引用状态与位置、轮询反馈、会议与工作区安全文本预览等。

Task7 实施代理在同一代码提交前完成改动范围的 ESLint、Prettier 与 `npm run build`（包括 postbuild），均通过。已存在的 Piper 浏览器外部模块、静态与动态导入、大分包警告记录在 Task7 报告中。主代理没有重复无变化的构建。

真实 Prisma 集成以显式 datasource 指向新建隔离 SQLite，应用了全部 **43 个迁移**；外部接口以测试代理和受控本地 HTTP 服务代替。测试没有使用真实企业账号资料。

## 实际页面验证

主代理使用真实 Express 与 Vite 页面，在隔离数据库与合成会议资料上操作了：会议中心、取消资料未就绪会议、固定会议/工作区范围、提问、带来源回答、引用快照、当前原文的安全文本预览、重新进入会话保留历史、管理员配置页面。问答页面首次加载错误和文本预览空白是在这个流程发现并修复的。

外部腾讯会议、向量、嵌入、模型接口为测试替代服务；这证明本地页面和接口接线，不证明真实模型回答质量或真实租户接口能力。工作区文本预览的后续修复有实际组件渲染回归测试，未再次启动整页浏览器。

实际截图保存在主机：

- `C:/Users/smc-sz-hr21007/.codex/visualizations/2026/10/14/01a13862-9eb5-7af3-9dc2-d783d7cd2025/meeting-qa-final-synthetic-proof.jpg`
- `C:/Users/smc-sz-hr21007/.codex/visualizations/2026/10/14/01a13862-9eb5-7af3-9dc2-d783d7cd2025/meeting-source-synthetic-proof.jpg`

测试 API/Vite 服务已停止，测试端口 41873、41874、41875 无监听；原工作区保持 `master`，代码实现仅在独立工作树中。

## 待目标环境验收

- Linux 全新部署、迁移、正常启动和重启。
- 真实腾讯会议企业连接、会议列表、转写/摘要/原始附件能力验证及人工补齐路径。
- 实际 OCR 服务和扫描/混合 PDF、图片、PPTX 图片质量。
- 实际模型的验收题集：无来源补充事实、伪造引用、使用已删除内容回答新问题、资料不足却确定作答必须零出现；其他错误先测量再设门槛。
- 约 10 人并发、回答耗时、失败率及发布前性能门槛。

执行方法见 `docs/meeting-intelligence-deployment.md`，需求验收标准以 APPROVED PRD 为准。

## 清理限制

旧合成 smoke SQLite 已清理。Task7 一份临时 schema/migrations 副本保留在 `server/prisma/task7-isolated-102c2410f89148b08c2fdfaedafef1ed/`，未提交；只包含 schema 和迁移，没有数据库或凭证。工具策略拒绝了该目录的递归删除，未尝试替代删除方式。临时审查 diff 包会在整体复核结束后清理，计划、TODO、报告和实现保留。
