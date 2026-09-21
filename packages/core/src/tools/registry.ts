import { readFile } from "node:fs/promises";
import { resolveWithin } from "./paths.js";
import type { Tool, ToolContext, ToolResult } from "./types.js";

/** 参数校验失败时尽力附上目标文件摘要（ACI：失败信息要能帮模型自我修正）。 */
async function fileSnippetHint(tool: Tool, args: unknown, ctx: ToolContext): Promise<string> {
  if (tool.kind === "write" && typeof (args as { path?: unknown })?.path === "string") {
    try {
      const argPath = (args as { path: string }).path;
      const filePath = resolveWithin(ctx.cwd, argPath);
      const content = await readFile(filePath, "utf8");
      const lines = content.split("\n");
      const head = lines.slice(0, 20).join("\n");
      return `\n文件 ${argPath} 当前内容（前 ${Math.min(20, lines.length)} 行）：\n${head}${lines.length > 20 ? "\n…" : ""}\n请先核对内容再构造 old_text/new_text。`;
    } catch {
      // 文件读不到就没有摘要可附
    }
  }
  return "";
}

export class ToolRegistry {
  #tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已注册，不允许重名`);
    }
    this.#tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.#tools.get(name);
  }

  list(): Tool[] {
    return [...this.#tools.values()];
  }

  names(): string[] {
    return [...this.#tools.keys()];
  }

  /**
   * 校验参数并执行工具。未知工具与参数校验失败都抛出含工具名的可读错误，
   * 由主循环回注给模型修复。
   */
  async validateAndRun(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) {
      throw new Error(`未知工具 "${name}"。可用工具：${this.names().join(", ") || "（无）"}`);
    }
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      const hint = await fileSnippetHint(tool, args, ctx);
      throw new Error(`工具 "${name}" 参数校验失败：${issues}${hint}`);
    }
    return tool.run(parsed.data, ctx);
  }
}
