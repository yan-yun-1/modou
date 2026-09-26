# OS 级沙箱评估（M5 B1，PRD 6.5）

> 目标：为 bash 工具提供 OS 级强制隔离，支撑「少弹窗而更安全」——沙箱内的命令执行
> 可以在用户显式开启 `sandboxAutoAllow` 后免弹窗放行（隔离是安全前提，不是审批的替代）。
> 结论速览：**macOS Seatbelt 本轮落地；Windows 不落地（权限审批兜底）；Linux 评估 bwrap/firejail 包装，不默认启用。**

## 一、威胁模型与边界

**防什么**：
- agent 误操作 / 提示注入导致的越界写入（项目目录之外的文件被改写）
- 无界破坏：删除 home、改系统配置、往项目外乱写脚本

**不防什么**：
- 用户自己审批放行的危险命令（审批是显式授权，沙箱只做纵深防御）
- 内核级逃逸、0-day（沙箱不是安全边界意义上的 VM）
- 读侧泄露：v1 profile 全盘可读（构建/编译依赖到处读文件，收紧读权限会大面积破坏工具链）

## 二、macOS：Seatbelt（sandbox-exec）——本轮落地

**机制**：`/usr/bin/sandbox-exec -f <profile>` 以 SBPL（Scheme 语法的 profile 语言）启动子进程，
由内核 TrustedBSD MAC 框架强制执行文件写、网络、进程等操作许可。

**可行性**：
- Apple 自 10.11 起"弃用" sandbox-exec（未承诺 ABI 稳定），但至今仍随系统分发且被广泛使用
  （Homebrew、Chromium 的渲染进程模型都基于同源机制），CLI 场景实践中稳定。
- 纯用户态包装：无需原生模块，profile 是文本文件，spawn 前写临时文件即可。

**权限模型（v1 profile 策略）**：
- 写：默认拒绝，仅放行会话 cwd 与系统临时目录（`file-write*` deny + subpath allow）
- 读：全放行（收紧读会破坏 node_modules/工具链，v1 不做）
- 网络：v1 放行（`npm install`、curl 等是高频合法操作；网络分级留待 v2）

**限制与风险**：
- profile 语言无官方文档，语法靠社区逆向（有已知拼写即静默失效的坑——profile 必须实测验证）
- 逃逸面：子进程若取得用户授权的 TCC 权限（如 Full Disk Access）不受 Seatbelt 约束的场景极少，但存在

**落地方式（B2）**：`SandboxAdapter` 在 spawn 前把 `/bin/sh -c <cmd>` 包装为
`sandbox-exec -f <profile> /bin/sh -c <cmd>`；profile 按会话 cwd 生成。

**验证状态**：profile 生成、参数拼装、平台选择有单元测试；真实执行路径需 macOS 实机
（开发机为 Windows，验收记录中如实标注）。

## 三、Linux：Landlock（本轮不默认落地）

**机制**：LSM 安全模块（Linux 5.13+），非特权进程可对自己及其子孙施加文件系统访问规则；
6.7+（ABI v4）支持 TCP bind/connect 控制。正确性模型最干净，是三平台中设计最好的。

**不落地的原因**：
- Landlock 经 syscall 施加，Node/libuv 不暴露，必须写 N-API 原生插件或引第三方绑定
  （npm 生态有零散尝试，无广受维护的标准包）——与"零重依赖"原则冲突
- 替代路径是包装器：`bwrap`（bubblewrap）或 `firejail` 若在系统上存在，可以像 Seatbelt 一样
  spawn 前包装。但两者非发行版默认预装，且 firejail 自身有安全争议

**推荐路径**：检测 `bwrap` 是否存在，存在则提供 `settings.sandbox: "bwrap"` 实验档；
Landlock 原生插件列为独立预研任务（不计入 M5）。

## 四、Windows：受限令牌 / AppContainer（本轮不落地）

**候选方案逐个评估**：
- **受限令牌（Restricted Token）**：`CreateProcessAsUser` + 限制 SID 需要 Win32 调用链，
  Node 无原生暴露，需 N-API 插件；且限制 SID 模型对"仅允许写 cwd"的表达力很弱（ACL 逐对象授权不可行）
- **AppContainer**：Windows 8+ 的低完整性沙箱（Edge 旧模型），能做路径+网络白名单，
  但需要 profile 本地化、capability SID 计算、LUACheck 等重工程，纯 Node 不可达
- **Windows Sandbox**：完整轻量 VM，隔离最强但秒级启动 + Windows Pro 限定，不适合每条命令
- **Job Object**：仅资源限制（内存/CPU/进程树），**不是安全边界**，不能防越界写

**结论**：Windows 上 Node 生态无轻量可行的 OS 级方案。防线维持现状——权限审批（write/execute
必弹窗）+ `resolveWithin` 路径越界防护 + checkpoint 回滚兜底。若未来投入原生插件，
受限令牌 + AppContainer 二选一建议 AppContainer（表达力强、文档全）。

## 五、集成设计（B2 实现依据）

```
settings.sandbox: "off" | "auto"     # 默认 off；auto = 平台支持才启用（当前仅 macOS）
settings.sandboxAutoAllow: boolean   # 默认 false；开启后 execute 免弹窗（仅当沙箱实际生效）

packages/core/src/sandbox/
├─ types.ts      SandboxAdapter { wrapExec(cmd, args, {cwd}) → {cmd, args}; readonly active: boolean }
├─ seatbelt.ts   buildSeatbeltProfile({writePaths}) → SBPL 文本（纯函数）
│                createSeatbeltAdapter() → 运行时写 profile 临时文件 + 参数拼装
├─ index.ts      createSandboxAdapter(mode, platform = process.platform) → Adapter | undefined
```

- `createBuiltinTools({ sandbox })` 把 adapter 闭包进 bash 工具；read/grep/glob/write/edit/explore 不经沙箱
  （写类工具本就经 `resolveWithin` 限制在 cwd 内，且有审批）
- `AgentLoopDeps.sandbox` 不新增——沙箱属于工具实现细节，从 tools 装配注入，agent-loop 零改动
- 免审批在 sdk 装配层实现：沙箱 active 且 `sandboxAutoAllow` 时向 PermissionEngine 追加
  全量 execute allow 规则（`{type:"execute-prefix", value:""}`）
