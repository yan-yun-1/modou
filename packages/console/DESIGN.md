# 墨斗 Web 控制台 · 视觉重设计规格（DESIGN.md）

依据：2026-09-28 只读调研（packages/console 现状）+ 设计语言约定（墨为底/朱砂强调/弹线母题）。
配套视觉稿：`./design-mockup.html`（自包含静态稿，与本规格逐节对应）。实现阶段动效走 GSAP（§4）。

## 0 硬约束 → 决策

| 约束（出处） | 决策 |
|---|---|
| Preact 10.25 + esbuild iife（`package.json:11-13`、`esbuild.mjs:13-24`） | 不动框架与构建形态；重设计 = index.html 样式层重写 + main.tsx 结构微调 |
| esbuild 无 CSS 管线（`esbuild.mjs:27` 仅 copyFileSync index.html） | 样式唯一落点仍是 index.html `<style>`，按 **令牌/基础/组件** 三段注释分层（上限约 350 行）；**不**新增 CSS 构建步骤 |
| 单文件 <500 行倾向（main.tsx 349 行实测） | 零内联样式进 TSX；新会话面板独立 `SessionPanel.tsx`（约 120 行） |
| 中文界面（`index.html:2`） | 文案全中文；数字/命令/时间/id 一律等宽字体 |
| 零/少依赖（`package.json:12` 仅 preact） | 图标一律内联 SVG 或等宽字形，**禁 emoji 装饰**（现 ⏳⚙🔐✅🚫⏹📖 全替换）；动效实现阶段唯一新依赖为 GSAP |
| 暗色靠 4 条 `!important`（`index.html:13-16`） | `data-theme` 属性 + CSS 变量双主题；`prefers-color-scheme` 定默认、切换钮覆写；**0 个硬编码 hex；除 prefers-reduced-motion 降级（a11y 豁免）外 0 条 !important** |
| server /sessions 无时间戳（`packages/server/src/server.ts:271-284`） | 前端先按 §3.3 回退规则落地；`updatedAt` 为服务端待办（本设计轮不阻塞） |

## 1 设计令牌

### 1.1 主题模型
「墨」为底：近黑浓墨做主底，以墨灰多级（非多色相）建立层级——开发工具天然暗色，**暗色为默认主题**。强调色只留一个尖锐色：**朱砂**，专属「动锯 = 执行 / 批准」语义；**绛**（冷调暗红）仅用于错误面，与朱砂分离；**拒绝**用中性描边（不动锯 = 收刀，不用红色）。hairline 细线为全站母题（边框、分隔、标尺感）。

### 1.2 色板（CSS 变量，亮暗各一组）

| 令牌 | 墨（暗，默认） | 宣纸（亮） | 用途 |
|---|---|---|---|
| `--bg0` | `#101113` | `#f2f0e9` | 页面底 |
| `--bg1` | `#16171a` | `#faf9f3` | 顶栏/面板/输入框底 |
| `--bg2` | `#1b1d21` | `#fffffd` | 卡片底 |
| `--bg3` | `#23252b` | `#eceade` | 悬停/用户消息底 |
| `--sun` | `#0b0c0f` | `#1b1c20` | 代码/diff 凹陷底 |
| `--t1` | `#e8e6df` | `#27251e` | 主文字 |
| `--t2` | `#a3a198` | `#6a685d` | 次级文字 |
| `--t3` | `#6d6b64` | `#999789` | 弱化/meta |
| `--line` | `#282a30` | `#dbd7c9` | hairline |
| `--line2` | `#3a3d45` | `#c2beae` | 强线/控件描边 |
| `--acc` | `#e0532f` | `#b93d1c` | 朱砂：执行/批准/焦点 |
| `--acc-h` | `#f0653f` | `#9d3113` | 朱砂 hover |
| `--acc-bg` | `rgba(224,83,47,.13)` | `rgba(185,61,28,.10)` | 朱砂浅底/focus 环 |
| `--err` | `#cf5b66` | `#a63a45` | 绛：错误文字/左边线 |
| `--err-bg` | `rgba(207,91,102,.10)` | `rgba(166,58,69,.08)` | 错误底 |
| `--dadd` / `--ddel` | `#7fa477` / `#b96c6c` | `#3d7a45` / `#a44f4f` | **仅限 diff 块** |
| `--code` | `#d3d1ca` | `#d3d1ca` | 凹陷块内文字 |

