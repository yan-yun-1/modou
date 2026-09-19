import type { Tool, ToolContext, ToolResult } from "./types.js";

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
      throw new Error(`工具 "${name}" 参数校验失败：${issues}`);
    }
    return tool.run(parsed.data, ctx);
  }
}
