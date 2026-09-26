# M5 待办清单（M5 启动时整理）

来源：backlog-m1/m2/m3 滚动迁移的未闭环项 + M4 收官决策（用户确认商业验证顺延）。
M5 计划内的清偿项（pack 校验、ACP 迁移、code-review 子代理、HTTP MCP 实测、eval 包化）见
[plan-m5.md](./plan-m5.md)，不在本清单重复。

## 商业验证（PRD 原定 M5 主线，用户决策顺延）

1. **F21 Web 控制台**：任务列表、多会话并行、diff 审阅（PRD.md:177）。M4 server 的 REST+SSE 已就绪。
2. **F22 云任务沙箱**：Docker/Firecracker 并行执行 + 按用量计费（PRD.md:178、335）。需要云基础设施与支付渠道。
3. **官方模型网关订阅**：$20/月档、免自备 key（PRD.md:334）。依赖支付与账号体系。

## 功能遗留

4. **MCP 图形化管理界面**：PRD F11/F18 承诺的"管理界面"，目前仅 `/mcp` 状态命令（README.md:96）。可并入 F21 Web 控制台。
5. **ACP Registry 分发**：PRD F19 后半句——把 modou agent 提交到 ACP Registry 供编辑器一键安装。
6. **repo map 树质量 / tree-sitter 评估**（backlog-m2 #6）：M2 遗留，正则/启发式树的质量上限评估。

## eval 与质量

7. **eval 扩到 20+ 用例**（backlog-m2 #7 剩余）：耗时/成本维度报告、按名过滤 `--filter`、`--repeat` 抗波动（M5 E3 只做了包化）。
8. **eval 输出结构化对比**（backlog-m3 #11 剩余）：历史报告基线漂移检测。

## TUI 后续（plan-tui 未尽事项，延续）

9. **主题配色系统**（backlog-m3 #13）：light/terminal 主题探测与自定义。
10. **鼠标滚动**（backlog-m3 #14）：等 Ink 上游。
11. **onboarding 视觉重设计**（backlog-m3 #15）。
12. **装配期进度可见**（backlog-m3 #16）：MCP 连接/repo map 阶段性回报。

## 文档

13. **文档站（英/中）**（PRD M3 交付物承诺，plan-m3 顺延至今）：当前以 README + docs/ 顶替。

## 明确不做（延续）

- core 层运行中热切换模型（换模型=开新会话）；向量索引/RAG；A2A 协议；自研模型/Tab 补全；
  桌面 GUI；fork 编辑器（PRD.md:181-186）。
