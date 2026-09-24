import { MODEL_CATALOG, type ModelCapabilities } from "@modou-dev/core";
import { providerNames, type ProviderName, type Settings } from "./settings.js";

/** 各供应商的默认 API 端点（与 core/models/provider.ts 的 DEFAULT_BASE_URLS 一致；anthropic/openai 由 SDK 默认） */
export const PROVIDER_BASE_URLS: Partial<Record<ProviderName, string>> = {
  glm: "https://open.bigmodel.cn/api/paas/v4",
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  kimi: "https://api.moonshot.cn/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
};

export interface ProviderOption {
  name: ProviderName;
  label: string;
}

/** 供应商展示名（Onboarding 与 /provider 选择器共用） */
export const PROVIDER_OPTIONS: ProviderOption[] = [
  { name: "anthropic", label: "Anthropic（Claude）" },
  { name: "openai", label: "OpenAI（GPT）" },
  { name: "glm", label: "智谱 GLM" },
  { name: "deepseek", label: "DeepSeek" },
  { name: "qwen", label: "阿里通义 Qwen" },
  { name: "kimi", label: "月之暗面 Kimi" },
  { name: "openrouter", label: "OpenRouter（聚合）" },
  { name: "ollama", label: "Ollama（本地，免 Key）" },
];

/** 各供应商的兜底模型（远端列表拉不到时回退到内置目录按 provider 过滤） */
export const FALLBACK_MODELS: Record<ProviderName, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  openai: ["gpt-5.1"],
  glm: ["glm-4.6"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  qwen: ["qwen3-max"],
  kimi: ["kimi-k2-0905-preview"],
  openrouter: ["openrouter/auto"],
  ollama: ["llama3.3:70b"],
};

export interface RemoteModel {
  id: string;
  /** 展示名（远端没有就等于 id） */
  displayName?: string;
}

/**
 * 拉取供应商的可用模型列表。
 * OpenAI 兼容型走 GET {baseURL}/models（Bearer Key）；Anthropic 走 /v1/models（x-api-key）。
 * Ollama 本地端点无需 Key。网络失败或 Key 无效时抛错，由调用方决定回退 UI。
 */
export async function fetchProviderModels(
  provider: ProviderName,
  apiKey?: string,
  baseURL?: string,
): Promise<RemoteModel[]> {
  if (provider === "anthropic") {
    const url = `${baseURL ?? "https://api.anthropic.com"}/v1/models?limit=100`;
    const res = await fetch(url, {
      headers: {
        "x-api-key": apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data?: { id: string; display_name?: string }[] };
    return (json.data ?? []).map((m) => ({ id: m.id, displayName: m.display_name }));
  }

  // 其余全部是 OpenAI 兼容端点
  const base = baseURL ?? PROVIDER_BASE_URLS[provider];
  if (!base) {
    throw new Error(`供应商 ${provider} 没有默认端点`);
  }
  const headers: Record<string, string> = {};
  if (provider !== "ollama") {
    headers.Authorization = `Bearer ${apiKey ?? ""}`;
  }
  const res = await fetch(`${base}/models`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: { id: string; name?: string }[] };
  return (json.data ?? [])
    .map((m) => ({ id: m.id, displayName: m.name }))
    // openrouter 等聚合端点会返回按厂商前缀的 id，保持原样即可
    .filter((m) => m.id);
}

/** 内置目录中该供应商的模型（远端不可用时的回退清单） */
export function catalogModelsFor(provider: ProviderName): RemoteModel[] {
  return MODEL_CATALOG.filter((m: ModelCapabilities) => m.provider === provider).map((m) => ({
    id: m.id,
    displayName: m.displayName,
  }));
}

/** 设置里的 provider 是否合法（容错手改 settings.json） */
export function isKnownProvider(p: string | undefined): p is ProviderName {
  return providerNames.includes(p as ProviderName);
}

/**
 * 思考强度 → 请求体映射（X 系列）。返回 undefined 表示该供应商没有标准请求参数
 * （DeepSeek/Kimi 由模型本身决定推理与否，Ollama 本地模型同理），设置将被忽略。
 * - glm：thinking.type enabled/disabled
 * - qwen：enable_thinking 布尔
 * - openrouter：reasoning.effort（off = enabled:false）
 */
export function thinkingToExtraBody(
  provider: ProviderName,
  level: "off" | "low" | "medium" | "high",
): Record<string, unknown> | undefined {
  switch (provider) {
    case "glm":
      return { thinking: { type: level === "off" ? "disabled" : "enabled" } };
    case "qwen":
      return { enable_thinking: level !== "off" };
    case "openrouter":
      return level === "off" ? { reasoning: { enabled: false } } : { reasoning: { effort: level } };
    default:
      return undefined;
  }
}

export type { Settings };
