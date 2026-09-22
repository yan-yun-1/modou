# PRD：开源 Agent 编程产品「墨斗 / Modou」

| 项 | 内容 |
|---|---|
| 版本 | v1.0（草稿，待评审） |
| 日期 | 2026-09-19 |
| 状态 | 待用户评审 |
| 调研基础 | 2026-09-19 实时抓取的 GitHub 数据与官方文档，覆盖 14 个开源项目 + 6 个商业竞品 + 架构模式/标准专项 |
| 命名决议 | 2026-09-21 定名「墨斗 / Modou」（npm 裸名可注册；墨斗弹线定直 ↔ Plan Mode 先计划后执行）；CLI 命令 `modou`，包名 `modou` / `@modou/core`（2026-09-22 发布时发现 @modou scope 被老账号占用，引擎包实际发布为 `@modou-dev/core`） |

## 0. 已确认的产品决策

| # | 决策项 | 结论 | 确认时间 |
|---|---|---|---|
| D1 | 产品形态 | **Agent 核心引擎（headless）+ CLI 先行**，后续经开放协议扩展 IDE 插件与 Web | 2026-09-19 |
| D2 | 目标用户 | **个人开发者优先**，团队/企业功能后置 | 2026-09-19 |
| D3 | 商业模式 | **开源核心 + 商业增值**（托管服务/团队版） | 2026-09-19 |
| D4 | 投入规模 | **1 人全职**，里程碑按单人可执行拆分，MVP 控制在 8 周内 | 2026-09-19 |
| D5 | 架构与主栈 | **Client/Server 分离 + TypeScript monorepo**（Node 生态） | 2026-09-19 |

---

## 1. 背景与市场分析

### 1.1 市场背景（2025–2026）

- **品类完成换代**：编程工具从"辅助补全"全面转向"自主 Agent"。标志性事件：Cursor 2025-11 融资 23 亿美元（估值 293 亿）、2026 年中传 ARR 超 20 亿美元；Windsurf 品牌消亡（被 Cognition 接盘，2026-06 更名 Devin Desktop）；GitHub Copilot 平台化（Agent HQ 编排多家 agent）。
- **开源格局刷新**：opencode（208k stars，MIT，TS）以"模型中立 + client/server 多端"成为开源事实标准；厂商系 OpenAI Codex CLI（125k，Rust）与 Gemini CLI（107k，TS）领跑工程与安全；上一代标杆 Aider 与 SWE-agent 均已进入维护模式。
- **标准收敛**：MCP（工具连接，事实标准）、AGENTS.md（项目规则，5.7 万+ 仓库采用）、Agent Skills/SKILL.md（可移植能力包，约 40 平台兼容）、ACP（agent↔编辑器协议，Zed/JetBrains/Xcode 支持）。Agent 产品正在变成"**MCP 宿主 + 上下文引擎**"。
- **关键行业结论**：mini-swe-agent 用约 100 行 Python 达到 SWE-bench Verified 65% —— **主循环没有壁垒**，竞争聚焦在上下文工程、安全模型、多端体验与模型质量。

### 1.2 竞品对比总览（开源）

数据为 2026-09-19 GitHub 实时值（约数）。

| 项目 | Stars | 语言 | 许可 | 形态 | 状态 | 一句话定位 |
|---|---|---|---|---|---|---|
| opencode | 208k | TS | MIT | CLI+server+多端 | 活跃 | 开源版 Claude Code，模型中立多端平台 |
| OpenAI Codex CLI | 125k | Rust | Apache-2.0 | CLI | 活跃 | 工程与安全标杆，OS 级沙箱 |
| Gemini CLI | 107k | TS | Apache-2.0 | CLI | 活跃 | 免费额度换装机量，配额缩水遭诟病 |
| Zed | 91k | Rust | GPL/AGPL | 独立 IDE | 活跃 | ACP 协议发起者，编辑器与 agent 解耦 |
| OpenHands | 88k | Python | MIT | Web+SDK | 活跃 | 学术范本，V1 重构为 4 解耦包的 Agent SDK |
| Cline | 69k | TS | Apache-2.0 | VS Code 插件+SDK+CLI | 活跃 | 最大社区插件，审批+checkpoint 安全范本 |
| Goose | 54k | Rust | Apache-2.0 | CLI+桌面+Server | 活跃 | Block 出品，MCP-first，企业向 |
| Aider | 49k | Python | Apache-2.0 | CLI | **维护模式** | 结对编程鼻祖，Repo Map 至今是最优上下文方案之一 |
| Continue | 36k | TS | Apache-2.0 | 插件+CLI | 活跃 | 可组合配置 + Merkle 增量索引 |
| Void | 29k | TS | Apache-2.0 | VS Code fork IDE | **停滞** | 小团队 fork VS Code 不可持续的警示 |
| Crush | 28k | Go | FSL-1.1 | CLI/TUI | 活跃 | TUI 体验标杆，订阅网关变现样板 |
| Kilo Code | 27k | TS | MIT(客户端) | 插件+CLI+网关 | 活跃 | Roo 停运承接者，模型网关商业模式 |
| Roo Code | 24k | TS | Apache-2.0 | 插件 | **已停运(2026-05)** | fork 换皮难以持续的警示 |
| SWE-agent | 20k | Python | MIT | CLI(研究) | **维护模式** | ACI 理念（工具面质量决定 agent 性能） |

