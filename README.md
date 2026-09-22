# 墨斗 Modou

[![npm](https://img.shields.io/npm/v/modou?color=cb3837&label=npm)](https://www.npmjs.com/package/modou)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-green)](https://nodejs.org)
[![Release](https://img.shields.io/github/v/release/yan-yun-1/modou?include_prereleases&label=release)](https://github.com/yan-yun-1/modou/releases)

> 面向个人开发者的开源 Agent 编程引擎：headless 核心 + 终端 CLI。把任务交给 agent 干，把审批权、回滚能力和账单留在自己手里。

墨斗是木匠弹线定直的工具——先弹线（Plan Mode 定计划），后动锯（确认后再执行）。

**当前状态**：M3 已发布（[Release v0.4.0-alpha](https://github.com/yan-yun-1/modou/releases/tag/v0.4.0-alpha)）。路线图见 [docs/PRD.md](docs/PRD.md)。

## 30 秒上手

要求：Node ≥ 24。

```bash
npm i -g modou
modou init    # 在当前项目生成 AGENTS.md 模板，填入你的项目约定
modou         # 交互模式（首次运行进入模型引导）
```

然后直接说任务：`把 utils.js 里重复的解析逻辑抽成一个函数`。默认模式下每一次写文件、每一条命令都会先请你审批（可按 `a` 记住选择）。

无头模式（CI / 脚本）：

```bash
modou -p "运行 pnpm test 并总结失败原因"
```

## 核心特性

- **事件即事实**：所有行为以 append-only JSONL 事件流落盘（`~/.modou/sessions/`），会话可恢复、可回放、可审计。
- **Plan Mode**：`/plan <任务>` 先只读调研产出实施计划，你确认后才动代码。
- **工具系统**：read（行号视窗）/ grep / glob / edit（唯一性强制 + 失败给最接近候选）/ write / bash（进程树超时击杀），按 ACI 原则设计。
- **MCP 生态**：`settings.json` 配置 `mcpServers` 即可接入社区 server（stdio 与 Streamable HTTP），工具与本机内置工具同一套权限门禁。
- **Skills**：项目 `.luban/skills/<name>/SKILL.md` 定义能力包（frontmatter 写 name/description），agent 按任务自动读取遵循；`/skills` 查看已发现的包。
- **安全默认**：plan（只读）/ default（写与执行需审批）/ yolo 三档；always-allow 白名单；高危命令任何模式都强制人工确认。
- **Checkpoint 回滚**：agent 每次写文件前自动 git 影子引用快照，`/rollback <n>` 一键恢复，不污染你的分支历史。
- **成本透明**：精确到缓存读写的 token 计量与金额核算，`/cost` 随时查看，可设预算上限。
- **多模型**：Anthropic / OpenAI / GLM / DeepSeek / Qwen / Kimi / OpenRouter / Ollama（本地模型免 Key）。
- **Windows 一等公民**：PowerShell EncodedCommand 调用（任意引号免疫、退出码透传），开发与测试均在 Windows 本机完成。

## 交互命令

| 命令 | 说明 |
|---|---|
| `/plan <任务>` | 只读调研产出实施计划，确认后按计划执行 |
| `/init` | 生成 AGENTS.md 项目约定模板（已存在不覆盖） |
| `/skills` | 查看已发现的 Skills 能力包 |
| `/mcp` | 查看 MCP server 连接状态与工具数 |
| `/cost` | 查看本会话 token 用量与成本明细 |
| `/checkpoints` / `/rollback <n>` | 回滚点列表 / 恢复 |
| `/sessions` / `/resume <id>` | 列出历史会话 / 恢复指定会话 |
| `/model` | 切换模型（保存后自动以新模型开新会话） |
| `/exit` | 退出 |
| `y` / `a` / `n` | 审批请求：允许本次 / 总是允许 / 拒绝 |

## MCP 配置示例

```json
// ~/.modou/settings.json
{
  "provider": "anthropic",
  "modelId": "claude-sonnet-4-5",
  "permissionMode": "default",
  "mcpServers": {
    "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"] }
  }
}
```

## 开发

```bash
pnpm test          # 全部测试（253）
pnpm build         # 构建
pnpm lint          # eslint
pnpm format        # prettier
LUBAN_SMOKE=1 pnpm smoke   # 真实端到端冒烟（读 ~/.modou/settings.json 的模型）
LUBAN_EVAL=1 pnpm eval     # 14 用例沙箱评测（读/查/写/改/MCP/Skills/多步修复，基线 10；产出 eval-results/eval-report.json）
```

架构与模块导读见 [docs/dev.md](docs/dev.md)；产品决策与路线图见 [docs/PRD.md](docs/PRD.md)。

## npm 包

| 包 | 说明 |
|---|---|
| [`modou`](https://www.npmjs.com/package/modou) | 终端 CLI（bin：`modou`） |
| [`@modou-dev/core`](https://www.npmjs.com/package/@modou-dev/core) | headless 引擎，可嵌入你自己的前端 |

## 许可

[Apache-2.0](LICENSE)
