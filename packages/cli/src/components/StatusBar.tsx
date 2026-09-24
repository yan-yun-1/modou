import { Box, Text } from "ink";
import { homedir } from "node:os";
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

/** 状态栏目录显示：主目录前缀缩写为 ~（其余原样） */
export function displayCwd(cwd: string, home: string = homedir()): string {
  if (home && (cwd === home || cwd.startsWith(home + "\\") || cwd.startsWith(home + "/"))) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
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
  /** 当前工作目录（第四段显示） */
  cwd?: string;
}

/** 单行四段状态栏：`model · mode │ ↑in ↓out $cost │ ctx n% (used/total) │ 目录` */
export function StatusBar({
  model,
  permissionMode,
  usage,
  budgetUsd,
  contextWindow,
  ctxUsedTokens,
  cwd,
}: StatusBarProps) {
  const { style } = terminalStyle();
  const hasCtx = contextWindow !== undefined && ctxUsedTokens !== undefined;
  const ctxRatio = hasCtx ? ctxUsedTokens! / contextWindow! : undefined;

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
            {`ctx ${Math.round(ctxRatio * 100)}% (${fmtTokens(ctxUsedTokens ?? 0)}/${fmtTokens(contextWindow ?? 0)})`}
          </Text>
        </Text>
      ) : null}
      {cwd ? (
        <Text color={style.dim}>
          {" │ "}
          {displayCwd(cwd)}
        </Text>
      ) : null}
    </Box>
  );
}
