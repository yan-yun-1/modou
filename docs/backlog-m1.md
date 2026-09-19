# M1 待办清单（M0 收尾时整理）

来源：M0 实现与冒烟过程中记录的摩擦点，作为 M1 计划（plan-m1.md）的输入。

## 功能缺口（M1 计划内）

1. **edit/write 工具 + diff 审批**：M0 只有只读工具；改文件能力是 M1 头号任务（F2 计划）。
2. **AGENTS.md 分层加载**：全局 → 项目 → 子目录；同时把外部内容标记为不可信数据（防提示注入）。
3. **compaction**：长会话在窗口 80% 时摘要重建；usage 事件里已有 cacheWriteTokens 可用于预算核算。
4. **git checkpoint 回滚**：agent 修改前自动 shadow-ref 快照。
5. **repo map**：tree-sitter 符号签名 + token 预算裁剪。

## M0 中发现并遗留的问题

6. **AgentLoop 不捕获流式异常**：模型流中途抛错（网络断、provider 5xx）时异常直接冒出到调用方；core 应捕获并持久化 `error{fatal:true}` 事件后再结束 run（print-mode 目前自己兜了一层 try/catch）。——M1 顺手修。
7. **TUI 会话恢复不完整**：交互模式每次启动新建会话，`/resume <sessionId>` 未实现（存储层已支持 rebuild）。
8. **审批队列**：连续多个 ask 时 ApprovalBridge 自动拒绝第二个请求；更优体验是排队逐个展示。
9. **Ctrl+C 中断语义**：目前只能整会话退出；应支持"中断当前任务、保留会话"。
10. **models.json 覆盖机制**：lookupModel 的 overrides 参数已预留，但尚无文件加载与文档。
11. **冒烟断言太弱**：exit=0 只代表有输出，1B 小模型会输出垃圾 JSON；M1 的 eval harness（packages/eval）应断言语义质量而非仅非空。

## 工程债

12. cli 的 `index.tsx` 中 `runInteractive` 与 `runPrintCommand` 有重复的模型/loop 装配逻辑，可提炼 `createLoopFromSettings()`。
13. Windows 路径显示统一正斜杠（工具输出混有 `\` 与 `/`）。
14. core 测试覆盖率 90.8%，session-store 的 append 队列异常分支未覆盖。

## M0 补丁已解决（历史记录）

15. ~~模型选择错误后无法重选~~：`luban model` 子命令已上线（复用 Onboarding 组件，`base` 合并保留权限/预算）。遗留的 TUI 内切换见下条。

## 会话内切换模型（/model）—— M1

16. TUI 内 `/model` 命令：保存新配置 → 结束当前会话 → 自动以新模型开新会话。前置依赖 #12 的 `createLoopFromSettings()` 提炼。语义是"新会话用新模型"，不做运行中热切换。

## 明确不做（Non-goals）

- **core 层运行中热切换模型**：当前会话的消息历史、上下文窗口与计价均绑定原模型能力声明，热切换会让 rebuild 逻辑背上跨模型兼容的复杂度，收益极低。换模型 = 开新会话/新任务。
