# M2 待办清单（M1 收尾时整理）

来源：M1 实现与评测过程记录的问题，作为 M2 计划的输入。

## 功能（PRD M2：MCP / plan mode / subagent）

1. **MCP Client**：stdio + Streamable HTTP 传输；MCP server 管理界面；MCP 工具与本内置工具走同一权限门禁（PRD F11，M2 头号任务）。
2. **Plan Mode 之外的 skill 化**：Skills（SKILL.md）兼容加载。
3. **Subagent 体系**：内置 `explore`（代码探索）与 `code-review` 子代理，隔离上下文仅回摘要。

## M1 评测暴露的问题

4. **edit/write 工具提示词遵循度**：glm-4.5-air 在 10 用例评测中约 20% 概率不调用工具而直接文字回答（edit-replace、edit-fix-typo 两例）。改进方向：工具描述强化、系统提示词加"修改文件必须调用工具"硬约束、或对"回复包含代码块但未调工具"的情况追问确认。
5. **compaction 的摘要调用成本未计入用量事件**：压缩用的 generateText 调用不产生 usage 事件，/cost 与预算钩子看不到这部分消耗。
6. **repo map 树质量**：正则版对 TypeScript 泛型/装饰器、Python 缩进块的理解有限；在真实大仓库上评估是否升级 web-tree-sitter。
7. **eval 扩展**：用例扩到 20+（含回归测试断言的多步任务）；加入耗时/成本维度报告；支持按用例名过滤与 --repeat 检验稳定性。

## 工程债

8. **审批排队展示**：连续多个 ask 时 ApprovalBridge 自动拒绝第二个请求；应排队逐个展示。
9. **Ctrl+C 任务级中断**：目前只能整会话退出；应支持"中断当前任务、保留会话"。
10. **bash 工具无 OS 级沙箱**：M1 仅有审批门禁；M2 评估 Windows 受限令牌 / macOS Seatbelt / Linux Landlock 的落地方案（PRD 6.5）。
11. **eval harness 包化**：从 scripts/eval.mts 迁移到 packages/eval 独立包；评测用例私有防污染。
12. **append 队列异常分支**：session-store 的覆盖缺口（M0 遗留）。

## 明确不做（延续）

- core 层运行中热切换模型（见 backlog-m1）。