**商业竞品速览**：Cursor（AI-first IDE 标杆，赢在自研模型+体验+资本飞轮）、Claude Code（终端 agent 事实标准，引擎以开源 Claude Agent SDK 反哺生态）、GitHub Copilot（平台级编排，护城河是分发与企业合规）、Devin（云端自主 agent）、Trae（字节，免费 AI IDE + 开源 trae-agent）、Windsurf（已并入 Devin Desktop）。

### 1.3 调研结论 → 对本产品的启示

1. **不要在主循环和工具集上"创新"**，全面拥抱标准（MCP、AGENTS.md、Skills、ACP），工具生态外包给社区。
2. **差异化空间明确且无人占满**：① token 成本可观测（各家普遍欠债，OpenHands 甚至有著名成本失控 issue）；② Windows 原生体验（Codex/Gemini CLI 均薄弱，开发者基数大）；③ 中文开发者与国产模型（GLM/DeepSeek/Qwen/Kimi）的一等支持；④ 安全模型完整度（仅 Codex 完整）。
3. **形态已被验证**：headless 核心 + CLI 先行（Claude Code、Codex CLI 路径），后接 IDE 与云端；Roo 停运宣言"IDE 插件不是终点"与本产品 D1 决策一致。
4. **fork 换皮是死路**（Roo 停运、Void 停滞），必须自研核心并尽早建立商业模式。
5. **变现样板存在**：开源 CLI + 官方模型网关订阅（Charm Hyper、OpenCode Zen）。
6. **上下文检索路线**：中小仓库用 grep/glob 实时探索 + 语法级 repo map（Aider 路线）足够，重型向量索引后置（Cline/Kilo 系已验证"无索引"可行；Cursor 式索引仅超大库才有必要）。

---

## 2. 产品定位

### 2.1 一句话定位

> **面向个人开发者的开源 Agent 编程引擎**：headless 核心 + 终端 CLI，把任务交给 agent 干，把审批权、回滚能力和账单留在自己手里。

### 2.2 目标用户

- **P0 个人开发者**：维护 1–10 人规模项目，命令行熟练；痛点是"重复性编码任务耗时"与"对 AI 工具的成本/安全不放心"；对价格敏感、愿意为省时间付费、拒绝厂商锁定。
- **P1 小团队**（v0.2 后）：需要统一模型账号、任务队列与用量管理。
- **P2 企业私有化**（远期）：代码不出域、审计合规、国产模型适配。

### 2.3 核心价值主张（差异化三板斧 + 安全底座）

| # | 主张 | 依据（调研结论） |
|---|---|---|
| V1 | **成本透明可控**：每个任务实时显示 token 与费用，支持会话预算上限与超支告警 | 各家普遍薄弱（OpenHands issue #7105 等），用户最大抱怨之一 |
| V2 | **全标准兼容、零锁定**：MCP + AGENTS.md + Skills + ACP；任意模型（含 GLM/DeepSeek/Qwen/Kimi/Ollama 本地模型） | 标准已成定局；厂商系产品均绑定自家生态 |
| V3 | **Windows 一等公民 + 中文体验**：Windows 原生支持、中文文档与中文社区渠道 | 竞品普遍 macOS/Linux 优先，Windows 为二等公民 |
| V0 | **安全默认**（底座）：审批门禁 + 权限白名单 + git checkpoint 回滚，后续补 OS 级沙箱 | Codex 的"沙箱档位×审批档位"矩阵已验证；供应链事件（Cline hAIsteal）证明安全即信任 |

