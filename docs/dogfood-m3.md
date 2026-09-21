# Dogfooding 记录（M3，2026-09-21）

用 modou 本体执行真实任务，记录摩擦点（M4 输入）。

## 本轮执行的任务

| 任务 | 方式 | 结果 | 耗时/成本 |
|---|---|---|---|
| 读取 package.json 总结项目 | 无头 `pnpm smoke` | 正确一句话总结 | 3.7s / $0.000323 |
| eval 14 用例全跑 | eval harness | 14/14（根因修复后首次满分） | 总计 ~60s / ~$0.003 |
| `modou init` 生成 AGENTS.md | tgz 全局安装产物 | 模板生成、二次运行正确拒绝覆盖 | <1s |

## 本轮暴露并已修复的问题（即 dogfooding 价值）

1. **GLM 思考模型 tool-result 轮空转早停**（f2a7123）——同轮 text 与 tool-call 被
   拆成两条 assistant 消息，模型在下一轮复述开场白后直接结束。已合并为一条消息
   （主循环 + rebuildState 双侧），eval 从 12/13 → 14/14。
2. **`-p` 选项未注册**——program.ts 缺 `.option("-p, --print")`，tgz 安装实测抓到。
3. **VERSION 停在 0.0.1**——与 package.json 0.4.0 不一致，tgz 实测抓到。

## 摩擦点清单（遗留，供 M4）

1. 无头模式审批一律拒绝：CI 场景要先配 always-allow 白名单或 yolo，文档需更醒目（quickstart 已提，但错误信息可以更直接给出配置建议）。
2. MCP filesystem server 空参数调用会产生一连串可读错误——模型重试消耗轮次；可在 mcp 桥接层对"必填参数缺失"提前给参数清单提示（与 C1 同思路）。
3. eval 单用例成本波动大（edit-fix-typo 一轮 30.6s vs 另一轮 4.1s）——思考模型 reasoning 长度不可控，基线判定应看通过率而非时长。
4. `init` 生成的模板占位符较多，用户直接不填时 AGENTS.md 噪声大——可考虑检测未替换占位并在加载时降权。
5. Windows 下 `npm pack`（npm 版）不替换 workspace: 协议，必须用 `pnpm pack`——发布手册已写明，但可加 CI 校验。
