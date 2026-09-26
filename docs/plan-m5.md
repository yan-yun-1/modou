# M5 实施计划：编辑器生态与安全（沙箱 → LSP → VS Code 插件 → 清偿 → 发布）

> 来源：plan-m4 正式顺延清单（docs/plan-m4.md:100：LSP F16、VS Code 插件 F20、OS 沙箱落地）
> + PRD F13/F16/F20 承诺 + backlog 遗留清偿（含 0.5.0-alpha.1 workspace: 泄漏事故的防再发）。
> 范围决策（2026-09-26 用户确认）：三大块全做 + 低成本清偿；
> **PRD 原定 M5 商业验证（F21/F22 云任务计费、模型网关订阅）不在本轮**，顺延。

## 一、目标与验收标准（6 条）

1. **沙箱**：`docs/sandbox-eval.md` 三平台评估落盘；macOS Seatbelt 落地（profile 生成与 bash 接入有单测；执行路径标注需 macOS 实机验证）；Windows/Linux 给出明确不落地结论；沙箱内免审批开关默认关
2. **LSP（F16）**：settings 配置 + 自动探测 language server；edit/write 后诊断自动附加到工具结果；`definition` 工具跳转（mock LSP 集成测试证明）
3. **VS Code 插件 alpha（F20）**：连接 modou serve，一问一答 + 流式渲染 + 一次 diff 审批（装 VS Code 实测）
4. **清偿**：pack 校验脚本能拦截 workspace: 泄漏（用 0.5.0-alpha 事故样本测试）；ACP 迁移到 @agentclientprotocol/sdk 回环全绿；code-review 子代理（F13 补全）；HTTP 型 MCP 集成测试（backlog-m3 #7）；README/dev.md 过时信息对齐
5. **零回归**：eval 14/14 + 全部现有测试绿
6. **发布 v0.6.0-alpha**：全包发布过 pack 校验 + GitHub Release

## 二、包结构

```
packages/lsp     @modou-dev/lsp    LSP 客户端（vscode-languageserver-protocol + vscode-jsonrpc）
packages/vscode  modou-vscode      VS Code 插件 alpha（esbuild 打包，@vscode/vsce 出 .vsix；不发 npm）
core             沙箱模块 packages/core/src/sandbox/
```

## 三、关键设计

### 沙箱（PRD 6.5「少弹窗而更安全」；纯新增，唯一改造点 bash.ts:66-78 spawn 处）

- `packages/core/src/sandbox/`：`SandboxAdapter` 接口 `wrap({cwd}) → {command, args}`；macOS 用
  `sandbox-exec -f <profile>`（profile 模板：全盘读、仅 cwd+tmp 写、网络 v1 放行）；
  Windows 受限令牌需 Win32 原生支持→文档结论不落地；Linux Landlock 需 syscall 绑定→评估 bwrap/firejail 包装，不默认落地
- 接入：`AgentLoopDeps.sandbox?` 注入；`settings.sandbox: "off"|"auto"`（默认 off，auto=平台支持才启用）
- 免审批：`settings.sandboxAutoAllow`（默认 false）开启时装配层注入全量 execute allow 规则——隔离是安全前提，不是替代审批

### LSP（F16；新包 @modou-dev/lsp）

- `LspHub` 管理多 server：stdio transport、didOpen/didChange 全量同步、诊断缓存；
  `settings.lspServers`（形状对齐 mcpServers），无配置时自动探测 PATH 中 typescript-language-server
- core 集成：`AgentLoopDeps.lspHub?`；edit/write 成功后诊断以内置逻辑附加到工具输出（不占用户 F14 hook）；
  新工具 `definition {file, line, column}` 返回位置列表
- 测试：vscode-jsonrpc in-process stream 起 mock language server 做协议级集成测试，不依赖外部二进制

### VS Code 插件 alpha（F20；新包 packages/vscode）

- 激活 → 探测 `127.0.0.1:4711 /health`，无则 spawn `modou serve`（端口从 stdout 解析）→ 侧边栏 webview
  （vanilla TS + CSP nonce，不引前端框架）
- 功能：会话列表/新建/发消息、SSE 流式渲染（fetch ReadableStream，不用 EventSource）、工具调用折叠、
  审批卡片（approval_request 自带 diff → `vscode.diff` 原生 diff 视图再 Allow/Deny）、用量显示
- alpha 不含：多根工作区、设置 UI、marketplace 发布

## 四、任务分解（TDD，一任务一提交，预计 16-19 任务）

**Phase A：地基与快赢清偿**
- A1 pack 校验脚本 scripts/check-pack.mts：pack 后解 tarball 扫描 `workspace:` 与版本一致性（事故样本测试）
- A2 ACP 迁移 @agentclientprotocol/sdk（核对 AgentSideConnection/ndJsonStream/Agent 等价），回环测试护航
- A3 文档对齐：README 状态行、dev.md 过时指针与版本号、docs/backlog-m5.md 归档遗留

**Phase B：沙箱**
- B1 docs/sandbox-eval.md：三平台可行性/权限模型/限制/推荐路径
- B2 SandboxAdapter + seatbelt profile 生成 + bash.ts 接入 + settings 装配 + 免审批开关

**Phase C：LSP**
- C1 packages/lsp 骨架 + LspConnection（initialize/文本同步/诊断）+ mock server 集成测试
- C2 LspHub 多 server 管理 + 自动探测 + settings.lspServers
- C3 core 集成：edit/write 诊断注入 + definition 工具 + sdk 装配
- C4 本机实测：modou 仓库自身当靶子（故意改出类型错误验证注入）

**Phase D：VS Code 插件**
- D1 包骨架：esbuild 构建、turbo 接入、扩展激活 + server 生命周期
- D2 REST/SSE client + webview 骨架（会话列表 + 聊天输入）
- D3 流式渲染 + 工具调用展示 + 审批卡片（vscode.diff）+ 用量
- D4 vsce 打包 .vsix + 装进 VS Code 人工实测（**验收 3**，需用户操作）

**Phase E：清偿与发布**
- E1 code-review 子代理（subagent.ts 加 code-review 角色）
- E2 HTTP 型 MCP 集成测试（node:http 起 StreamableHTTP 测试 server）
- E3 eval 包化 packages/eval（scripts/eval.mts 迁入，根 pnpm eval 转发）
- E4 文档：README/dev.md/PRD 附录 A、本文档验收记录回填
- E5 发布 v0.6.0-alpha：全包 pnpm publish --tag alpha + A1 校验 + GitHub Release

## 五、明确不做（顺延）

文档站英/中（backlog-m5 记录）、F22 云任务与计费、F23 团队版、主题配色/鼠标滚动/onboarding 重设计、
向量索引/A2A/core 热切换、LSP 高级特性（hover/references/rename）、Windows/Linux 沙箱强制隔离、
VS Code 插件 marketplace 发布。

## 六、执行方式与配合点

延续 M4 节奏：本文档第一笔提交，TDD 一任务一提交，每 3-5 任务一次检查点。
用户配合两处：D4 装 VS Code 实测；E5 发布确认。
沙箱 macOS 执行路径在本机（Windows）只能做到单测级验证，验收记录中如实标注。

## 七、验收记录

| 项 | 结果 | 日期 |
|---|---|---|
| （随任务推进回填） | | |
