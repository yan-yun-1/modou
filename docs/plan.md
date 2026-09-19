# 实现计划：M0「骨架」（对应 PRD 里程碑 M0，第 1–2 周）

> 关联文档：[docs/PRD.md](./PRD.md)（v1.0，已评审通过）
> 范围声明：本计划只覆盖 M0。M1–M3 按 YAGNI 原则在各自启动时再出计划，避免为未验证的假设写细节。

## 执行纪律（每个任务都必须遵守）

1. **TDD 红绿循环**：先写失败测试（RED）→ 最小实现（GREEN）→ 重构（REFACTOR）→ 提交（COMMIT）。core 包不允许出现无测试的代码。
2. **一任务一提交**：`feat(core): 简述` / `test:` / `chore:` 前缀；提交前 `pnpm lint && pnpm test` 必须通过。
3. **偏离即停**：实现时发现计划有误（接口不匹配、依赖缺失），立即停止并在会话中报告，不自行改设计。
4. **批量检查点**：每完成 3–5 个任务做一次人工检查点（运行 demo、真机 TUI 验证）。
5. 预计时间为净编码时间；实际按 ×3 缓冲（调试/学习曲线）。M0 总量约 45–55 净工时，符合 2 周全职。

## 环境确认（已验证）

- Node v24.16.0 ✅（PRD 要求 24 LTS）、pnpm 11.17.0 ✅、git 身份已配置 ✅、仓库已初始化（master，PRD 已提交）✅

## 接口契约（所有任务共同遵守，改动需回到本文件）

```ts
// packages/core/src/events.ts —— 事件是唯一事实来源（append-only）
type LubanEvent =
  | { type: 'session_started'; sessionId: string; model: string; at: number }
  | { type: 'user_message'; text: string; at: number }
  | { type: 'assistant_message'; text: string; at: number }        // 流式结束后的完整文本
  | { type: 'tool_call'; id: string; name: string; args: unknown; at: number }
  | { type: 'tool_result'; id: string; output: string; truncated: boolean; at: number }
  | { type: 'approval_request'; id: string; name: string; args: unknown; reason: string; at: number }
  | { type: 'approval_result'; id: string; granted: boolean; remembered: boolean; at: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; at: number }
  | { type: 'error'; message: string; fatal: boolean; at: number };

// packages/core/src/tools/types.ts
interface ToolContext { cwd: string; signal: AbortSignal; }
interface Tool<T = unknown> {
  name: string; description: string;
  kind: 'read' | 'write' | 'execute';        // 权限引擎只依赖 kind
  schema: z.ZodType<T>;
  run(args: T, ctx: ToolContext): Promise<{ output: string; truncated?: boolean }>;
}

// packages/core/src/agent-loop.ts
interface AgentLoopDeps {
  model: LanguageModel;                      // AI SDK 的 LanguageModel
  tools: Map<string, Tool>;
  store: SessionStore;
  permissions: PermissionEngine;
  approve: (req: ApprovalRequest) => Promise<{ granted: boolean; remembered: boolean }>;
  systemPrompt: string;
  maxSteps?: number;                         // 默认 30
}
class AgentLoop { run(input: string, sessionId: string): AsyncIterable<LubanEvent>; }
```

---

## 任务列表

### Phase A：工程骨架

