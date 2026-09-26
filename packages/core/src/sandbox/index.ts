import { createSeatbeltAdapter } from "./seatbelt.js";
import type { SandboxAdapter } from "./types.js";

export type SandboxMode = "off" | "auto";

/**
 * 沙箱工厂：off 恒为 undefined；auto 仅在平台支持时启用（当前仅 macOS Seatbelt）。
 * Windows/Linux 的评估结论见 docs/sandbox-eval.md §三/§四。
 */
export function createSandboxAdapter(
  mode: SandboxMode | undefined,
  platform: NodeJS.Platform = process.platform,
): SandboxAdapter | undefined {
  if (mode === "off" || mode === undefined) {
    return undefined;
  }
  if (platform === "darwin") {
    return createSeatbeltAdapter();
  }
  return undefined;
}

export { buildSeatbeltProfile, createSeatbeltAdapter } from "./seatbelt.js";
export type { SandboxAdapter, SandboxSpawnContext } from "./types.js";
