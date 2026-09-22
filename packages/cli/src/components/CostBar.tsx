import { Box, Text } from "ink";
import type { UsageTotals } from "@modou-dev/core";

function fmtUsd(cost: number): string {
  if (cost === 0) {
    return "$0";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(6).replace(/0+$/, "")}`;
  }
  return `$${cost.toFixed(4).replace(/0+$/, "")}`;
}

export function CostBar({ usage, budgetUsd }: { usage: UsageTotals; budgetUsd?: number }) {
  return (
    <Box>
      <Text dimColor>
        ↑{usage.inputTokens} ↓{usage.outputTokens}
        {usage.cacheReadTokens > 0 ? ` 缓存读${usage.cacheReadTokens}` : ""}
        {"  "}
        <Text color="green">{fmtUsd(usage.costUsd)}</Text>
        {budgetUsd !== undefined ? ` / 预算 ${fmtUsd(budgetUsd)}` : ""}
      </Text>
    </Box>
  );
}
