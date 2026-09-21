# M3 待办清单（M2 收尾时整理）

来源：M2 实现与评测过程记录的问题，作为 M3 计划的输入。

## 功能（PRD M3：Skills / LSP / 沙箱 / ACP）

1. **Skills（SKILL.md）**：兼容开放 Skills 标准加载能力包（PRD F15）。
2. **LSP 上下文**：vscode-languageserver-protocol 独立客户端，诊断与定义跳转注入上下文（PRD F16）。
3. **OS 级沙箱落地**：Windows 受限令牌 / macOS Seatbelt / Linux Landlock 的实际实现（M2 仅评估，PRD 6.5）。
4. **ACP 兼容**：agent 侧接入 Zed / JetBrains（PRD F19，需要 server 包先行）。

## M2 评测与实现暴露的问题

5. **edit 工具的 ACI 降级路径**：`edit` 对 `old_text=""` 之类空参数返回"参数校验失败"而非给出文件内容提示——模型卡在重试循环（评测 multi-step-fix-test 中观察到一次）。改进：edit 参数校验失败时在错误信息中附上文件当前内容摘要。
6. **eval 用例自身质量**：grep-count-batch 用例检查太弱（只要输出有数字）；应断言具体数字。multi-step-fix-test 偶发因 read 参数为空失败——可给模型更明确的"先 read 再 edit"步骤提示。
7. **HTTP 型 MCP server 未实测**：settings 支持 `{ url }` 传输，但无集成测试覆盖；M3 用真实远程 server 验证。
8. **/plan 的计划阶段上下文**：计划文本直接进入主会话历史，任务极长时与 compaction 的交互未验证。
9. **审批排队 UI**：FIFO 逻辑已实现，但 UI 只显示队首——可在审批卡片上显示"队列中还有 N 个"。

## 工程债

10. **subagent 工具的 parentSessionId**：explore 工具当前传 "adhoc"，应接入真实主会话 id（需要 ToolContext 携带 sessionId）。
11. **eval 输出结构化**：JSON 报告 + 历史对比（防回归基线漂移）。
12. **session-store append 队列异常分支**：仍未覆盖（M0 遗留）。

## 明确不做（延续）

- core 层运行中热切换模型；向量索引/RAG；A2A 协议。
