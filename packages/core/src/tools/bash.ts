import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
/** 输出尾部保留上限，≈2k token */
const MAX_OUTPUT_CHARS = 8000;

const bashSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

interface RunOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
}

function appendCapped(buffer: string, chunk: string): { text: string; truncated: boolean } {
  const combined = buffer + chunk;
  if (combined.length <= MAX_OUTPUT_CHARS) {
    return { text: combined, truncated: false };
  }
  return { text: combined.slice(-MAX_OUTPUT_CHARS), truncated: true };
}

function killTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === "win32") {
    // Windows 上 child.kill() 只杀直接子进程，用 taskkill 杀整棵进程树
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      child.kill();
    }
  } else {
    try {
      if (child.pid) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/**
 * Windows 用 PowerShell + EncodedCommand：
 * - Base64(UTF-16LE) 传输，模型命令里的任意引号不会被重 quoting 破坏
 * - 前缀 SilentlyContinue 关掉 CLIXML 进度噪声
 * - 尾部 exit $LASTEXITCODE 把原生命令的退出码透传为 powershell 的退出码
 */
function buildWindowsScript(command: string): string {
  return `$ProgressPreference='SilentlyContinue';\n${command}\nexit $LASTEXITCODE;`;
}

function exec(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<RunOutcome> {
  return new Promise((resolvePromise, rejectPromise) => {
    const isWin = process.platform === "win32";
    const child = isWin
      ? spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(buildWindowsScript(command), "utf16le").toString("base64"),
          ],
          { cwd, windowsHide: true },
        )
      : spawn("/bin/sh", ["-c", command], { cwd, detached: true });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    // abort 时杀掉进程树并等 close，避免孤儿进程锁住工作目录
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      killTree(child);
      const fail = () =>
        rejectPromise(new Error("命令已被用户中止", { cause: new Error("SIGABRT") }));
      child.once("close", fail);
      setTimeout(fail, 3_000).unref();
    };
    signal.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: string) => {
      const r = appendCapped(stdout, chunk);
      stdout = r.text;
      stdoutTruncated ||= r.truncated;
    });
    child.stderr?.on("data", (chunk: string) => {
      const r = appendCapped(stderr, chunk);
      stderr = r.text;
      stderrTruncated ||= r.truncated;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolvePromise({
        code,
        stdout,
        stderr,
        timedOut,
        outputTruncated: stdoutTruncated || stderrTruncated,
      });
    });
  });
}

export const bashTool: Tool<z.infer<typeof bashSchema>> = {
  name: "bash",
  description:
    "在项目目录执行 shell 命令（Windows 用 PowerShell，其余用 /bin/sh），返回 stdout/stderr 与退出码。长输出只保留尾部。超时默认 120 秒。",
  kind: "execute",
  schema: bashSchema,
  async run(args, ctx) {
    const outcome = await exec(
      args.command,
      ctx.cwd,
      args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ctx.signal,
    );
    const sections: string[] = [];
    if (outcome.timedOut) {
      sections.push("[命令超时，进程已被强制终止]");
    }
    if (outcome.stdout.trim()) {
      sections.push(
        `--- stdout ${outcome.outputTruncated ? "（超长，仅保留尾部）" : ""} ---\n${outcome.stdout.trimEnd()}`,
      );
    }
    if (outcome.stderr.trim()) {
      sections.push(`--- stderr ---\n${outcome.stderr.trimEnd()}`);
    }
    return {
      output: `${sections.join("\n")}\n[exit ${outcome.code ?? "null"}]`,
      truncated: outcome.outputTruncated || undefined,
    };
  },
};
