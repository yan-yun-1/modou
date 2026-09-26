# modou-vscode

墨斗 Modou 的 VS Code 侧边栏（alpha，PRD F20）。复用 `@modou-dev/server` 的 REST+SSE API。

## 功能（alpha）

- 侧边栏会话面板：新建 / 选择会话、发送任务、流式渲染回复
- 工具调用折叠展示、审批卡片（diff 内联 + 允许/拒绝）、用量与成本累计
- 自动探测 `127.0.0.1:4711` 上已运行的 `modou serve`，没有则自动拉起（随机端口）

## 构建与安装

```bash
pnpm build              # esbuild 打包（扩展宿主 cjs + webview iife）
pnpm package            # vsce 打包 modou-vscode.vsix
```

VS Code 中 `Extensions: Install from VSIX…` 安装即可。