### 2.4 北极星指标与护栏

- **北极星**：每周被用户接受完成的 agent 任务数（Accepted Tasks / Week）。
- 护栏指标：自建评测任务成功率（不回退）；平均每任务 token 成本（下降趋势）；TUI p50 首 token 延迟；会话崩溃率。

---

## 3. 用户故事与核心场景

| ID | 用户故事 | 优先级 |
|---|---|---|
| US-01 | 作为开发者，我粘贴一个 issue 描述，agent 给出修改计划，我批准后它完成编码并通过测试 | P0 |
| US-02 | 作为开发者，我让 agent 跨多个文件实现一个小 feature，每一步改动我都看到 diff 并逐个批准 | P0 |
| US-03 | 作为开发者，我在只读模式下向 agent 提问"这个函数在哪被调用"，它探索代码库后回答 | P0 |
| US-04 | 作为开发者，我对 `npm test` 这类安全命令设置 always-allow，此后不再被打断 | P0 |
| US-05 | 作为开发者，agent 改错了文件，我能一键回滚到改动前的 checkpoint | P0 |
| US-06 | 作为开发者，我随时能看到本会话已消耗的 token 与金额，超预算时 agent 自动暂停 | P0 |
| US-07 | 作为开发者，我给项目写一份 AGENTS.md，agent 每次会话自动遵守项目规范 | P0 |
| US-08 | 作为开发者，我接入社区 MCP server（如浏览器、数据库），扩展 agent 能力 | P1 |
| US-09 | 作为开发者，我在 CI 中用非交互模式让 agent 修复 lint/测试 | P1 |
| US-10 | 作为开发者，我在 Zed/JetBrains 中通过 ACP 直接使用本引擎 | P2 |

---

## 4. 功能需求

### 4.1 P0 —— MVP（对应里程碑 M0–M3，8 周内交付）

**F1 会话与 Agent 主循环**
- 单线程主循环（LLM↔工具调用），流式输出；事件流（append-only）记录全部行为。
- 验收：真实仓库中完成"读懂一段代码并做小修改"任务；全程事件可回放。

**F2 内置工具集（按 ACI 原则设计工具面）**
- `read`（带行号、视窗式读取）、`write`、`edit`（精确替换、失败即报错并给出提示）、`bash`（超时与输出截断控制）、`grep`/`glob`。
- 验收：自建评测集上 `edit` 一次成功率 ≥ 90%、单步编辑平均额外重试 ≤ 0.5 次；单次工具输出超过 2k token 自动截断并给出精化建议。

**F3 权限与审批系统**
- 三个权限模式：`plan`（只读）/ `default`（写与执行需审批）/ `yolo`（跳过审批，高危显式开启）。
- 审批选项：Allow once / Allow always（白名单：命令前缀、文件路径、域名）/ Reject with feedback。
- 验收：`default` 模式下任何写盘与命令执行均有门禁；白名单持久化并在设置中可审计、可删除。

**F4 Checkpoint 回滚**
- 每次 agent 修改前自动创建 git checkpoint（shadow ref，不污染用户历史）。
- 验收：任意一步可回滚到之前任一 checkpoint；不丢失用户未提交的无关改动。

**F5 上下文工程**
- AGENTS.md 分层加载（全局 → 项目 → 子目录）；接近模型窗口上限 80% 时自动 compaction（摘要重建上下文，保留任务清单与关键文件）；轻量 repo map（tree-sitter 符号签名 + 按预算裁剪）。
- 验收：长会话（>200 轮工具调用）不中断且任务不漂移；对 1 万文件量级的中型仓库，repo map ≤ 2k token 且包含全部顶层目录与主要入口文件。

**F6 多模型接入**
- 基于 Vercel AI SDK 的薄封装：Anthropic、OpenAI、GLM、DeepSeek、Qwen、Kimi、OpenRouter、Ollama（本地）。
- 每模型能力声明（上下文窗口、工具调用、推理模式），编辑格式与提示词按模型适配。
- 验收：8 个 provider 各自完成 F1 验收任务；切换 provider 只改一行配置。

