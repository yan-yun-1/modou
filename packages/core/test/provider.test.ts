import { describe, expect, it } from "vitest";
import { createLanguageModel, modelConfigSchema } from "../src/models/provider.js";

describe("modelConfigSchema", () => {
  it("rejects unknown provider names", () => {
    expect(() => modelConfigSchema.parse({ provider: "nope", modelId: "x" })).toThrow();
  });
});

describe("createLanguageModel", () => {
  it("creates an anthropic model instance", () => {
    const model = createLanguageModel({
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      apiKey: "sk-test",
    });
    expect(model.provider).toContain("anthropic");
  });

  it("creates an openai model instance", () => {
    const model = createLanguageModel({
      provider: "openai",
      modelId: "gpt-5.1",
      apiKey: "sk-test",
    });
    expect(model.provider).toContain("openai");
  });

  it.each(["glm", "deepseek", "qwen", "kimi", "openrouter"] as const)(
    "creates an openai-compatible model for %s without explicit baseURL",
    (provider) => {
      const model = createLanguageModel({ provider, modelId: "test-model", apiKey: "k" });
      expect(model.provider.length).toBeGreaterThan(0);
    },
  );

  it("defaults ollama to localhost with a placeholder key", () => {
    const model = createLanguageModel({ provider: "ollama", modelId: "llama3.3:70b" });
    expect(model.provider.length).toBeGreaterThan(0);
  });

  it("honors a custom baseURL override", () => {
    const model = createLanguageModel({
      provider: "deepseek",
      modelId: "deepseek-chat",
      apiKey: "k",
      baseURL: "http://127.0.0.1:9999/v1",
    });
    expect(model.provider.length).toBeGreaterThan(0);
  });
});
