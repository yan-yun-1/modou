import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { toDisplayPath } from "./paths.js";
import type { Tool } from "./types.js";
import { walk } from "./walk.js";

const MAX_MATCHES = 100;

const grepSchema = z.object({
  pattern: z.string().min(1),
  /** 目录或文件，相对 cwd，默认全仓库 */
  path: z.string().optional(),
  /** 文件名 glob 过滤，如 "*.ts" */
  include: z.string().optional(),
});

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escaped.replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*")}$`,
  );
}

export const grepTool: Tool<z.infer<typeof grepSchema>> = {
  name: "grep",
  description:
    '在代码库中用正则搜索文本内容，输出 "文件:行号: 内容"。跳过 node_modules/.git/dist。结果上限 100 条，可配合 include（如 "*.ts"）过滤文件类型。',
  kind: "read",
  schema: grepSchema,
  async run(args, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern);
    } catch (error) {
      throw new Error(`无效正则表达式 "${args.pattern}"：${(error as Error).message}`, {
        cause: error,
      });
    }
    const includeRegex = args.include ? globToRegex(args.include) : null;

    const target = args.path ?? ".";
    const abs = resolve(ctx.cwd, target);
    const targetStat = await stat(abs).catch(() => null);
    if (!targetStat) {
      throw new Error(`搜索路径不存在：${target}`);
    }

    const results: string[] = [];
    let truncated = false;

    const collect = async (absPath: string, displayPath: string): Promise<boolean> => {
      for (const line of await searchFile(absPath, displayPath, regex)) {
        if (results.length >= MAX_MATCHES) {
          return false;
        }
        results.push(line);
      }
      return true;
    };

    if (targetStat.isFile()) {
      truncated = !(await collect(abs, toDisplayPath(ctx.cwd, abs)));
    } else {
      for await (const rel of walk(abs)) {
        if (includeRegex && !includeRegex.test(rel.split("/").pop() ?? rel)) {
          continue;
        }
        const full =
          truncated ||
          (await collect(resolve(abs, rel), toDisplayPath(ctx.cwd, resolve(abs, rel))));
        if (!full) {
          truncated = true;
          break;
        }
      }
    }

    if (results.length === 0) {
      return { output: `无匹配：没有匹配 "${args.pattern}" 的内容` };
    }
    const note = truncated
      ? `\n[已达 ${MAX_MATCHES} 条上限，结果被截断——请用更精确的正则或 include 收窄]`
      : "";
    return { output: results.join("\n") + note, truncated: truncated || undefined };
  },
};

async function searchFile(absPath: string, displayPath: string, regex: RegExp): Promise<string[]> {
  const fileStat = await stat(absPath).catch(() => null);
  if (!fileStat || fileStat.size > 1_000_000) {
    return [];
  }
  let content: Buffer;
  try {
    content = await readFile(absPath);
  } catch {
    return [];
  }
  if (content.includes(0)) {
    return [];
  }
  const out: string[] = [];
  const lines = content.toString("utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i]!)) {
      out.push(`${displayPath}:${i + 1}: ${lines[i]}`);
    }
  }
  return out;
}
