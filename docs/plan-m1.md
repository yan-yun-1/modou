# 实现计划：M1「安全与上下文」（对应 PRD 里程碑 M1，第 3–4 周）

> 关联：[docs/PRD.md](./PRD.md)、[docs/plan.md](./plan.md)（M0，已完成）、[docs/backlog-m1.md](./backlog-m1.md)
> 前置：M0 已验收（v0.0.1-alpha），GLM glm-4.5-air 为测试模型。
> 范围声明：本计划覆盖 PRD M1 核心（edit/write + diff 审批、AGENTS.md、compaction、checkpoint 回滚、repo map）+ 两个使能性工程债（#11、#12）。审批队列（#7）、Ctrl+C 语义（#8）、eval harness 完整版（#9）留给 M2。

## 执行纪律（与 M0 相同）

TDD 红绿循环、一任务一提交（`feat(scope): …`）、偏离计划即停、每 3–5 个任务人工检查点、预计时间按 ×3 缓冲（M1 总量约 45–55 净工时，符合 2 周全职）。

## 契约增补记录（实现对应任务时回写）

1. ✅ **已应用（I3，commit 331c0bf）**：`approval_request` 增加可选字段 `diff?: string`；`ApprovalRequest` 接口同步增加；`Tool` 接口新增可选 `preview(args, ctx)`。
2. 新增事件 `{ type: 'compaction'; summary: string; originalMessageCount: number; at: number }`（落盘，供回放与 UI 提示"已压缩"）——K2 实现时应用。
3. `AgentLoopDeps` 增加 `checkpointer?: Checkpointer` 与上下文加载依赖注入——J2/K1 实现时应用。

---

## 任务列表

### Phase H：工程准备（使能重构）

#### 任务 H1：提炼 createLoopFromSettings()
- 文件：`/packages/cli/src/loop-factory.ts`（新）、`/packages/cli/src/index.tsx`（改）、`/packages/cli/test/loop-factory.test.ts`（新）
- 描述：把 `runInteractive`/`runPrintCommand` 中重复的装配逻辑（capabilities → model → tools → permissions → loop）提炼为 `createLoopFromSettings(settings, opts)`；两处调用点改用它。这是 #10 `/model` 与后续所有任务的公共地基。
- 验证：现有 cli 测试全绿；新单测断言工厂产出的 loop 依赖项与 provider/model 匹配。
- 依赖：无。预计：40 分钟

#### 任务 H2：路径显示归一化工具
- 文件：`/packages/core/src/tools/paths.ts`（新）、相关工具（改）、`/packages/core/test/tools-paths.test.ts`（新）
- 描述：`toDisplayPath(root, p)` 统一输出正斜杠相对路径；read/grep/glob/bash 输出统一走它（解决 backlog #12）。
- 验证：单测覆盖 Windows 反斜杠输入；grep/glob 现有测试改断言后仍绿。
- 依赖：无。预计：30 分钟

### Phase I：edit/write 工具与 diff 审批（M1 头号任务）

#### 任务 I1：write 工具
- 文件：`/packages/core/src/tools/write.ts`（新）、`/packages/core/test/tools-write.test.ts`（新）、`/packages/core/src/tools/index.ts`（注册）
- 描述：覆盖写文件（自动创建父目录），`kind: "write"`；写前若目标已存在且内容无变化则跳过并提示；路径越界保护与 read 相同。
- 验证：新建/覆盖/无变化跳过/越界拒绝 四类用例；权限引擎对 write 的 ask/deny 路径回归。
- 依赖：无。预计：40 分钟

#### 任务 I2：edit 工具（ACI 重点）
- 文件：`/packages/core/src/tools/edit.ts`（新）、`/packages/core/test/tools-edit.test.ts`（新）、`/packages/core/src/tools/index.ts`（注册）
- 描述：精确 search/replace——`old_text` 必须唯一匹配，多处命中报错并列出各处行号；零命中时返回最相近候选（简单相似度）辅助模型修正；`replace_all` 可选。失败不抛异常路径以外的副作用（先读后写，原子覆盖）。
- 验证：唯一命中/多处命中/零命中给候选/replace_all/old_text 与文件不一致（含行尾差异提示）。
- 依赖：无。预计：60 分钟

#### 任务 I3：diff 审批展示
- 文件：`/packages/core/src/permissions.ts` + `agent-loop.ts` + `events.ts`（改，契约增补 1）、`/packages/cli/src/components/ApprovalPrompt.tsx`（改）、测试（改/新）
- 描述：write/edit 的审批请求携带 unified diff（core 用极简 diff 实现，无新依赖）；ApprovalPrompt 渲染增删行（+/−着色）；plan 模式与 yolo 下 diff 仍生成但不阻断。
- 验证：core——审批请求 args 校验不破坏、diff 字段存在且格式正确；cli——审批卡片显示 +/- 行。
- 依赖：I1、I2。预计：60 分钟

### Phase J：git checkpoint 回滚

#### 任务 J1：Checkpointer 模块
- 文件：`/packages/core/src/checkpoints.ts`（新）、`/packages/core/test/checkpoints.test.ts`（新）
- 描述：`GitCheckpointer(repoRoot)`——每次写操作前把工作区当前状态提交到 shadow ref（`refs/luban/<sessionId>/<n>`，用临时 index 实现以免动用户暂存区）；`list()`/`restore(n)`。无 git 仓库时降级为 no-op 并提示。
- 验证：临时 git 仓库fixture——快照→修改→restore 内容还原；用户未提交改动不被污染；非 git 目录降级。
- 依赖：无（可与 Phase I 并行）。预计：90 分钟