主题切换：`:root`（暗默认）+ `@media (prefers-color-scheme: light)` 覆写 + `[data-theme=light/dark]` 强制覆写；JS 切换只改 `html[data-theme]` 并存 localStorage `modou.theme`。除 prefers-reduced-motion 降级块（a11y 豁免）外 0 条 `!important`。

### 1.3 字体
- 等宽（视觉性格承担者）：`"Cascadia Code","JetBrains Mono","Sarasa Mono SC",ui-monospace,"SF Mono",Consolas,"Courier New",monospace`
- 中文正文（零依赖约束下只能系统栈）：`"Source Han Sans SC","Noto Sans CJK SC","PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif`
- 尺阶仅 4 档：`12`（meta/mono 小字）、`13`（mono/工具/命令）、`15`（正文，中文底线 ≥15px）、`20`（空状态标题）
- 正文行高 ≥1.7、`letter-spacing: .02em`（web-design SKILL.md:357-361）；数字/成本用 `font-variant-numeric: tabular-nums`（账单可对齐可核对）

### 1.4 间距 / 圆角 / 焦点
- 4px 栅格：`--s1:4 --s2:8 --s3:12 --s4:16 --s5:24 --s6:32`
- 圆角：`--r0:0`（卡片/面板直角，直线切割）、`--r1:2px`（按钮/输入）；状态点全圆
- 焦点：`:focus-visible` → `box-shadow: 0 0 0 3px var(--acc-bg)` + 描边转 `--acc`
- 过渡：`--t-fast:.15s --t-med:.25s --t-slow:.45s`，缓动 `cubic-bezier(.2,.8,.2,1)`（power2.out 近似）

### 1.5 状态纪律
每个可交互元素补齐 default/hover/active/disabled/focus-visible；禁裸 `outline: none`。

## 2 组件规格

### 2.1 顶栏 Header（映射 `main.tsx:263-284`，替换 `.spacer`/`h1`/原生 select）
- 布局：52px 高，`--bg1` 底 + 1px `--line` 底边；左：**印章标**（20×20 朱砂底、纸色「墨」字、2px 圆角）+ 词标「墨斗 MODOU」（mono 13px，`letter-spacing:.12em`）+ 状态灯（7px 圆点 + mono 12px「空闲/执行中」，running 态朱砂微脉冲）；右：会话触发器（§2.2）＋「＋ 新会话」次级按钮。主题切换钮仅视觉稿阶段，实现版不进顶栏。
- 状态：执行中 → 状态灯朱砂脉冲 + 词标旁文本切换；通知条（`main.tsx:285-289`）改为顶栏下滑出的通栏细条，`--acc-bg` 底、可点击关闭。

### 2.2 会话选择器（替换 `main.tsx:266-280` 原生 select）→ 详见 §3
触发器：顶栏右侧「＋ 新会话」左边，mono 文本显示当前会话预览（截 24 字）+ 活跃点 + ▾，1px 描边控件态（hover 加深）。面板锚定触发器（右缘对齐、顶边下 8px）、无遮罩、点击外部关闭；**视觉稿以全屏遮罩+居中弹层呈现仅为静态稿便利，实现版按此锚定**。

### 2.3 空状态（替换 `main.tsx:294-302` 及列表内空态 `main.tsx:99`）
- 布局：垂直居中卡片（无边框，直角），自上而下：**弹线 SVG**（两端锚点 + 虚线淡入、随后朱砂实线 `scaleX 0→1` 绷直，一次性动画）、标题 20px「没有进行中的会话」、副文 15px「把任务交给墨斗——先弹线，后动锯。」、目录输入框（260px）＋「＋ 新会话」朱砂按钮同行、mono 12px 提示「Enter 新建 · 或从会话面板选择历史会话」。
- 状态：输入有值 → 按钮转朱砂实底；无值 → 描边态。回放徽标（`main.tsx:97`）改 mono 12px「⟲ 只读回放」细字居中，非卡片。

