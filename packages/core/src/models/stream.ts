import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { ModelCapabilities } from "./catalog.js";
import { computeCost } from "./cost.js";
import type { LubanEvent } from "../events.js";

export interface StreamTurnOptions {
  model: LanguageModel;
  messages: ModelMessage[];
  capabilities: ModelCapabilities;
  tools?: ToolSet;
  signal?: AbortSignal;
  /** 可注入时钟，测试用；默认 Date.now */
  at?: () => number;
}

/**
 * 把 AI SDK 的流式响应映射为鲁班事件流。
 * 事件顺序：text_delta… → tool_call… → assistant_message（完整文本）→ usage（含成本）。
 * text_delta 仅供 UI 实时渲染，不落盘；assistant_message 是持久化的唯一文本事实。
 */
export async function* streamTurn(options: StreamTurnOptions): AsyncGenerator<LubanEvent> {
  const { model, messages, capabilities, tools, signal, at = Date.now } = options;
  let text = "";
  let emitted = false;

  const emitText = function* (): Generator<LubanEvent> {
    if (!emitted && text.length > 0) {
      emitted = true;
      yield { type: "assistant_message", text, at: at() };
    }
  };

  const result = streamText({ model, messages, tools, abortSignal: signal });

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        text += part.text;
        yield { type: "text_delta", delta: part.text, at: at() };
        break;
      case "tool-call":
        yield {
          type: "tool_call",
          id: part.toolCallId,
          name: part.toolName,
          args: part.input,
          at: at(),
        };
        break;
      case "finish": {
        yield* emitText();
        const usage = part.totalUsage;
        const inputTokens = usage.inputTokens ?? 0;
        const outputTokens = usage.outputTokens ?? 0;
        const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
        const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0;
        const costUsd = computeCost(
          { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
          capabilities.pricing,
        );
        yield {
          type: "usage",
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          costUsd,
          at: at(),
        };
        break;
      }
      case "error":
        throw part.error;
      default:
        break;
    }
  }
  yield* emitText();
}
