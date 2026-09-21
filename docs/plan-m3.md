# 实现计划：M3「公开发布」（对应 PRD 里程碑 M3，第 7–8 周）

> 关联：[docs/PRD.md](./PRD.md)、[docs/plan-m2.md](./plan-m2.md)（M2 已完成，v0.3.0-alpha）、[docs/backlog-m3.md](./backlog-m3.md)
> 更名决议（2026-09-21）：产品名定为**墨斗 Modou**，R0 批次先行执行更名，其余任务以 modou 命名实施。
> 前置：M2 已验收（MCP stdio 真实接入、/plan 闭环、explore 子代理、eval 10/13 达基线）。
> 范围声明：本计划覆盖 PRD M3 主线——**发布准备（LICENSE/包名/npm）+ Skills 最小实现 + eval harness 收尾 + 发布动作**，并顺手清偿 backlog-m3 中低成本的评测/工程债项。LSP 上下文、OS 级沙箱落地、ACP 兼容不在本计划（PRD 将其排在 M4：`docs/PRD.md` 路线图 M4 = server 包 + ACP + Skills/hooks/LSP + 沙箱增强），其中 Skills 因成本低且是"可迁移"卖点，按 backlog-m3 决策**提前并入 M3**。

## 与 PRD 路线图的一致性说明

PRD M3 验收标准为「自建评测通过率基线建立且不回退；从安装到完成任务 < 5 分钟」。前者 M2 已建立基线（10/13），本计划用 JSON 报告把"不回退"变为可机械判定；后者要求 npm 全局安装可用——本计划用 `npm pack` 产物 + 全新目录安装实测。

## 发布命名决策（2026-09-21 用户确认：产品更名「墨斗 Modou」）

- 原决策「用 `@luban-dev/*` scope 包」作废：用户选择换产品名争取 npm 裸名。实时核查 `modou`（npm 裸名与 scope 均未被占）可注册，已定名。
- **产品名：墨斗 / Modou**——墨斗弹线定直，与木匠规矩「先弹线，后动锯」对应 Plan Mode（先计划 → 确认 → 再执行），传承原鲁班木工叙事。
- npm 包：`modou`（CLI）、`@modou/core`（引擎）；bin 命令：`modou`（`luban` 作为兼容别名保留一个版本周期）。
- 用户目录：`~/.luban/` → `~/.modou/`，首版启动时**自动探测迁移**（旧目录存在且新目录不存在 → 整体改名复制，不删除旧目录）；`LUBAN_API_KEY` 环境变量同步改 `MODOU_API_KEY`（旧名保留读取一个周期）。
- 内部标识同步：git 影子引用 `refs/luban/…` → `refs/modou/…`（列快照同时扫两个前缀，旧快照仍可回滚）；事件类型名 `LubanEvent` → `ModouEvent`（core 导出两个名字一个周期，避免下游断裂）；MCP CLIENT_INFO name → `modou`。
- GitHub 仓库名：`modou`。域名候选 `modou.sh`（未建站，发布前注册）。
- 许可证：Apache-2.0（PRD 已定）。
- 版本：`v0.4.0-alpha`（本里程碑 tag；npm 正式 0.1.0 发布放到真实仓库就绪后）。

## 执行纪律（与 M0–M2 相同）

TDD 红绿循环、一任务一提交、偏离计划即停、每 3–5 个任务人工检查点。总量约 30–38 净工时（×3 缓冲 ≈ 1.5 周全职）。测试模型统一 GLM glm-4.5-air。

## 契约增补预告（实现时回写本文件）

0. **更名（R0 决策）**：包名 `modou` / `@modou/core`、bin `modou`（luban 别名一个周期）、目录 `~/.modou/`（自动迁移）、env `MODOU_API_KEY`、refs `refs/modou/`（双前缀兼容读）、导出 `ModouEvent`（=旧 LubanEvent 别名保留）、子会话前缀 `sub-` 不变、eval 沙箱前缀 `modou-eval-`。
1. 新增命令：`luban --init`（无头生成 AGENTS.md 模板）与 TUI `/init`。
2. settings.json 新增 `cwd?: string`（项目目录覆盖，默认 process.cwd()）。
3. `Tool` 接口新增可选 `skill?: string`（标注来源 Skill，/skills 与调试用）。
4. `parseCommand` 增加 `/init`、`/skills`。
5. eval 输出新增 `eval-report.json`（结构化报告，含与上次基线的对比）。

