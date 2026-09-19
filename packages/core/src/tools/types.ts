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

export type ToolKind = "read" | "write" | "execute";

/**
 * 工具是引擎与外部世界交互的唯一通道（ACI 原则：工具面质量优先于数量）。
 * kind 驱动权限引擎：read 可自动放行，write/execute 需审批。
 */
export interface Tool<T = unknown> {
  name: string;
  description: string;
  kind: ToolKind;
  /** 工具来源：内置实现或 MCP server 桥接（契约增补：plan-m2 N2） */
  source?: "builtin" | "mcp";
  schema: z.ZodType<T>;
  run(args: T, ctx: ToolContext): Promise<ToolResult>;
  /**
   * 审批预览：write/edit 实现它，在执行前返回 unified diff 供人工审阅。
   * 返回 null 表示本次调用会被拒绝或无法预览（此时审批卡片只显示参数）。
   */
  preview?(args: T, ctx: ToolContext): Promise<string | null>;
}
