import { describe, expect, it } from "vitest";
import { lookupModel, MODEL_CATALOG, modelCapabilitiesSchema } from "../src/models/catalog.js";

const ALL_PROVIDERS = [
  "anthropic",
  "openai",
  "glm",
  "deepseek",
  "qwen",
  "kimi",
  "openrouter",
  "ollama",
];

describe("model catalog", () => {
  it("covers all 8 providers with schema-valid, uniquely-id'd entries", () => {
    const providers = new Set(MODEL_CATALOG.map((m) => m.provider));
    expect([...providers].sort()).toEqual([...ALL_PROVIDERS].sort());
    for (const entry of MODEL_CATALOG) {
      expect(() => modelCapabilitiesSchema.parse(entry)).not.toThrow();
    }
    const ids = MODEL_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks up a model by id", () => {
    const found = lookupModel("claude-sonnet-4-5");
    expect(found.provider).toBe("anthropic");
    expect(found.supportsTools).toBe(true);
  });

  it("throws a readable error for unknown ids, mentioning models.json", () => {
    expect(() => lookupModel("definitely-not-a-model")).toThrow(/models\.json/);
  });

  it("supports overrides that take precedence over the builtin catalog", () => {
    const cheaper = {
      ...lookupModel("claude-sonnet-4-5"),
      pricing: {
        inputPerMtokUsd: 1,
        outputPerMtokUsd: 5,
        cacheReadPerMtokUsd: 0.1,
        cacheWritePerMtokUsd: 1.25,
      },
    };
    expect(lookupModel("claude-sonnet-4-5", [cheaper]).pricing).toEqual(cheaper.pricing);
    expect(lookupModel("claude-sonnet-4-5").pricing.inputPerMtokUsd).not.toBe(1);
  });
});
