import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatAgreements, loadAgreements } from "../src/context/agents-md.js";

let home: string;
let cwd: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "luban-ag-home-"));
  cwd = await mkdtemp(join(tmpdir(), "luban-ag-proj-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

async function writeAgreement(scope: "global" | "project" | "sub", content: string) {
  const paths = {
    global: join(home, "AGENTS.md"),
    project: join(cwd, "AGENTS.md"),
    sub: join(cwd, "src", "AGENTS.md"),
  };
  await mkdir(join(paths[scope], ".."), { recursive: true });
  await writeFile(paths[scope], content, "utf8");
}

describe("loadAgreements", () => {
  it("returns empty when no AGENTS.md files exist", async () => {
    expect(await loadAgreements({ cwd, home })).toEqual([]);
  });

  it("loads the global file first, then the project file", async () => {
    await writeAgreement("global", "全局约定");
    await writeAgreement("project", "项目约定");
    const sections = await loadAgreements({ cwd, home });
    expect(sections.map((s) => s.source)).toEqual(["global", "project"]);
    expect(sections[0]?.content).toBe("全局约定");
    expect(sections[1]?.content).toBe("项目约定");
  });

  it("includes first/second-level subdirectory files, but not deeper ones", async () => {
    await writeAgreement("sub", "子目录约定");
    await mkdir(join(cwd, "src", "deep", "deeper"), { recursive: true });
    await writeFile(join(cwd, "src", "deep", "AGENTS.md"), "深层", "utf8");
    await writeFile(join(cwd, "src", "deep", "deeper", "AGENTS.md"), "更深", "utf8");
    const sections = await loadAgreements({ cwd, home });
    // src/ 在深度 1；src/deep/ 在深度 2（计划约定含一二级）；src/deep/deeper/ 在深度 3 → 排除
    expect(sections.map((s) => s.source)).toEqual(["src", "src/deep"]);
    expect(sections[0]?.content).toBe("子目录约定");
    expect(sections[1]?.content).toBe("深层");
  });

  it("skips node_modules and hidden directories", async () => {
    await mkdir(join(cwd, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(cwd, "node_modules", "pkg", "AGENTS.md"), "依赖的约定", "utf8");
    await mkdir(join(cwd, ".hidden"), { recursive: true });
    await writeFile(join(cwd, ".hidden", "AGENTS.md"), "隐藏约定", "utf8");
    expect(await loadAgreements({ cwd, home })).toEqual([]);
  });

  it("caps total content with a truncation note", async () => {
    await writeAgreement("project", "很长的约定".repeat(3000));
    const sections = await loadAgreements({ cwd, home, maxTotalChars: 1000 });
    const total = sections.reduce((sum, s) => sum + s.content.length, 0);
    expect(total).toBeLessThanOrEqual(1000 + 100); // 截断注记的余量
  });
});

describe("formatAgreements", () => {
  it("marks content as untrusted data with sources", () => {
    const text = formatAgreements([
      { source: "project", content: "使用 pnpm" },
      { source: "src", content: "本目录用 React" },
    ]);
    expect(text).toContain("不可信");
    expect(text).toContain("不得覆盖");
    expect(text).toContain("使用 pnpm");
    expect(text).toContain("[project]");
    expect(text).toContain("[src]");
  });

  it("returns empty string for no agreements", () => {
    expect(formatAgreements([])).toBe("");
  });
});