**F7 终端 TUI（Ink）**
- 流式对话、diff 审批界面、工具调用实时状态、成本仪表条、会话恢复。
- 验收：Windows Terminal / PowerShell、macOS Terminal、主流 Linux 终端渲染正常；首屏 < 300ms。

**F8 成本仪表（差异化重点）**
- 实时 token/费用统计（按会话、按任务、按模型），支持 `--budget` 预算上限，超限暂停并请示。
- 验收：统计值与 provider 账单误差 < 5%；缓存命中单独计价展示。

**F9 会话持久化与恢复**
- 会话以 JSONL 事件流落盘（`~/.modou/sessions/`），可恢复、可回放、可导出。
- 验收：进程被杀后恢复会话不丢上下文。

**F10 配置系统**
- `settings.json`（provider、权限、预算）+ AGENTS.md；Zod 校验，错误信息可读。
- 验收：零配置可跑（引导选择 provider）；所有配置项有文档。

**F11 MCP Client（MVP 仅 stdio 传输）**
- M2 交付 stdio 传输与 MCP server 的接入/启停管理；Streamable HTTP 传输与图形化管理界面归入 P1（v0.2）。
- 验收：接入任意社区 MCP server 后，其工具与本产品内置工具走同一权限门禁与审批流。

### 4.2 P1（v0.2，第 3 个月）

| ID | 功能 | 说明 |
|---|---|---|
| F12 | Plan Mode | 只读分析产出计划 → 用户确认 → 切执行模式 |
| F13 | Subagent | 内置 `explore`（代码探索）与 `code-review` 两个子代理，隔离上下文仅回摘要 |
| F14 | Hooks | 会话/工具生命周期钩子（PreToolUse、PostToolUse 等） |
| F15 | Skills（SKILL.md） | 兼容开放 Skills 标准，按需加载能力包 |
| F16 | LSP 上下文 | 基于 vscode-languageserver-protocol 独立客户端，诊断与定义跳转注入上下文 |
| F17 | 非交互模式与 SDK | `modou -p "..."` 单命令模式（CI 可用）；`@modou/sdk` 可编程调用 |
| F18 | Server 包 | HTTP + SSE 服务化，会话 API，为多端复用打地基；含 MCP Streamable HTTP 传输与管理界面 |

### 4.3 P2（v0.3+，商业验证期）

- F19 **ACP 兼容**：作为 agent 接入 Zed / JetBrains（借 ACP Registry 分发）。
- F20 **VS Code 插件**：复用 server 的官方前端之一。
- F21 **Web 控制台**：任务列表、多会话并行、diff 审阅。
- F22 **云任务**：Docker/Firecracker 沙箱并行执行（商业化起点）。
- F23 **团队版**：统一账号、用量管理、审计日志。

### 4.4 明确不做（Non-goals，YAGNI）

- 向量索引/嵌入 RAG（MVP 阶段；超大库场景在 v0.3 后按需评估 Merkle 增量索引）
- 自研模型、Tab 补全（autocomplete）——与 Cursor 正面竞争无胜算
- 桌面 GUI、多 agent 编排框架、A2A 协议（观察即可）
- fork 任何编辑器

---

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | TUI 首屏 < 300ms；工具执行全程流式；compaction 触发于窗口 80%，压缩期间 UI 不阻塞 |
| 安全 | 默认拒绝一切写盘/执行外操作；白名单粒度到命令前缀/路径/域名；AGENTS.md 与一切外部内容视为**不可信数据**（防提示注入），高危操作（删文件、网络请求、git push）即使白名单也二次确认；API key 仅存本机 keytar/环境变量，日志脱敏 |
| 隐私 | 默认零遥测（opt-in 匿名统计）；代码仅直连用户选择的模型 API，不经任何中间服务器 |
| 跨平台 | Windows 10/11（PowerShell/cmd 适配为一等目标）、macOS、Linux；Node 24 LTS |
| 成本 | 成本统计误差 < 5%；预算上限硬约束 |
| 可维护性（单人约束） | 单文件 < 500 行；core 包测试覆盖率 > 80%；每个包有独立 README；变更日志随版本发布 |

---

## 6. 产品架构

### 6.1 总体架构

