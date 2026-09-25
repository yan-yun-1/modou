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
 * ctx 使用率颜色：常规白色（用户要求），仅保留阈值预警——
 * ≥80% yellow（compaction 预警）、≥95% red。
 */
export function ctxColor(ratio: number): "white" | "yellow" | "red" {
  if (ratio >= 0.95) {
    return "red";
  }
  if (ratio >= 0.8) {
    return "yellow";
  }
  return "white";
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
  /** 思考强度（off/low/medium/high）；未设置=跟随模型默认，不显示 */
  thinking?: "off" | "low" | "medium" | "high";
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

/**
 * 权限模式在状态栏的显示名：仅 default 换词（与思考档位观感雷同易混淆），
 * plan/yolo 本身无歧义原样显示。settings/命令取值不变，仅展示层映射。
 */
export function permissionLabel(mode: string): string {
  if (mode === "default") {
    return "standard";
  }
  return mode;
}

/** 状态栏：`权限  模型  thinking: X  ↑in ↓out $cost  目录        context n% (used/total)`（ctx 右对齐） */
export function StatusBar({
  model,
  thinking,
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
    <Box justifyContent="space-between">
      <Text color={style.dim}>
        <Text color={style.permission}>{permissionLabel(permissionMode)}</Text>
        {/* 分段之间用双空格（不用 · 和 │）；模型/思考/用量/成本白色 */}
        <Text color="white">
          {"  "}
          {model}
          {thinking ? `  thinking: ${thinking}` : ""}
          {"  ↑"}
          {fmtTokens(usage.inputTokens)}
          {" ↓"}
          {fmtTokens(usage.outputTokens)}
          {" "}
          {fmtUsd(usage.costUsd)}
          {budgetUsd !== undefined ? `/${fmtUsd(budgetUsd)}` : ""}
        </Text>
        {cwd ? `  ${displayCwd(cwd)}` : ""}
      </Text>
      {ctxRatio !== undefined ? (
        <Text color={ctxColor(ctxRatio)}>
          {`context ${Math.round(ctxRatio * 100)}% (${fmtTokens(ctxUsedTokens ?? 0)}/${fmtTokens(contextWindow ?? 0)})`}
        </Text>
      ) : null}
    </Box>
  );
}