### 2.4 消息（`main.tsx:100-109`：user/assistant/error/streaming）
- 用户：右对齐，max-width 78%，`--bg3` 底 + 1px `--line`，2px 圆角；上方 mono 11px「你」右对齐。
- 助手：通栏无底色，左侧 2px `--line2` 竖线 + 左内距 14px；上方 mono 11px「墨斗」。
- 错误：`--err-bg` 底 + 左 2px `--err` 边线，mono 12px「✕」前缀，正文 t1（绛与朱砂不同面，互不混淆）。
- 流式：助手样式 + 行尾朱砂「▍」光标（`steps` 闪烁，仅 streaming 存在时渲染）。

### 2.5 工具卡 ToolItem（`main.tsx:27-40`，类 tool/tool-head/hint/tool-detail）
- 布局：1px `--line` 边框直角卡，头行 mono 13px：状态位（pending=朱砂「●」脉冲 / done=t2「✓」）+ 工具名 chip（mono 11px、1px 描边）+ 命令文本（t1）+ 右侧 ▸。体部：`--sun` 凹陷块、mono 13px、`--code` 文字、左 2px `--line` 边线。
- 状态：pending（不可展开）/ done（可展开，`grid-template-rows 0fr→1fr` 过渡）/ 展开时 ▾ 旋转 90°。删除 `.hint` 孤儿类的侥幸渲染，箭头是真样式。
- 实现注意：grid-rows 过渡要求体部**常渲染**——`main.tsx:37` 的 `{open && item.output !== undefined && …}` 条件渲染改为常渲染 + `.open` class 切换（output 未到时隐藏内容）。


### 2.6 审批卡三键 ApprovalItem（`main.tsx:42-78`，孤儿类 approval-title/approval-reason 一并转正）
- 布局：1px `--line2` 直角卡 + **顶部 2px 弹线条**（虚线 = `repeating-linear-gradient(90deg, var(--acc) 0 6px, transparent 6px 10px)`，其上叠一条同尺寸实线 `scaleX(0)`、`transform-origin:left`）；头行：「待批」章（朱砂底纸字 mono 11px）+ 工具名 mono + 原因（t2，15px）；diff 块同 §2.5 体部，`+` 行 `--dadd`、`-` 行 `--ddel`、`@@/---` 行 t3；按钮行：**拒绝**（中性 1px `--line2` 描边、t2，kbd 1）· **允许**（朱砂描边、hover 实底，kbd 2）· **总是允许**（朱砂实底 = 盖章，kbd 3）——键位按视觉顺序左→右对应 1/2/3。
- 状态：pending → 已应答（按钮区淡出，状态行「✓ 已允许 · 回执已发送」/「✕ 已拒绝」淡入；顶部实线 **scaleX 0→1 绷直**——允许时朱砂、拒绝时 `--line2` 灰，卡片整体降至 .68 不透明度）；replay 模式 `disabled` 全钮（`main.tsx:55`）。
- 键盘绑定（新增交互，`main.tsx` 现无任何审批快捷键）：ApprovalItem 在 `status==="pending"` 且非 replay 时挂 `window` keydown、应答或卸载即移除；键位→动作：1=拒绝、2=允许、3=总是允许；`e.target` 为 textarea/input 等表单控件时不触发（输入数字不误批）；多张 pending 并存时仅响应最早一张（同轮业务上至多一张）。

### 2.7 输入条（`main.tsx:305-322`，含取消 `main.tsx:110-114`）
- 布局：max-width 860 同主列；外框 1px `--line2` 直角、`--bg1` 底，内含无边框 textarea（15px/1.7）+ 底行：mono 11px 提示「Enter 发送 · Shift+Enter 换行」+ 朱砂发送按钮（内联 SVG 箭头，非文字符号）。
- 状态：`focus-within` → 框描边转 `--acc` + 3px `--acc-bg` 环；busy → textarea disabled、发送钮转「取消本轮」ghost 描边钮（`main.tsx:111` 的 cancel-row 取消按钮并入此处，不再悬在消息流尾部）。

