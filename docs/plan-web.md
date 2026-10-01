# Web 控制台实施计划（F21）：packages/console（Preact SPA）+ server 增补

> 来源：PRD F21（docs/PRD.md:177「任务列表、多会话并行、diff 审阅」）+ backlog-m5 商业验证顺延项 #1（docs/backlog-m5.md:9）
> + 功能遗留 #4「MCP 图形化管理界面可并入 F21」（docs/backlog-m5.md:15）。
> 范围决策：**控制台先行**——本地复用 @modou-dev/server（REST+SSE 已就绪，docs/plan-m4.md:33-41），
> 不依赖云基础设施与支付渠道；F22 云任务/计费、模型网关订阅是独立商业化线，不在本轮（docs/backlog-m5.md:10-11）。
> 定位：控制台本体是 PRD 架构图中的官方多端前端之一（docs/PRD.md:211-216），开源 Apache-2.0、无功能锁（docs/PRD.md:332,337）。

## 一、目标与验收标准（7 条）

1. **安全门禁**：开启鉴权（`serve --auth-token` 或 `--auth` 自动生成打印）后，未带 Bearer token 的 API/SSE 请求一律 401（`/health` 豁免——保持 VS Code 插件探测兼容）；未开启时行为与现状完全一致（验证方式：packages/cli/test/server.test.ts 全绿 + 手动 smoke `/health` 探测；vscode 包无测试设施——scripts 仅 build/package、devDeps 无 vitest，不做"vscode 回归测试"表述）；静态路由拒绝路径穿越（`../` 攻击样本测试）；默认绑定 127.0.0.1 不变（server.ts:49、program.ts 默认值）
2. **任务列表**：控制台列出最近会话（GET /sessions：活跃态 + 首条消息预览，server.ts:153-169）；`modou serve` 重启后旧会话仍可点开只读历史（非活跃会话改经 SessionStore 直读回放，修掉现行 404，server.ts:172-175）
3. **多会话并行**：浏览器同时开 ≥2 个会话各自流式输出互不串扰；每会话独立 SSE 订阅（断线自动重连 + 重拉历史对账）；server 端 409 busy 保护保持不回归（server.ts:224-227）
4. **diff 审阅**：一次 write/edit 审批在控制台展示 unified diff（approval_request.diff，core/src/events.ts:43-46），三键生效：允许一次 / 总是允许（remembered 经 savePermissionRule 落盘 permissionRules）/ 拒绝；审批结果回写卡片（approval_result）。注意：serve 路径 remembered 落盘依赖 A6——program.ts:31 只传 `{port, host}`，server.ts:135 defaults.home=undefined，loop-factory.ts:269-275 `if (options.home)` 不成立导致 onRemember 不接线（现状 serve 下永不落盘），A6 显式补此接线（顺带修复 server.ts:139 loadModelOverrides(defaults.home) 在 serve 下拿不到 models.json）
5. **流式与用量**：text_delta 流式上屏、tool_call/tool_result 配对折叠展示；usage 事件累计 token 上/下行与成本（对齐 V1 成本透明主张，docs/PRD.md:82）
6. **turn 取消**：运行中会话可从控制台一键取消（新增 POST /sessions/:id/cancel）。cancel 语义须处理审批挂起：abort 信号现状只消费于模型流（agent-loop.ts:216）与工具执行（agent-loop.ts:479），审批等待是 agent-loop.ts:432 `await answerPromise` 不消费 signal——仅 abort 会让 run 生成器挂死（busy 保持 true、后续消息 409、挂起审批仍被 server.ts:209-212 补发，事后点"允许"会让已取消的 turn 复活）。cancel 实现同时对该会话 pendingRequests 自动 answerById(granted:false)；集成测试覆盖"审批挂起中取消"分支：abort 后 busy 释放、待审批自动拒绝、后续消息不再 409
7. **零回归与发布**：eval 14/14 + 全部现有测试绿（基线 packages/cli/test/server.test.ts:9-244）；@modou-dev/server 发版，check:pack 通过且**可验证 webui 进包**：check-pack.mts:44-51 现仅解 `package/package.json` 扫 workspace: 协议、不查文件清单（A2 需给 server 包 files 加 `webui`，否则构建复制了也进不了 tarball），E3 扩展 check-pack（或新增脚本）断言 tarball 含 `package/webui/index.html`

## 二、包结构

