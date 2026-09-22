import { Box, Text } from "ink";
import type { UsageTotals } from "@modou-dev/core";

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

/** 10 格字符进度条：filled 用 █，剩余用 ░ */
export function ctxBar(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

/** ctx 使用率分色：<80% 默认 dim，80–95% 黄（compaction 预警），≥95% 红 */
export function ctxColor(ratio: number): string | undefined {
  if (ratio >= 0.95) {
    return "red";
  }
  if (ratio >= 0.8) {
    return "yellow";
  }
  return undefined;
}

export interface StatusBarProps {
  model: string;
  permissionMode: string;
  usage: UsageTotals;
  budgetUsd?: number;
  /** 模型上下文窗口（token 数）；缺省时不显示 ctx 段 */
  contextWindow?: number;
  /** 当前估算已用上下文 token（input+output+cacheRead 与消息估算取大者由调用方决定，这里只管渲染） */
  ctxUsedTokens?: number;
}

/** 单行三段状态栏：`model · mode │ ↑in ↓out $cost │ ▐█░▌ n% ctx` */
export function StatusBar({
  model,
  permissionMode,
  usage,
  budgetUsd,
  contextWindow,
  ctxUsedTokens,
}: StatusBarProps) {
  const totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens;
  const ctxRatio =
    contextWindow && ctxUsedTokens !== undefined ? ctxUsedTokens / contextWindow : undefined;

  return (
    <Box>
      <Text dimColor>
        <Text color="cyan">{model}</Text>
        {" · "}
        {permissionMode}
        {" │ ↑"}
        {fmtTokens(usage.inputTokens)}
        {" ↓"}
        {fmtTokens(usage.outputTokens)} <Text color="green">{fmtUsd(usage.costUsd)}</Text>
        {budgetUsd !== undefined ? `/${fmtUsd(budgetUsd)}` : ""}
      </Text>
      {ctxRatio !== undefined ? (
        <Text dimColor>
          {" │ "}
          <Text color={ctxColor(ctxRatio)}>
            {ctxBar(ctxRatio)} {Math.round(ctxRatio * 100)}% ctx
          </Text>
        </Text>
      ) : null}
    </Box>
  );
}