### 2.8 用量条（`main.tsx:323-327`）
- 布局：输入框下方右对齐单行 mono 12px：`↑ 12.4k  ↓ 3.1k  ·  $0.0842`，箭头 t3、数字 t1 `tabular-nums`、成本 t2；上方 1px `--line` hairline 分隔。k 缩写规则：≥1000 取 1 位小数。

### 2.9 附：令牌门（`main.tsx:119-141`）
居中 420px 直角卡：mono「⌘ 需要访问令牌」标题 + 说明 + 密码输入（`--bg1` 底）+ 朱砂按钮；输入框 focus 态同 §2.7。

## 3 会话选择器信息架构（彻底消灭裸 session-id 刷屏）

### 3.1 结构
顶栏触发器 → 下拉面板（宽 420px，直角、1px `--line2`、投影；实现版锚定触发器——右缘对齐、顶边下 8px、无遮罩，视觉稿全屏遮罩+居中仅为静态稿便利）：`筛选输入` → **分组列表**「进行中」（活跃会话置顶、朱砂脉冲点）与「历史」→ 底部 mono 11px 键位条「↑↓ 选择 · Enter 打开 · Esc 关闭」。行内不再出现完整裸 id。

### 3.2 行规格（两行制）
- 第一行：预览文本（15px t1，单行省略）+ 右侧活跃点（仅活跃会话）；
- 第二行 mono 12px t3：`相对时间 · id 前 8 位`（如 `3 分钟前 · 9f2c41ab`）。
- 当前会话行：左缘 2px 朱砂内嵌条 + `--bg2` 底；hover `--bg3`。

### 3.3 裸 id 与缺时间回退规则
1. `preview` 为空 → 显示「空会话」，id 前缀升为第一行主体（mono t2）——id 永不与预览混排刷屏；
2. server 未提供 `updatedAt`（已核验：`server.ts:271-284` 响应仅 `{sessionId, active, preview}` 三字段）→ 时间位显示「—」，仅 id 前缀；server 增字段后自动切相对时间（刚刚 / n 分钟前 / n 小时前 / 昨天 HH:mm / MM-DD）；
3. 预览截断由 server 端完成——`server.ts:278` `user.text.slice(0, 60)`，前端只做单行省略；损坏会话占位「（会话文件损坏，无法预览）」（`server.ts:280`）原样透传；活跃判定沿用 `active`（`client.ts:36`）。

### 3.4 键盘与交互
面板内 ↑↓ 移动、Enter 打开、Esc 关闭、输入即过滤（preview 与 id 前缀双匹配）；点击外部关闭。开合动效见 §4。

### 3.5 数据契约变更（实现阶段）
`SessionSummary` 以 `client.ts:33-37` 为**单一来源**，`state.ts:8-12` 改为 `export type { SessionSummary } from "./client.js"`（消除双份定义漂移）；新增可选字段 `updatedAt?: number`，由 server 端 `/sessions` 补齐（服务端改动另立任务，不在本设计轮）。

## 4 动效规格（实现阶段用 GSAP；本视觉稿以 CSS transition 等价演示）

### 4.1 总则（调研 motion 规则）
① 只动 transform 别名（x/y/scale）+ opacity/autoAlpha，禁 width/height/top/left（gsap SKILL.md:184,229）；② 微交互 0.15–0.25s、入场/面板 0.4–0.6s，默认 power2.out、入场 power3.out（gsap SKILL.md:87）；③ 列表 stagger（0.04–0.06s）、编排用 timeline（:207,139-141）；④ 长列表离屏 pause/kill，will-change 只给真动的元素（:211,189-192）；⑤ `gsap.matchMedia` 接 `prefers-reduced-motion` → duration 0（:107-121）；⑥ 禁无限 repeat（:234）——唯一例外是状态灯/流式光标的 **CSS** 语义脉冲（≤2s、仅 opacity）。

### 4.2 清单

