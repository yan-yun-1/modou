# 架构导读（10 分钟）

面向要读代码或参与贡献的开发者。产品决策见 [PRD](./PRD.md)，任务拆解见 [plan](./plan.md)。

## 包结构

```
packages/
├─ core/    引擎：零 UI 依赖，可被任何前端嵌入
│  ├─ events.ts          事件类型（zod 判别联合）——唯一事实来源
│  ├─ session-store.ts   JSONL 追加式会话存储（并发串行化）
│  ├─ session.ts         rebuildState：事件流 → 模型消息 + 用量合计
│  ├─ permissions.ts     权限引擎：模式 × 白名单规则 × 高危拦截
│  ├─ agent-loop.ts      主循环：多步 model↔tool 循环、审批、Hooks、守卫
│  ├─ prompt.ts          系统提示词装配
│  ├─ models/            catalog（能力+计价）/ provider（8 家工厂）/ stream（流→事件）/ cost
│  ├─ tools/             Tool 接口、注册表、read/grep/glob/write/edit/bash/explore、walk 共享遍历器
│  ├─ mcp/               MCP client（stdio / StreamableHTTP）
│  ├─ context/           AGENTS.md 分层 / repo map
│  ├─ skills.ts          Skills 加载
│  └─ subagent.ts        explore 等子代理
├─ sdk/      @modou-dev/sdk 装配层（M4）：settings / loop-factory / approval-bridge / print-mode / acp / session（createSession 高层 API）
├─ server/   @modou-dev/server（M4）：node:http 手写 REST+SSE 会话 API
└─ cli/      modou 终端交互
   ├─ index.tsx          入口：-p 无头 / 交互两路径；program.ts 子命令（serve/acp）
   ├─ onboarding.tsx     首次引导
   ├─ app.tsx            ModouApp 主视图（事件驱动渲染）
   └─ components/        MessageItem(Static 冻结) / InputBox(边框+补全) / BusyLine(spinner)
                         / StatusBar(三段式) / ApprovalPrompt / PlanConfirm
M5 新增：packages/lsp（LSP 客户端）、packages/vscode（VS Code 插件 alpha）、core/src/sandbox/（沙箱）
```

## 核心不变量（改代码前必读）

1. **事件先持久化，再上屏**。`AgentLoop` 中所有 `persist(event)` 先 `store.append` 再 `yield`。text_delta 例外：只上屏不落盘，文本的持久化事实只有 `assistant_message`。
2. **tool-call 必须配对 tool-result**。审批拒绝、计划模式拒绝、未知工具、执行失败四条路径都以 tool_result 文本回注模型（`toolResultMessage`），否则下一次模型调用会因悬空的 tool-call 报 API 错误。
3. **权限判定在参数校验之前**，用的是原始 args；`kind` 只有三值（read/write/execute），权限引擎只依赖 kind，不感知具体工具。
5. **TUI 渲染分层（plan-tui）**：消息历史进 Ink `<Static>`（打印后冻结、不重渲）；动态区只有流式文本（60ms 节流）/忙碌行/审批卡/输入卡/状态栏。`ModouApp` 支持 `loop=null` 装配态（TUI 先行、上下文后台装配），内部经 `onAssemble` 接管 bundle——改渲染层前先读 `docs/plan-tui.md`。
4. **模型消息形状 = AI SDK v7 的 `ModelMessage`**：tool-call 部件带 `input`，tool-result 部件不带 `input`（provider-utils 层类型）。升级 AI SDK 时重点核对这两处。

## 关键流程：一次工具调用

```
模型流（streamTurn）→ tool_call 事件 → persist → 权限引擎 decide
  ├─ allow → registry.validateAndRun → tool_result 事件 → 回注 messages
  ├─ ask   → persist approval_request → approve()（UI 挂起等待）→ approval_result
  │           ├─ granted → 执行 → tool_result → 回注
  │           └─ denied  → tool_result("用户拒绝执行此操作") → 回注
  └─ deny  → tool_result("权限拒绝…") → 回注（不弹审批）
```

## 设计取舍（为什么）

- **不用 LangGraph/AutoGen**：编程 agent 需要完全掌控权限与上下文；mini-swe-agent 证明薄循环即可达标。
- **TypeScript 而非 Rust/Go**：单人迭代速度是生死线；TUI 性能可后期局部替换。
- **grep 路线而非向量索引**：中小仓库足够且零基础设施（PRD 1.3/4.4）。
- **PowerShell EncodedCommand**：绕开 Windows 命令行嵌套引号被 CreateProcess 重 quoting 的坑；`exit $LASTEXITCODE` 透传退出码；`$ProgressPreference='SilentlyContinue'` 消除 CLIXML 噪声（见 tools/bash.ts 注释）。

## 已知限制与待办

历史 backlog 已滚动迁移：[backlog-m1](./backlog-m1.md) → [backlog-m2](./backlog-m2.md) → [backlog-m3](./backlog-m3.md) → [backlog-m5](./backlog-m5.md)（当前）。

## 发布手册（现行：pnpm workspace + alpha tag）

1. 版本检查：`packages/*/package.json` 版本一致。
2. 构建：`pnpm build`（必须先于 pack，产物在 dist/）。
3. **发布物校验（必做）**：`pnpm check:pack`——pack 后扫描发布物 manifest，
   拦截 `workspace:` 协议泄漏（0.5.0-alpha 事故的防再发，见 scripts/check-pack.mts）。
4. 正式发布（按依赖序 core → sdk → server → cli，prerelease 用 alpha tag 防止抢占 latest）：
   ```bash
   (cd packages/core   && pnpm publish --tag alpha --access public --no-git-checks)
   (cd packages/sdk    && pnpm publish --tag alpha --access public --no-git-checks)
   (cd packages/server && pnpm publish --tag alpha --access public --no-git-checks)
   (cd packages/cli    && pnpm publish --tag alpha --access public --no-git-checks)
   ```
   注意必须用 `pnpm publish`（发布时替换 workspace: 依赖），不能用 `npm publish`。
5. 全新目录安装实测：`npm install -g modou@alpha && modou --version`。
6. 打 tag：`git tag vX.Y.Z && git push --tags`，GitHub Release 页写变更说明。

注意：`files` 字段只含 `dist`，README/LICENSE/package.json 会自动包含；`.luban/`、`eval-results/` 不会进入产物。
