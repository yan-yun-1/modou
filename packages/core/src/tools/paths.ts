import { relative, resolve, sep } from "node:path";

/**
 * 解析工作目录内的绝对路径；越界（../ 逃逸）时抛错。
 * read/write/edit/grep/glob 共用。
 */
export function resolveWithin(root: string, p: string): string {
  const resolved = resolve(root, p);
  const rootAbs = resolve(root);
  if (!resolved.startsWith(rootAbs + sep) && resolved !== rootAbs) {
    throw new Error(`路径越界：${p} 超出工作目录 ${rootAbs}`);
  }
  return resolved;
}

/**
 * 统一显示路径：相对 root、正斜杠分隔（模型与跨平台输出的一致性）。
 */
export function toDisplayPath(root: string, p: string): string {
  const rel = relative(resolve(root), resolve(root, p));
  return (rel === "" ? "." : rel).split(sep).join("/");
}
