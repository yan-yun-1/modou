import { createBashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { ToolRegistry } from "./registry.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import type { SandboxAdapter } from "../sandbox/index.js";

/**
 * 内置工具集：只读（read/grep/glob）+ 执行（bash）+ 写入（write/edit）。
 * write/edit 为 kind "write"，由权限引擎在执行前强制审批。
 * M5 B2：bash 经 sandbox 适配器包装（macOS Seatbelt，见 docs/sandbox-eval.md）。
 */
export function createBuiltinTools(options: { sandbox?: SandboxAdapter } = {}): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [readTool, grepTool, globTool, writeTool, editTool, createBashTool(options)]) {
    registry.register(tool);
  }
  return registry;
}

/** 只读工具集（子代理用）：无法写文件或执行命令 */
export function createReadonlyTools(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [readTool, grepTool, globTool]) {
    registry.register(tool);
  }
  return registry;
}
