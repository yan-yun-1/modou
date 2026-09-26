import type { ExtensionContext } from "vscode";

/**
 * M5 D1（PRD F20）：modou serve 生命周期——探测已运行的实例（4711），否则拉起
 * `modou serve --port 0` 并从 stdout 解析实际端口。插件只销毁自己拉起的进程。
 */

const DEFAULT_PORT = 4711;
const STARTUP_TIMEOUT_MS = 20_000;

export class ModouServerProcess {
  #context: ExtensionContext;
  #child?: import("node:child_process").ChildProcess;
  #owned = false;
  #port?: number;

  constructor(context: ExtensionContext) {
    this.#context = context;
  }

  /** 探测/拉起 server，返回 baseUrl。幂等 */
  async ensureRunning(): Promise<string> {
    if (this.#port) {
      return `http://127.0.0.1:${this.#port}`;
    }
    // 1) 已有实例（用户手动 modou serve 或其它端在用）
    if (await this.#probe(DEFAULT_PORT)) {
      this.#port = DEFAULT_PORT;
      return `http://127.0.0.1:${DEFAULT_PORT}`;
    }
    // 2) 拉起新实例（随机端口，stdout 解析实际端口）
    return await this.#spawn();
  }

  async #probe(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    } catch {
      return false;
    }
  }

  async #spawn(): Promise<string> {
    const { spawn } = await import("node:child_process");
    // Windows 上 modou 是 .cmd 垫片，必须经 shell
    const child = spawn("modou serve --port 0", {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.#child = child;
    this.#owned = true;

    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("modou serve 启动超时——请确认已 npm i -g modou")),
        STARTUP_TIMEOUT_MS,
      );
      let out = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString("utf8");
        const match = out.match(/serve 已启动：http:\/\/[\d.]+:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[modou serve] ${chunk.toString("utf8")}`);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`modou serve 提前退出（code ${code}）`));
      });
    });
    this.#port = port;
    return `http://127.0.0.1:${port}`;
  }

  dispose(): void {
    if (this.#owned && this.#child && this.#child.exitCode === null) {
      this.#child.kill();
    }
  }
}
