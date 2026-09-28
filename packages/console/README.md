# @modou-dev/console

墨斗 Modou 的 Web 控制台（PRD F21）。官方浏览器前端，同源复用 `@modou-dev/server` 的 REST+SSE。

## 功能（首版）

- 会话：新建（可指定项目目录）/ 切换 / 多会话并行流式
- 流式回复、工具调用折叠、审批卡（unified diff + 允许/总是允许/拒绝三键）、用量与成本
- turn 取消（含审批挂起中取消）；server 重启后历史只读回放
- 可选 Bearer 鉴权（serve `--auth-token/--auth`；浏览器首次 401 弹 token 表单，存 localStorage）

## 构建

```bash
pnpm build   # esbuild 打包 dist/ 并复制进 packages/server/webui/
```

产物随 `@modou-dev/server` 分发：`modou serve` 后浏览器打开 `http://127.0.0.1:4711` 即可。
开发态 server 自动探测 `packages/console/dist`（无需 --web-root）。