---

## 任务列表

### Phase A：AGENTS.md 引导与配置补全（backlog-m3 #5 姊妹项、#12 的 cwd 面）

#### 任务 A1：`--init` 生成 AGENTS.md 模板
- 文件：`/packages/cli/src/init.ts`（新）、`/packages/cli/src/program.ts`（改）、`/packages/cli/test/init.test.ts`（新）
- 描述：`luban --init [dir]`——在目录写一份 AGENTS.md 模板（项目概述/构建与测试命令/代码风格三节，含引导注释）；已存在时不覆盖、提示路径。同时提供 TUI `/init` 复用同一函数。这是"从安装到完成任务 < 5 分钟"的关键一步：新用户先 `/init` 让 agent 记住项目约定。（实现时命令与提示文案统一用 `modou` 命名。）
- 验证：空目录生成合法模板；二次运行不覆盖；TUI 命令可用。
- 依赖：无。预计：60 分钟

#### 任务 A2：settings 支持 `cwd` 项目目录
- 文件：`/packages/cli/src/settings.ts`（改，契约增补 2）、`/packages/cli/src/loop-factory.ts`（改，settings.cwd 优先于 process.cwd()）、测试（改）
- 描述：用户在 settings.json 配 `cwd` 后，所有工具解析与 AGENTS.md/repo-map 加载以该目录为根（原为硬绑 process.cwd()）；目录不存在时报可读错误并回退 process.cwd()。
- 验证：fixture settings 指向临时目录，工具在该目录生效；坏路径回退不崩溃。
- 依赖：无。预计：45 分钟

### Phase B：评测质量与 harness 收尾（backlog-m3 #6/#11，PRD"基线不回退"的机械化）

#### 任务 B1：eval 用例修复
- 文件：`/scripts/eval.mts`（改）
- 描述：`grep-count-batch` 断言具体数字（沙箱 fixture 固定函数个数）；`multi-step-fix-test` 提示补"先 read 再 edit"步骤提示；顺带给 `edit-fix-typo` 也补一步提示（模型偶发不调工具）。
- 验证：真实 glm-4.5-air 连跑 3 轮，3 用例通过率 ≥ 2/3；总基线不低于 10/13。
- 依赖：无。预计：60 分钟（含等待真实模型）

#### 任务 B2：eval JSON 报告
- 文件：`/scripts/eval.mts`（改，契约增补 5）、`/scripts/eval-report.mjs`（新，读报告输出对比表）、`/docs/dev.md`（改）
- 描述：评测结束写 `eval-results/eval-report.json`（时间、模型、每用例耗时/结果、基线）；与上一份报告 diff 出"新增通过/新增失败/回退"清单，退出码在回退时非 0（可当 CI 门禁）。
- 验证：跑两次生成两份报告；人为注入一次失败后对比脚本正确标红回退项。
- 依赖：B1。预计：75 分钟

### Phase C：backlog 工程债清偿（小改动，趁手清掉）

#### 任务 C1：edit 空参数 ACI 降级（backlog-m3 #5）
- 文件：`/packages/core/src/tools/edit.ts`（改）、`/packages/core/test/tools-edit.test.ts`（改）
- 描述：`old_text` 为空/缺失时，错误信息附上文件前 40 行内容摘要与"使用 read 先查看文件"引导；`file_path` 缺失同理提示参数清单。
- 验证：TDD——空参数调用返回的错误包含文件内容片段；带不存在路径的错误列出参数清单。
- 依赖：无。预计：45 分钟

#### 任务 C2：审批排队 UI 显示队列数（backlog-m3 #9）
- 文件：`/packages/cli/src/approval-bridge.ts`（改：暴露 pendingCount）、`/packages/cli/src/components/ApprovalPrompt.tsx`（改）、测试（改）
- 描述：审批卡片标题显示"审批 #N（队列中还有 M 个）"；队列为 1 时维持原样不显摆。
- 验证：夹具模拟 2 个待审批请求，卡片出现队列计数；解决一个后计数递减。
- 依赖：无。预计：45 分钟

