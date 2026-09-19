import type { ModelPricing } from "./catalog.js";

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * 按 provider 牌价计算单轮成本（USD）。
 * inputTokens 已含缓存命中/写入的 token，先扣除再按各自价格计费，避免重复计价。
 */
export function computeCost(usage: TurnUsage, pricing: ModelPricing): number {
  const billableInput = Math.max(
    0,
    usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens,
  );
  const raw =
    (billableInput / 1e6) * pricing.inputPerMtokUsd +
    (usage.cacheReadTokens / 1e6) * pricing.cacheReadPerMtokUsd +
    (usage.cacheWriteTokens / 1e6) * pricing.cacheWritePerMtokUsd +
    (usage.outputTokens / 1e6) * pricing.outputPerMtokUsd;
  return Number(raw.toFixed(6));
}
