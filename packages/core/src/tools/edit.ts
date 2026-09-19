import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { resolveWithin, toDisplayPath } from "./paths.js";
import type { Tool } from "./types.js";

const editSchema = z.object({
  path: z.string().min(1),
  /** 要替换的精确原文；必须唯一命中（否则用 replace_all） */
  old_text: z.string().min(1),
  new_text: z.string(),
  replace_all: z.boolean().optional(),
});

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function lineOfIndex(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function bigrams(s: string): Map<string, number> {
  const set = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const gram = s.slice(i, i + 2);
    set.set(gram, (set.get(gram) ?? 0) + 1);
  }
  return set;
}

/** Dice 系数（字符二元组重合度），0~1 */
function similarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  let overlap = 0;
  let totalA = 0;
  let totalB = 0;
  for (const n of gramsA.values()) {
    totalA += n;
  }
  for (const n of gramsB.values()) {
    totalB += n;
  }
  for (const [gram, n] of gramsA) {
    const m = Math.min(n, gramsB.get(gram) ?? 0);
    overlap += m;
  }
  return totalA + totalB === 0 ? 0 : (2 * overlap) / (totalA + totalB);
}

/** 零命中时按行窗口寻找最接近的原文片段，帮模型自我修正（ACI：失败要可修复） */
function suggestCandidate(content: string, oldText: string): string | null {
  const windowSize = oldText.split("\n").length;
  const lines = content.split("\n");
  let best = { score: 0, line: 0, text: "" };
  for (let i = 0; i + windowSize <= lines.length; i++) {
    const window = lines.slice(i, i + windowSize).join("\n");
    const score = similarity(oldText, window);
    if (score > best.score) {
      best = { score, line: i + 1, text: window };
    }
  }
  if (best.score < 0.3) {
    return null;
  }
  const snippet = best.text.length > 200 ? `${best.text.slice(0, 200)}…` : best.text;
  return `最接近的内容在第 ${best.line} 行（相似度 ${Math.round(best.score * 100)}%）：\n${snippet}`;
}

export const editTool: Tool<z.infer<typeof editSchema>> = {
  name: "edit",
  description:
    "精确替换文件内容：old_text 必须与文件原文完全一致且唯一命中（多处命中会被拒绝并列出行号；零命中会给出最接近的候选位置）。replace_all: true 可替换全部命中。",
  kind: "write",
  schema: editSchema,
  async run(args, ctx) {
    const filePath = resolveWithin(ctx.cwd, args.path);
    let content = await readFile(filePath, "utf8").catch(() => {
      throw new Error(`文件不存在：${args.path}`);
    });

    let occurrences = countOccurrences(content, args.old_text);
    let normalizedEol = false;
    if (occurrences === 0 && content.includes("\r\n")) {
      // CRLF 文件：模型通常发 LF，统一行尾后重试（整文件行尾随之归一为 LF）
      const normalized = content.replace(/\r\n/g, "\n");
      if (countOccurrences(normalized, args.old_text) > 0) {
        content = normalized;
        occurrences = countOccurrences(content, args.old_text);
        normalizedEol = true;
      }
    }

    if (occurrences === 0) {
      const hint = suggestCandidate(content, args.old_text);
      throw new Error(
        `old_text 在文件中未找到（0 处命中）。请用 read 核对精确内容后再试。${hint ? `\n${hint}` : ""}`,
      );
    }

    if (occurrences > 1 && !args.replace_all) {
      const lines: number[] = [];
      let pos = 0;
      while ((pos = content.indexOf(args.old_text, pos)) !== -1) {
        lines.push(lineOfIndex(content, pos));
        pos += args.old_text.length;
      }
      throw new Error(
        `old_text 命中 ${occurrences} 处（第 ${lines.join("、")} 行），需要补充上下文唯一定位，或设置 replace_all: true。`,
      );
    }

    const updated = args.replace_all
      ? content.split(args.old_text).join(args.new_text)
      : content.replace(args.old_text, args.new_text);
    await writeFile(filePath, updated, "utf8");

    const suffix = normalizedEol ? "（文件行尾已统一为 LF）" : "";
    return {
      output: `已修改 ${toDisplayPath(ctx.cwd, filePath)}：替换 ${args.replace_all ? occurrences : 1} 处${suffix}`,
    };
  },
};
