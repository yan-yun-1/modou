import { Box, Text } from "ink";
import type { UsageTotals } from "@modou-dev/core";
import { terminalStyle } from "../terminal-capability.js";

export function fmtUsd(cost: number): string {
  if (cost === 0) {
    return "$0";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(6).replace(/0+$/, "")}`;
  }
  return `$${cost.toFixed(4).replace(/0+$/, "")}`;
}

/** token 数缩写：1200 → 1.2k，345600 → 345.6k，1200000 → 1.2m */
export function fmtTokens(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${Math.round(k * 10) / 10}k`;
  }
  const m = n / 1_000_000;
  return `${Math.round(m * 10) / 10}m`;
}

/** 10 格字符进度条：filled 用 █，剩余按能力降级（░ / ─） */
export function ctxBar(ratio: number, barEmpty = "░"): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * 10);
  return "█".repeat(filled) + barEmpty.repeat(10 - filled);
}

/**
 * ctx 使用率四档色（C2）：颜色只在需要预警时出现——
 * <70% gray（结构可见不干扰）、70–80% green、80–95% yellow（compaction 预警）、≥95% red。
 */
export function ctxColor(ratio: number): "gray" | "green" | "yellow" | "red" {
  if (ratio >= 0.95) {
    return "red";
  }
  if (ratio >= 0.8) {
    return "yellow";
  }
  if (ratio >= 0.7) {
    return "green";
  }
  return "gray";
}

export interface StatusBarProps {
  model: string;
  permissionMode: string;
  usage: UsageTotals;
  budgetUsd?: number;
  /** 模型上下文窗口（token 数）；缺省时不显示 ctx 段 */
  contextWindow?: number;
  /** 当前估算已用上下文 token */
  ctxUsedTokens?: number;
}

/** 单行三段状态栏：`model · mode │ ↑in ↓out $cost │ ▐█░▌ n% ctx 已用` */
export function StatusBar({
  model,
  permissionMode,
  usage,
  budgetUsd,
  contextWindow,
  ctxUsedTokens,
}: StatusBarProps) {
  const { style } = terminalStyle();
  const ctxRatio =
    contextWindow && ctxUsedTokens !== undefined ? ctxUsedTokens / contextWindow : undefined;

  return (
    <Box>
      <Text color={style.dim}>
        <Text color={style.model}>{model}</Text>
        {" · "}
        {permissionMode}
        {" │ ↑"}
        {fmtTokens(usage.inputTokens)}
        {" ↓"}
        {fmtTokens(usage.outputTokens)} <Text color={style.cost}>{fmtUsd(usage.costUsd)}</Text>
        {budgetUsd !== undefined ? `/${fmtUsd(budgetUsd)}` : ""}
      </Text>
      {ctxRatio !== undefined ? (
        <Text color={style.dim}>
          {" │ "}
          <Text color={ctxColor(ctxRatio)}>
            {ctxBar(ctxRatio, glyphs.barEmpty)} {Math.round(ctxRatio * 100)}% ctx 已用
          </Text>
        </Text>
      ) : null}
    </Box>
  );
}
