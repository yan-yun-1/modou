import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { grepTool } from "../src/tools/grep.js";
import type { ToolContext } from "../src/tools/types.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-grep-"));
  ctx = { cwd: dir, signal: new AbortController().signal };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fixtureTree() {
  await mkdir(join(dir, "src/utils"), { recursive: true });
  await mkdir(join(dir, "node_modules/pkg"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(
    join(dir, "src/app.ts"),
    "export function login() {}\nconst loginAgain = login;\n",
    "utf8",
  );
  await writeFile(
    join(dir, "src/utils/format.ts"),
    "export function loginFormatter() {}\n",
    "utf8",
  );
  await writeFile(join(dir, "node_modules/pkg/index.js"), "function login() {}\n", "utf8");
  await writeFile(join(dir, ".git/config"), "[user]\nlogin = yes\n", "utf8");
  await writeFile(join(dir, "readme.md"), "how to login\n", "utf8");
}

describe("grep tool", () => {
  it("finds matches across the tree in file:line: text form", async () => {
    await fixtureTree();
    const result = await grepTool.run({ pattern: "login" }, ctx);
    expect(result.output).toContain("src/app.ts:1: export function login() {}");
    expect(result.output).toContain("src/app.ts:2:");
    expect(result.output).toContain("src/utils/format.ts:1:");
    expect(result.output).toContain("readme.md:1:");
    expect(result.truncated).toBeUndefined();
  });

  it("never descends into node_modules, .git or hidden directories", async () => {
    await fixtureTree();
    const result = await grepTool.run({ pattern: "login" }, ctx);
    expect(result.output).not.toContain("node_modules");
    expect(result.output).not.toContain(".git");
  });

  it("filters files with the include glob", async () => {
    await fixtureTree();
    const result = await grepTool.run({ pattern: "login", include: "*.ts" }, ctx);
    expect(result.output).toContain("src/app.ts");
    expect(result.output).not.toContain("readme.md");
  });

  it("can search a single file path", async () => {
    await fixtureTree();
    const result = await grepTool.run(
      { pattern: "loginFormatter", path: "src/utils/format.ts" },
      ctx,
    );
    expect(result.output).toContain("src/utils/format.ts:1:");
  });

  it("reports no matches without truncation", async () => {
    await fixtureTree();
    const result = await grepTool.run({ pattern: "不存在的内容" }, ctx);
    expect(result.output).toContain("无匹配");
    expect(result.truncated).toBeUndefined();
  });

  it("caps results at 100 and marks truncation", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    const lines = Array.from({ length: 150 }, (_, i) => `hit ${i}`);
    await writeFile(join(dir, "src/many.txt"), lines.join("\n"), "utf8");
    const result = await grepTool.run({ pattern: "hit" }, ctx);
    expect(result.truncated).toBe(true);
    expect(result.output).toContain("100");
  });

  it("gives a friendly error for invalid regex", async () => {
    await fixtureTree();
    await expect(grepTool.run({ pattern: "([" }, ctx)).rejects.toThrow(/正则/);
  });

  it("skips binary files without failing", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/blob.bin"), Buffer.from([0x00, 0x01, 0x02]));
    await writeFile(join(dir, "src/text.txt"), "needle\n", "utf8");
    const result = await grepTool.run({ pattern: "needle" }, ctx);
    expect(result.output).toContain("src/text.txt:1:");
  });
});
