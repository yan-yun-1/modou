import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { z } from "zod";

export const modelConfigSchema = z.object({
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
  modelId: z.string().min(1),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  /** 附加请求体字段（如思考强度 thinking/reasoning）；合并进每次请求的 JSON body */
  extraBody: z.record(z.string(), z.unknown()).optional(),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

/** OpenAI 兼容型 provider 的默认端点；均可通过 config.baseURL 覆盖。 */
const DEFAULT_BASE_URLS: Record<
  "glm" | "deepseek" | "qwen" | "kimi" | "openrouter" | "ollama",
  string
> = {
  glm: "https://open.bigmodel.cn/api/paas/v4",
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  kimi: "https://api.moonshot.cn/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
};

/**
 * 模型工厂：把用户配置解析为 AI SDK 的 LanguageModel。
 * API key 缺失不在工厂阶段报错——由 provider 在真正发请求时给出可读错误。
 */
export function createLanguageModel(config: ModelConfig): LanguageModel {
  const { provider, modelId, apiKey, baseURL, extraBody } = modelConfigSchema.parse(config);

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey, baseURL });
      return anthropic(modelId);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey, baseURL });
      return openai(modelId);
    }
    case "glm":
    case "deepseek":
    case "qwen":
    case "kimi":
    case "openrouter":
    case "ollama": {
      const compatible = createOpenAICompatible({
        name: provider,
        baseURL: baseURL ?? DEFAULT_BASE_URLS[provider],
        apiKey: apiKey ?? (provider === "ollama" ? "ollama" : undefined),
        // 思考强度等厂商私有参数：合并进每次请求体（AI SDK 的 openai-compatible 透传点）
        transformRequestBody:
          extraBody && Object.keys(extraBody).length > 0
            ? (body) => ({ ...body, ...extraBody })
            : undefined,
      });
      return compatible.chatModel(modelId);
    }
  }
}
