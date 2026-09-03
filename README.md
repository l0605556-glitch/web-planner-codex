# Web Planner for Codex

这是一个个人使用的 ChatGPT 网页规划 + 本地 Codex 执行工作流。V2 的目标是：你只输入一次任务，Codex 自动决定是否需要网页版 ChatGPT 先规划。

## 当前实现

- Codex 自动判断任务走 `DIRECT` 还是 `WEB_PLAN`。
- `WEB_PLAN` 通过 Codex 桌面应用直接向一个已有 ChatGPT 对话发送结构化 C2C 消息，并自动读取回复，不需要人工复制。
- Codex 自动生成有范围限制的项目上下文包；ChatGPT 只能分析收到的只读内容。
- 本地 MCP Bridge 提供 6 个只读工具，为以后接入远程 ChatGPT MCP 连接器保留标准接口。
- 所有文件修改、命令、测试、Git 提交和推送仍只由 Codex 完成。

## 两条通道

```text
控制通道：Codex app → ChatGPT conversation → PLAN → Codex
数据通道：固定工作区 → 脱敏只读策略 → CONTEXT → ChatGPT
```

V2 不使用浏览器点击自动化，也不把本地 MCP 暴露到公网。网页版 ChatGPT 当前不会读取本地 Codex MCP 配置；公开远程 MCP 插件属于后续可选阶段。

## 目录结构

```text
.codex-plugin/plugin.json                Codex 插件清单
skills/web-planner-codex/                自动路由与协作流程
src/context-cli.ts                       生成脱敏、限量的上下文包
src/workspace/                           固定目录与只读安全策略
src/mcp/server.ts                        6 个只读 MCP 工具
src/index.ts                             仅监听本机的 MCP HTTP 服务
tests/                                   权限与 MCP 行为测试
```

## 日常使用

在这个项目的 Codex 任务里提出正常需求即可，例如：

```text
使用 $web-planner-codex。为这个项目增加导出功能，完成后停在阶段汇报，不要提交或推送。
```

Skill 会先选择：

- `DIRECT`：目标清楚、范围很小、低风险，Codex 直接执行。
- `WEB_PLAN`：架构、多阶段、安全、迁移或范围不确定的任务，自动向已经指定的 ChatGPT 对话发规划请求并读取回复。

首次使用某个 ChatGPT 对话时，需要由用户打开或指定一次；之后工作流复用该对话。控制消息会携带唯一 `TASK_ID`，发送状态不确定时先读取历史，避免重复执行。

## 本地验证

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run context -- --workspace . --action overview
npm start -- --workspace . --port 43123
```

`overview` 默认只列出 Git 已跟踪文件。未跟踪文件只报告数量，不暴露名称或内容；确有需要时，再由 Codex 按明确路径生成小范围上下文。

服务仅监听 `127.0.0.1`。健康检查地址为 `http://127.0.0.1:43123/health`，MCP 地址为 `http://127.0.0.1:43123/mcp`。

## 只读边界

- 固定一个工作目录，拒绝绝对路径和目录穿越。
- 不跟随目录列表中的符号链接。
- 拒绝 `.env`、私钥、凭据、Git 内部数据和私有工作流状态。
- 限制读取行数、文件大小、搜索数量和命令输出。
- 只允许固定参数形状的 `git status`、`git diff` 和 `rg`；不存在任意命令工具。
- MCP 工具全部标记为只读、非破坏性和幂等。
- MCP 默认只暴露 Git 已跟踪内容；未跟踪文件名和内容均不可读取。

## 目前暂不包含

- ChatGPT 执行后代码审查。
- 公网隧道和 OAuth。
- 多用户、多电脑或多工作区。
- ChatGPT 写文件、执行命令或修改 Git/GitHub。