```
packages/console  @modou-dev/console  Web 控制台前端（Preact SPA，esbuild jsx automatic；private 不发 npm，产物随 server 包分发）
packages/server   @modou-dev/server   增补：Bearer 鉴权中间件、静态资源托管、cancel 端点、历史只读回放、cwd 语义修正、健壮性
cli               modou               serve 命令增参：--auth-token/--auth、--web-root、--max-sessions；注入 createSessionDefaults.home（remembered 落盘与 models.json 生效的前提）
```

- 许可：console 为开源侧官方前端（Apache-2.0），与 vscode 包同型（package.json private:true，零 runtime deps）
- PRD 6.2 monorepo 结构未列 web 包（docs/PRD.md:237-247），本计划补位；PRD 结构图更新进文档任务

## 三、关键设计

### 技术栈：Preact SPA（用户拍板 2026-09-27；复用 vscode 包模式）

- **为什么**：F21 所需 UI 词汇已在 packages/vscode/src/webview/main.ts（348 行）全部验证——事件分发 handleEvent(event, replay)（:217-257）、流式增量累积与 finalize 对账（:64-96）、tool_call/result 配对 Map（:103-147）、审批卡 diff 展示与允许/拒绝两键（:151-198）、用量累计条（:208-213）、不可信内容 esc 转义（:43-45）。控制台首版 = 这套词汇的多会话泛化（Map<sessionId, 容器+状态>）。注意：审批"三键"（允许一次/**总是允许**/拒绝）是**净新增交互**，不在已验证词汇内——vscode 审批卡只有两键，且 client.ts:73 answerApproval 硬编码 `remembered: false`（server 侧 server.ts:266-269 已支持 remembered，前端放开即可）；C2 工作量按此计。SSE 解析（fetch ReadableStream 手解析 data: 行，client.ts:84-130）与 REST 方法面（client.ts:25-78）浏览器同款 API，近原样复制。
- **决策（用户拍板，原默认 vanilla 改为 Preact）**：采用 Preact 10 + esbuild（jsx automatic，jsxImportSource preact）。理由：事件→状态→视图的词汇（handleEvent/流式累积/工具配对/审批卡）仍整体复用 vscode 包已验证模式（packages/vscode/src/webview/main.ts:43-257）；组件化让多会话 tab、审批卡、MCP 状态页的挂载/卸载由框架接管，替代手写 Map<sessionId, DOM> 管理；MCP 管理页等表单密集 UI 后续落地更顺。代价：+1 个 runtime dep（preact ~4KB，MIT），devDeps 沿 vscode 惯例（esbuild/typescript/@types）。esbuild browser 打包惯例已验证（packages/vscode/esbuild.mjs:16-25）。状态与事件处理仍收在"事件→状态"纯函数边界（vitest 直测，不依赖 DOM），组件渲染层薄、人工实测。
- **测试策略**：状态与事件处理写成纯函数（vitest 可测）；DOM 细节沿用 vscode 先例（webview 无 DOM 测试）靠人工实测；server 侧全部进集成测试。

### 同源部署，免 CORS

