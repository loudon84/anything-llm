# 会议知识检索交付验证记录

代码分支：`codex/meeting-intelligence`。基线：`1336d327f4460510b755059b15481fd94a57cef7`。最终代码提交：`6197281924dc21847b099185ff4c64f0a05ab1e3`。本记录对应最终代码状态；初始整分支审查发现的问题已由 `e5e98e80`、`b6100eeb`、`61972819` 三个修复提交处理，两个后续定向复审均批准。此记录不代表 Linux 或外部服务验收通过。

## 自动化验证

在 `server/` 执行：

```powershell
node ../node_modules/jest/bin/jest.js __tests__/meetings __tests__/utils/boot.test.js __tests__/models/documentSyncQueue.test.js __tests__/utils/files/moveProcessedDocsToFolder.test.js __tests__/utils/files/isWithin.test.js --runInBand
```

结果：**21 个测试套件、264 项测试全部通过**，退出码 0。覆盖会议功能、后台启动、pgvector、Workspace、文档移动等相邻路径。输出包含预期的文档身份不匹配、数据库写入失败负向测试日志，以及现有加密管理器、流中止日志；没有测试失败。

在 `frontend/` 执行：

```powershell
node --test src/models/meetings.node-test.mjs
```

结果：**28 项测试全部通过**，退出码 0。覆盖范围/状态/日期限制、真实问答历史客户端契约、引用状态与位置、轮询反馈、会议与工作区安全文本预览、详情页工作区加载失败/重试、失败任务阶段与错误同时显示等。

最终前端 `npm run build`（包括 postbuild）通过。三个修复提交的改动范围 ESLint/Prettier 检查通过，`git diff --check` 通过。整仓 `npm run lint:check` 仍报告 20 项既有错误，均在本轮未变更的文件；两个最终改动文件单独 lint/format 通过。Vite 仍报告 Piper 浏览器外部模块、静态与动态导入、大分包警告。

真实 Prisma 集成以显式 datasource 指向新建隔离 SQLite，应用了全部 **43 个迁移**；外部接口以测试代理和受控本地 HTTP 服务代替。测试没有使用真实企业账号资料。

## 实际页面验证

主代理使用真实 Express 与 Vite 页面，在隔离数据库与合成会议资料上操作了会议中心、固定范围和详情页。最终流程从会议详情创建单会议会话，确认固定范围是 1 场会议、0 个工作区；返回中心后确认该会话显示为可重新打开的历史链接。本轮另外通过交互式组件回归验证详情页工作区默认不选、失败时可重试、只提交显式勾选项，并且会议单独问答在工作区加载失败时仍可用。初期合成 UI 流程还验证了提问、带来源回答、引用快照、安全文本预览和历史保留；这些不是生产模型或真实数据验收。

外部腾讯会议、向量、嵌入、模型接口为测试替代服务；这证明本地页面和接口接线，不证明真实模型回答质量或真实租户接口能力。详细缺陷及逐项修复证据见 `final-review.md`、`final-fix-report.md` 和 ledger。

实际截图保存在主机：

- `C:/Users/smc-sz-hr21007/.codex/visualizations/2026/10/14/01a13862-9eb5-7af3-9dc2-d783d7cd2025/meeting-qa-final-synthetic-proof.jpg`
- `C:/Users/smc-sz-hr21007/.codex/visualizations/2026/10/14/01a13862-9eb5-7af3-9dc2-d783d7cd2025/meeting-source-synthetic-proof.jpg`

最终合成 UI 服务在本轮验证结束后关闭；原工作区保持 `master`，代码实现仅在独立工作树中。分支最新提交为 `61972819`，没有推送或合并。

## 待目标环境验收

- Linux 全新部署、迁移、正常启动和重启。
- 真实腾讯会议企业连接、会议列表、转写/摘要/原始附件能力验证及人工补齐路径。
- 实际 OCR 服务和扫描/混合 PDF、图片、PPTX 图片质量。
- 实际模型的验收题集：无来源补充事实、伪造引用、使用已删除内容回答新问题、资料不足却确定作答必须零出现；其他错误先测量再设门槛。
- 约 10 人并发、回答耗时、失败率及发布前性能门槛。

执行方法见 `docs/meeting-intelligence-deployment.md`，需求验收标准以 APPROVED PRD 为准。

## 清理限制

旧合成 smoke SQLite 已清理。Task7 一份临时 schema/migrations 副本保留在 `server/prisma/task7-isolated-102c2410f89148b08c2fdfaedafef1ed/`，未提交；只包含 schema 和迁移，没有数据库或凭证。工具策略拒绝了该目录的递归删除，未尝试替代删除方式。临时审查 diff 包在最终复核结束后按明确文件名清理；计划、TODO、报告和实现保留。
