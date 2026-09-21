# 快速上手

从安装到完成第一个任务。前置要求：Node ≥ 24。

## 1. 安装（源码方式，npm 包发布前）

```bash
git clone <仓库地址> modou && cd modou
pnpm install && pnpm build
alias modou="node $(pwd)/packages/cli/dist/index.js"   # Windows PowerShell: Set-Alias
```

## 2. 首次配置

```bash
modou          # 交互模式首次运行进入引导：选模型提供商 → 确认模型 ID → 输入 API Key
```

配置写入 `~/.modou/settings.json`。选错了用 `modou model` 重选。

本地模型（免 Key）示例：

```json
{ "provider": "ollama", "modelId": "llama3.2:1b", "permissionMode": "default" }
```

> 1B 级别模型无法可靠遵循工具协议，建议 7B+ 或商用模型。

## 3. 让 agent 记住项目约定

```bash
cd /path/to/your/project
modou init     # 生成 AGENTS.md 模板；把方括号占位替换成项目实际约定
```

## 4. 完成第一个任务

```bash
modou          # 进入交互
```

```
> 读取 package.json 并用三句话总结这个项目
```

默认权限模式下，agent 的每次写文件、每条命令都会先弹出审批卡片（附 diff）：`y` 允许本次、`a` 总是允许、`n` 拒绝。

## 5. 典型工作流

- **先计划后执行**：`/plan 重构 auth 模块` —— agent 只读调研产出计划，你确认后才执行。
- **查问题**：直接问 `这个函数在哪些地方被调用`，agent 用只读工具探索后回答。
- **改错了**：`/checkpoints` 看回滚点，`/rollback <编号>` 一键恢复。
- **CI/脚本**：`modou -p "运行 pnpm test 并总结失败原因"` 单命令执行。

## 6. 进阶

- **MCP 扩展**：`settings.json` 加 `mcpServers` 字段接入社区 server，见 [README](../README.md#mcp-配置示例)。
- **Skills**：项目下建 `.luban/skills/<name>/SKILL.md`（frontmatter 写 `name`、`description`，正文为指令），agent 在任务匹配时自动读取遵循；`/skills` 查看已发现的包。
- **预算**：`settings.json` 加 `"budgetUsd": 5`，超过自动暂停。
- **无头审批**：无头模式审批自动拒绝——CI 场景请用 yolo 模式（`"permissionMode": "yolo"`）或预设 always-allow 白名单。
