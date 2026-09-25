import type {
  LanguageModel,
  ModouEvent,
  ModelCapabilities,
  SessionStore,
  UsageTotals,
} from "@modou-dev/core";
import type { Settings } from "./settings.js";
import { createLoopFromSettings } from "./loop-factory.js";

export interface PrintModeOptions {
  settings: Settings;
  cwd: string;
  prompt: string;
  /** models.json 的自定义模型能力（目录外模型如 glm-4.5-air 需要它解析能力与计价） */
  modelOverrides?: ModelCapabilities[];
  /** 事件回调（eval/观测用） */
  onEvent?: (event: ModouEvent) => void;
  /** 测试注入口：绕过真实 provider */
  model?: LanguageModel;
  /** 测试注入口：会话存储目录（默认 ~/.modou/sessions） */
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
 * 无头模式（modou -p "..."）：单任务执行后退出。
 * 没有人在终端里审批——所有 ask 一律拒绝（工厂的无桥语义），模型会收到拒绝原因并自行收尾；
 * 因此默认权限模式下无头任务只读，写盘/执行需要在 yolo 或规则白名单下进行。
 */
export async function runPrintMode(options: PrintModeOptions): Promise<PrintModeResult> {
  const { settings, cwd, prompt } = options;
  const bundle = await createLoopFromSettings({
    settings,
    cwd,
    modelOverrides: options.modelOverrides,
    model: options.model,
    store: options.store,
    sessionId: `print-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });

  let output = "";
  let fatal = false;
  const usage: UsageTotals = { ...ZERO_USAGE };

  try {
    for await (const event of bundle.loop.run(prompt, bundle.sessionId)) {
      options.onEvent?.(event);
      consumeEvent(event);
    }
  } catch (error) {
    fatal = true;
    process.stderr.write(`[modou] 任务失败：${(error as Error).message}\n`);
  } finally {
    // 关闭 MCP server 子进程，否则事件循环挂起进程不退出
    await bundle.closeMcp().catch(() => {});
  }

  function consumeEvent(event: ModouEvent): void {
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
        bundle.updateSpent(usage.costUsd);
        break;
      case "error":
        if (event.fatal) {
          fatal = true;
        }
        process.stderr.write(`[modou] ${event.message}\n`);
        break;
      default:
        break;
    }
  }

  return { exitCode: fatal || output.length === 0 ? 1 : 0, output, costUsd: usage.costUsd };
}
