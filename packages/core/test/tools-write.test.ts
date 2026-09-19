import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeTool } from "../src/tools/write.js";
import type { ToolContext } from "../src/tools/types.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-write-"));
  ctx = { cwd: dir, signal: new AbortController().signal };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("write tool", () => {
  it("creates a new file including parent directories", async () => {
    const result = await writeTool.run({ path: "src/utils/new.ts", text: "export {};\n" }, ctx);
    expect(result.output).toContain("src/utils/new.ts");
    expect(await readFile(join(dir, "src/utils/new.ts"), "utf8")).toBe("export {};\n");
  });

  it("overwrites an existing file and reports byte size", async () => {
    const result = await writeTool.run({ path: "a.txt", text: "第二版内容" }, ctx);
    await writeTool.run({ path: "a.txt", text: "第三版" }, ctx);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("第三版");
    expect(result.output).toMatch(/字节/);
  });

  it("skips the write when content is unchanged", async () => {
    await writeTool.run({ path: "same.txt", text: "no-change" }, ctx);
    const first = await writeTool.run({ path: "same.txt", text: "no-change" }, ctx);
    expect(first.output).toContain("无变化");
  });

  it("rejects traversal outside the cwd", async () => {
    await expect(writeTool.run({ path: "../evil.txt", text: "x" }, ctx)).rejects.toThrow(/越界/);
  });

  it("is registered as kind write so the permission engine gates it", () => {
    expect(writeTool.kind).toBe("write");
  });

  it("preview returns a unified diff against the current file content", async () => {
    await writeFile(join(dir, "a.txt"), "old line\n", "utf8");
    const preview = await writeTool.preview?.({ path: "a.txt", text: "new line\n" }, ctx);
    expect(preview).toContain("-old line");
    expect(preview).toContain("+new line");
  });

  it("preview shows all additions for a new file", async () => {
    const preview = await writeTool.preview?.({ path: "new.txt", text: "a\nb\n" }, ctx);
    expect(preview).toContain("+a");
    expect(preview).toContain("+b");
  });
});