```
┌────────────────────────────────────────────────────────────┐
│                     前端（可并存多端）                        │
│   CLI/TUI (Ink)  │  VS Code插件(P2) │  Web控制台(P2) │ CI    │
└────────┬─────────────────────┬───────────────┬─────────────┘
         │ in-process          │ HTTP + SSE    │
┌────────▼─────────┐  ┌───────▼───────────────▼─────────────┐
│ packages/cli     │  │ packages/server（会话状态/事件流）    │
│  TUI + 本地会话   │  │  REST API + SSE 事件总线（ACP 预留） │
└────────┬─────────┘  └───────┬─────────────────────────────┘
         │                    │
┌────────▼────────────────────▼──────────────────────────────┐
│                packages/core（headless Agent 引擎）          │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐  │
│  │ 主循环    │ │ 工具系统  │ │ 权限引擎   │ │ 上下文管线    │  │
│  │ (事件驱动)│ │ 内置+MCP │ │ 模式×白名单│ │ AGENTS.md/   │  │
│  │          │ │          │ │           │ │ compaction/  │  │
│  │          │ │          │ │           │ │ repo map     │  │
│  └──────────┘ └──────────┘ └───────────┘ └──────────────┘  │
│  ┌──────────────────┐ ┌────────────────┐ ┌─────────────┐  │
│  │ 模型接入层        │ │ 会话存储(JSONL) │ │ checkpoint  │  │
│  │ AI SDK 薄封装     │ │ ~/.modou/      │ │ (git shadow)│  │
│  └──────────────────┘ └────────────────┘ └─────────────┘  │
└────────────────────────────────────────────────────────────┘
         │                        │
   LLM Providers           MCP Servers (stdio/HTTP)
```

### 6.2 Monorepo 结构

```
modou/
├─ packages/
│  ├─ core/      # 引擎：主循环、工具、权限、上下文、模型接入（零 UI 依赖）
│  ├─ cli/       # Ink TUI + 命令行入口
│  ├─ server/    # HTTP+SSE 服务化（P1 后期）
│  ├─ sdk/       # 供插件与第三方嵌入的客户端 SDK
│  └─ eval/      # 评测 harness（私有用例，不随 npm 发布）
├─ docs/         # 面向用户与贡献者的文档
└─ (pnpm workspace + Turborepo)
```

### 6.3 主循环与状态机

状态机：`idle → planning → acting → waiting_approval → (compact) → done | error`。
- 单线程事件驱动循环（Claude Code 验证的单 master loop 模式），每一步产生事件写入会话 JSONL，前端只是事件的订阅者——这是 C/S 分离的根基。
- `waiting_approval` 状态下循环挂起，等待审批事件；超时可配置默认行为（默认 Reject）。
- 错误恢复：工具失败将错误与修复提示回注模型（最多 N 次重试），不中断会话。

### 6.4 工具系统（ACI 原则）

工具面质量优先于数量（SWE-agent 教训）：`read` 返回带行号视窗而非整文件；`edit` 用精确 search/replace、失败时返回最相近候选；`bash` 输出超长自动截断并提示用 grep 精化。所有内置工具定义用 Zod schema 声明参数，同一 schema 同时生成给 LLM 的 tool spec 与运行时校验。MCP 工具与本内置工具走同一接口。

### 6.5 权限模型（借鉴 Codex 矩阵并简化）

| 模式 \ 操作 | 读文件/grep | 写文件 | 执行命令 | 网络 |
|---|---|---|---|---|
| plan | ✅ | ❌ | ❌ | ❌ |
| default | ✅ | 审批 | 审批（白名单免批） | 审批 |
| yolo | ✅ | ✅ | ✅ | ✅（高危命令仍拦截） |

always-allow 白名单持久化于 `settings.json`，设置界面可审计。OS 级沙箱（macOS Seatbelt / Linux Landlock / Windows 受限令牌）作为 P1 增强，目标是"少弹窗而更安全"。

### 6.6 上下文管线

装配顺序：system prompt（含工具说明）→ 全局/项目 AGENTS.md → repo map（按 token 预算）→ 会话历史 → 本轮用户输入。compaction：达到窗口 80% 时，摘要历史但**硬保留**当前任务清单、最近 N 次工具结果与被用户明确强调的约束。检索策略：MVP 用 grep/glob 实时探索 + repo map，不建索引。

### 6.7 模型接入层

Vercel AI SDK 作为多 provider 底座 + 针对专有能力（prompt cache、reasoning 透传）的薄封装，保留直连官方 SDK 的逃生通道。每个模型注册能力声明（上下文窗口、工具调用支持、reasoning、计价），驱动 compaction 阈值、编辑格式选择与成本计算。

