import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import {
  fetchProviderModels,
  FALLBACK_MODELS,
  PROVIDER_OPTIONS,
  type RemoteModel,
} from "./provider-models.js";
import { saveSettings, type ProviderName, type Settings } from "./settings.js";

const MAX_MODEL_ROWS = 8;

export interface OnboardingProps {
  home: string;
  /** 既有设置：重新选择时传入，保存时合并（保留 permissionMode/budgetUsd 等） */
  base?: Settings;
  /** 直接从 key 步骤开始（/provider 已选定供应商时用） */
  initialProvider?: ProviderName;
  onDone: (settings: Settings) => void;
  onError?: (message: string) => void;
}

type Step = "provider" | "key" | "loading" | "models" | "manualModel" | "saving";

/**
 * 模型配置引导（首次引导、/model、/provider 共用）。
 * 流程（V3）：选供应商 → 先输 API Key → 用 Key 拉取该供应商的模型列表
 * （失败回退内置目录）→ ↑↓ 选择模型（M 手动输入 ID）→ 写入设置。
 * Ollama 免 Key：跳过 key 直接拉本地 /v1/models。
 */
export function Onboarding({ home, base, initialProvider, onDone, onError }: OnboardingProps) {
  const [step, setStep] = useState<Step>(initialProvider ? "key" : "provider");
  const [providerIndex, setProviderIndex] = useState(0);
  const [provider, setProvider] = useState<ProviderName | null>(initialProvider ?? null);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<RemoteModel[]>([]);
  const [modelIndex, setModelIndex] = useState(0);
  const [manualId, setManualId] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  // 用户按 K 主动重输 Key：本次 key 步骤不自动跳过
  const [manualKeyEntry, setManualKeyEntry] = useState(false);

  const providerLabel = PROVIDER_OPTIONS.find((p) => p.name === provider)?.label ?? "";

  const loadModels = useCallback(
    async (p: ProviderName, key: string) => {
      setStep("loading");
      setLoadError(null);
      let list: RemoteModel[];
      try {
        const remote = await fetchProviderModels(p, key || base?.apiKey, base?.baseURL);
        list = remote.length > 0 ? remote : FALLBACK_MODELS[p].map((id) => ({ id }));
      } catch (error) {
        setLoadError((error as Error).message);
        list = FALLBACK_MODELS[p].map((id) => ({ id }));
      }
      setModels(list);
      setModelIndex(0);
      setScrollOffset(0);
      setStep("models");
    },
    [base],
  );

  // 进入 key 步骤时：settings 里已存有该供应商的 Key → 直接用旧 Key 拉模型列表，
  // /model 换模型不必重输 Key（想换 Key 在模型列表按 K）
  useEffect(() => {
    if (step !== "key" || provider === null || provider === "ollama") {
      return;
    }
    if (manualKeyEntry) {
      return;
    }
    if (base?.apiKey) {
      void loadModels(provider, base.apiKey);
    }
  }, [step, provider, manualKeyEntry, loadModels, base]);

  const saveWith = async (modelId: string) => {
    if (!provider) {
      return;
    }
    setStep("saving");
    const settings: Settings = {
      ...base,
      provider,
      modelId,
      apiKey: provider === "ollama" ? undefined : apiKey || base?.apiKey || undefined,
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

  const submitKey = (value: string) => {
    const key = value.trim();
    setApiKey(key);
    void loadModels(provider!, key);
  };

  useInput((input, key) => {
    if (step === "provider") {
      if (key.upArrow) {
        setProviderIndex((i) => (i + PROVIDER_OPTIONS.length - 1) % PROVIDER_OPTIONS.length);
      } else if (key.downArrow) {
        setProviderIndex((i) => (i + 1) % PROVIDER_OPTIONS.length);
      } else if (key.return) {
        const p = PROVIDER_OPTIONS[providerIndex]!.name;
        setProvider(p);
        setStep("key");
      }
      return;
    }
    if (step === "models") {
      const count = models.length;
      if (count === 0) {
        return;
      }
      if (key.upArrow) {
        setModelIndex((i) => {
          const next = (i + count - 1) % count;
          setScrollOffset((o) => {
            if (next < o) {
              return next;
            }
            if (next >= o + MAX_MODEL_ROWS) {
              return next - MAX_MODEL_ROWS + 1;
            }
            return o;
          });
          return next;
        });
      } else if (key.downArrow) {
        setModelIndex((i) => {
          const next = (i + 1) % count;
          setScrollOffset((o) => {
            if (next >= o + MAX_MODEL_ROWS) {
              return next - MAX_MODEL_ROWS + 1;
            }
            if (next < o) {
              return next;
            }
            return o;
          });
          return next;
        });
      } else if (key.return) {
        // 回车确认当前选中模型 → 保存
        const picked = models[modelIndex];
        if (picked) {
          void saveWith(picked.id);
        }
      } else if (input === "m" || input === "M") {
        setManualId("");
        setStep("manualModel");
      } else if (input === "k" || input === "K") {
        // 重输 Key（当前 Key 失效/想换号时用）
        setManualKeyEntry(true);
        setApiKey("");
        setStep("key");
      }
    }
  });

  if (step === "provider") {
    return (
      <Box flexDirection="column">
        <Text bold>墨斗模型配置</Text>
        <Text>选择模型提供商（↑/↓ 移动，回车确认）：</Text>
        {PROVIDER_OPTIONS.map((p, i) => (
          <Text key={p.name} color={i === providerIndex ? "green" : undefined}>
            {i === providerIndex ? "❯ " : "  "}
            {p.label}
          </Text>
        ))}
      </Box>
    );
  }

  if (step === "key") {
    if (provider === "ollama") {
      // 免 Key：渲染期直接触发本地列表拉取
      return <OllamaAutoLoad onLoad={() => void loadModels("ollama", "")} />;
    }
    return (
      <Box flexDirection="column">
        <Text>{providerLabel} 的 API Key（输入不回显，回车确认）：</Text>
        <TextInput value={apiKey} onChange={setApiKey} onSubmit={submitKey} mask="*" />
      </Box>
    );
  }

  if (step === "loading") {
    return (
      <Box flexDirection="column">
        <Text>正在从 {providerLabel} 拉取模型列表…</Text>
      </Box>
    );
  }

  if (step === "models") {
    const visible = models.slice(scrollOffset, scrollOffset + MAX_MODEL_ROWS);
    return (
      <Box flexDirection="column">
        <Text>
          选择 {providerLabel} 的模型（↑/↓ 移动，回车确认，M 手动输入 ID，K 重输 Key）：
        </Text>
        {loadError ? (
          <Text color="yellow">远端列表拉取失败（{loadError}），已回退内置目录</Text>
        ) : null}
        {visible.map((m, i) => {
          const absolute = scrollOffset + i;
          return (
            <Text key={m.id} color={absolute === modelIndex ? "green" : undefined}>
              {absolute === modelIndex ? "❯ " : "  "}
              {m.id}
              {m.displayName && m.displayName !== m.id ? ` — ${m.displayName}` : ""}
            </Text>
          );
        })}
        {models.length > MAX_MODEL_ROWS ? (
          <Text color="gray">
            （{modelIndex + 1}/{models.length}）
          </Text>
        ) : null}
      </Box>
    );
  }

  if (step === "manualModel") {
    return (
      <Box flexDirection="column">
        <Text>模型 ID（回车确认）：</Text>
        <TextInput value={manualId} onChange={setManualId} onSubmit={(v) => void saveWith(v.trim())} />
      </Box>
    );
  }

  return <Text>正在保存设置到 {home} …</Text>;
}

/** Ollama 免 Key：挂载即拉本地模型列表 */
function OllamaAutoLoad({ onLoad }: { onLoad: () => void }) {
  const fired = useRef(false);
  useEffect(() => {
    if (!fired.current) {
      fired.current = true;
      onLoad();
    }
  });
  return <Text>正在连接本地 Ollama…</Text>;
}
