import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bashTool } from "../src/tools/bash.js";
import type { ToolContext } from "../src/tools/types.js";

let dir: string;
let ctx: ToolContext;

// 测试命令一律走"写脚本文件再 node 执行"，避免 shell 嵌套引号的平台差异
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-bash-"));
  ctx = { cwd: dir, signal: new AbortController().signal };
  await writeFile(join(dir, "exit3.js"), "process.exit(3);", "utf8");
  await writeFile(join(dir, "hang.js"), "setTimeout(() => {}, 60000);", "utf8");
  await writeFile(join(dir, "big.js"), 'console.log("x".repeat(20000));', "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("bash tool", () => {
  it("runs a command and returns its output with exit code", async () => {
    const result = await bashTool.run({ command: "echo hello-luban" }, ctx);
    expect(result.output).toContain("hello-luban");
    expect(result.output).toContain("exit 0");
    expect(result.truncated).toBeUndefined();
  }, 30_000);

  it("reports non-zero exit codes without throwing", async () => {
    const result = await bashTool.run({ command: "node exit3.js" }, ctx);
    expect(result.output).toContain("exit 3");
  }, 30_000);

  it("kills the process on timeout", async () => {
    const start = Date.now();
    const result = await bashTool.run({ command: "node hang.js", timeoutMs: 500 }, ctx);
    expect(Date.now() - start).toBeLessThan(30_000);
    expect(result.output).toContain("超时");
  }, 60_000);

  it("keeps only the tail of huge output", async () => {
    const result = await bashTool.run({ command: "node big.js" }, ctx);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThan(9000);
    expect(result.output).toContain("超长");
  }, 30_000);

  it("aborts with the context signal", async () => {
    const controller = new AbortController();
    const abortingCtx: ToolContext = { cwd: dir, signal: controller.signal };
    setTimeout(() => controller.abort(), 300);
    await expect(bashTool.run({ command: "node hang.js" }, abortingCtx)).rejects.toThrow(/中止/);
  }, 30_000);
});
