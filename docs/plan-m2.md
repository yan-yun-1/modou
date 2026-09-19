# 实现计划：M2「生态与健壮」（对应 PRD 里程碑 M2，第 5–6 周）

> 关联：[docs/PRD.md](./PRD.md)、[docs/plan-m1.md](./plan-m1.md)（M1 已完成，v0.2.0-alpha）、[docs/backlog-m2.md](./backlog-m2.md)
> 前置：M1 已验收（edit/write + 回滚 + 上下文工程 + eval 8/10）。
> 范围声明：本计划覆盖 PRD M2 核心（**MCP Client、Plan Mode、Subagent**）+ backlog-m2 的健壮性项（审批队列、Ctrl+C、compaction 计量、edit 遵循度）。Skills/LSP/沙箱落到 M3。

## 执行纪律（与 M0/M1 相同）

TDD 红绿循环、一任务一提交、偏离计划即停、每 3–5 个任务人工检查点。总量约 45–55 净工时（×3 缓冲 ≈ 2 周全职）。测试模型统一 GLM glm-4.5-air。

## 契约增补预告（实现时回写本文件）

1. settings.json 新增 `mcpServers?: Record<name, { command: string; args?: string[]; env?: Record<string,string> } | { url: string; headers?: Record<string,string> }>`。
2. `Tool` 接口新增可选 `source?: "builtin" | "mcp"`（/mcp 面板与权限策略展示用）。
3. 新增事件 `{ type: 'subagent'; name: string; summary: string; at: number }`（落盘）。
4. `parseCommand` 增加 `/mcp`、`/plan`。

---

## 任务列表

### Phase N：MCP Client（M2 头号任务）

#### 任务 N1：MCP stdio 客户端会话
- 文件：`/packages/core/src/mcp/client.ts`（新）、`/packages/core/test/mcp-client.test.ts`（新）
- 描述：基于官方 `@modelcontextprotocol/sdk`（TS）封装 `McpConnection`：`connect()`（StdioClientTransport 启动子进程、initialize 握手）、`listTools()`、`close()`；进程崩溃自动标记断开。
- 验证：用 SDK 自带的 in-memory/echo 测试 server 或脚本化子进程 fixture 完成握手与工具列举。
- 依赖：无。预计：90 分钟

#### 任务 N2：MCP 工具桥接到 ToolRegistry
- 文件：`/packages/core/src/mcp/tools.ts`（新）、`/packages/core/test/mcp-tools.test.ts`（新）
- 描述：把 MCP server 的 tools（JSON Schema 入参）适配为本 `Tool` 接口——schema 用 zod 自定义校验（或透传 JSON Schema）；`source: "mcp"`；`kind: "execute"`（一律走审批，除非用户对 server 配置 `allowAlways`）；`run` 内调用 `connection.callTool` 并把文本结果转 ToolResult（截断规则同内置工具）。
- 验证：echo server 的工具被调用且结果回传；server 崩溃时工具调用报可读错误且不中断会话。
- 依赖：N1。预计：60 分钟

#### 任务 N3：配置与 /mcp 命令
- 文件：`/packages/cli/src/settings.ts`（改，契约增补 1）、`/packages/cli/src/loop-factory.ts`（改）、`/packages/cli/src/commands.ts` + `app.tsx`（改）、`/packages/core/src/events.ts` 无改动、测试（新/改）
- 描述：settings.json 支持 `mcpServers` 配置；工厂启动时连接全部 server 并把工具注册进 registry（连接失败不阻断启动，发警告）；TUI `/mcp` 列出各 server 状态与工具数。
- 验证：fixture 配置 + echo server：工厂注册成功、工具可被调用、坏配置给出可读警告。
- 依赖：N2。预计：60 分钟

#### 任务 N4：真实 server 集成验证
- 文件：`/scripts/eval.mts`（改，新增 1 个 MCP 用例）、`/docs/dev.md`（改，MCP 配置示例）
- 描述：用 `@modelcontextprotocol/server-filesystem`（npx 启动）作为真实集成对象：沙箱目录挂载，agent 通过 MCP 工具读取文件内容并回答。
- 验证：eval 新用例通过；文档含可复制的配置示例。
- 依赖：N3。预计：60 分钟

### Phase O：Plan Mode 工作流

#### 任务 O1：/plan 工作流
- 文件：`/packages/core/src/plan.ts`（新）、`/packages/core/src/agent-loop.ts`（改：暴露只读单轮运行入口或复用 run + permissions override）、`/packages/cli/src/commands.ts` + `app.tsx`（改）、测试（新）
- 描述：`/plan <任务>` —— 在 plan 权限模式（只读）下运行任务，产出实施计划文本；计划展示后弹确认（y=按计划执行 / n=放弃）；确认后以 default 模式发起新任务，prompt = 原任务 + 计划全文。
- 验证：mock 模型——plan 阶段写工具被拒绝、确认后执行阶段正常；cli 端到端渲染计划与确认卡片。
- 依赖：无。预计：90 分钟