#### 任务 A1：仓库基础配置
- 文件：`/.gitignore`、`/package.json`、`/pnpm-workspace.yaml`、`/turbo.json`、`/tsconfig.base.json`
- 描述：pnpm workspace（packages/*）+ Turborepo；根 package.json 设 `"packageManager"`、`engines.node>=24`；tsconfig strict + NodeNext + verbatimModuleSyntax。
- 验证：`pnpm install` 成功；`pnpm exec turbo --version` 可执行；`git status` 无意外产物。
- 依赖：无。预计：20 分钟

#### 任务 A2：core 包脚手架与冒烟测试
- 文件：`/packages/core/package.json`、`tsconfig.json`、`vitest.config.ts`、`src/index.ts`、`src/version.ts`、`test/smoke.test.ts`
- 描述：`@luban/core` 包，vitest 环境；冒烟测试断言 `VERSION` 与导出存在（此任务作为 TDD 流程演示：先跑失败测试）。
- 验证：`pnpm --filter @luban/core test` 绿。
- 依赖：A1。预计：15 分钟

#### 任务 A3：cli 包脚手架
- 文件：`/packages/cli/package.json`（bin: `luban`）、`tsconfig.json`、`src/index.ts`、`test/version.test.ts`
- 描述：`@luban/cli`，先用 commander 解析 `--version`/`--help`；build 用 tsdown。
- 验证：`pnpm --filter @luban/cli build && node packages/cli/dist/index.js --version` 输出正确版本。
- 依赖：A1。预计：15 分钟

#### 任务 A4：质量工具链与 CI
- 文件：`/eslint.config.js`、`/.prettierrc.json`、`/package.json`（scripts）、`/.github/workflows/ci.yml`
- 描述：eslint flat config（TS 严格）+ prettier；scripts：`lint/format/test/build` 全部走 turbo；CI 矩阵 ubuntu + windows（Node 24）：install→lint→test→build。
- 验证：`pnpm lint && pnpm format:check && pnpm test` 全绿；ci.yml 通过 `pnpm exec actionlint`（若可用）或人工核对语法。
- 依赖：A2。预计：25 分钟

### Phase B：事件流与会话存储（core）

#### 任务 B1：事件类型与 Zod Schema
- 文件：`/packages/core/src/events.ts`、`test/events.test.ts`
- 描述：按「接口契约」实现 `LubanEvent` 判别联合 + zod schema + `parseEvent`/`isLubanEvent`。
- 验证：测试合法事件 round-trip、非法事件（缺字段/未知 type）被拒并给出可读错误。
- 依赖：A2。预计：30 分钟

#### 任务 B2：JSONL 会话存储
- 文件：`/packages/core/src/session-store.ts`、`test/session-store.test.ts`
- 描述：`SessionStore(baseDir)`：`create(id?)`/`append(sessionId, event)`（`fs.appendFile` 原子追加）/`read(sessionId)`/`list()`；目录默认 `~/.luban/sessions`，可注入（测试用临时目录）。
- 验证：写入 1000 事件后 read 顺序一致；损坏行抛出含行号的描述性错误；并发 append 不交错（追加 ≤ 单条 write）。
- 依赖：B1。预计：30 分钟

#### 任务 B3：会话状态重建
- 文件：`/packages/core/src/session.ts`、`test/session.test.ts`
- 描述：`rebuildState(events)` → `{ messages: ModelMessage[]; usageTotals }`，供主循环恢复上下文与 TUI 恢复显示。
- 验证：给定混合事件序列，重建出的 messages 可直接喂给 AI SDK；usageTotals 正确累加。
- 依赖：B2。预计：30 分钟

### Phase C：模型接入层（core）

#### 任务 C1：模型目录与能力声明
- 文件：`/packages/core/src/models/catalog.ts`、`test/catalog.test.ts`
- 描述：`ModelCapabilities`（contextWindow、supportsTools、supportsReasoning、输入/输出/缓存读/缓存写单价 USD/Mtok）+ 内置目录：claude-sonnet、gpt-5.x、glm-4.x、deepseek-chat/reasoner、qwen-max、kimi-k2、openrouter 兜底、ollama 占位。价格注明来源与日期，允许 `models.json` 覆盖。
- 验证：目录条目通过 schema 校验；未知模型 id 查询报错信息含「如何在 models.json 添加」。
- 依赖：A2。预计：45 分钟

#### 任务 C2：Provider 工厂
- 文件：`/packages/core/src/models/provider.ts`、`test/provider.test.ts`
- 描述：`createLanguageModel(config)` 按配置惰性加载对应 AI SDK provider（anthropic/openai 官方包；deepseek/qwen/kimi/glm 走 openai-compatible 或官方适配包；ollama 本地）。API key 从构造参数传入（读取环境/设置文件是 CLI 层职责）。
- 验证：每类配置返回正确 provider 实例（冒烟级断言）；无效 provider 名报错可读。
- 依赖：C1。预计：45 分钟

#### 任务 C3：流式封装
- 文件：`/packages/core/src/models/stream.ts`、`test/stream.test.ts`
- 描述：`streamTurn(model, messages, tools)` → `AsyncIterable<LubanEvent>`：将 AI SDK 流片段（text-delta/tool-call/finish+usage）映射为 `assistant_message`/`tool_call`/`usage` 事件；支持 AbortSignal。
- 验证：用 `ai/test` 的 MockLanguageModel 脚本化片段，断言事件序列、文本聚合、usage 捕获、abort 中断。
- 依赖：B1、C2。预计：45 分钟

#### 任务 C4：成本计算
- 文件：`/packages/core/src/models/cost.ts`、`test/cost.test.ts`
- 描述：`computeCost(usage, caps)`：输入/输出/缓存读/缓存写分别计价，保留 6 位小数。
- 验证：给定数值用例（含缓存命中）手工核算比对，误差为 0。
- 依赖：C1。预计：20 分钟

### Phase D：工具系统（core）

#### 任务 D1：Tool 接口与注册表
- 文件：`/packages/core/src/tools/types.ts`、`registry.ts`、`test/tools-registry.test.ts`
- 描述：按「接口契约」实现 `Tool`/`ToolContext`/`ToolRegistry`（注册重名报错、schema 校验失败返回结构化错误）+ `createBuiltinTools()` 汇总入口。
- 验证：注册/查询/重复注册/schema 拒绝用例全绿。
- 依赖：A2。预计：30 分钟

#### 任务 D2：read 工具
- 文件：`/packages/core/src/tools/read.ts`、`test/tools-read.test.ts`
- 描述：带行号视窗读取（`offset`/`limit`，默认 2000 行）；超出约 2k token 截断并附「用 offset 续读」提示；二进制/超长行安全处理。
- 验证：fixture 长文件测试窗口、截断标记、行号格式（cat -n 风格）。
- 依赖：D1。预计：30 分钟

#### 任务 D3：grep 工具
- 文件：`/packages/core/src/tools/grep.ts`、`test/tools-grep.test.ts`
- 描述：纯 JS 实现（不依赖 rg 二进制）：递归遍历（跳过 node_modules/.git/隐藏目录与二进制文件），JS 正则匹配，可选 include glob 过滤；输出 `file:line: text`，上限 100 条并提示收窄。
- 验证：fixture 目录树测试命中、过滤、上限、非法正则的友好报错。
- 依赖：D1。预计：45 分钟

#### 任务 D4：glob 工具
- 文件：`/packages/core/src/tools/glob.ts`、`test/tools-glob.test.ts`
- 描述：基于 Node 24 `fs.promises.glob` 的模式匹配，输出相对路径列表，上限 500 条。
- 验证：`**/*.ts` 等模式在 fixture 树上的结果正确。
- 依赖：D1。预计：20 分钟

#### 任务 D5：bash 工具
- 文件：`/packages/core/src/tools/bash.ts`、`test/tools-bash.test.ts`
- 描述：跨平台 shell 执行——win32 用 `powershell.exe -NoProfile -Command`，其余 `sh -c`；默认超时 120s（超时杀进程树）；输出只保留尾部约 2k token；返回 exit code。`kind: 'execute'`。
- 验证：echo 用例；`node -e "setTimeout(...)"` 超时用例；超长输出截断用例；`AbortSignal` 取消用例。Windows 为首要测试平台（本机）。
- 依赖：D1。预计：45 分钟

### Phase E：主循环与权限（core）

#### 任务 E1：权限引擎
- 文件：`/packages/core/src/permissions.ts`、`test/permissions.test.ts`
- 描述：`PermissionEngine`：模式 `plan|default|yolo`；`decide(tool, args)` → `allow|deny|ask`；规则表支持 always-allow（命令前缀、路径前缀）；`plan` 拒绝一切非 read 工具；`yolo` 仍对高危模式（`rm -rf`、`git push`、`Remove-Item -Recurse` 等）强制 ask；`remembered` 规则运行时累加并导出持久化快照。
- 验证：模式×操作全矩阵表驱动测试（≥20 用例）。
- 依赖：D1。预计：40 分钟

#### 任务 E2：主循环骨架（纯对话）
- 文件：`/packages/core/src/agent-loop.ts`、`test/agent-loop.basic.test.ts`
- 描述：`AgentLoop.run()`：装配 system prompt + 重建消息 → `streamTurn` → 发射事件 → 无工具调用即结束。事件全部经 `store.append` 持久化。
- 验证：MockLanguageModel 单轮对话：事件序列（session_started→user_message→assistant_message→usage）与持久化内容一致。
- 依赖：B2、C3、E1（接口先行的 stub 即可）。预计：30 分钟

#### 任务 E3：工具执行与审批接线
- 文件：`/packages/core/src/agent-loop.ts`（扩展）、`test/agent-loop.tools.test.ts`
- 描述：处理模型 tool_call：schema 校验 → `permissions.decide` → `ask` 时调用 `approve()`（发射 approval_request/result 事件）→ 执行 → 发射 tool_result 并把结果回注为 tool 消息。工具抛错转为 error 事件（非 fatal）并回注模型。
- 验证：脚本化两轮（call→approve→result→final text）；deny 路径（模型收到拒绝原因）；工具异常路径。
- 依赖：E2。预计：45 分钟

#### 任务 E4：多步循环与守卫
- 文件：`/packages/core/src/agent-loop.ts`（扩展）、`test/agent-loop.guard.test.ts`
- 描述：循环直到模型不再调用工具或触发守卫：`maxSteps`（默认 30）、外部预算回调（`isOverBudget()` 注入，供 F4 使用）。
- 验证：Mock 模型无限调用工具时在 maxSteps 截停并给用户明确提示事件。
- 依赖：E3。预计：30 分钟

#### 任务 E5：系统提示词装配 v0
- 文件：`/packages/core/src/prompt.ts`、`test/prompt.test.ts`
- 描述：基础系统提示词：身份、工具使用纪律（先 grep 再读、编辑后验证）、平台/cwd/日期注入。AGENTS.md 加载是 M1 任务，此处不做。
- 验证：快照测试关键动态字段（cwd、平台、日期）。
- 依赖：A2。预计：20 分钟

### Phase F：CLI 与 TUI

#### 任务 F1：设置加载与首次引导
- 文件：`/packages/cli/src/settings.ts`、`onboarding.tsx`、`test/settings.test.ts`
- 描述：`~/.luban/settings.json`（zod：provider/model/apiKey/permission mode）；无设置时运行 Ink 引导（选 provider → 贴 key → 选模型），文件权限 0600；key 也可来自环境变量（优先）。
- 验证：临时 HOME 下首跑出引导、写入正确；损坏配置给可读错误。
- 依赖：C1、A3。预计：45 分钟

#### 任务 F2：Ink 会话视图
- 文件：`/packages/cli/src/app.tsx`、`components/{MessageList,ToolStatus,InputBox}.tsx`、`test/app.test.tsx`
- 描述：事件驱动渲染：流式文本、工具状态行（名称+耗时）、输入框、`ink-testing-library` 组件测试。in-process 直连 AgentLoop（server 是 M4）。
- 验证：fake loop 发射事件序列，断言渲染出现关键文本与状态变化。
- 依赖：E4、F1。预计：60 分钟

#### 任务 F3：审批 UI
- 文件：`/packages/cli/src/components/ApprovalPrompt.tsx`、`test/approval.test.tsx`
- 描述：y/n/a（a=always 写入规则表）三键审批卡片，展示工具名+参数摘要；`approve()` 接线。
- 验证：组件测试三选项路径与 remembered 规则生效。
- 依赖：F2、E1。预计：30 分钟

#### 任务 F4：成本显示与基础命令
- 文件：`/packages/cli/src/components/CostBar.tsx`、`src/commands.ts`、`test/commands.test.ts`
- 描述：底栏实时 tokens/USD（消费 usage 事件，调 `computeCost`）；命令：`/cost`（明细）、`/exit`；Ctrl+C 二次确认优雅退出；`isOverBudget` 注入回循环。
- 验证：给定 usage 事件序列断言底栏数值；`/cost` 输出按模型分组的明细。
- 依赖：F2、C4。预计：30 分钟

### Phase G：M0 验收与收尾

#### 任务 G1：`--print` 无头模式与冒烟脚本
- 文件：`/packages/cli/src/print-mode.ts`、`/scripts/smoke.ts`、`test/print-mode.test.ts`
- 描述：`luban -p "..."` 单命令无头执行（复用 core，plan/default 模式下 deny 直接失败退出）——为 CI 与评测铺路。冒烟脚本：对本仓库跑真实模型任务「读取 package.json 并总结」，断言退出码 0、会话 JSONL 生成、usage 事件 costUsd > 0。
- 验证：`pnpm smoke`（需环境变量真实 key）通过；无 key 时跳过并提示。
- 依赖：F2。预计：45 分钟

#### 任务 G2：Dogfooding 与 M0 收尾
- 文件：`/README.md`（快速开始：源码安装/配置/首个任务）、`/docs/dev.md`（架构 10 分钟导读）
- 描述：作者本人用 M0 完成至少 3 个真实日常任务并记录摩擦点清单（作为 M1 输入）；修复阻塞性 bug；打 tag `v0.0.1-alpha`（不对外发布，npm 发布在 M3）。
- 验证：PRD M0 验收标准逐条核对：真实仓库完成「解释代码+一处小修改」、全程流式、事件可回放；CI 全绿。
- 依赖：G1。预计：60 分钟 + 半天真实使用

---

## 完成定义（M0 出口条件）

1. `pnpm lint && pnpm test && pnpm build` 在 Windows 本机与 CI（ubuntu+windows）全绿。
2. core 包测试覆盖率 ≥ 80%（`vitest --coverage` 验证）。
3. PRD「M0」验收标准逐条通过，并在 docs/dev.md 附核对记录。
4. 摩擦点清单已写入 `/docs/backlog-m1.md`，作为 M1 计划的输入。

## 下一里程碑预告（不在本计划内）

M1（第 3–4 周）：edit/write 工具 + diff 审批、AGENTS.md 分层加载、compaction、成本仪表完善、git checkpoint 回滚。在 M0 验收后依据 dogfooding 摩擦点清单出 `plan-m1.md`。