server 新增静态托管：GET / 与 /assets/* 服务控制台产物。web-root 解析顺序：① 显式 `--web-root`；② repo 内 `packages/console/dist`（开发态）；③ server 包内 `webui/`（发布形态：构建时复制 console dist 进 server 包，tarball 携带）。同源浏览器访问零 CORS——**不做 CORS 中间件/OPTIONS 预检**（全仓现状零 CORS，server.ts:298-301 只写 content-type），跨域部署（静态站 + 远程 API）顺延，届时再补。未构建/未指定时保持纯 API 模式（/ 返回 404），vscode/ACP 路径不受影响。

### 鉴权：单 token Bearer，opt-in 默认关

- 三级来源：`--auth-token <t>` 显式 > `MOUDOU_TOKEN` 环境变量 > `--auth` 启动时随机生成并打印到 stdout。
- **浏览器端约定（B1/B2 落地，避免实测时现场发明）**：console JS 本身不携带凭据（静态资源豁免），首次收到 401 时控制台显示 token 输入表单 → 存 localStorage（键 `modou.token`）→ 之后 REST 与 SSE 请求统一带 `Authorization: Bearer <token>`；再遇 401 清除凭据回到输入表单。
- `#handle` 入口（server.ts:89-92）统一插入校验；`/health` 与静态资源豁免（无敏感数据、插件探测兼容）。
- SSE 用 fetch 而非 EventSource（client.ts:84-130 先例），可带自定义 Authorization 头，浏览器端无障碍。
- 定位是**单用户本地访问控制**，不是多租户：会话无归属、审批任何持 token 者可答、SSE 全客户端广播（server.ts:260-271,273-277）维持现状——多用户隔离（会话归属、按用户 settings/预算）顺延 F23 团队版。VS Code 插件适配 token 顺延（未开鉴权时插件现状可用）。
- 远程暴露（--host 0.0.0.0 + 反代/隧道/TLS）不在本轮：文档写明风险与建议（token + HTTPS 反代）。

### cwd 语义修正（server 层，不动 SDK）

现状：POST /sessions 接受 body.cwd（server.ts:140），但 loop-factory 的 resolveCwd 让 settings.cwd 优先（loop-factory.ts:151-153；settings.ts:201-215）——宿主配置过 settings.cwd 时请求 cwd 被静默钉死；目录不存在静默回退只写 stderr。修法：server 在 createSession 前把 body.cwd 合并进 settings（请求 cwd 优先于 settings.cwd）；目录不存在返回 400（不静默回退）；解析结果与 warning 回传 201 响应体，控制台可见。SDK 语义不动（TUI 路径零影响）。

### 历史只读回放（resume 顺延）

非活跃会话的 #history 改为 SessionStore 直读（与 entry.session.store 同一底座，SessionStore.read），重启后仍可回放；JSONL 事件流天然支持回放（docs/PRD.md:280），前端用 handleEvent(event, replay=true) 模式（回放跳过 text_delta，main.ts:217-257）。**resume 续跑不做**：SDK 虽支持 sessionId 注入（loop-factory.ts:44），但恢复审批桥/MCP 状态的装配面需另行设计，顺延。

### turn 取消（cancel 语义；abort 不覆盖审批等待）

现状：entry.abort 的 signal 只被模型流（agent-loop.ts:216）与工具执行（agent-loop.ts:479）消费，审批等待是 agent-loop.ts:432 `await answerPromise` 纯 Promise 挂起。因此 cancel 实现为两步：① `entry.abort.abort()`（server.ts:233,239-244 已挂）；② 对 `entry.session.approvals.pendingRequests()` 逐个 `answerById(id, {granted:false})`（approval-bridge.ts:49-58 已支持），释放卡在审批上的 turn。不做 loop 内 signal race（改 core 风险面大，server 层两步可达且可测）。测试须覆盖"审批挂起中取消"分支（见验收 6）。

### server 健壮性顺手修（低成本项）

- 请求体上限 1MB（413）——现状 #readJson 无上限（server.ts:283-296）
- SSE 周期心跳（15s comment ping）——现状仅连接时一次 retry: 2000（server.ts:207），反代会掐长连接
- `--max-sessions`（默认 8，超出 429）——现状 sessionCount 只是 getter、创建无配额（server.ts:44-46），每会话真实成本为 MCP 子进程 + LSP hub + 模型连接

### 项目目录选择（Phase F，2026-09-30 用户提出并拍板）

现状：控制台 `cwd` 状态存在但零输入入口（console/src/main.tsx:107 `useState("")`，setCwd 无调用）——网页建的每个会话都跑在 serve 启动目录，换项目必须重启 serve。API 层已就绪（A5：body.cwd 优先、目录不存在 400，server.ts:233-246），缺的只是选择 UI 与服务端浏览能力。

**形态与边界（用户拍板：两个都做；本地默认不限根；部署期用白名单收紧）**：
- 浏览器无法枚举服务器文件系统 → 目录浏览必须 server 支撑：`GET /fs/dirs?path=<abs>` 列子目录（仅目录不列文件；跳过 dotfiles；`resolve` 归一化后 `stat` 校验，不存在/非目录 400）；响应 `{path, parent, dirs:[{name,path}]}`。
- **白名单 `--fs-allow-root <dir>`（可重复）/ `ModouServerOptions.fsAllowRoots?: string[]`**：默认空 = 不限（本地单用户定位，用户拍板）；配置后 ①`/fs/dirs` 请求路径越界 403 ②`POST /sessions` 的 body.cwd 越界 403（opt-in 行为变更，部署场景的安全边界）③recents 过滤越界项。越界判定 `path.relative(root, p)` 以 `..`/绝对结果为准；Windows 盘符大小写归一（两侧 resolve 后 toLowerCase 比较，LSP URI 归一化同款先例）。
- **最近目录**：POST /sessions 成功创建后把解析出的绝对 cwd 去重置顶写入 `<defaults.home>/cwd-recents.json`（上限 8 条；home 未注入的库内嵌用场景自动禁用）；`GET /fs/recents` 返回 `{serveCwd, recents}`（serveCwd = server 进程 process.cwd()，作为默认目录）。
- **console 交互**：「+ 新会话」改为打开目录选择弹层（esbuild iife 单文件内新增，零新依赖）：最近目录 chips **单击即建会话**（主快路径）；目录浏览器两步（面包屑可点跳级 + 上级 + 子目录行 + 「在此新建」确认）；手动路径输入 Enter 即建，400/403 错误文案内联回显；Esc/遮罩关闭。空态「开始一个新会话」流程不变（Enter 直接在 serve 目录建，零摩擦默认），旁加「目录：…（更改）」chip 唤起弹层。
- **cwd 可见性**：会话创建时把响应体里 A5 回传的解析 cwd 记入视图状态，输入台上方 mono 小字 chip 显示（中段截断、hover 全路径）；replay 旧会话拿不到则不显示（客户端记录，不强改 server 契约）。
- 安全面评估：`POST /sessions` 本就接受任意 cwd（"在任意目录建会话"能力已存在），新端点新增的只是文件系统结构枚举；鉴权开启时自然被 token 保护（#handle 统一校验，/health 豁免不变），未开鉴权的本地默认与现有 GET /sessions 同风险级；白名单为部署期收紧手段。
- 测试：/fs/dirs 正常列/400 非目录/dotfile 跳过；fsAllowRoots 配置后 dirs 越界 403、sessions cwd 越界 403、穿越样本（`..`/URL 编码）不逃逸；recents 创建落盘/去重置顶/上限 8/白名单过滤；console 状态纯函数沿用现有 vitest 面，弹层 DOM 人工实测。

## 四、任务分解（TDD，一任务一提交，预计 17 任务）

**Phase A：server 增补（先服务端——前端依赖托管与鉴权；以 packages/cli/test/server.test.ts:9-244 五链路为回归基线扩展；一任务一提交，A3-A6 互不依赖各自独立测试与回滚）**
- A1 Bearer 鉴权中间件：ModouServerOptions.authToken；除 /health 全路由校验 401；CLI `serve --auth-token/--auth`（缺省生成打印）；未配置时零行为变化——验证方式为 server.test.ts 全绿（未配 authToken 路径）+ 手动 smoke /health 探测（vscode 包无测试设施，不做 vscode 回归测试表述）
- A2 静态托管：GET / 与 /assets/*（三级 web-root 解析；content-type 表；路径穿越 403 测试；纯 API 降级）；构建编排：console dist → server 包 webui/，**server 包 package.json files 加 `webui`**（现 files=["dist"]，不加则产物进不了 tarball）
- A3 cancel 端点：POST /sessions/:id/cancel = abort + pendingRequests 自动 answerById(granted:false)；集成测试含"审批挂起中取消"分支（busy 释放/待审批自动拒绝/不再 409）
- A4 历史只读回放：#history 非活跃会话改 SessionStore 直读（修 server.ts:172-175 重启后 404）
- A5 cwd 语义修正：body.cwd 优先于 settings.cwd（server 层合并，不动 SDK）；目录不存在 400（不静默回退）；解析结果与 cwdWarning 回传响应体（**行为变更**，E2 changelog 明示）
- A6 serve 注入 home：program.ts serve 传 createSessionDefaults.home → PermissionEngine.onRemember 接线（loop-factory.ts:269-275）→ remembered 落盘 permissionRules；顺带修 loadModelOverrides(defaults.home) 拿不到 models.json（**验收 4 依赖**）
- A7 健壮性顺手修（三项与 F21 七条验收无一直接关联，整体可顺延不影响验收）：#readJson 1MB 上限 413；SSE 15s 心跳；--max-sessions 429

**Phase B：console 骨架**
- B1 包骨架：esbuild.mjs（jsx automatic + jsxImportSource preact，对齐 vscode/esbuild.mjs:16-25）+ index.html + preact 依赖接入 + turbo/pnpm 接入 + modou serve 打开页面联调（**验收 1 部分验证点**）
- B2 client 层：REST+SSE 复用 vscode/src/client.ts:25-130 模式 + Authorization 头 + **token 输入表单与 localStorage 存取（§三鉴权浏览器端约定：401 → 输入 → `modou.token` → 统一带头，再 401 清凭据）** + 多会话订阅注册表（Map<sid, dispose>）+ 断线 onDone 重连
- B3 会话列表（活跃态/预览）+ 新建会话（cwd 输入 + mcpStatus/contextWindow 展示）+ 多会话 tab 并行骨架

**Phase C：单会话核心**
- C1 流式渲染（text_delta 增量/finalize 对账）+ 工具调用折叠 + 发送/409 busy/400 提示 + esc 转义
- C2 审批卡（unified diff + **三键**：允许一次/总是 remembered/拒绝——净新增交互，vscode 仅两键且 client.ts:73 硬编码 remembered:false + approval_result 回写 + 重连后审批快照补发对接，server.ts:209-212）+ 用量条 + 取消按钮（对接 A3 cancel；remembered 落盘依赖 A6）

**Phase D：多会话与回放**
- D1 会话历史回放：点开旧会话 replay 模式（重启后只读历史，**验收 2**）
- D2 MCP 状态只读展示：会话详情显示 mcpStatus（创建响应已有，server.ts:145-149）；若拍板并入 MCP 管理操作（启停/工具浏览）则追加任务，默认只读

**Phase E：验收与收尾**
- E1 浏览器端到端人工实测（**验收 3/4/5/6 核心**，需用户配合）：真实 key 跑一轮带审批的 edit 任务验证 diff 三键（含"总是允许"后 settings.json 落盘 permissionRules）、≥2 会话并行流式、取消失控 turn（含审批挂起中取消）、重启 serve 后回放旧会话
- E2 文档：README（控制台一节 + 鉴权用法）、dev.md 架构/结构补 console、PRD 附录 A + F21 状态与 6.2 结构图补行、backlog-m5 #4 处置记录、**server changelog 明示 cwd 行为变更**（坏目录 400 而非静默回退，A5）、本文档验收记录回填
- E3 回归与发布：eval 14/14 + 全部测试绿；@modou-dev/server 发版；**扩展 check-pack（或新增脚本）断言 tarball 含 package/webui/index.html**（check-pack.mts:44-51 现仅扫 package/package.json，验不了文件清单）

**Phase F：项目目录选择（2026-09-30 拍板：两个都做、默认不限根、部署期白名单；预计 5 任务约 1 天）**
验收（自包含，不改动上方 F21 七条）：① 未配 fsAllowRoots 时本地行为不限根、默认目录 = serve 启动目录；② 配置后 /fs/dirs 与 POST /sessions cwd 越界一律 403，`..`/URL 编码穿越样本不逃逸；③ recents 去重置顶、上限 8、落盘重启仍在；④ 控制台可「最近快选 / 浏览 / 手输」三种方式指定目录建会话，坏路径错误内联可见；⑤ 会话 cwd 在输入台上方可见；⑥ server/console 全量测试绿后一提交一任务。
- F1 server 目录浏览端点：`GET /fs/dirs?path=`（resolve+stat 校验、仅目录、跳过 dotfiles、parent 计算）；`fsAllowRoots` 选项 + CLI `serve --fs-allow-root`（可重复）；白名单校验同时挂到 /fs/dirs 与 POST /sessions body.cwd（越界 403）；集成测试含穿越样本与盘符大小写归一
- F2 server 最近目录：POST /sessions 成功后落盘 `<home>/cwd-recents.json`（去重置顶、上限 8）；`GET /fs/recents` 返回 `{serveCwd, recents}`；白名单配置时过滤越界项；集成测试（tmp home）
- F3 console 目录选择弹层：client 层 `listDirs/getCwdRecents` 两方法 + 弹层组件（最近 chips 单击即建 / 面包屑浏览器两步确认 / 手输 Enter 即建；400/403 内联回显；Esc/遮罩关闭）；「+ 新会话」改挂弹层，空态加「目录：…（更改）」chip
- F4 console cwd 可见：创建响应的解析 cwd 记入视图状态，输入台上方 mono chip（中段截断 hover 全路径）；replay 无则不显示
- F5 文档与回归：README 控制台节补目录选择与 `--fs-allow-root`；本文档验收记录回填；server+console 全量测试绿

## 五、明确不做（顺延）

- **F22 云任务沙箱与按用量计费、官方模型网关订阅**：独立商业化线，需云基础设施与支付渠道（docs/PRD.md:178,335；docs/backlog-m5.md:10-11）
- **多用户/团队**：会话归属、按用户 settings/模型/预算分配、审批人权限隔离 → F23 团队版（docs/PRD.md:179,336）
- **CORS 中间件与跨域部署**：同源静态托管替代；分域部署时再补（含 OPTIONS 预检）
- **resume 重启会话续跑**：SDK 有 sessionId 注入（loop-factory.ts:44）但恢复装配面另需设计；本轮重启后只读回放
- **历史分页 / 列表预览性能优化（O(50×文件)）/ SSE Last-Event-ID 续传**：本地单用户会话规模可控（server.ts:157-166）
- **MCP 管理操作界面**（启停/工具浏览/配置编辑）：默认只读展示，管理操作视拍板追加（backlog-m5 #4）
- **setThinking/预算控制端点与 UI**：LoopBundle 已备好（loop-factory.ts:168-170,305-310），接线顺延
- **VS Code 插件 token 适配、控制台 npm 发布**：插件在未开鉴权 serve 下现状可用；console 产物随 server 分发
- **目录选择顺延项（Phase F 明确不做）**：隐藏文件（dotfiles）浏览与开关、目录收藏/书签、跨机远程目录（SSH/容器内路径）、fsAllowRoots 之外的部署加固（TLS/反代/多租户隔离——延续上方鉴权顺延项）
- 桌面 GUI、fork 编辑器、向量索引/RAG、A2A、core 热切换模型（延续，docs/PRD.md:181-186；docs/backlog-m5.md:37-38）

## 六、执行方式与配合点

延续 M5 节奏：本文档第一笔提交，TDD 一任务一提交，每 3-5 任务一次检查点（eval 14/14 门禁）。
顺序先 server（A）后 console（B/C/D）——前端依赖静态托管与鉴权落地。预计 17 任务（约 1.5-2 周单人节奏，粗估；A7 可整体顺延）。
用户配合一处：E1 浏览器实测（需真实模型 key 跑审批任务）。

**待拍板清单（2026-09-27 用户已拍板）**：
1. **MCP 图形化管理界面**——✅ 确认默认：只读状态展示进首版（D2），启停/工具浏览等管理操作顺延
2. **"任务列表"语义**——✅ 确认默认：直接映射会话列表（GET /sessions），不引入独立"任务"抽象
3. **用量/成本展示**——✅ 确认默认：进首版
4. **console 包定位与许可**——✅ 确认默认：开源 Apache-2.0 private 包，PRD 6.2 补一行
5. **前端技术栈**——✅ **改为 Preact**（原默认 vanilla TS；理由见关键设计，esbuild jsx automatic）
6. **鉴权形态**——✅ 确认默认：单 token Bearer、opt-in 默认关、仅 localhost；远程暴露顺延
7. **排期**——✅ 确认控制台先行；F22/网关订阅后续另行决策
8. **项目目录选择（Phase F，2026-09-30）**——✅ 两个都做（浏览端点 + 最近目录/选择器 UI 全上）；**本地默认不限根**；白名单 `--fs-allow-root` 随 F1 一并实现但默认空，部署期再配置收紧

## 七、验收记录

| 项 | 结果 | 日期 |
|---|---|---|
| 计划产出（动态工作流：3 调研 + 规划 + 独立评审通过） | ✅ 14→17 任务定稿，评审通过 | 2026-09-27 |
| 待拍板清单 | ✅ 用户确认 6 项默认；前端栈改 Preact | 2026-09-27 |
| A1 鉴权 | ✅ dc2953c；sha256+timingSafeEqual，/health 豁免，三级 token 来源 | 2026-09-28 |
| A2 静态托管 | ✅ f7e41e3；穿越实测抓到 ..%5C 变体曾暴露 webRoot 根文件（修为 /assets/* 锁死子目录 403） | 2026-09-28 |
| A3 cancel | ✅ 317a26d；审批挂起中取消=abort+自动拒绝（集成测试覆盖 busy 释放/不再 409） | 2026-09-28 |
| A4 历史回放 | ✅ 317a26d；非活跃会话 SessionStore 直读，active 标记 | 2026-09-28 |
| A5 cwd 语义 | ✅ c745d33；请求优先/400 拒绝不存在/结果回传（行为变更已明示） | 2026-09-28 |
| A6 serve home | ✅ c745d33；remembered 落盘端到端测试 | 2026-09-28 |
| A7 健壮性 | ✅ f954d1b；1MB 413（排空非销毁）/SSE 心跳/--max-sessions | 2026-09-28 |
| B1-B3 console 骨架 | ✅ d80cd91；状态层纯函数 10 测 + client token 门 | 2026-09-28 |
| C1-C2/D1-D2 UI | ✅ 79ea632；流式/审批三键/取消/回放/MCP 状态 | 2026-09-28 |
| 用户实测回归修复 ① | ✅ b8032e0：非活跃会话 SSE 404 静默退出（原误报"事件流断开"）+ 回放徽标 | 2026-09-28 |
| 用户实测回归修复 ② | ✅ 72c8afc：store.list 按修改时间倒序（2844 历史文件把新会话挤出最近 50） | 2026-09-28 |
| 用户实测回归修复 ③ | ✅ a3f37d8：回放 busy 永不清除致取消按钮常驻（落盘 usage 无 turnEnd） | 2026-09-28 |
| E1 浏览器实测 | ✅ 用户验收通过（一问一答/审批三键/取消/多会话/回放） | 2026-09-28 |
| E2 文档 | ✅ ed5f891（README/dev.md/PRD/backlog；cwd 行为变更随本表与 Release notes 明示） | 2026-09-28 |
| E3 回归与发版 | ✅ 479c222；eval 14/14、全量 427 测、check-pack 断言 webui 进包；npm 五包 0.6.0-alpha.1（latest 同步） | 2026-09-28 |
| UI 重设计 | ✅ 动态工作流产出规格+视觉稿（独立评审通过）→ Preact 落地（a01d0f7）→ 用户验收通过；实测反馈三轮修复（回放 404 噪声 b8032e0 / 列表排序 72c8afc / 回放 busy a3f37d8 / 状态灯与空态 5a4ab05） | 2026-09-29 |
| UI 重设计第三轮 | ✅ 三方向并行视觉稿（晒图/孔版/仪器面板）→ 用户选晒图 → 落地（c40f521）；后续用户仍不满意 | 2026-09-29 |
| UI 重设计第四轮（主流化） | ✅ 转向主流高级感路线（对标 Claude/ChatGPT/Linear，放弃主题概念化）：基准提炼→重写真实 UI→质量门→审计循环（1dac6ad）；用户停止工作流后由主代理收尾（构建/console 11 测全绿），浏览器实测：暗色空状态示例卡/历史会话消息流/续跑均正常 | 2026-09-29 |
| 布局微调两轮 | ✅ 侧栏新会话钮（钉底→列表尾 acfdd84→**列表顶部** 5a979ae，会话列其下）+ 用量条输入台下方水平居中（acfdd84）；浏览器截图验证 | 2026-09-30 |
| 回归修复：删除活跃会话 | ✅ 5a979ae：DELETE /sessions/:id 活跃/非活跃语义统一为彻底删历史文件（原活跃分支只关不删，界面删除"复活"），补集成测试（server 6/6） | 2026-09-30 |
| Phase F 拍板 | ✅ 项目目录选择：两个都做 / 本地默认不限根 / 部署期 --fs-allow-root 白名单；任务 F1-F5 定稿（见四 Phase F） | 2026-09-30 |
| F1 目录浏览端点 | ✅ 3001587：GET /fs/dirs（仅目录跳 dotfiles，缺省=进程目录）+ fsAllowRoots 白名单（/fs/dirs 与会话 cwd 含缺省回落越界 403，先于存在性 400 防探测）；测试含 .. 上跳/反斜杠编码/盘符大小写归一（server 10/10） | 2026-09-30 |
| F2 最近目录 | ✅ 建会话落盘 <home>/cwd-recents.json（realpath 归一去重置顶上限 8，落盘失败不阻塞）；GET /fs/recents 回 serveCwd+recents（过滤不存在/白名单外，损坏容错）；server 12/12 | 2026-09-30 |
| F3 目录选择弹层 | ✅ DirPicker.tsx（最近 chips 单击即建/面包屑两步/手输 Enter；400/403 内联回显，Esc/遮罩关闭）+ client 单例导出；浏览器实测：浏览往返/快选即建即关；顺带修 commander 驼峰键名（fsAllowRoot） | 2026-09-30 |
| F4 cwd 展示 | ✅ SessionView.cwd（创建响应记入，replay 不显示）+ 输入台上方 mono chip；state 测试 12/12 | 2026-09-30 |
| F5 文档与回归 | ✅ README 控制台节（目录选择 + --fs-allow-root）；全量测试 turbo 8/8 包绿（core 204 / cli 212 / console 12 / lsp 12 等），eval 14/14 达基线（glm-4.5-air） | 2026-09-30 |
| F6 系统目录对话框 | ✅ POST /fs/pick：serve 弹原生选择框（Win FolderBrowserDialog/macOS choose folder/Linux zenity；单例+10min 兜底回收，UTF-8 字节直写防中文乱码），弹层「系统对话框」按钮仅 localhost 显示；端到端实测选目录→建会话→cwd 显示与取消路径；recents 移至 ~/.modou/（b6f1e31 后续提交） | 2026-09-30 |
| F6 反馈修复：对话框置顶 | ✅ 原生框挂置顶隐形属主窗体（无属主时被浏览器压住，用户以为没弹出）+ 弹层等待提示条；实测对话框直接抢前台、取消后复位 | 2026-09-30 |
| F7 反馈：多项目混排可辨 | ✅ server 维护 cwd-index.json（store 同目录，创建落索引/删除同步清），/sessions 每行带 cwd；控制台会话行显示所属项目名（末段，与时间并列），底部状态条继续显示当前会话目录；集成测试覆盖索引落盘与删除清除（server 13/13） | 2026-09-30 |
| F8 反馈：树状侧栏 | ✅ 会话列表重构为项目分组树：一级节点=项目目录（icon+名称+会话计数，点击展开/收起，偏好记 localStorage），会话缩进其下，空项目（来自 recents）也可存在；无 cwd 旧会话归「未标注项目」组排最后；底部状态条保留显示当前会话完整目录；groupSessions 纯函数 + vitest（console 14/14）；类名 .pjrow 避让 MessageLog 参数行 .prow（撞名踩坑记录） | 2026-09-30 |
| F9 反馈：项目管理交互 | ✅ 项目行悬浮显两操作钮（… 更多 / 气泡+「在此工作区新建会话」title 提示，点击建会话并展开该组）；… 下拉菜单：复制路径（clipboard+execCommand 兜底）/ 重命名（行内编辑，别名存 localStorage）/ 移除工作区（红字；客户端隐藏 + server POST /fs/recents/remove 摘除，不动磁盘文件）；计数 0 灰显；空组提示「暂无会话，点击右侧 + 号开始」；端到端实测全部通过（server 14/14 / console 14/14） | 2026-09-30 |
| F10 反馈：目录选择器重构 | ⏪ 已撤销（用户要求，517cce9 revert）：曾实现面包屑+⬆ 导航、行选中/双击/行内选择、输入框+选择此文件夹、原生链接先关后调（消双弹窗）——原提交 ac21a1d | 2026-09-30 |
| F1 补遗 | ✅ --fs-allow-root 读取 commander 驼峰键名 fsAllowRoot 的修复此前漏提交，补入（7adea61） | 2026-09-30 |
| 缓存根因修复 | ✅ 用户见旧界面（树"消失"实为缓存旧 bundle）——静态资源加 cache-control: no-cache（32f6784），普通刷新即最新 | 2026-09-30 |
| F9 缺陷修正：隐藏吞会话 | ✅ 「移除工作区」的隐藏名单把带会话的项目组也过滤，致全部会话不可见只剩「暂无会话」；改为隐藏仅对空节点（recents）生效，有会话的组永远显示（人为塞满隐藏名单复现验证）；菜单项补语义提示「不删除文件；其下已有会话仍会显示」（165b58b） | 2026-09-30 |
| F10.5 语义定版：移除工作区 | ✅ 用户反馈两连坑（有会话时移除无反应；删光会话后节点因此前移除过 recents 而突失）——定版语义：移除=立即连节点带会话从侧栏消失（文件/历史不动）；头部计数只数可见会话；全移除时提示「工作区已移除」；列表底部常驻「已移除 N 个工作区 · 恢复」一键找回（复现+恢复实测通过） | 2026-09-30 |
| F10.6 语义定版：工作区持久化 | ✅ 用户明确「工作区只能手动删除，删会话不影响」——新增 modou.projKnown 持久清单（会话/recents 出现过的目录自动沉淀），节点与 recents/会话彻底解耦：删光会话节点保留显示 0；移除工作区 = 唯一删除途径（hidden），底部恢复可找回；全流程实测（建→删会话节点在→移除→恢复） | 2026-09-30 |
| F10.6 收尾：去恢复入口 | ✅ 用户不要「恢复」按钮与「工作区已移除」提示——移除即彻底从侧栏消失，空态回归「暂无会话」；被移除的工作区再建会话时自动解除移除（实测）；菜单 title 同步 | 2026-09-30 |