### Phase P：Subagent

#### 任务 P1：子代理运行器
- 文件：`/packages/core/src/subagent.ts`（新）、`/packages/core/test/subagent.test.ts`（新）、`/packages/core/src/events.ts`（改，契约增补 3）
- 描述：`runSubagent({ model, name, systemPrompt, task, cwd, permissionMode })`——独立 SessionStore 会话（`sub-<parent>-<name>`）、只读工具集（无写/执行）、独立 maxSteps（默认 15）、返回最终文本与成本。异常同主循环语义（fatal error 事件 + 降级返回）。
- 验证：mock 模型——子代理读文件并返回摘要；主会话事件流出现 `subagent` 事件。
- 依赖：无。预计：60 分钟

#### 任务 P2：explore 子代理工具
- 文件：`/packages/core/src/tools/explore.ts`（新）、`/packages/core/src/tools/index.ts`（注册）、`/packages/core/test/tools-explore.test.ts`（新）
- 描述：内置工具 `explore`（kind read）——参数为研究问题，内部跑 explore 子代理（只读，可 grep/read/glob），返回摘要给主循环。用途：大范围代码勘察不撑爆主会话上下文。
- 验证：fixture 仓库——explore 正确回答"登录逻辑在哪个文件"，主会话仅收到摘要。
- 依赖：P1。预计：60 分钟

### Phase Q：健壮性

#### 任务 Q1：审批队列
- 文件：`/packages/cli/src/approval-bridge.ts`（改）、`/packages/cli/test/approval-bridge.test.tsx`（改）
- 描述：并发审批不再自动拒绝，改为 FIFO 排队逐个展示（request 挂起入队，answer 后弹出下一个并通知订阅者）。
- 验证：并发 3 个请求——按序展示、全部得到回答。
- 依赖：无。预计：40 分钟

#### 任务 Q2：Ctrl+C 任务级中断
- 文件：`/packages/cli/src/app.tsx`（改）、`/packages/cli/src/index.tsx`（改）、测试（新）
- 描述：任务运行中按 Ctrl+C：第一次 = 中断当前任务（AbortSignal 触发，会话保留，UI 显示"任务已中断"），5 秒内第二次 = 退出应用。
- 验证：组件测试——中断后 InputBox 恢复可输入；连续两次退出。
- 依赖：无。预计：60 分钟

#### 任务 Q3：compaction 成本计量
- 文件：`/packages/core/src/context/compaction.ts`（改）、`/packages/core/src/agent-loop.ts`（改）、测试（改）
- 描述：generateText 的 usage（压缩调用）换算成本并入一条 usage 事件，消除 /cost 与预算钩子的计量盲区（backlog-m2 #5）。
- 验证：压缩后 usage 事件包含摘要调用成本。
- 依赖：无。预计：30 分钟

#### 任务 Q4：edit 遵循度硬约束 + eval 回归
- 文件：`/packages/core/src/prompt.ts`（改）、`/scripts/eval.mts`（改）、`/packages/core/test/prompt.test.ts`（改）
- 描述：系统提示词加硬约束："任何文件修改必须通过 write/edit 工具完成，禁止仅在回复中给出代码"；eval 对失败用例加第二轮重试统计。
- 验证：eval 中 edit-replace/edit-fix-typo 稳定通过（连续 2 轮）。
- 依赖：无。预计：40 分钟

### Phase R：M2 验收

#### 任务 R1：eval 扩展与回归
- 文件：`/scripts/eval.mts`（改）、`/docs/dev.md`（改）
- 描述：用例扩到 12+（新增 MCP 用例、plan mode 用例）；基线提升为 10/12；输出含总成本与总耗时。
- 验证：GLM 全量跑达到新基线。
- 依赖：N4、O1。预计：60 分钟

#### 任务 R2：dogfooding 与发布
- 文件：`/README.md`（改）、`/docs/backlog-m3.md`（新）、`/docs/dev.md`（改）
- 描述：真实任务 dogfooding（含 MCP server 场景）；修阻塞性 bug；文档更新；tag `v0.3.0-alpha`。
- 验证：PRD M2 验收逐条：MCP server 可接入并可调用、plan→执行闭环、explore 子代理可用、审批排队体验正常。
- 依赖：全部。预计：半天 + 真实使用

---

## 完成定义（M2 出口条件）

1. `pnpm lint && test && build` 全绿；core 覆盖率 ≥ 85%。
2. PRD M2 验收逐条通过：真实 MCP server（filesystem）接入可调用；`/plan` → 确认 → 执行闭环；`explore` 子代理在大文件勘察中保护主上下文。
3. `pnpm eval` ≥ 10/12（GLM glm-4.5-air）。
4. `docs/backlog-m3.md` 就绪（Skills/LSP/沙箱 → M3）。

## 明确不做（本里程碑）

Skills（SKILL.md）、LSP 上下文、OS 级沙箱落地（仅评估）、向量索引、A2A——均在 M3+。