### 6.8 数据与存储

- 会话：`~/.modou/sessions/<id>.jsonl`（事件流，天然支持回放与多端同步）。
- 配置：`~/.modou/settings.json`（全局）+ `<repo>/modou.json`（项目，可选）。
- Checkpoint：git shadow refs（`refs/modou/*`），不污染用户分支历史。

---

## 7. 技术选型

| 领域 | 选型 | 理由 | 备选 |
|---|---|---|---|
| 语言/运行时 | TypeScript 5.x + Node 24 LTS | 迭代最快、AI/MCP/LSP 生态最全、与未来 VS Code 插件同栈 | Rust（分发好但单人迭代慢 2–3 倍）、Go |
| 包管理/构建 | pnpm workspace + Turborepo | 2026 官方推荐组合，单人均可驾驭 | npm workspaces |
| LLM 接入 | Vercel AI SDK（薄封装） | 统一 20+ provider；保留官方 SDK 逃生通道 | 各家官方 SDK 直连 |
| TUI | Ink | Claude Code/Gemini CLI 同款，React 心智、生态成熟 | blessed、Go bubbletea |
| MCP | @modelcontextprotocol/sdk（官方 TS SDK） | 随规范同步更新 | 自实现协议 |
| LSP | vscode-languageserver-protocol + vscode-jsonrpc | 协议层与 VS Code 解耦，可独立使用 | — |
| Server | Hono + SSE | 轻量、跨运行时 | Fastify |
| 校验 | Zod | 工具参数/配置校验一体 | — |
| 测试 | vitest + LLM 录制回放（fixture） | 单测/集成统一 | jest |
| 打包/发布 | tsdown + changesets + npm | 单包安装 `npm i -g modou`，免编译 | — |
| CI/CD | GitHub Actions（测试 + eval 回归 + 发布） | 开源标配 | — |

**关键取舍说明**：① 不用 LangGraph/AutoGen 等编排框架——编程 Agent 需要完全控制权限与上下文，自研薄循环已被 mini-swe-agent 证明成本很低；② 不用 Rust/Go——1 人全职下迭代速度是生死线，性能瓶颈（TUI 渲染）可后期局部替换；③ 不建向量索引——中小仓库 grep 路线够用且零基础设施，避免 Cursor 式索引的隐私与维护成本。

---

## 8. 评测与质量策略

- **自建评测集（eval harness，`packages/eval`）**：20 个真实 issue 回放用例（bug + 回归测试断言）+ 10 个终端任务，Docker 沙箱并行执行；每次提示词/模型/管线变更必须跑回归，作为发布门禁。用例私有，防数据污染。
- **横向参照**：同一模型下与 opencode / Claude Code 在自建评测集上对比任务成功率与平均成本（对外口径可选 SWE-bench Verified 子集）。
- **测试分层**：单元测试（core 覆盖率 > 80%）→ 集成测试（录制回放 LLM 响应，不烧钱）→ 端到端 eval（真实模型）。
- **发布门禁**：eval 不回退 + 全部测试通过 + 真实自用（dogfooding）至少一个工作日。

---

## 9. 路线图（1 人全职，MVP 8 周）

| 里程碑 | 时间 | 交付物 | 验收标准 |
|---|---|---|---|
| **M0 骨架** | W1–2 | monorepo 脚手架；AI SDK provider 层（≥3 家）；最小主循环 + read/bash/grep 三工具；Ink 流式 TUI；JSONL 会话落盘 | 真实仓库完成"解释代码+一处小修改"任务，全程流式无卡死 |
| **M1 安全与上下文** | W3–4 | edit/write 工具 + diff 审批；权限模式×白名单；AGENTS.md 分层；compaction；成本仪表（F8）；git checkpoint 回滚 | `default` 模式零越权；长会话不中断；成本误差 <5%；改动可回滚 |
| **M2 生态与健壮** | W5–6 | MCP client（stdio）；plan mode；`explore` subagent；多模型能力适配（补齐 8 provider）；错误恢复与会话恢复 | 接入 2 个社区 MCP server 实用；杀进程后恢复会话不丢上下文 |
| **M3 公开发布** | W7–8 | eval harness + 自建评测基线；文档站（英/中）；`npm i -g modou` 发布 v0.1.0（Apache-2.0，GitHub 开源）；build-in-public 宣发（HN/V2EX/掘金/X） | 自建评测通过率基线建立且不回退；从安装到完成任务 < 5 分钟 |
| **M4 多端与增强** | 第 3 个月 | server 包 + SSE；ACP 兼容（接 Zed）；Skills/hooks/LSP；VS Code 插件 alpha；OS 沙箱增强 | 任一 ACP 编辑器中可用；SDK 可被第三方嵌入 |
| **M5 商业验证** | 第 4 个月起 | Web 控制台 + 云任务沙箱（收费）；官方模型网关订阅内测 | 首批付费用户验证支付意愿 |

