/**
 * M5 C3（PRD F16）：LSP 集成接口。
 * core 只依赖该最小接口（结构化类型），实现由 @modou-dev/sdk 装配 @modou-dev/lsp 提供。
 */
export interface LspIntegration {
  /** edit/write 成功后调用：返回格式化诊断文本（无诊断返回 undefined，避免噪声） */
  diagnosticsAfterWrite(path: string, content: string): Promise<string | undefined>;
  /** definition 工具实现：返回格式化定义位置（未找到返回 undefined） */
  definition(args: { file: string; line: number; column?: number }): Promise<string | undefined>;
}

/** 从工具参数中取 path 字段（edit/write 均含）；形状不符返回 undefined */
export function pathOfArgs(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) {
    return undefined;
  }
  const path = (args as Record<string, unknown>).path;
  return typeof path === "string" && path !== "" ? path : undefined;
}
