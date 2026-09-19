import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod";
import type { Tool } from "./types.js";

const DEFAULT_WINDOW = 2000;
/** ≈2k token（按 4 字符/token 估算） */
const MAX_CHARS = 8000;

const readSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(DEFAULT_WINDOW).optional(),
});

function resolveInCwd(cwd: string, p: string): string {
  const resolved = resolve(cwd, p);
  const root = resolve(cwd) + sep;
  if (!resolved.startsWith(root) && resolved !== resolve(cwd)) {
    throw new Error(`路径越界：${p} 超出工作目录 ${cwd}`);
  }
  return resolved;
}

export const readTool: Tool<z.infer<typeof readSchema>> = {
  name: "read",
  description:
    "读取文本文件，返回带行号的窗口内容。大文件自动截断，按提示用 offset 参数续读。不支持二进制文件。",
  kind: "read",
  schema: readSchema,
  async run(args, ctx) {
    const filePath = resolveInCwd(ctx.cwd, args.path);
    const buffer = await readFile(filePath);
    if (buffer.subarray(0, 8192).includes(0)) {
      throw new Error(`"${args.path}" 是二进制文件，read 工具无法显示`);
    }
    const allLines = buffer.toString("utf8").split("\n");
    const start = args.offset ?? 1;
    const windowEnd = start - 1 + (args.limit ?? DEFAULT_WINDOW);
    let selected = allLines.slice(start - 1, windowEnd);

    // 按 token 预算截断，防止撑爆上下文
    let charCount = 0;
    for (let i = 0; i < selected.length; i++) {
      charCount += selected[i]!.length + 1;
      if (charCount > MAX_CHARS) {
        selected = selected.slice(0, i);
        break;
      }
    }

    const lastShown = start - 1 + selected.length;
    const truncated = lastShown < allLines.length;
    const body = selected.map((line, i) => `${String(start + i).padStart(6)}\t${line}`).join("\n");
    const note = truncated
      ? `\n[已截断：第 ${lastShown + 1} 行起还有 ${allLines.length - lastShown} 行，用 offset=${lastShown + 1} 续读]`
      : "";
    return { output: body + note, truncated: truncated || undefined };
  },
};