> 节奏原则：每个里程碑结束时产品都处于"自己每天在用"的状态（dogfooding 优先于功能堆叠）。

---

## 10. 商业化规划（开源核心 + 商业增值）

- **开源部分**（Apache-2.0）：`core / cli / server / sdk` 全部功能不设阉割。选 Apache-2.0 而非 FSL/AGPL：避免 Crush 式许可争议与 Zed 式企业引用摩擦，最大化个人开发者信任（D2/D3 的渠道基础）。
- **增值路径**（参照 Hyper/Zen 样板，核心功能永不闭源）：
  1. **官方模型网关订阅**（$20/月档）：统一计费、免自备 API key、内置缓存优化省钱——解决"开发者不想办 5 张国外信用卡"的真实痛点，尤其面向国内用户。
  2. **云任务托管**（按用量计费）：并行沙箱执行任务（F22）。
  3. **团队版**（远期）：SSO、用量管理、审计。
- **纪律**：增值只做"托管、并发、合规"，不做"功能锁"；若网关策略引发中立性质疑（OpenCode Zen 的教训），公开计价与不加价承诺。

---

## 11. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 单人带宽不足，里程碑延期 | 高 | 严格 YAGNI（Non-goals 清单）；每里程碑 dogfooding 优先；不在主循环上过度工程 |
| opencode/大厂碾压（免费、迭代快） | 高 | 避开功能战，占差异位：成本透明、Windows/中文、国产模型与网关订阅；build in public 积累社区 |
| 提示注入（AGENTS.md/MCP 内容投毒） | 高 | 外部内容一律视为不可信数据；高危操作强制人工确认（白名单不可覆盖）；沙箱增强（M4） |
| 供应链安全（依赖投毒，Cline hAIsteal 教训） | 中 | 依赖锁死 + Dependabot + 发布前 `npm audit`；发布流水线最小权限 |
| 模型 API 变动/计价变化 | 中 | AI SDK 适配层隔离；能力声明机制让降级路径明确 |
| 用户 token 成本失控引发口碑风险 | 中 | 成本仪表 + 预算硬上限（V1 主张即答案）；默认启用 prompt cache |
| 开源冷启动无人问津 | 中 | M3 起持续内容输出；中文渠道（掘金/V2EX/B站）差异化；把 AGENTS.md/Skills 兼容做成"可迁移"卖点 |
| TUI 在 Windows 终端兼容性差 | 中 | M0 起即以 Windows Terminal 为首要测试环境（本机即 Windows，天然 dogfooding） |

---

## 12. 附录

### A. 标准兼容清单（首发承诺）

| 标准 | 支持里程碑 | 说明 |
|---|---|---|
| AGENTS.md | M1 | 分层加载（全局→项目→子目录） |
| MCP | M2 | stdio 先行，Streamable HTTP 随后 |
| Agent Skills (SKILL.md) | M4 | 与 AGENTS.md 同理念，按需加载 |
| ACP | M4 | 作为 agent 接入 Zed/JetBrains |

### B. 本 PRD 的信息来源

GitHub API / shields.io 实时数据（2026-09-19）；各项目官方文档与仓库 README；MCP 官方博客与规范；agentclientprotocol.com；SWE-bench / Terminal-Bench 官网；Anthropic、LangChain 技术博客；The New Stack、Zuplo《State of MCP》等行业报告。完整链接清单见调研报告原文。

### C. 后续流程

1. 用户评审本 PRD → 通过后进入实施计划（plan.md）：将 M0–M3 拆解为 2–5 分钟粒度、含验收步骤的任务清单（TDD）。
2. 按 superpowers 工作流执行：TDD 实现 → 子代理并行开发 → 代码评审 → 分支收尾。
