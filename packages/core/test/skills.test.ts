import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSkillsPrompt, loadSkills, parseSkill } from "../src/skills.js";

let dir: string;
let home: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await mkdtempCompat();
  home = await mkdtempCompat();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  warnSpy.mockRestore();
  await rm(dir, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

async function mkdtempCompat(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "modou-skills-"));
}

async function writeSkill(root: string, name: string, content: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), content, "utf8");
}

const VALID = `---
name: commit-style
description: 项目提交信息规范
---

提交信息使用 Conventional Commits：\`feat(scope): 描述\`。`;
const GLOBAL_ONLY = `---
name: deploy
description: 部署流程说明
---

部署前必须跑通全部测试。`;

describe("parseSkill", () => {
  it("parses valid frontmatter into name/description/body", () => {
    const skill = parseSkill(VALID, "/x/SKILL.md", "project");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("commit-style");
    expect(skill!.description).toBe("项目提交信息规范");
    expect(skill!.body).toContain("Conventional Commits");
  });

  it("returns null when frontmatter is missing or incomplete", () => {
    expect(parseSkill("# 没有 frontmatter", "/x", "project")).toBeNull();
    expect(parseSkill("---\nname: x\n---\n正文", "/x", "project")).toBeNull();
  });
});

describe("loadSkills", () => {
  it("discovers project skills and reports their source", async () => {
    await writeSkill(join(dir, ".luban", "skills"), "commit-style", VALID);
    const skills = await loadSkills({ cwd: dir, home });
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "commit-style", source: "project" });
  });

  it("project overrides global on name clash", async () => {
    await writeSkill(join(home, ".modou", "skills"), "commit-style", VALID);
    await writeSkill(
      join(dir, ".luban", "skills"),
      "commit-style",
      VALID.replace("项目提交信息规范", "项目级覆盖版"),
    );
    const skills = await loadSkills({ cwd: dir, home });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toBe("项目级覆盖版");
    expect(skills[0]!.source).toBe("project");
  });

  it("merges global and project without clash", async () => {
    await writeSkill(join(home, ".modou", "skills"), "deploy", GLOBAL_ONLY);
    await writeSkill(join(dir, ".luban", "skills"), "commit-style", VALID);
    const skills = await loadSkills({ cwd: dir, home });
    expect(skills.map((s) => s.name).sort()).toEqual(["commit-style", "deploy"]);
  });

  it("skips invalid SKILL.md with a warning and keeps the rest", async () => {
    await writeSkill(join(dir, ".luban", "skills"), "broken", "# 无 frontmatter");
    await writeSkill(join(dir, ".luban", "skills"), "commit-style", VALID);
    const skills = await loadSkills({ cwd: dir, home });
    expect(skills).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("非法 SKILL.md"));
  });

  it("returns an empty list when no skills directories exist", async () => {
    expect(await loadSkills({ cwd: dir, home })).toEqual([]);
  });
});

describe("formatSkillsPrompt", () => {
  it("returns empty string with no skills", () => {
    expect(formatSkillsPrompt([])).toBe("");
  });

  it("lists name/description and the read path", () => {
    const skill = parseSkill(VALID, "/proj/.luban/skills/commit-style/SKILL.md", "project")!;
    const prompt = formatSkillsPrompt([skill]);
    expect(prompt).toContain("## 可用 Skills");
    expect(prompt).toContain("commit-style");
    expect(prompt).toContain("项目提交信息规范");
    expect(prompt).toContain("/proj/.luban/skills/commit-style/SKILL.md");
  });
});
