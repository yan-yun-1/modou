import type { z } from "zod";

export interface ToolContext {
  /** 工具执行的工作目录（通常是当前项目根） */
  cwd: string;
  signal: AbortSignal;
}

export interface ToolResult {
  output: string;
  /** 输出被截断时为 true，提示模型可精化查询 */
  truncated?: boolean;
}

/**
 * 工具是引擎与外部世界交互的唯一通道（ACI 原则：工具面质量优先于数量）。
 * kind 驱动权限引擎：read 可自动放行，write/execute 需审批。
 */
export interface Tool<T = unknown> {
  name: string;
  description: string;
  kind: "read" | "write" | "execute";
  schema: z.ZodType<T>;
  run(args: T, ctx: ToolContext): Promise<ToolResult>;
}
