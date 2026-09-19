import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** 不进入的目录：依赖、版本库、构建产物、隐藏目录 */
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".turbo"]);

export function isSkippedDir(name: string): boolean {
  return SKIPPED_DIRS.has(name) || name.startsWith(".");
}

/**
 * 递归遍历目录树，产出全部文件路径（相对 root，统一正斜杠）。
 * 跳过 node_modules/.git/dist 等目录与隐藏目录。
 */
export async function* walk(root: string): AsyncGenerator<string> {
  yield* walkDir(resolve(root), "");
}

async function* walkDir(absDir: string, relPrefix: string): AsyncGenerator<string> {
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) {
        continue;
      }
      yield* walkDir(join(absDir, entry.name), rel);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
}
