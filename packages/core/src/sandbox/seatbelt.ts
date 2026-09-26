import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxAdapter } from "./types.js";

/**
 * macOS Seatbelt（sandbox-exec）适配。
 *
 * profile 策略（docs/sandbox-eval.md §二）：allow default 兜底 → deny 全部文件写 →
 * 按 subpath 放行 cwd、系统临时目录与 /dev（/dev/null 是脚本的合法写目标）。
 * 读与网络 v1 全放行。SBPL 语法无官方文档，改动 profile 前必须在 macOS 实机验证。
 */

/** SBPL profile 文本（纯函数，单测覆盖）。路径需双引号包裹并转义反斜杠/引号 */
export function buildSeatbeltProfile(options: { writePaths: string[] }): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const p of options.writePaths) {
    const escaped = p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    if (!seen.has(escaped)) {
      seen.add(escaped);
      entries.push(`  (subpath "${escaped}")`);
    }
  }
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    "(allow file-write*",
    '  (subpath "/dev")',
    ...entries,
    ")",
  ].join("\n");
}

let profileCounter = 0;

export function createSeatbeltAdapter(options: { tmpDir?: string } = {}): SandboxAdapter {
  const tmpDir = options.tmpDir ?? tmpdir();
  return {
    name: "seatbelt",
    wrapExec(cmd, args, { cwd }) {
      // sandbox-exec 启动时读取 profile；临时文件留在系统 tmp（OS 自清），不与并发会话共用
      const file = join(tmpDir, `modou-seatbelt-${process.pid}-${profileCounter++}.sb`);
      writeFileSync(file, buildSeatbeltProfile({ writePaths: [cwd, tmpDir] }), "utf8");
      return { cmd: "sandbox-exec", args: ["-f", file, cmd, ...args] };
    },
  };
}
