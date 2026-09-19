# 鲁班 Luban

> 面向个人开发者的开源 Agent 编程引擎：headless 核心 + 终端 CLI，把任务交给 agent 干，把审批权、回滚能力和账单留在自己手里。

**状态**：M1（安全与上下文）。详见 [docs/PRD.md](docs/PRD.md)、[docs/plan.md](docs/plan.md) 与 [docs/plan-m1.md](docs/plan-m1.md)。

## 特性（M0）

- **事件即事实**：所有行为以 append-only JSONL 事件流落盘（`~/.luban/sessions/`），会话可恢复、可回放。
- **工具系统**：read（行号视窗）/ grep（无需 ripgrep）/ glob / bash（进程树超时击杀、输出尾部保留），按 ACI 原则设计。
- **安全默认**：plan（只读）/ default（写与执行需审批）/ yolo 三档模式；always-allow 白名单（命令前缀/路径前缀）；高危命令（rm -rf、git push --force 等）任何模式都强制人工确认。
- **多模型**：Anthropic / OpenAI / GLM / DeepSeek / Qwen / Kimi / OpenRouter / Ollama（本地模型免 Key），统一能力声明与**精确到缓存读写的成本核算**。
- **Windows 一等公民**：PowerShell EncodedCommand 调用（任意引号免疫、退出码透传），开发与测试均在 Windows 本机完成。
- **无头模式**：`luban -p "任务"` 单命令执行（CI/脚本可用）。

## 快速开始（源码）

要求：Node ≥ 24、pnpm ≥ 10。

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js        # 交互模式（首次运行进入引导）
node packages/cli/dist/index.js -p "读取 package.json 并总结这个项目"   # 无头模式
node packages/cli/dist/index.js model  # 重新选择模型（写入 settings.json，重启后生效）
```

首次运行引导：选择模型提供商 → 确认模型 ID → 输入 API Key（Ollama 跳过）。配置写入 `~/.luban/settings.json`；选错了用 `model` 子命令重选（权限模式与预算会保留）。

本地模型（免 Key）示例：

```json
// ~/.luban/settings.json
{ "provider": "ollama", "modelId": "llama3.2:1b", "permissionMode": "default" }
```

> 提示：1B 级别的玩具模型无法可靠遵循工具协议，建议 7B+ 或商用模型。模型能力可按 [docs/dev.md](docs/dev.md) 在 models.json 中覆盖。

## 交互命令

| 命令 | 说明 |
|---|---|
| `/cost` | 查看本会话 token 用量与成本明细 |
| `/sessions` / `/resume <id>` | 列出历史会话 / 恢复指定会话 |
| `/checkpoints` / `/rollback <n>` | 回滚点列表 / 恢复（agent 每次写文件前自动快照） |
| `/model` | 切换模型（保存后自动以新模型开新会话） |
| `/exit` | 退出 |
| `y` / `a` / `n` | 审批请求：允许本次 / 总是允许 / 拒绝 |

## 开发

```bash
pnpm test          # 全部测试（120+）
pnpm build         # 构建
pnpm lint          # eslint
pnpm format        # prettier
LUBAN_SMOKE=1 pnpm smoke   # 真实端到端冒烟（默认读 ~/.luban/settings.json 的模型）
LUBAN_EVAL=1 pnpm eval     # 10 用例沙箱评测（读/查/写/改/多步修复）
```

架构与模块导读见 [docs/dev.md](docs/dev.md)；产品路线图见 [docs/PRD.md](docs/PRD.md)。

## 许可

Apache-2.0（规划，见 PRD 第 10 节；v0.1.0 npm 发布时附 LICENSE 文件）。
