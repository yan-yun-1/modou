import { bashTool } from "./bash.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { ToolRegistry } from "./registry.js";
import { readTool } from "./read.js";

/**
 * M0 内置工具集（只读 + 执行）。write/edit 工具与 diff 审批在 M1 加入（plan.md M1）。
 */
export function createBuiltinTools(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [readTool, grepTool, globTool, bashTool]) {
    registry.register(tool);
  }
  return registry;
}
