import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { ModelCapabilities } from "../models/catalog.js";
import { runSubagent } from "../subagent.js";
import type { Tool } from "./types.js";

/** diff 摘要上限（字符），超出截断——审查聚焦最相关改动 */
const MAX_DIFF_CHARS = 24_000;

export interface CodeReviewToolDeps {
  model: LanguageModel;
  capabilities: ModelCapabilities;
  cwd: string;
  /** 注入会话存储（测试用）；默认新建默认目录 store */
  store?: import("../session-store.js").SessionStore;
}

/** 取未提交改动：优先 vs HEAD，零提交仓库回退 staged；非 git 仓库返回 null */
function gitDiffHead(cwd: string): string | null {
  try {
    let res = spawnSync("git", ["diff", "HEAD"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) {
      res = spawnSync("git", ["diff", "--cached"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    }
    if (res.status !== 0) {
      return null;
    }
    return res.stdout;
  } catch {
    return null;
  }
}

/**
 * code-review 子代理（M5 E1，F13 补全——backlog-m2 #3）：
 * 派出只读子代理审查代码改动。默认审查当前未提交改动（父上下文先取 git diff HEAD），
 * 也可指定文件/目录/描述由子代理自行阅读。
 */
export function createCodeReviewTool(deps: CodeReviewToolDeps): Tool<{ scope?: string }> {
  return {
    name: "code_review",
    description:
      "派出一个只读子代理审查代码改动，按严重度返回问题清单（正确性/边界/安全/约定）。默认审查当前未提交的改动；可用 scope 指定文件、目录或描述。",
    kind: "read",
    subagentName: "code-review",
    schema: z.object({
      scope: z.string().optional().describe("审查范围：文件/目录/描述；缺省=当前未提交改动"),
    }),
    async run(args, ctx) {
      const diff = gitDiffHead(deps.cwd);
      let task: string;
      if (diff && diff.trim()) {
        const truncated = diff.length > MAX_DIFF_CHARS;
        task =
          `审查以下未提交改动${args.scope ? `（重点关注：${args.scope}）` : ""}。` +
          `可用 read 工具查看改动周边代码确认上下文。\n\n` +
          `\`\`\`diff\n${diff.slice(0, MAX_DIFF_CHARS)}${truncated ? "\n…（diff 过长已截断）" : ""}\n\`\`\``;
      } else if (args.scope) {
        task = `审查以下范围的代码：${args.scope}。用只读工具（read/grep/glob）自行阅读相关代码。`;
      } else {
        return {
          output:
            "没有可审查的未提交改动（非 git 仓库或工作区干净）。请用 scope 参数指定要审查的文件或目录。",
        };
      }

      const result = await runSubagent({
        parentSessionId: ctx.sessionId ?? "adhoc",
        name: "code-review",
        task,
        model: deps.model,
        capabilities: deps.capabilities,
        cwd: deps.cwd,
        systemPrompt:
          "你是代码审查子代理。审查给定的改动或范围，重点：正确性缺陷、边界条件、安全漏洞、" +
          "与项目既有约定冲突。输出：按严重度（高/中/低）排序的问题清单，每条给 文件:行 + 问题 + 具体建议；" +
          "确认无问题就明确说「审查通过」。不要泛泛而谈，不要复述代码。",
        maxSteps: 10,
        store: deps.store,
      });
      if (result.fatal) {
        throw new Error(`code-review 子代理失败：${result.fatal}`);
      }
      return { output: result.summary || "（子代理没有产出审查结论）" };
    },
  };
}
