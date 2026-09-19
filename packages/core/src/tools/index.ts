import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { ToolRegistry } from "./registry.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";

/**
 * 内置工具集：只读（read/grep/glob）+ 执行（bash）+ 写入（write/edit）。
 * write/edit 为 kind "write"，由权限引擎在执行前强制审批。
 */
export function createBuiltinTools(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [readTool, grepTool, globTool, writeTool, editTool, bashTool]) {
    registry.register(tool);
  }
  return registry;
}
