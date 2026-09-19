import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { walk } from "../tools/walk.js";

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"];
const MAX_FILES = 2000;
const DEFAULT_MAX_CHARS = 8000; // ≈2k token

/** 各语言的符号签名提取（正则轻量版；tree-sitter 升级留 M2 再评估） */
const SIGNATURE_PATTERNS: RegExp[] = [
  /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g,
  /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g,
  /^\s*def\s+([A-Za-z_]\w*)/gm,
  /^\s*class\s+([A-Za-z_]\w*)/gm,
  /func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)\s*\(/g,
];

export function extractSignatures(content: string): string[] {
  const names = new Set<string>();
  for (const pattern of SIGNATURE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      names.add(match[1]!);
      if (names.size > 30) {
        break;
      }
    }
  }
  return [...names];
}

/**
 * 轻量 repo map（plan-m1 K3）：按文件列出代码符号签名，
 * 输出 ≤ maxChars（默认 ≈2k token），供系统提示词了解项目结构。
 */
export async function buildRepoMap(options: { cwd: string; maxChars?: number }): Promise<string> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const lines: string[] = [];
  let used = 0;
  let truncated = false;
  let files = 0;

  for await (const rel of walk(options.cwd)) {
    if (files >= MAX_FILES) {
      truncated = true;
      break;
    }
    const filterResult = CODE_EXTENSIONS.some((ext) => rel.endsWith(ext));
    if (!filterResult) {
      continue;
    }
    let content: string;
    try {
      content = await readFile(join(options.cwd, rel), "utf8");
    } catch {
      continue;
    }
    files++;
    const signatures = extractSignatures(content);
    if (signatures.length === 0) {
      continue;
    }
    const line = `${rel}: ${signatures.join(", ")}`;
    if (used + line.length > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  if (lines.length === 0) {
    return "";
  }
  const note = truncated ? "\n[…repo map 已按预算截断]" : "";
  return lines.join("\n") + note;
}
