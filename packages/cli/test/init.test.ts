import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initAgentsMd } from "../src/init.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "modou-init-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("initAgentsMd（A1）", () => {
  it("creates a template AGENTS.md in an empty directory", async () => {
    const result = await initAgentsMd(dir);

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("created");
    expect(result.path).toBe(join(dir, "AGENTS.md"));
    const content = await readFile(join(dir, "AGENTS.md"), "utf8");
    // 模板三节齐全且是模板（含占位符）
    expect(content).toContain("项目概述");
    expect(content).toContain("构建与测试命令");
    expect(content).toContain("代码风格");
    expect(content).toContain("<");
  });

  it("refuses to overwrite an existing AGENTS.md", async () => {
    await writeFile(join(dir, "AGENTS.md"), "# 用户手写约定", "utf8");

    const result = await initAgentsMd(dir);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("exists");
    expect(result.message).toContain("不覆盖");
    // 用户内容原封不动
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# 用户手写约定");
  });

  it("writes a real file on disk", async () => {
    await initAgentsMd(dir);
    await expect(stat(join(dir, "AGENTS.md"))).resolves.toBeTruthy();
  });
});
