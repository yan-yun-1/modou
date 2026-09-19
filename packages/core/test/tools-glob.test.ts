import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globTool } from "../src/tools/glob.js";
import type { ToolContext } from "../src/tools/types.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-glob-"));
  ctx = { cwd: dir, signal: new AbortController().signal };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fixtureTree() {
  await mkdir(join(dir, "src/utils"), { recursive: true });
  await mkdir(join(dir, "node_modules/pkg"), { recursive: true });
  await writeFile(join(dir, "src/app.ts"), "x", "utf8");
  await writeFile(join(dir, "src/utils/format.ts"), "x", "utf8");
  await writeFile(join(dir, "readme.md"), "x", "utf8");
  await writeFile(join(dir, "node_modules/pkg/index.js"), "x", "utf8");
}

describe("glob tool", () => {
  it("matches files by pattern with forward-slash relative paths", async () => {
    await fixtureTree();
    const result = await globTool.run({ pattern: "**/*.ts" }, ctx);
    expect(result.output).toContain("src/app.ts");
    expect(result.output).toContain("src/utils/format.ts");
    expect(result.truncated).toBeUndefined();
  });

  it("never lists node_modules", async () => {
    await fixtureTree();
    const result = await globTool.run({ pattern: "**/*" }, ctx);
    expect(result.output).not.toContain("node_modules");
  });

  it("supports a base path", async () => {
    await fixtureTree();
    const result = await globTool.run({ pattern: "**/*.ts", path: "src" }, ctx);
    expect(result.output).toContain("src/app.ts");
    expect(result.output).not.toContain("readme.md");
  });

  it("reports no matches gracefully", async () => {
    await fixtureTree();
    const result = await globTool.run({ pattern: "**/*.go" }, ctx);
    expect(result.output).toContain("无匹配");
  });

  it("caps results at 500 and marks truncation", async () => {
    await mkdir(join(dir, "gen"), { recursive: true });
    for (let i = 0; i < 600; i++) {
      await writeFile(join(dir, `gen/f${i}.txt`), "x", "utf8");
    }
    const result = await globTool.run({ pattern: "gen/*.txt" }, ctx);
    expect(result.truncated).toBe(true);
  });
});