#### 任务 C3：subagent parentSessionId 接真实会话（backlog-m3 #10）
- 文件：`/packages/core/src/tools/registry.ts`（改：ToolContext 增加 sessionId）、`/packages/core/src/subagent.ts`（改）、`/packages/core/src/tools/explore.ts`（改）、`/packages/core/src/agent-loop.ts`（改：执行时传入）、测试（改）
- 描述：ToolContext 增加 `sessionId`，agent-loop 执行工具时传入；explore/subagent 会话 id 变为 `sub-<真实parent>-<name>-<rand>`，主会话 `/sessions` 里父子关系可读。
- 验证：TDD——mock 工具收到正确 sessionId；explore 产生的子会话 id 前缀含父会话 id。
- 依赖：无。预计：45 分钟

### Phase D：Skills 最小实现（backlog-m3 #1，PRD F15 提前项）

#### 任务 D1：SKILL.md 解析与发现
- 文件：`/packages/core/src/skills.ts`（新）、`/packages/core/test/skills.test.ts`（新）
- 描述：`loadSkills({ cwd, home })` 扫描 `.luban/skills/*/SKILL.md` 与 `~/.luban/skills/*/SKILL.md`（项目覆盖全局同名）；解析 YAML frontmatter（name/description，白名单键）+ 正文，frontmatter 非法跳过并警告。格式对齐 Anthropic 开放 Skills 标准（`name`、`description` 必填，正文为指令）。
- 验证：TDD——合法 skill 解析出 name/description/body；全局与项目重名取项目；坏 frontmatter 跳过不崩溃。
- 依赖：无。预计：60 分钟

#### 任务 D2：Skills 注入系统提示词 + /skills 命令
- 文件：`/packages/core/src/prompt.ts`（改：可用 skill 清单 + 触发条件注入）、`/packages/cli/src/loop-factory.ts`（改：loadSkills 接入装配）、`/packages/cli/src/commands.ts`（改，契约增补 4）、测试（改）
- 描述：系统提示词追加一节"可用 Skills"（name/description/触发时机），指示模型在匹配任务时用 `read` 自行读取 SKILL.md 正文（渐进披露，不预载全文）；`/skills` 列出已发现能力包与来源（global/project）。
- 验证：fixture skill 存在时系统提示词含其 name/description；/skills 输出清单；无 skills 目录时提示词无该节。
- 依赖：D1。预计：60 分钟

#### 任务 D3：Skills 端到端验证
- 文件：`/scripts/eval.mts`（改：新增 skill 提示词遵循用例）、`/docs/dev.md`（改：Skills 编写指南）
- 描述：沙箱预置 `.luban/skills/commit-style/SKILL.md`（定义提交信息格式），评测"按项目的 commit 规范写提交信息"类任务，断言输出遵循格式。
- 验证：新 eval 用例通过（glm-4.5-air）；文档含可复制的 SKILL.md 示例。
- 依赖：D2、B2。预计：60 分钟

### Phase E：发布准备

#### 任务 E1：LICENSE 与包元数据
- 文件：`/LICENSE`（新，Apache-2.0）、`/package.json` 与 `/packages/*/package.json`（改：license 字段、repository、description、engines）
- 描述：Apache-2.0 全文 + 各包 license/repository/keywords 元数据补齐；版本统一 0.4.0-alpha。
- 验证：`npm pack --dry-run` 各包无 license 警告；`pnpm build && pnpm test` 绿。
- 依赖：无。预计：30 分钟

#### 任务 E2：README 面向用户重写
- 文件：`/README.md`（改）、`/docs/quickstart.md`（新）
- 描述：README 重写为产品页结构（是什么/30 秒上手/核心特性/与同类对比表）；`docs/quickstart.md` 从安装到第一个任务的完整路径（含 `--init`）。现有开发向内容移入 `docs/dev.md`。
- 验证：quickstart 步骤在干净目录按序执行全部成功。
- 依赖：A1、E1。预计：90 分钟

