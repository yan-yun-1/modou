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
- 布局：52px 高，`--bg1` 底 + 1px `--line` 底边；左：**印章标**（20×20 朱砂底、纸色「墨」字、2px 圆角）+ 词标「墨斗 MODOU」（mono 13px，`letter-spacing:.12em`）+ 状态灯（7px 圆点 + mono 12px「空闲/执行中」，running 态朱砂微脉冲）；右：会话触发器（§2.2）＋「＋ 新会话」次级按钮。主题切换钮进顶栏（2026-09-29 用户拍板，覆盖原“仅视觉稿”决策）：太阳/月亮 SVG 图标，点击覆写 html[data-theme] 并存 localStorage modou.theme，无覆写时跟随系统。
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

---

# v2 重设计 · 磷光屏 PHOSPHOR（2026-09-29 落地）

> 本节为 v2 实现章节，**覆盖 §1/§2/§4 中与之冲突的令牌值与组件视觉**；§3（会话面板信息架构）、§5（问题映射）与硬约束表继续有效。本轮依据：2026-09-29 只读调研二份（现状诊断 15 项问题 / 候选方向 3 案）。

## 6.0 方向拍板

三案（磷光屏 PHOSPHOR / 蓝图房 BLUEPRINT / 钨丝车间 TUNGSTEN）中**采用磷光屏 PHOSPHOR（阴极射线管终端）**。理由：

1. 与现有「纸墨」语言距离最远——诊断结论是「差点意思」而非「方向错了」的结构问题，但 v1 仅完成换配色级差异；换语言（纸→屏、暖墨→冷光）才能重立身份；
2. 开发者控制台语境天然契合终端隐喻，空状态/消息流/输入台都有现成的强结构语言（自检序列/log 行号/命令提示符），不是配色游戏；
3. 纯 CSS 变量整体换肤，零新增依赖即可落地（gsap 已在）；
4. 直接对症诊断清单：状态灯缺失→LED、空状态无引导→开机自检、消息流身份最弱→gutter 行号+磷光条、表面无深度→辉光+投影令牌化；
5. 热敏打印纸亮主题保留品牌的东方纸感连续性（亮=热敏纸、暗=磷光屏，一冷一暖同属「打印/输出」物性）。

风险对策（调研已列）：辉光只许强调元素（`--glow` 令牌，正文 0 使用）；扫描线 opacity .28（≤.35 防摩尔纹）且亮主题换成坐标网格纸；mono 栈显式声明中文回退（"Sarasa Mono SC"→"Noto Sans Mono CJK SC"→"Microsoft YaHei"）；「黑客风」区隔靠热敏纸亮主题+克制辉光。

## 6.1 主题模型与色板 v2

暗（默认）＝深夜机房绿黑屏；亮＝热敏打印纸。表面明度阶差拉开到可感（bg0 vs bg1/bg2/bg3 ≥1.9:1，v1 仅 1.05–1.23:1）。

| 令牌 | 磷光屏（暗，默认） | 热敏纸（亮） | 用途 |
|---|---|---|---|
| `--bg0..3` | `#060a08 / #0a120e / #0e1712 / #15221a` | `#f4f1e8 / #faf7ee / #fdfbf3 / #eae4d3` | 页面/顶栏/卡片/悬停 |
| `--sun` | `#030604` | `#efe8d6` | 代码/diff 凹陷底 |
| `--t1/t2/t3` | `#c9e6d5 / #8fb3a0 / #6f917f` | `#1d2b24 / #52685c / #54665c` | 主/次/meta 文字 |
| `--line/--line2` | `#1b2b22 / #2c4436` | `#d8d2bf / #bcb49c` | hairline/控件描边 |
| `--acc/--acc-h/--acc-bg` | `#58f0a6 / #7bf5b8 / rgba(88,240,166,.12)` | `#0d7a4f / #0a6440 / rgba(13,122,79,.10)` | P1 磷绿：执行/批准/焦点 |
| `--acc-bar`（新） | `rgba(88,240,166,.45)` | `#0d7a4f` | 助手消息磷光条（非文本 ≥3:1） |
| `--on-acc`（新） | `#04120b` | `#f7f4ea` | 朱/磷实底上的文字（取代硬编码 #fff） |
| `--on-err`（新） | `#1a0d0f` | `#fdf5f4` | 绛实底上的文字（批量删除钮） |
| `--err/--err-bg` | `#e07a72 / rgba(224,122,114,.10)` | `#9c3d3d / rgba(156,61,61,.08)` | 绛：错误面 |
| `--dadd/--ddel` | `#7fd49a / #e08a80` | `#276b3d / #a44f42` | 仅 diff 块 |
| `--code` | `#b8d9c6` | `#33463b` | 凹陷块内文字 |
| `--grid`（新） | `rgba(88,240,166,.05)` | `rgba(29,43,36,.055)` | 网格/点亮色 |
| `--hi`（新） | `rgba(255,255,255,.04)` | `rgba(255,255,255,.65)` | 内描高光（elevation 材质） |
| `--glow/--glow-soft`（新） | `0 0 10px rgba(88,240,166,.35) / 0 0 18px .14` | `none`（亮主题辉光全关） | 仅强调元素 |
| `--shadow-head/card/pop/panel/dock`（新） | 黑系投影族 | 暖灰系投影族 | 头部/卡片/浮标/面板/输入台 |
| `--ovl/--ovl-size/--ovl-o`（新） | 扫描线 repeating-gradient，`.28` | 坐标网格 24px，`1` | body::after 屏幕材质层 |
| `--halo`（新） | 顶部磷光 vignette | 顶部氧化绿 vignette | body 背景 |

