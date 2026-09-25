import { z } from "zod";
import type { Tool } from "../tools/types.js";
import type { McpConnection } from "./client.js";

const MAX_OUTPUT_CHARS = 8000;

function tail(text: string): { output: string; truncated?: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return { output: text };
  }
  return { output: text.slice(-MAX_OUTPUT_CHARS), truncated: true };
}

/**
 * 把一个 MCP server 的工具桥接为本 Tool 接口（plan-m2 N2）：
 * - 命名 mcp__<server>__<tool>，避免与内置工具冲突
 * - kind 一律 execute：外部工具面是不可信边界，走审批门禁
 * - 参数校验交给 MCP server 本身（这里只透传对象），失败以可读错误回注模型
 */
export async function mcpToolsFromConnection(connection: McpConnection): Promise<Tool[]> {
  const infos = await connection.listTools();
  return infos.map((info) => {
    const fullName = `mcp__${connection.name}__${info.name}`;
    const tool: Tool<Record<string, unknown>> = {
      name: fullName,
      description: `[MCP:${connection.name}] ${info.description ?? info.name}`,
      kind: "execute",
      source: "mcp",
      // 参数形状由 MCP server 声明与校验，这里透传任意对象
      schema: z.object({}).passthrough(),
      async run(args, ctx) {
        // 连接失败与 isError 都向上抛出：主循环会转为非致命 error 事件 + tool_result 回注
        void ctx;
        // M4 E1（dogfood#2）：必填参数缺失时提前给出参数清单，
        // 避免无头调用产生一串远程错误、模型反复重试空耗轮次
        const record = (args ?? {}) as Record<string, unknown>;
        const required = (info.inputSchema as { required?: string[] } | undefined)?.required ?? [];
        const missing = required.filter((key) => record[key] === undefined);
        if (missing.length > 0) {
          return { output: `[参数缺失] 工具 ${info.name} 需要必填参数：${required.join(", ")}（当前缺少 ${missing.join(", ")}）。请补齐参数后重试。` };
        }
        const text = await connection.callTool(info.name, args);
        return tail(text);
      },
    };
    return tool;
  });
}
