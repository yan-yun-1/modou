import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { providerNames, saveSettings, type ProviderName, type Settings } from "./settings.js";

const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: "Anthropic（Claude）",
  openai: "OpenAI（GPT）",
  glm: "智谱 GLM",
  deepseek: "DeepSeek",
  qwen: "阿里通义 Qwen",
  kimi: "月之暗面 Kimi",
  openrouter: "OpenRouter（聚合）",
  ollama: "Ollama（本地，免 Key）",
};

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-5.1",
  glm: "glm-4.6",
  deepseek: "deepseek-chat",
  qwen: "qwen3-max",
  kimi: "kimi-k2-0905-preview",
  openrouter: "openrouter/auto",
  ollama: "llama3.3:70b",
};

export interface OnboardingProps {
  home: string;
  /** 既有设置：重新选择模型时传入，保存时合并（保留 permissionMode/budgetUsd 等） */
  base?: Settings;
  onDone: (settings: Settings) => void;
  onError?: (message: string) => void;
}

/** 模型配置引导（首次运行与 `luban model` 重选共用）：选 provider → 模型 ID → API Key（Ollama 跳过）→ 写入设置。 */
export function Onboarding({ home, base, onDone, onError }: OnboardingProps) {
  const [step, setStep] = useState<"provider" | "model" | "key" | "saving">("provider");
  const [providerIndex, setProviderIndex] = useState(0);
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const provider = providerNames[providerIndex] as ProviderName;

  useInput((input, key) => {
    if (step !== "provider") {
      return;
    }
    if (key.upArrow) {
      setProviderIndex((i) => (i + providerNames.length - 1) % providerNames.length);
    } else if (key.downArrow) {
      setProviderIndex((i) => (i + 1) % providerNames.length);
    } else if (key.return) {
      setModelId(DEFAULT_MODELS[provider]);
      setStep("model");
    }
  });

  const submitModel = (value: string) => {
    const model = value.trim() || DEFAULT_MODELS[provider];
    setModelId(model);
    if (provider === "ollama") {
      // 本地模型无需 Key，直接保存
      void finish(provider, model, "");
    } else {
      setStep("key");
    }
  };

  const submitKey = async (value: string) => {
    setApiKey(value.trim());
    await finish(provider, modelId, value.trim());
  };

  const finish = async (p: ProviderName, model: string, key: string) => {
    setStep("saving");
    const settings: Settings = {
      ...base,
      provider: p,
      modelId: model,
      // 切到 ollama 时旧 key 无意义；留空提交视为沿用原 provider 的 key（如仅换同厂商模型变体）
      apiKey: p === "ollama" ? undefined : key || base?.apiKey || undefined,
      permissionMode: base?.permissionMode ?? "default",
      budgetUsd: base?.budgetUsd,
    };
    try {
      await saveSettings(settings, home);
      onDone(settings);
    } catch (error) {
      onError?.(`保存设置失败：${(error as Error).message}`);
    }
  };

  if (step === "provider") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>鲁班模型配置</Text>
        <Text>选择模型提供商（↑/↓ 移动，回车确认）：</Text>
        {providerNames.map((name, i) => (
          <Text key={name} color={i === providerIndex ? "green" : undefined}>
            {i === providerIndex ? "❯ " : "  "}
            {PROVIDER_LABELS[name]}
          </Text>
        ))}
      </Box>
    );
  }

  if (step === "model") {
    return (
      <Box flexDirection="column">
        <Text>模型 ID（回车确认，留空用默认 {DEFAULT_MODELS[provider]}）：</Text>
        <TextInput
          value={modelId}
          onChange={setModelId}
          onSubmit={submitModel}
          placeholder={DEFAULT_MODELS[provider]}
        />
      </Box>
    );
  }

  if (step === "key") {
    return (
      <Box flexDirection="column">
        <Text>API Key（输入不会回显内容，回车确认）：</Text>
        <TextInput value={apiKey} onChange={setApiKey} onSubmit={submitKey} mask="*" />
      </Box>
    );
  }

  return <Text>正在保存设置到 {home} …</Text>;
}