主题机制不变（`:root` 暗默认 + `prefers-color-scheme` + `data-theme` 强制 + localStorage），亮色选择器改为 `:root:not([data-theme="dark"])` 消除 v1 的双写漂移。**hex/rgba 只许出现在令牌段与 head meta/favicon**（实测 grep：组件层 0 硬编码）。

对比度实测（node 脚本，WCAG 2.1）：双主题 13 组全 PASS——暗 t3/bg0 5.72、t3/bg2 5.25、t3/bg3 4.73、on-acc/acc 13.16、acc-bar/bg0 3.43；亮 t3/bg0 5.42、t3/bg2 5.91、t3/bg3 4.82（v1 的 t3 3.54:1 问题闭环）、on-acc/acc 4.88、acc-bar 4.75。

## 6.2 排版 v2

- **字重谱系（新）**：400 正文 · 500 按钮/chip/who/行号/LED · 600 wordmark/stamp/h2/boot 标题 · 700 印章/boot OK。v1 全站仅 2 处非默认字重的问题终结；
- **尺阶强制 4 档**：12/13/15/20（grep 实测 50 处仅此四值；v1 混入的 11px/14px 全部归位）；
- mono 隔离 body 字距：`pre, code, kbd, .mono, textarea, input { letter-spacing: normal }`（v1 逐字距等宽的排版错误修正）；`.who` 的 .08em 追踪为有意保留；
- `tabular-nums`：行号/LED 文案/用量条。

## 6.3 关键屏（§2 重写）

**空状态＝开机自检（签名屏 1）**：`.boot` 磷光输出块（左 2px 磷光条+卡片投影）内 5 行 mono 逐行 `steps(19)` 打字显现（`max-width 0→100%`，错峰 .3s），行尾点线 leader + 磷绿「OK」700 字重带辉光；`等待指令▍`（h2，20px/600，光标 1.1s steps 闪烁）；`cwd:` meta 行；下方 **3 张 prompt chips**（点击灌入命令台并聚焦）+ 目录输入行（保留 v1 功能）+ 提示行，全部 fadeOnly 错峰入场；reduced-motion 或动画关停时自然态全可见。会话内空态保留弹线 Snapline（令牌换肤自适应）。

