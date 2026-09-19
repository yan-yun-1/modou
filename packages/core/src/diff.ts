type Op = { type: "same" | "del" | "add"; line: string };

interface Hunk {
  aStart: number;
  aLines: string[];
  bStart: number;
  bLines: string[];
}

/** 超过此行数的文件不生成 diff 正文（审批时提示过大），防止 O(n*m) 拖垮 UI */
const MAX_DIFF_LINES = 5000;
const CONTEXT_LINES = 3;

function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // LCS 长度表（滚动数组省内存；n*m ≤ 5000² 时仍可接受一次性分配）
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", line: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ type: "del", line: a[i] });
      i++;
    } else {
      ops.push({ type: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "del", line: a[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", line: b[j] });
    j++;
  }
  return ops;
}

function toHunks(ops: Op[]): Hunk[] {
  // 两遍法：先定位全部变更 op，把间隔 ≤ 2×context 的变更归并为一个区域，
  // 再按区域回填/续填上下文行——保证 hunk 前导上下文正确、远距离变更拆分。
  const changedIdx = ops
    .map((op, i) => (op.type === "same" ? -1 : i))
    .filter((i) => i >= 0);
  if (changedIdx.length === 0) {
    return [];
  }

  const regions: Array<[number, number]> = [];
  let regionStart = changedIdx[0]!;
  let regionEnd = changedIdx[0]!;
  for (const idx of changedIdx.slice(1)) {
    if (idx - regionEnd - 1 > CONTEXT_LINES * 2) {
      regions.push([regionStart, regionEnd]);
      regionStart = idx;
    }
    regionEnd = idx;
  }
  regions.push([regionStart, regionEnd]);

  const hunks: Hunk[] = [];
  for (const [cStart, cEnd] of regions) {
    const s = Math.max(0, cStart - CONTEXT_LINES);
    const e = Math.min(ops.length - 1, cEnd + CONTEXT_LINES);
    const aLines: string[] = [];
    const bLines: string[] = [];
    for (let i = s; i <= e; i++) {
      const op = ops[i]!;
      if (op.type === "same") {
        aLines.push(op.line);
        bLines.push(op.line);
      } else if (op.type === "del") {
        aLines.push(op.line);
      } else {
        bLines.push(op.line);
      }
    }
    let aBefore = 0;
    let bBefore = 0;
    for (let i = 0; i < s; i++) {
      if (ops[i]!.type !== "add") {
        aBefore++;
      }
      if (ops[i]!.type !== "del") {
        bBefore++;
      }
    }
    hunks.push({ aStart: aBefore + 1, aLines, bStart: bBefore + 1, bLines });
  }
  return hunks;
}

/**
 * 极简 unified diff（无第三方依赖）：上下文 3 行，超远变更拆分为多个 hunk。
 * 内容相同返回空字符串。仅供审批展示，不追求 git 兼容的字节级格式。
 */
export function unifiedDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  if (Math.max(a.length, b.length) > MAX_DIFF_LINES) {
    return "[diff 省略：文件过大]";
  }
  const hunks = toHunks(diffOps(a, b));
  if (hunks.length === 0) {
    return "";
  }
  const out: string[] = [];
  for (const hunk of hunks) {
    out.push(`@@ -${hunk.aStart},${hunk.aLines.length} +${hunk.bStart},${hunk.bLines.length} @@`);
    const max = Math.max(hunk.aLines.length, hunk.bLines.length);
    for (let k = 0; k < max; k++) {
      if (k < hunk.aLines.length && k < hunk.bLines.length && hunk.aLines[k] === hunk.bLines[k]) {
        out.push(` ${hunk.aLines[k]}`);
        continue;
      }
      if (k < hunk.aLines.length && hunk.aLines[k] !== hunk.bLines[k]) {
        out.push(`-${hunk.aLines[k]}`);
      }
      if (k < hunk.bLines.length && (k >= hunk.aLines.length || hunk.aLines[k] !== hunk.bLines[k])) {
        out.push(`+${hunk.bLines[k]}`);
      }
    }
  }
  return out.join("\n");
}
