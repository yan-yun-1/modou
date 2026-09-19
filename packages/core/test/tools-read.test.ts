import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTool } from "../src/tools/read.js";
import type { ToolContext } from "../src/tools/types.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-read-"));
  ctx = { cwd: dir, signal: new AbortController().signal };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);

describe("read tool", () => {
  it("reads a file with cat -n style line numbers", async () => {
    await writeFile(join(dir, "a.txt"), lines.join("\n"), "utf8");
    const result = await readTool.run({ path: "a.txt" }, ctx);
    expect(result.output).toContain("     1\tline 1");
    expect(result.output).toContain("    50\tline 50");
    expect(result.truncated).toBeUndefined();
  });

  it("supports offset and limit windows", async () => {
    await writeFile(join(dir, "a.txt"), lines.join("\n"), "utf8");
    const result = await readTool.run({ path: "a.txt", offset: 10, limit: 5 }, ctx);
    expect(result.output).toContain("    10\tline 10");
    expect(result.output).toContain("    14\tline 14");
    expect(result.output).not.toContain("line 15");
    expect(result.truncated).toBe(true);
  });

  it("truncates files beyond the 2000-line default window with a hint", async () => {
    const long = Array.from({ length: 3000 }, (_, i) => `L${i + 1}`);
    await writeFile(join(dir, "big.txt"), long.join("\n"), "utf8");
    const result = await readTool.run({ path: "big.txt" }, ctx);
    expect(result.truncated).toBe(true);
    expect(result.output).toContain("offset");
  });

  it("rejects binary files with a readable error", async () => {
    await writeFile(join(dir, "bin.dat"), Buffer.from([0x89, 0x00, 0x01, 0x00]));
    await expect(readTool.run({ path: "bin.dat" }, ctx)).rejects.toThrow(/二进制/);
  });

  it("gives a readable error for missing files", async () => {
    await expect(readTool.run({ path: "nope.txt" }, ctx)).rejects.toThrow(/nope\.txt/);
  });

  it("does not escape the cwd via relative traversal", async () => {
    await mkdir(join(dir, "sub"), { recursive: true });
    await expect(readTool.run({ path: "../../outside.txt" }, ctx)).rejects.toThrow();
  });
});
