import {
  AgentLoop,
  PermissionEngine,
  SessionStore,
  createBuiltinTools,
  createLanguageModel,
  buildSystemPrompt,
  resolveCapabilities,
  type LanguageModel,
  type LubanEvent,
  type ModelCapabilities,
  type UsageTotals,
} from "@luban/core";
import { resolveApiKey, type Settings } from "./settings.js";

export interface PrintModeOptions {
  settings: Settings;
  cwd: string;
  prompt: string;
  /** models.json 的自定义模型能力（目录外模型如 glm-4.5-air 需要它解析能力与计价） */
  modelOverrides?: ModelCapabilities[];
  /** 测试注入口：绕过真实 provider */
  model?: LanguageModel;
  /** 测试注入口：会话存储目录（默认 ~/.luban/sessions） */
  store?: SessionStore;
}

export interface PrintModeResult {
  exitCode: number;
  output: string;
  costUsd: number;
}

const ZERO_USAGE: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

/**
 * 无头模式（luban -p "..."）：单任务执行后退出。
 * 没有人在终端里审批——所有 ask 一律拒绝，模型会收到拒绝原因并自行收尾；
 * 因此默认权限模式下无头任务只读，写盘/执行需要在 yolo 或规则白名单下进行。
 */
export async function runPrintMode(options: PrintModeOptions): Promise<PrintModeResult> {
  const { settings, cwd, prompt } = options;
  const capabilities = resolveCapabilities(
    settings.provider,
    settings.modelId,
    options.modelOverrides,
  );
  const model =
    options.model ??
    createLanguageModel({
      provider: settings.provider,
      modelId: settings.modelId,
      apiKey: resolveApiKey(settings),
      baseURL: settings.baseURL,
    });
  const tools = createBuiltinTools();
  const store = options.store ?? new SessionStore();
  const sessionId = `print-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await store.create(sessionId);

  let spent = 0;
  const budgetUsd = settings.budgetUsd;

  const loop = new AgentLoop({
    model,
    capabilities,
    tools,
    store,
    permissions: new PermissionEngine({ mode: settings.permissionMode ?? "default" }),
    approve: async () => ({ granted: false, remembered: false }),
    systemPrompt: buildSystemPrompt({
      cwd,
      platform: process.platform,
      tools: tools.names(),
    }),
    cwd,
    isOverBudget: () => budgetUsd !== undefined && spent > budgetUsd,
  });

  let output = "";
  let costUsd = 0;
  let fatal = false;
  const usage: UsageTotals = { ...ZERO_USAGE };

  try {
    for await (const event of loop.run(prompt, sessionId)) {
      consumeEvent(event);
    }
  } catch (error) {
    fatal = true;
    process.stderr.write(`[luban] 任务失败：${(error as Error).message}\n`);
  }

  function consumeEvent(event: LubanEvent): void {
    switch (event.type) {
      case "assistant_message":
        output = event.text;
        break;
      case "usage":
        usage.inputTokens += event.inputTokens;
        usage.outputTokens += event.outputTokens;
        usage.cacheReadTokens += event.cacheReadTokens;
        usage.cacheWriteTokens += event.cacheWriteTokens;
        usage.costUsd += event.costUsd;
        costUsd = usage.costUsd;
        spent = usage.costUsd;
        break;
      case "error":
        if (event.fatal) {
          fatal = true;
        }
        process.stderr.write(`[luban] ${event.message}\n`);
        break;
      default:
        break;
    }
  }

  return { exitCode: fatal || output.length === 0 ? 1 : 0, output, costUsd };
}