| 元素 | 触发 | 规格 | 实现 |
|---|---|---|---|
| 首屏/切会话入列 | 挂载 | 子项 fadeUp 12px，0.45s power3.out，stagger .05 | GSAP timeline |
| 新消息入列 | items 增 | fadeUp 10px，0.25s power2.out | CSS class 或 GSAP |
| 流式光标 | streaming≠null | 「▍」opacity 闪烁 1.1s steps（仅存在期间） | CSS |
| **弹线绷直（签名时刻）** | 审批应答 | 顶栏实线 scaleX 0→1，0.45s power3.out，origin left；拒绝态转灰 | GSAP（SKILL.md:19 scaleX reveal 即此例） |
| 审批卡出现 | approval_request | fadeUp 12px + 卡描边 0.2s 渐显 | GSAP |
| 状态灯 idle→running | busy 翻转 | 颜色切换 0.15s + CSS 脉冲 2s（唯一循环） | CSS |
| 工具卡展开 | 点击 | grid-template-rows 0fr→1fr，0.25s | CSS |
| 会话面板开合 | 触发器 | opacity + y(-4→0)，0.2s power2.out；行 stagger .04 | GSAP |
| 按钮按压 | :active | translateY(1px)，0.1s | CSS |
| token 计数跳变 | usage 事件 | 数字直更 + scale 1.06→1，0.2s（可省） | GSAP |
| 主题切换 | 切换钮 | **不用 GSAP**（颜色非 transform）；实现优先 View Transitions API，退化为直切 | CSS/API |

### 4.3 不做
自定义光标、常驻背景循环、滚动文字、动元素上的 blur、backdrop-filter>14px（现状顶栏 blur(4px) 在限内，改为不透明 `--bg1` 后移除）（web-design SKILL.md:222-228）。

## 5 现状问题 → 设计动作映射

| # | 现状问题（出处） | 设计动作 | 落点 |
|---|---|---|---|
| 1 | 头部纯文字+原生 select+灰按钮，无品牌锚点（`main.tsx:263-284`） | 印章标+词标+状态灯+触发器 | §2.1/2.2 |
| 2 | 空状态一行灰字+孤输入框（`main.tsx:294-302`、`:99`） | 弹线 SVG 卡片式空状态，目录输入+主行动钮 | §2.3 |
| 3 | 会话下拉裸 id 与预览混排、无时间无分组（`main.tsx:274-279`） | 下拉面板两行制+分组+活跃点，id 只留 8 位前缀 | §3 |
| 4 | 数据层无时间戳（`client.ts:33-37`、`state.ts:8-12`、`server.ts:271-284`） | 可选 `updatedAt` 契约 + 「—」回退规则；server 增字段另立任务 | §3.3/3.5 |
| 5 | 输入条通栏默认样式、无聚焦层次（`index.html:43-47`） | 框式输入台：focus 环+朱砂描边，取消钮并入 | §2.7 |
| 6 | 0 个 CSS 变量、hex 硬编码、`!important` 暗色链（`index.html:10,13-16,24,54`） | 全变量双主题、0 !important、0 硬编码 hex | §1 |
| 7 | 字号五档即兴 16/14/13/12.5/12px（`index.html:20,24,35,37,47,53`） | 4 档尺阶 12/13/15/20 | §1.3 |
| 8 | 默认蓝 `#2563eb` 语义不明（`index.html:24,54`） | 朱砂专属「执行/批准」；拒绝转中性描边；错误转绛 | §1.1/2.6 |
| 9 | 样式全内联无分层、esbuild 无 CSS 管线（`esbuild.mjs:27`） | index.html `<style>` 三段分层（令牌/基础/组件），不加构建步骤 | §0 |
| 10 | 孤儿类 `.hint/.approval-title/.approval-reason/.cancel-row` 无样式（`main.tsx:35,58,59,111`） | 全部纳入组件规格，有真样式定义 | §2.5/2.6/2.7 |
| 11 | 死样式 `.tabs/.tab/.tab.current`（`index.html:52-54`，main.tsx 零引用） | 删除，不留对应物 | 本稿无 |
| 12 | `SessionSummary` 双份定义易漂移（`client.ts:33-37` vs `state.ts:8-12`） | client.ts 单一来源，state.ts re-export | §3.5 |
| 13 | 图标全 emoji（⏳⚙🔐✅🚫⏹📖） | 内联 SVG/等宽字形替换 | §2 全部 |
| 14 | 工具输出 12.5px 偏小（`index.html:37,40`） | mono 13px 统一 | §1.3 |
