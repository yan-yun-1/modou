import { z } from "zod";
import type { LanguageModel } from "ai";
import type { ModelCapabilities } from "../models/catalog.js";
import { runSubagent } from "../subagent.js";
import type { Tool } from "./types.js";

export interface ExploreToolDeps {
  model: LanguageModel;
  capabilities: ModelCapabilities;
  cwd: string;
}

/**
 * explore 子代理（plan-m2 P2）：派出只读子代理做代码勘察。
 * 大范围搜索/阅读发生在隔离上下文里，主会话只收到简明发现，保护主上下文窗口。
 * subagentName 标记让主循环在 tool_result 后落盘 subagent 事件（契约增补 3）。
 */
export function createExploreTool(deps: ExploreToolDeps): Tool<{ question: string }> {
  return {
    name: "explore",
    description:
      "派出一个只读子代理对代码库做广泛勘察（多轮搜索与阅读），只把简明发现带回主对话。适合“这个功能在哪些文件、如何实现”类的大范围问题。",
    kind: "read",
    subagentName: "explore",
    schema: z.object({
      question: z.string().min(1).describe("要勘察的问题，尽量具体"),
    }),
    async run(args) {
      const result = await runSubagent({
        parentSessionId: "adhoc",
        name: "explore",
        task: args.question,
        model: deps.model,
        capabilities: deps.capabilities,
        cwd: deps.cwd,
        systemPrompt:
          "你是代码勘察子代理。用只读工具（read/grep/glob）广泛探索代码库，回答给定问题。" +
          "输出必须简明：直接给结论 + 涉及的文件路径 + 一句话说明，不要贴大段代码。",
        maxSteps: 12,
      });
      if (result.fatal) {
        throw new Error(`explore 子代理失败：${result.fatal}`);
      }
      return { output: result.summary || "（子代理没有产出结论）" };
    },
  };
}