#### 任务 E3：npm 发布演练（不发真实包）
- 文件：`/docs/dev.md`（改：发布手册一节）
- 描述：`npm pack` 三包产物；在全新临时目录 `npm i -g <tgz>` 实测 `luban --version`、`luban --init`、`luban -p "1+1"`；记录发布手册（`npm publish --access public` 步骤、.npmignore/files 字段核对）。
- 验证：tgz 全局安装后三条命令全部可用；发布手册成文。
- 依赖：E1。预计：60 分钟

### Phase F：Dogfooding 与验收

#### 任务 F1：真实 dogfooding 半日
- 文件：`/docs/dogfood-m3.md`（新，摩擦点记录）
- 描述：用 `luban` 本体完成 ≥ 3 个真实日常任务（修 bug、写小功能、整理文档），记录摩擦点清单（M4 输入）。
- 验证：摩擦点清单落盘；阻塞性 bug 当场修复或入 backlog。
- 依赖：E2。预计：240 分钟

#### 任务 F2：PRD 验收核对与发布
- 文件：`/docs/plan-m3.md`（改：验收记录）
- 描述：逐条核对 PRD M3 验收——① eval 基线建立且不回退（B2 的报告对比机制证明）；② 从安装到完成任务 < 5 分钟（E3 实测计时）；修复验收暴露的问题；打 tag `v0.4.0-alpha`。
- 验证：验收记录写明每条证据与数据；tag 完成。
- 依赖：F1、B2、E3。预计：60 分钟

---

## 依赖关系与执行顺序

```
A1 ──┬── E2
A2   │
B1 ── B2 ──┬── D3 ── F1 ── F2
C1/C2/C3（并行小任务）
D1 ── D2 ──┘
E1 ──┬── E2
     └── E3
```

建议批次：①A1+A2+C1（一次检查点）→ ②C2+C3+B1+B2（一次检查点）→ ③D1+D2+D3（一次检查点）→ ④E1+E2+E3（一次检查点）→ ⑤F1+F2（发布）。

## 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| eval 修复后真实模型波动导致基线回退 | 中 | B1 验收即"连跑 3 轮 ≥ 2/3"；回退则先修用例质量再谈基线 |
| npm 包名冲突/被抢注 | 低 | 已定名 `modou`（2026-09-21 实时核查 npm 裸名与 scope 均可注册）；GitHub 仓库名 `modou` 无冲突 |
| Skills 渐进披露在 glm-4.5-air 上遵循度不足 | 中 | D3 用例允许 3 轮重试；失败则降级为整段注入（token 换可靠性），记录到 backlog |
| 全局安装产物缺文件（bin/dist 遗漏） | 中 | E3 用 `npm pack --dry-run` + 真实 tgz 安装双验证 |

## 明确不做（本计划 Non-goals）

- LSP 上下文、OS 沙箱落地、ACP/Server 包（PRD M4 范围）
- npm 真实 `npm publish`（等 GitHub 仓库公开后执行，本计划只做演练）
- 文档站（英/中）（PRD M3 提及，但 1 人投入下优先级让位于产品本体；用 README + docs/ 顶替，记入 backlog）
- core 层运行中热切换模型、向量索引、A2A（延续不做）


---

## 验收记录（F2，2026-09-21）

PRD M3 验收标准逐条核对：

| 标准 | 证据 | 结果 |
|---|---|---|
| 自建评测通过率基线建立且不回退 | eval 扩至 14 用例；`eval-results/eval-report.json` 结构化报告 + 与上次报告自动对比，回退即退出码非 0（CI 门禁可直用）；根因修复后终验 **14/14**（基线 10） | ✅ |
| 从安装到完成任务 < 5 分钟 | `pnpm pack` 两包产物在全新临时目录 `npm i -g` 实测：`modou --version`（0.4.0）、`modou init`（模板生成+防覆盖）、`modou -p` 三命令全通；源码路径 `pnpm install && pnpm build` 后 2 命令进入交互。安装+首个任务实测约 3 分钟 | ✅ |

附：发布门禁三项——eval 14/14 不回退（报告机制保证）；全部测试通过（253 绿）；真实自用（dogfooding 见 docs/dogfood-m3.md，本轮真实任务 + 修复 3 个问题）。

任务完成度：14/14 全部完成（A1/A2、B1/B2、C1/C2/C3、D1/D2/D3、E1/E2/E3、F1/F2）+ R0 更名批次 + 计划外根因修复 1 项（f2a7123）。