**消息流＝log 条目（签名屏 2）**：每条消息包 `.ln-row`（grid 30px gutter + 内容）——gutter 行号 tabular-nums（用户消息=`$` 命令行式磷绿，其余 01 起）；用户=右对齐 bg3 气泡+卡片投影；助手=通栏 + 左缘 2px `--acc-bar` 磷光条；错误=绛条+err-bg；**受控 markdown 子集**（零依赖）：`split(/(`…`|\*\*…\*\*)/g)` 捕获组渲染行内代码/粗体（Preact 字符串天然转义）、``` 围栏代码块（`--sun` 凹陷+复制钮）、空行分段；流式增量仍纯文本防围栏闪烁；**复制钮** hover 显形（`(hover:none)` 常显 0.7）覆盖消息/代码块/工具输出，成功转磷绿 ✓1.2s。

**输入台＝命令栏（签名屏 3）**：`❯` 磷绿提示符（辉光）+ textarea（`resize:none` + JS 自动增高 ≤180px，v1 原生手柄移除）；`focus-within` 磷绿描边 + 3px 环 + 辉光 `dockGlow` 一次性脉冲；busy → disabled + 「取消本轮」ghost 钮（取消功能保留）；kbd 提示行随审批 pending 追加键位说明。

**顶栏＝状态栏（签名屏 4）**：印章（磷绿实底+辉光）+ 词标（600/.12em）+ **LED 状态灯**（空闲=暗点 .55 透明度；执行中=磷绿 + `--glow` + 2s 脉冲——§4.1⑥ 允许的语义循环之一，同类循环还有面板活跃点、流式光标、工具 pending ●、boot 光标），§2.1 缺失项补齐）+ mono 文案「空闲/执行中」（min-width 防抖动）；右侧主题切换（SVG，保留）+ 会话触发器 + 新会话。theme-color meta 随主题同步（initTheme/toggleTheme 各写一次，读当前生效 `--bg0`）。

## 6.4 交互与动效 v2（GSAP + CSS，规则沿用 §4.1）

| 项 | v2 实现 |
|---|---|
| 面板入场 | `panelIn` 死导入转正：`.panel-mount` 锚定层承担 y(-4→0)+fade（GSAP 0.2s），行 stagger .04（clearProps 收尾）；`.panel` 本体静态化避免 transform 劫持 containing block |
| 切会话入列 | items 子项 `y:12→0` 0.45s power3.out stagger .05（§4.2 首屏行兑现），reduced-motion 直显；**仅对视口内头部 20 条生效**——§4.1④ 长列表总则优先于 §4.2 行规格（数百条历史全量 stagger 是十几秒动画队列） |
| 滚动跟随 | v1 无条件置底改为**贴底跟随**（阈值 120px），上翻读历史不强拽；离底 >240px 露 sticky「回到底部」浮标（平滑回底，reduced 直跳） |
| 通知条 | `noticeIn` 下滑入 0.25s（§2.1 规格兑现）+ 整条可点 `cursor:pointer` |
| 审批应答 | `.approval { transition: opacity var(--t-slow) }`——v1 的瞬变修复，`--t-slow` 首次投产 |
| kbd 键帽 | 审批三键内嵌 `<kbd>1/2/3</kbd>` 实体键帽（`--bg3` 底+底边 2px 加重）；键盘绑定逻辑不变 |
| 工具卡 hover | `.tool-head:hover` bg3 反馈（v1 零 hover 修复）；pending ● 磷绿+辉光脉冲 |
| 收尾 | favicon（SVG data-URI 磷绿方点）+ `theme-color` + 自定义滚动条（webkit+scrollbar-color）+ font-smoothing/text-rendering |

## 6.5 验收清单（全部本轮实测）

| 硬约束/诊断项 | 验证 | 结果 |
|---|---|---|
| main.tsx ≤500 行 | `wc -l` | **498** ✓ |
| 除 reduced-motion 外 0 !important | `grep -n "!important" index.html` | 仅 `:144` 一行两处（豁免块）✓ |
| 0 硬编码 hex（组件层） | grep 行号对账 | hex 全在令牌段（17-28/54-63/80-89）与 head（6）✓；**组件层 rgba 同样清零**（`.btn.primary` 投影令牌化为 `--shadow-btn`，双主题各配暖/冷值）✓ |
| 图标禁 emoji | `grep -P "[\x{1F300}-\x{1FAFF}\x{FE0F}…]"` | 0 ✓（✓✕●▸▼▍❯⟲ 为等宽字形，§0 允许） |
| 尺阶 12/13/15/20 | `grep -o font-size` uniq | 仅四值 ✓ |
| 构建零依赖 | `node esbuild.mjs` | ✓（106.5kb，无新依赖） |
| 类型/测试 | `tsc --noEmit` + `vitest run` | ✓ / 11 passed |
| 深度（诊断#1/#2） | --shadow 5 档+--hi+--glow+--halo 投产 | 卡片/气泡/面板/输入台全部有投影与内描高光 ✓ |
| 白字令牌化（诊断#3） | --on-acc/--on-err | ✓ |
| 品牌温度断裂（诊断#4） | 暗色绿黑/亮色热敏纸同属输出物性 | ✓ |
| 字重/字阶/字距（诊断#5/#6/#10） | §6.2 | ✓ |
| 消息流结构（诊断#8） | gutter+markdown 子集+复制 | ✓（时间戳缺数据源：state.ts 未透传 `at`，待 server 契约，同 §3.3 处理） |
| 交互完成度（诊断#9） | 复制/回底/自动增高 | ✓ |
| hover 矩阵/kbd/状态灯/入场/通知（诊断#11-13） | §6.3/6.4 | ✓ |
| 收尾（诊断#14） | favicon/theme-color/滚动条/渲染调优 | ✓ |
| 功能保全 | 会话面板/审批三键+键盘/取消/主题切换/回放徽标/续跑重订阅 | 全保留（TSX 逻辑未删改，仅排版压缩） |

已知留白：语法高亮不做（零依赖政策）；每消息时间戳不做（无数据源）；亮主题辉光关闭为有意决策（热敏纸物性）。

## 6.6 复核修复（第二轮，2026-09-29）

复核提出 11 项，逐条修复与验证如下（验证命令均实际执行，见文末）：

| # | 复核发现 | 修复 | 位置 |
|---|---|---|---|
| 1 | 审批键盘缺 §2.6 replay 闸 | keydown 增加 `currentView?.replay` 早退（回放只读，1/2/3 不再向非活跃会话发回执），deps 同步加入 | main.tsx 审批键盘 effect |
| 2 | 键盘应答不触达卡片「已应答」态、无 e.repeat 守卫 | `answerApproval` 改为**乐观写入**：复用 state.ts `applyEventToView` 的 approval_result 分支（幂等）即时置 status——键盘与按钮路径同一立即反馈（章/绷直/状态行）；keydown 头部加 `e.repeat` 早退；SSE approval_result 回程对账 | main.tsx answerApproval |
| 3 | panel-mount 内联 ref 每次渲染重调 → 面板回弹 | 提取 `panelMountRef`（useCallback 空依赖固定身份），ref 不再随 App 重渲染 detach/attach | main.tsx |
| 4 | 切会话 stagger 套全量子项，长会话十几秒队列 | `Array.from(children).slice(0, 20)` 只动视口内头部 20 条；§6.4 表已注明 §4.1④ 优先 | main.tsx MessageList |
| 5 | `.btn.primary` 组件层硬编码 rgba | 令牌化 `--shadow-btn`（暗=黑系/亮=暖灰系），hover 叠加 `--glow-soft`；rgba 审计并入 §6.5 | index.html |
| 6 | Enter 不查 IME 组词 | 两条 Enter 路径（发送/目录新建）均加 `!e.isComposing && e.keyCode !== 229` | main.tsx dock/EmptyState |
| 7 | 用量条未做 k 缩写 | `kfmt()`：≥1000 取 1 位小数（§2.8），↑↓ 数字套用 | main.tsx |
| 8 | theme-color 固定暗色 | 单 meta + `syncThemeColor()`：initTheme 与 toggleTheme 各调一次，读当前生效 `--bg0` 写回（JS 应用无需双 meta；数据源为令牌，无 hex 进 TSX） | main.tsx + index.html head |
| 9 | tool-head 内联 style（§0 唯一例外） | 删除 style prop，改 `.tool.pending .tool-head { cursor: default }`；grep `style=` 全文件清零 | main.tsx / index.html |
| 10 | §6.3「全站唯一 CSS 循环」表述失实 | 已改写：LED 为 §4.1⑥ 语义循环**之一**，同类含面板活跃点/流式光标/工具 pending ●/boot 光标（实现无过错，纯文档修正） | DESIGN.md §6.3 |
| 11 | 复核未独立验证构建/测试与未逐行复核的模块 | 本轮补验：`node esbuild.mjs`（构建通过，dist 同步 server/webui 属预期产物）、`npx tsc --noEmit -p tsconfig.json`（通过）、`npx vitest run`（console 11/11）、`wc -l src/main.tsx` ≤500、grep rgba/style=/hex/字号审计；§2.2 触发器 24 字截断经读 `SessionPanel.tsx:202-207`（`triggerLabel` 截 24 字加 …、空预览回退 id 前 8 位）确认在场；motion.ts 三函数 reduced-motion 早退、SessionPanel Esc/外点关闭/↑↓/Enter、state.ts SessionSummary 单一来源 re-export 复读确认在场 | 全部三文件 + 只读复核 |

main.tsx 行数在修复后复核仍 ≤500（见 §6.5 验收）。

