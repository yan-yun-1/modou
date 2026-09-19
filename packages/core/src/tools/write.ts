import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { unifiedDiff } from "../diff.js";
import { resolveWithin, toDisplayPath } from "./paths.js";
import type { Tool } from "./types.js";

const writeSchema = z.object({
  path: z.string().min(1),
  text: z.string(),
});

export const writeTool: Tool<z.infer<typeof writeSchema>> = {
  name: "write",
  description:
    "把完整内容写入文件（覆盖式，自动创建父目录）。修改既有文件请优先用 edit 工具，避免整文件重写。",
  kind: "write",
  schema: writeSchema,
  async run(args, ctx) {
    const filePath = resolveWithin(ctx.cwd, args.path);
    await mkdir(dirname(filePath), { recursive: true });

    const existing = await readFile(filePath, "utf8").catch(() => null);
    if (existing === args.text) {
      return { output: `${toDisplayPath(ctx.cwd, filePath)} 内容无变化，已跳过写入` };
    }

    await writeFile(filePath, args.text, "utf8");
    const bytes = Buffer.byteLength(args.text, "utf8");
    return { output: `已写入 ${toDisplayPath(ctx.cwd, filePath)}（${bytes} 字节）` };
  },
  async preview(args, ctx) {
    const filePath = resolveWithin(ctx.cwd, args.path);
    const before = await readFile(filePath, "utf8").catch(() => "");
    return unifiedDiff(before, args.text) || null;
  },
};
