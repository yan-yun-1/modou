import { z } from "zod";

/**
 * 模型能力声明：驱动 compaction 阈值、编辑格式选择与成本计算。
 * 价格为 2025-2026 各厂商公开牌价的近似值（USD/Mtok），允许用户在 models.json 中覆盖。
 */
export const modelPricingSchema = z.object({
  inputPerMtokUsd: z.number().nonnegative(),
  outputPerMtokUsd: z.number().nonnegative(),
  cacheReadPerMtokUsd: z.number().nonnegative(),
  cacheWritePerMtokUsd: z.number().nonnegative(),
});

export const modelCapabilitiesSchema = z.object({
  id: z.string().min(1),
  provider: z.enum([
    "anthropic",
    "openai",
    "glm",
    "deepseek",
    "qwen",
    "kimi",
    "openrouter",
    "ollama",
  ]),
  displayName: z.string().min(1),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  supportsTools: z.boolean(),
  supportsReasoning: z.boolean(),
  pricing: modelPricingSchema,
});

export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
export type ModelPricing = z.infer<typeof modelPricingSchema>;

export const MODEL_CATALOG: ModelCapabilities[] = [
  {
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.5",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: {
      inputPerMtokUsd: 3,
      outputPerMtokUsd: 15,
      cacheReadPerMtokUsd: 0.3,
      cacheWritePerMtokUsd: 3.75,
    },
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: {
      inputPerMtokUsd: 1,
      outputPerMtokUsd: 5,
      cacheReadPerMtokUsd: 0.1,
      cacheWritePerMtokUsd: 1.25,
    },
  },
  {
    id: "gpt-5.1",
    provider: "openai",
    displayName: "GPT-5.1",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: {
      inputPerMtokUsd: 1.25,
      outputPerMtokUsd: 10,
      cacheReadPerMtokUsd: 0.125,
      cacheWritePerMtokUsd: 0,
    },
  },
  {
    id: "glm-4.6",
    provider: "glm",
    displayName: "GLM-4.6",
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: {
      inputPerMtokUsd: 0.6,
      outputPerMtokUsd: 2.2,
      cacheReadPerMtokUsd: 0.11,
      cacheWritePerMtokUsd: 0,
    },
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    displayName: "DeepSeek V3.2",
    contextWindow: 128_000,
    maxOutputTokens: 8_000,
    supportsTools: true,
    supportsReasoning: false,
    pricing: {
      inputPerMtokUsd: 0.28,
      outputPerMtokUsd: 0.42,
      cacheReadPerMtokUsd: 0.028,
      cacheWritePerMtokUsd: 0,
    },
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    displayName: "DeepSeek R1",
    contextWindow: 128_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: {
      inputPerMtokUsd: 0.28,
      outputPerMtokUsd: 0.42,
      cacheReadPerMtokUsd: 0.028,
      cacheWritePerMtokUsd: 0,
    },
  },
  {
    id: "qwen3-max",
    provider: "qwen",
    displayName: "Qwen3 Max",
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: {
      inputPerMtokUsd: 1.2,
      outputPerMtokUsd: 6,
      cacheReadPerMtokUsd: 0.24,
      cacheWritePerMtokUsd: 0,
    },
  },
  {
    id: "kimi-k2-0905-preview",
    provider: "kimi",
    displayName: "Kimi K2",
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    supportsTools: true,
    supportsReasoning: false,
    pricing: {
      inputPerMtokUsd: 0.6,
      outputPerMtokUsd: 2.5,
      cacheReadPerMtokUsd: 0.15,
      cacheWritePerMtokUsd: 0,
    },
  },
  {
    id: "openrouter/auto",
    provider: "openrouter",
    displayName: "OpenRouter Auto（按上游计费，此处报 0）",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: {
      inputPerMtokUsd: 0,
      outputPerMtokUsd: 0,
      cacheReadPerMtokUsd: 0,
      cacheWritePerMtokUsd: 0,
    },
  },
  {
    id: "llama3.3:70b",
    provider: "ollama",
    displayName: "Llama 3.3 70B（本地，免费）",
    contextWindow: 32_768,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsReasoning: false,
    pricing: {
      inputPerMtokUsd: 0,
      outputPerMtokUsd: 0,
      cacheReadPerMtokUsd: 0,
      cacheWritePerMtokUsd: 0,
    },
  },
];

export function lookupModel(id: string, overrides: ModelCapabilities[] = []): ModelCapabilities {
  const override = overrides.find((m) => m.id === id);
  if (override) {
    return modelCapabilitiesSchema.parse(override);
  }
  const found = MODEL_CATALOG.find((m) => m.id === id);
  if (found) {
    return found;
  }
  throw new Error(
    `未知模型 "${id}"。内置目录中没有该模型：可在项目的 models.json 中按 ModelCapabilities 结构添加后重试。`,
  );
}

/**
 * Ollama 的模型是动态的（任意本地 tag），不在静态目录里也能解析为默认能力（免费）。
 */
export function resolveCapabilities(
  provider: ModelCapabilities["provider"],
  modelId: string,
  overrides: ModelCapabilities[] = [],
): ModelCapabilities {
  const override = overrides.find((m) => m.id === modelId);
  if (override) {
    return modelCapabilitiesSchema.parse(override);
  }
  if (provider === "ollama") {
    return {
      id: modelId,
      provider: "ollama",
      displayName: modelId,
      contextWindow: 32_768,
      maxOutputTokens: 8_192,
      supportsTools: true,
      supportsReasoning: false,
      pricing: {
        inputPerMtokUsd: 0,
        outputPerMtokUsd: 0,
        cacheReadPerMtokUsd: 0,
        cacheWritePerMtokUsd: 0,
      },
    };
  }
  return lookupModel(modelId, overrides);
}
