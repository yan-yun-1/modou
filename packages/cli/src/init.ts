import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const TEMPLATE = `# AGENTS.md

> 本文件由 modou --init 生成。Agent（墨斗/Modou 等）每次会话会自动读取本文件并遵守其中的约定。
> 方括号内容请替换为你的项目实际信息；不需要的小节可删除。

## 项目概述

<一到三句话说明这个项目是什么、用什么技术栈、面向谁。>

## 构建与测试命令

- 安装依赖：<例如 pnpm install>
- 构建：<例如 pnpm build>
- 运行全部测试：<例如 pnpm test>
- 运行单个测试：<例如 pnpm --filter <pkg> test -- <file>>
- Lint / 格式化：<例如 pnpm lint / pnpm format>

## 代码风格

- 语言与框架约定：<例如 TypeScript strict、React 函数组件、Python ruff>
- 命名约定：<例如 文件 kebab-case、类型 PascalCase>
- 提交信息：<例如 Conventional Commits：feat(scope): 描述>
- 其他硬性约定：<例如 禁止 any、测试必须 TDD 先红后绿>
`;

export interface InitResult {
  ok: boolean;
  /** 已存在时为 "exists"，成功时为 "created" */
  reason?: "exists" | "created";
  path: string;
  message: string;
}

/**
 * A1（plan-m3）：在目标目录生成 AGENTS.md 模板。
 * 已存在时不覆盖（内容是用户的项目约定，覆盖等于毁约）。
 */
export async function initAgentsMd(dir: string): Promise<InitResult> {
  const target = join(dir, "AGENTS.md");
  if (existsSync(target)) {
    return {
      ok: false,
      reason: "exists",
      path: target,
      message: `已存在，不覆盖：${target}（如需重新生成请手动改名或删除后重试）`,
    };
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(target, TEMPLATE, "utf8");
  return {
    ok: true,
    reason: "created",
    path: target,
    message: `已生成 ${target}——请把方括号占位替换为项目实际信息，Agent 下次会话自动遵守。`,
  };
}

/** 读取已生成的 AGENTS.md 内容（TUI /init 展示用）；不存在返回 null。 */
export async function readAgentsMd(dir: string): Promise<string | null> {
  const target = join(dir, "AGENTS.md");
  if (!existsSync(target)) {
    return null;
  }
  return readFile(target, "utf8");
}
