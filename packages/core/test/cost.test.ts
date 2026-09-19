import { describe, expect, it } from "vitest";
import { computeCost } from "../src/models/cost.js";

const sonnetPricing = {
  inputPerMtokUsd: 3,
  outputPerMtokUsd: 15,
  cacheReadPerMtokUsd: 0.3,
  cacheWritePerMtokUsd: 3.75,
};

describe("computeCost", () => {
  it("computes cost with cache read/write split correctly", () => {
    const cost = computeCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 20_000,
        cacheReadTokens: 100_000,
        cacheWriteTokens: 50_000,
      },
      sonnetPricing,
    );
    // 0.85M*3 + 0.1M*0.3 + 0.05M*3.75 + 0.02M*15 = 2.55 + 0.03 + 0.1875 + 0.3
    expect(cost).toBeCloseTo(3.0675, 10);
  });

  it("never bills the same token twice when cache tokens exceed input", () => {
    const cost = computeCost(
      { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 2_000, cacheWriteTokens: 0 },
      sonnetPricing,
    );
    // billable input 0 + 0.002*0.3 + 0.0001*15
    expect(cost).toBeCloseTo(0.0006 + 0.0015, 10);
  });

  it("rounds to 6 decimals", () => {
    const cost = computeCost(
      { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      {
        inputPerMtokUsd: 1.25,
        outputPerMtokUsd: 0,
        cacheReadPerMtokUsd: 0,
        cacheWritePerMtokUsd: 0,
      },
    );
    expect(cost).toBe(0.000001);
  });

  it("returns 0 for free local models", () => {
    const free = {
      inputPerMtokUsd: 0,
      outputPerMtokUsd: 0,
      cacheReadPerMtokUsd: 0,
      cacheWritePerMtokUsd: 0,
    };
    expect(
      computeCost(
        { inputTokens: 999_999, outputTokens: 9_999, cacheReadTokens: 0, cacheWriteTokens: 0 },
        free,
      ),
    ).toBe(0);
  });
});
