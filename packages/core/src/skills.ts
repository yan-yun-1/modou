import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 解析后的 Skill：frontmatter 元数据 + 正文指令（正文不预载进提示词，渐进披露） */
export interface Skill {
  name: string;
  description: string;
  /** 正文（SKILL.md 去掉 frontmatter 后的内容） */
  body: string;
  /** 来源：项目级覆盖全局级 */
  source: "project" | "global";
  /** SKILL.md 绝对路径（模型按需 read 用） */
  path: string;
}

export interface LoadSkillsOptions {
  cwd: string;
  home?: string;
}

/** 解析 YAML frontmatter（只认 name/description 两个键，值取到行尾）；非法返回 null */
export function parseFrontmatter(raw: string): { name: string; description: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) {
    return null;
  }
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) {
      meta[kv[1]!.toLowerCase()] = kv[2]!.trim();
    }
  }
  const name = meta.name;
  const description = meta.description;
  if (!name || !description) {
    return null;
  }
  return { name, description };
}

/** 解析一个 SKILL.md 文件；frontmatter 缺失/非法返回 null */
export function parseSkill(raw: string, path: string, source: Skill["source"]): Skill | null {
  const meta = parseFrontmatter(raw);
  if (!meta) {
    return null;
  }
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  return { name: meta.name, description: meta.description, body, source, path };
}

/**
 * D1（plan-m3）：扫描 cwd 与 home 下的 skills 目录中每个子目录的 SKILL.md
 * （项目级 .luban/skills/、全局级 ~/.modou/skills/）。
 * 同名时项目级覆盖全局级；单个 SKILL.md 非法跳过（console 警告），不阻断。
 */
export async function loadSkills(options: LoadSkillsOptions): Promise<Skill[]> {
  const { cwd } = options;
  const home = options.home ?? homedir();
  const globalRoot = join(home, ".modou", "skills");
  const projectRoot = join(cwd, ".luban", "skills");

  const byName = new Map<string, Skill>();
  // 全局先扫，项目级覆盖
  await scanRoot(globalRoot, "global", byName);
  await scanRoot(projectRoot, "project", byName);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function scanRoot(
  root: string,
  source: Skill["source"],
  byName: Map<string, Skill>,
): Promise<void> {
  if (!existsSync(root)) {
    return;
  }
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = join(root, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) {
      continue;
    }
    try {
      const raw = await readFile(skillPath, "utf8");
      const skill = parseSkill(raw, skillPath, source);
      if (skill) {
        byName.set(skill.name, skill);
      } else {
        console.warn(`[skills] 跳过非法 SKILL.md（缺 name/description frontmatter）：${skillPath}`);
      }
    } catch (error) {
      console.warn(`[skills] 读取失败 ${skillPath}：${(error as Error).message}`);
    }
  }
}

/** D2：系统提示词的"可用 Skills"一节；无 skill 返回空串（不占提示词） */
export function formatSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }
  const lines = skills.map(
    (skill) =>
      `- **${skill.name}**（${skill.source}）：${skill.description}\n  读取 ${skill.path} 获取完整指令。`,
  );
  return [
    "## 可用 Skills",
    "",
    "以下能力包与当前任务相关时，先用 read 工具读取其 SKILL.md 全文，再严格按其中指令执行：",
    "",
    ...lines,
  ].join("\n");
}
