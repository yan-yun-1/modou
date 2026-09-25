# M4 实施计划：多端与增强（server → SDK → ACP → Hooks → 清偿）

> 来源：PRD 路线图 M4（docs/PRD.md:323「多端与增强」）+ plan-m3 Non-goals 遗留 + dogfood-m3 摩擦点清单（供 M4）。
> 范围决策（2026-09-25 用户确认）：只做核心链路（装配下沉 → server → SDK → ACP → Hooks → 清偿）；
> server HTTP 层用 node:http 手写（延续零新依赖原则）；ACP 验收装 Zed 实测。
> **顺延 M5**：LSP（F16）、VS Code 插件（F20）、OS 沙箱落地（补评估文档进 docs/）。

## 一、目标与验收标准

PRD M4 验收："任一 ACP 编辑器中可用；SDK 可被第三方嵌入"。拆成 6 条可验证标准：

1. **SDK 可嵌入**：第三方 `npm install @modou-dev/sdk`，约 10 行代码跑通"创建会话 → 提问 → 收到流式事件 → 审批 → 最终回复"（示例脚本 + 测试证明）
2. **server 可用**：`modou serve` 后仅用 curl 完成一轮会话（POST 创建会话 → POST 消息 → SSE 收到 assistant_message → HTTP 应答审批并生效）
3. **ACP 可用**：Zed 中配置 modou agent，完成一问一答 + 一次需审批的文件编辑
4. **Hooks 生效**：preToolUse 能放行/改写/阻断一次工具调用，postToolUse 能附加输出（测试证明）
5. **零回归**：eval 14/14 保持、现有测试全绿
6. **清偿**：dogfood-m3 摩擦点 1/2/4 + backlog-m3 #7/8/12 闭环

## 二、包结构

```
packages/sdk     @modou-dev/sdk    装配层 + 高层 API（从 cli 物理迁移，PRD F17 的 @modou/sdk 因 scope 被占校正为 @modou-dev/sdk）
packages/server  @modou-dev/server node:http 手写 HTTP+SSE（依赖 sdk，零新依赖）
cli              modou             保留 TUI 与命令入口，依赖 sdk（re-export 壳，cli 内 import 路径不变）
```

下沉到 sdk 的模块：`settings.ts`、`loop-factory.ts`、`provider-models.ts`、`approval-bridge.ts`、`print-mode.ts`。

## 三、关键设计

### server API（node:http 手写；JSONL 会话存储复用 SessionStore）

```
GET    /health                        → {ok, version}
POST   /sessions                      → 装配 loop → 201 {sessionId, mcpStatus}
GET    /sessions                      → 会话列表（回放 JSONL 首行补元数据）
GET    /sessions/:id                  → 历史事件（store.read）
POST   /sessions/:id/messages         → {input} 启动一轮（202；进行中再发 409）
GET    /sessions/:id/events           → SSE：逐条 ModouEvent（含 approval_request）
POST   /sessions/:id/approvals/:reqId → {granted, remembered} 应答审批
DELETE /sessions/:id                  → abort + closeMcp + 移除
```

会话注册表：每会话 {loop, ApprovalBridge, AbortController, cost 累计, closeMcp}。
ApprovalBridge 增加 **id 寻址**（answerById，approval_request.id 即路由键），CLI FIFO 语义保持兼容。

### ACP（F19）

`sdk/src/acp.ts` + `modou acp` 子命令（stdio JSON-RPC，优先复用官方包
`@zed-industries/agent-client-protocol`，不可用则手写）。方法映射：
initialize→能力宣告；session/new→createSession；session/prompt→run；
session/update←ModouEvent（text_delta→agent_message_chunk、tool_call/tool_result→tool 块、
approval_request→permission_request、usage→session/info）；session/unload→close。

### Hooks（F14）

`AgentLoopDeps.hooks?: { preToolUse?, postToolUse? }`，插桩点：
- preToolUse：agent-loop.ts 权限 decide 之前（可改 args / 放行 / 阻断）
- postToolUse：validateAndRun 之后 persist 之前（可附加输出，失败路径覆盖）
- 经 deps 注入天然覆盖 subagent；settings 增加命令式 hook（stdin JSON → stdout JSON）

### 白名单持久化（dogfood#1 + PRD 6.5 兑现）

settingsSchema 增加 `permissionRules`；`remember()` 后 snapshot 落盘；装配时读回。

## 四、任务分解（TDD，一任务一提交）

**Phase A：装配下沉与 SDK 地基**
- A1 新建 packages/sdk：物理迁移 5 模块；cli re-export 壳；turbo/tsc 编排验证
- A2 ApprovalBridge 按 id 寻址（answerById + id→resolver Map），CLI FIFO 兼容
- A3 always-allow 白名单持久化（settings.permissionRules + remember 落盘 + 装配读回）
- A4 sdk 高层 API `createSession/run` + README 嵌入示例（验收 1 直测）

**Phase B：server 包**
- B1 packages/server 骨架：node:http + 路由分发 + /health + 测试
- B2 会话注册表 + POST/GET/DELETE /sessions（多会话隔离、409 并发保护）
- B3 SSE 事件流 + POST messages + 审批 HTTP 应答
- B4 `modou serve [--port]` 子命令 + 优雅关闭（SIGINT 时 closeMcp 防挂起）

**Phase C：ACP**
- C1 规范调研落盘 docs/acp-notes.md（方法映射表）+ JSON-RPC stdio 骨架
- C2 ModouEvent→session/update 映射 + permission_request 远程审批桥
- C3 `modou acp` 子命令 + JSON-RPC 回环自测
- C4 Zed 安装实测：一问一答 + 一次审批文件编辑（**验收 3**）

**Phase D：Hooks（F14）**
- D1 core 插桩（preToolUse/postToolUse + deps 注入 + subagent 覆盖）
- D2 settings 命令式 hook + sdk 桥接
- D3 测试 + eval 新增 hook 阻断用例

**Phase E：清偿与发布**
- E1 dogfood 清偿：MCP 必填参数缺失预检（#2）、init 占位降权（#4）、无头审批错误带 always-allow 配置建议（#1）
- E2 backlog：HTTP 型 MCP 实测（#7）、/plan compaction 交互验证（#8）、session-store append 异常测试（#12）
- E3 eval 回归 14/14 + 新增 server/SDK 用例
- E4 文档：PRD 附录 A 更新（Skills 标注 M3 已交付）、README/dev.md、本文档验收记录
- E5 发布 v0.5.0-alpha：npm 发布 @modou-dev/sdk + @modou-dev/server、GitHub Release、dogfooding 半日

## 五、明确不做（顺延 M5）

LSP（F16）、VS Code 插件（F20）、OS 沙箱落地（补三平台评估文档进 docs/）；A2A、向量索引、core 热切换模型延续不做。

## 六、验收记录

（执行完成后回填）