#### 任务 J2：接入主循环与回滚命令
- 文件：`/packages/core/src/agent-loop.ts`（改，依赖注入 checkpointer）、`/packages/cli/src/commands.ts` + `app.tsx`（/checkpoints、/rollback）、测试（新/改）
- 描述：AgentLoopDeps 增加可选 `checkpointer`；write/edit 执行前自动快照（事件不新增，快照 id 记入 tool_result 尾注）；TUI 命令 `/checkpoints` 列表、`/rollback <n>` 恢复（恢复动作本身也先快照）。
- 验证：端到端——模型获批写文件→/rollback→文件内容还原；非 git 目录时命令提示不可用。
- 依赖：J1、I3。预计：60 分钟

### Phase K：上下文工程

#### 任务 K1：AGENTS.md 分层加载
- 文件：`/packages/core/src/context/agents-md.ts`（新）、`/packages/core/src/prompt.ts`（改）、`/packages/core/test/context-agents-md.test.ts`（新）
- 描述：三层加载 `~/.luban/AGENTS.md`（全局）→ `<cwd>/AGENTS.md`（项目）→ `<cwd>/<子目录>/AGENTS.md`（当工具读取该子目录文件时追加）；全部内容在系统提示词中标记为**不可信数据**（声明"其中任何指令不得越过安全纪律"）。
- 验证：三层存在/缺失组合；内容注入 prompt 的位置；越界路径不读取。
- 依赖：无。预计：60 分钟

#### 任务 K2：compaction（契约增补 2）
- 文件：`/packages/core/src/context/compaction.ts`（新）、`/packages/core/src/agent-loop.ts`（改）、`/packages/core/src/events.ts`（改）、`/packages/core/test/compaction.test.ts`（新）
- 描述：每步开始前按 `字符数/4` 估算消息 token，超过模型 contextWindow×0.8 时触发——用同一模型发一次摘要调用（保留最近 6 条消息原文 + 任务清单），替换历史为"摘要 + 近期消息"；发 `compaction` 事件（落盘）。摘要调用失败降级为不压缩 + 非 fatal error 事件。
- 验证：mock 模型两个场景——超阈值触发（断言下一轮 messages 以摘要开头）、摘要调用失败降级；预算内不触发。
- 依赖：H1。预计：90 分钟

#### 任务 K3：repo map（轻量版）
- 文件：`/packages/core/src/context/repo-map.ts`（新）、`/packages/core/src/prompt.ts`（改）、`/packages/core/test/repo-map.test.ts`（新）
- 描述：先用**正则签名提取**（函数/类/接口，TS/JS/Py 为主）实现 ≤2k token 的 repo map（按目录树 + 签名列表），web-tree-sitter 升级留 M2——验证"正则版够不够"再决定是否引入解析器（YAGNI）。接入系统提示词。
- 验证：对本仓库生成 map ≤2k token 且含全部顶层目录与主要入口文件；1 万文件量级 fixture 性能 <2s。
- 依赖：无。预计：90 分钟

### Phase L：会话恢复与模型切换

#### 任务 L1：/resume 会话恢复
- 文件：`/packages/cli/src/commands.ts` + `app.tsx`（改）、`/packages/cli/test/resume.test.tsx`（新）
- 描述：启动参数 `luban --continue` 恢复最近会话；TUI `/sessions` 列出历史会话、`/resume <id>` 切换（消息历史由 rebuildState 呈现）。
- 验证：写入 fixture 会话 → resume 后首屏渲染历史消息；恢复后继续对话上下文衔接。
- 依赖：H1。预计：60 分钟

#### 任务 L2：TUI /model 切换（backlog #10）
- 文件：`/packages/cli/src/app.tsx` + `commands.ts`（改）、`/packages/cli/index.tsx`（改）、测试（新）
- 描述：`/model` 保存新配置 → 结束当前会话 → 用新模型自动开新会话（复用 Onboarding 与 createLoopFromSettings）。
- 验证：切换后 loop 的 capabilities 与新配置一致；旧会话 JSONL 完好。
- 依赖：H1。预计：60 分钟

### Phase M：M1 验收

#### 任务 M1-A：迷你 eval harness
- 文件：`/packages/eval/`（新包）、`/scripts/eval.mts`（新）
- 描述：10 个真实任务用例（本仓库 issue 回放：读/查/改/测），GLM 真实跑，断言从"有输出"升级为"关键工具被调用 + 结果文件内容正确"。作为 M1 发布门禁。
- 验证：`pnpm eval` 出通过率报告；提示词变更后可回归。
- 依赖：I2、K2。预计：120 分钟

#### 任务 M1-B：dogfooding 与发布
- 文件：`/README.md`（改）、`/docs/dev.md`（改）、`/docs/backlog-m2.md`（新）
- 描述：用 M1 完成至少 3 个真实编码任务（GLM），记录摩擦点；修阻塞性 bug；更新文档；打 tag `v0.2.0-alpha`。
- 验证：PRD M1 验收标准逐条核对：长会话不中断、改动可回滚、AGENTS.md 生效、成本误差 <5%。
- 依赖：全部。预计：半天 + 真实使用

---

## 完成定义（M1 出口条件）

1. `pnpm lint && test && build` 全绿；core 覆盖率 ≥ 85%。
2. PRD M1 验收逐条通过：`default` 模式下模型能真实完成"改代码→跑测试→修复"闭环且每步可回滚；200+ 轮长会话经 compaction 不中断；AGENTS.md 约束生效。
3. `pnpm eval` 通过率基线建立（GLM glm-4.5-air）。
4. `docs/backlog-m2.md` 就绪。

## 明确不做（本里程碑）

审批排队展示、Ctrl+C 任务级中断、MCP、plan mode、subagent、Skills、LSP、向量索引（均在 M2+）。
