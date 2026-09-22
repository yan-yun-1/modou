# 实施计划：TUI 改版「极简风」（对齐 Claude Code 式终端体验）

> 关联：[docs/PRD.md](docs/PRD.md)、[docs/plan-m3.md](docs/plan-m3.md)（M3 已完成，v0.4.0-alpha）
> 用户需求：当前终端界面简陋（裸提示符 + 单行 `0↑0↓$0`），参考其它 Agent 的 TUI 设计改进。**纯终端、跨平台、轻量、启动快**；先设计后代码。
> 已确认决策（2026-09-22）：视觉风格 = **极简风（Claude Code 式）**；范围 = **五个阶段一次做完**。不引入重的 TUI 框架（不换 blessed/react-blessed），继续 Ink 5 + 自研组件，零新依赖。

---

## 一、设计

### 1.1 目标视觉

```
墨斗 v0.4.3 · glm-4.5-air · default                    ← 欢迎行（启动即出，dim）

  ❯ 把 utils.js 里重复的解析逻辑抽成函数                 ← 用户消息（cyan ❯）

  ⚙ read {"path":"src/utils.js"}                        ← 工具调用（dim）
    ↳ 142 行                                            ← 工具结果（缩进）
  ⚙ edit …
    ↳ 已修改 src/utils.js

  抽取公共函数时发现三处重复…（流式增量在此渲染）

  ✻ 抽取公共函数… (esc 中断 · 12.3s · 第 5 步)          ← 忙碌行：spinner + 摘要 + 计时 + 步数

╭──────────────────────────────────────────╮            ← 输入卡（round 边框，空闲时）
│ ❯ 输入任务，/ 开头为命令…                 │
╰──────────────────────────────────────────╯
  /plan /init /skills /mcp /cost …（Tab 补全 · Ctrl+C 退出）   ← 命令提示行（输入 / 时高亮匹配）

 glm-4.5-air · default │ ↑1.2k ↓345 $0.013 │ ▐███░░░░░ 31% ctx   ← 状态栏（单行三段）
```

设计原则（对齐参考产品的共性，而非像素级复刻）：
1. **历史区静默、底部区活跃**：消息历史用 Ink `<Static>` 冻结（不再每帧重渲），屏幕底部只有输入卡 + 忙碌行 + 状态栏三个活动块。
2. **一行状态栏讲完全部状态**：`模型 · 权限模式 │ ↑in ↓out $cost │ ctx 剩余%` 三段式，段间 `│` 分隔，整体 dim、数字高亮。
3. **忙碌行取代黑盒**：busy 时输入卡收起，显示 `✻ spinner + 最近动作摘要 + (esc 中断 · 计时 · 步数)`。
4. **零新依赖**：spinner（✻✽✜✢✣✲✳ 帧序列自绘，120ms/帧）、进度条（█░ 字符块）手写。
5. **Windows 优先**：符号全部选 Unicode BMP 常见字符（✻ ❯ ⚙ ↳ █░ ⎘），conhost 与 Windows Terminal 均可渲染。

### 1.2 组件结构（改版后）

```
ModouApp
├─ <Static items={history}>              ← 新：冻结已完成的消息
├─ {streaming && <StreamingBlock>}       ← 流式文本（60ms 节流）
├─ {busy ? <BusyLine/> : null}           ← 新：spinner + 摘要 + esc 中断 + 计时 + 步数
├─ {pendingApproval && <ApprovalPrompt>} ← 保留（标题加粗）
├─ {pendingPlan && <PlanConfirm>}        ← 保留（📋 换 ⎘）
├─ {!busy && <InputCard>}                ← InputBox 改造：round 边框 + placeholder + Tab 补全
└─ <StatusBar/>                          ← 新（替换 CostBar）：三段式
```

### 1.3 关键交互

| 交互 | 设计 |
|---|---|
| Esc 中断 | busy 时 `esc` = 中断当前任务（复用 `taskAbortRef.abort()`）；Ctrl+C 语义不变 |
| 流式节流 | delta 落 ref 缓冲，60ms interval flush（每秒 ≤17 帧）；assistant_message 到达先 flush 再清空 |
| 斜杠补全 | `/` 前缀时提示行列匹配命令，`Tab` 补全首项 |
| 忙碌摘要 | 最近 tool_call 的 `name + args 摘要`；无工具轮次显示"思考中…" |
| ctx 剩余% | `usage 三项和` 与 `estimateTokens(messages)` 取大者 / `contextWindow`；数据从 LoopBundle 新增 `contextWindow` 接入 |
| 欢迎行 | `墨斗 vX · model · mode`（render 前已可用，立即显示）；装配完成后追加"✓ 上下文就绪"条目 |

### 1.4 启动提速

现状：TUI 在 `createLoopFromSettings`（MCP 串行 connect + repo map 全目录扫描）之后才 render，期间白屏数秒。

改造：**TUI 先行、上下文后台装配**——render 提前到 factory 之前；App 增 `bundle: LoopBundle | null`（初始 null），装配期欢迎行 + 输入卡（placeholder 变"正在装配上下文…"，提交拦截）可见；factory 内 MCP 串行改 `Promise.all` 并行；就绪后切换 + "✓ 上下文就绪"。bundle 为 null 时 /plan /resume /skills 等提示"装配中，请稍候"。

---

## 二、任务清单（TDD，一任务一提交）

- **T1** StatusBar 三段式组件（替换 CostBar，其测试迁移）——分色阈值 80%/95%
- **T2** 数据接通：LoopBundle.contextWindow + index.tsx 传 settings 字段
- **T3** InputCard：round 边框 + placeholder + 欢迎行
- **T4** 斜杠命令补全：`SLASH_COMMANDS` 导出 + Tab 补全
- **T5** BusyLine：自绘 spinner + 摘要 + esc 中断 + 计时步数
- **T6** 流式 60ms 节流
- **T7** 历史条目 `<Static>` 化
- **T8** 视觉统一：图标缩进、📋→⎘、审批标题加粗
- **T9** MCP 连接并行化（Promise.all，单失败不阻断不变）
- **T10** TUI 先行 + 后台装配（bundle:null 过渡态 + 提交拦截 + 就绪条目）
- **T11** README 界面示意 + dev.md 组件结构 + backlog

## 三、验收标准

1. 启动 <300ms 可见欢迎行与输入卡（装配不白屏）
2. busy 可见 spinner/最近动作/计时，Esc 真能中断
3. 状态栏实时三段式，ctx ≥80% 黄 / ≥95% 红
4. `/` 补全 + Tab 生效
5. 长流式回复 60ms 节流不卡
6. Windows Terminal 与 conhost 符号均正常
7. 253 测试全绿零回归

## 四、明确不做

不换 TUI 框架、不加鼠标支持、不做主题配色（记 backlog）、不做虚拟滚动（Static 已解决重渲）、不改 core 事件协议、onboarding 重设计另开小任务。
