# 墨斗 Modou v0.4.0-alpha — M3「公开发布」

墨斗是面向个人开发者的开源 Agent 编程引擎：headless 核心 + 终端 CLI。事件溯源、权限审批、checkpoint 回滚、MCP、Skills——把任务交给 agent 干，把审批权、回滚能力和账单留在自己手里。

## 🚀 安装

```bash
npm i -g modou
```

要求 Node ≥ 24。首次运行进入模型引导（支持 Anthropic / OpenAI / GLM / DeepSeek / Qwen / Kimi / OpenRouter / Ollama 本地模型）。

## ✨ 本里程碑亮点

### 更名：鲁班 → 墨斗
产品定名**墨斗 Modou**——墨斗是木匠弹线定直的工具，「先弹线，后动锯」正好对应产品的 Plan Mode（先计划 → 确认 → 再执行）。npm 裸名 `modou` 成功注册，`npm i -g modou` 一条命令安装。旧 `~/.luban/` 配置自动迁移到 `~/.modou/`。

### Skills（能力包）
在项目下建 `.luban/skills/<name>/SKILL.md`（frontmatter 写 `name`、`description`，正文为指令），agent 在任务匹配时自动读取遵循；`/skills` 查看已发现的包。项目级覆盖全局级，坏包跳过不阻断。

### `modou init` 与 `/init`
一条命令在项目里生成 AGENTS.md 约定模板（已存在不覆盖），让 agent 记住你的构建命令与代码风格。

### eval harness 机械化防回退
14 用例沙箱评测（读/查/写/改/MCP/Skills/多步修复），产出 `eval-results/eval-report.json`，与上一轮报告自动对比，**基线回退即退出码非 0**，可直接当 CI 门禁。当前基线 10/14，实测 14/14。

### 体验与安全细节
- edit/grep 参数写错时，错误信息附上目标文件前 20 行摘要，帮模型自我修正
- 审批卡片显示「队列中还有 N 个待审批」
- explore 子代理会话 id 接真实父会话，`/sessions` 里父子关系可读
- settings.json 支持 `cwd` 项目目录配置

### 一个有意思的根因修复
GLM 等思考模型在多轮工具调用后「复述开场白然后空转早停」——根因是主循环把同一轮的文本和 tool-call 拆成了两条 assistant 消息。已合并为单条消息（provider 语义），修复后 eval 从 12/13 升到 14/14（[分析](docs/dogfood-m3.md)）。

## 📦 npm 包

| 包 | 说明 |
|---|---|
| [`modou`](https://www.npmjs.com/package/modou) | 终端 CLI（bin：`modou`） |
| [`@modou-dev/core`](https://www.npmjs.com/package/@modou-dev/core) | headless 引擎，可嵌入你自己的前端 |

> 注：`@modou` scope 被占，引擎包用 `@modou-dev` scope。

## 📚 文档

- [快速上手](docs/quickstart.md)
- [架构导读](docs/dev.md)
- [PRD 与路线图](docs/PRD.md)
- [M3 验收记录](docs/plan-m3.md)

## 🔜 下一步（M4）

server 包 + SSE / ACP 编辑器接入 / LSP 上下文 / OS 级沙箱。

**全量变更**：v0.3.0-alpha...v0.4.0-alpha（12 提交，67 文件 +1880/−270）
**质量**：253 测试绿 · eslint/prettier 全绿 · eval 14/14
