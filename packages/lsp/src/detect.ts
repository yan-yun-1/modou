import { spawnSync } from "node:child_process";
import type { HubServerConfig } from "./hub.js";

/**
 * M5 C2：language server 自动探测。未配置 lspServers 时，探测 PATH 中可用的 server。
 * 探测结果按进程缓存（一次会话装配只 spawn 一次版本查询）。
 */

export interface DetectProbe {
  (command: string, args: string[]): { status: number | null };
}

function defaultProbe(command: string, args: string[]): { status: number | null } {
  const res = spawnSync(`${command} ${args.join(" ")}`, {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 10_000,
  });
  return { status: res.status };
}

const CANDIDATES: Record<string, { command: string; versionArgs: string[]; runArgs: string[] }> = {
  typescript: { command: "typescript-language-server", versionArgs: ["--version"], runArgs: ["--stdio"] },
};

let cache: Record<string, HubServerConfig> | undefined;

export function detectDefaultServers(probe: DetectProbe = defaultProbe): Record<string, HubServerConfig> {
  if (cache) {
    return cache;
  }
  const found: Record<string, HubServerConfig> = {};
  for (const [name, candidate] of Object.entries(CANDIDATES)) {
    try {
      const { status } = probe(candidate.command, candidate.versionArgs);
      if (status === 0) {
        found[name] = { command: candidate.command, args: candidate.runArgs };
      }
    } catch {
      // 探测失败视作不可用
    }
  }
  cache = found;
  return found;
}

/** 测试用：清空探测缓存 */
export function resetDetectionCache(): void {
  cache = undefined;
}
