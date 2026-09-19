import { glob as fsGlob } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { Tool } from "./types.js";
import { isSkippedDir } from "./walk.js";

const MAX_RESULTS = 500;

const globSchema = z.object({
  pattern: z.string().min(1),
  /** 基准目录，相对 cwd，默认项目根 */
  path: z.string().optional(),
});

function toRel(cwd: string, abs: string): string {
  if (isAbsolute(abs)) {
    return relative(cwd, abs).split(sep).join("/");
  }
  return abs.replace(/\\/g, "/");
}

export const globTool: Tool<z.infer<typeof globSchema>> = {
  name: "glob",
  description:
    '按 glob 模式（如 "src/**/*.ts"）查找文件，返回相对路径列表（上限 500 条）。不搜索 node_modules。',
  kind: "read",
  schema: globSchema,
  async run(args, ctx) {
    const base = args.path ? resolve(ctx.cwd, args.path) : ctx.cwd;
    const results: string[] = [];
    let truncated = false;

    for await (const entry of fsGlob(args.pattern, { cwd: base })) {
      const abs = resolve(base, entry);
      const rel = toRel(ctx.cwd, abs);
      // fs.glob 不感知我们的跳过规则，结果侧过滤
      if (rel.split("/").some((segment) => isSkippedDir(segment))) {
        continue;
      }
      if (results.length >= MAX_RESULTS) {
        truncated = true;
        break;
      }
      results.push(rel);
    }

    if (results.length === 0) {
      return { output: `无匹配：模式 "${args.pattern}" 没有找到文件` };
    }
    results.sort();
    const note = truncated
      ? `\n[已达 ${MAX_RESULTS} 条上限，结果被截断——请用更精确的模式或 path 收窄]`
      : "";
    return { output: results.join("\n") + note, truncated: truncated || undefined };
  },
};
