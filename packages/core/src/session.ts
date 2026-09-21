import type { ModelMessage } from "ai";
import type { ModouEvent } from "./events.js";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface RebuiltSession {
  messages: ModelMessage[];
  usageTotals: UsageTotals;
}

/**
 * 从事件流重建会话状态：模型可直接使用的消息历史 + 累计用量。
 * 审批、错误等运营类事件不进入模型消息，但 usage 会计入总量。
 */
export function rebuildState(events: ModouEvent[]): RebuiltSession {
  const messages: ModelMessage[] = [];
  const usageTotals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  const pendingCalls = new Map<string, string>();
  let pendingText: string | null = null;

  const flushText = () => {
    if (pendingText !== null) {
      messages.push({ role: "assistant", content: [{ type: "text", text: pendingText }] });
      pendingText = null;
    }
  };

  for (const event of events) {
    switch (event.type) {
      case "user_message":
        flushText();
        messages.push({ role: "user", content: event.text });
        break;
      case "assistant_message":
        pendingText = pendingText === null ? event.text : pendingText + event.text;
        break;
      case "tool_call": {
        pendingCalls.set(event.id, event.name);
        // 与主循环一致：同轮 text + tool-call 合并为一条 assistant 消息（M3 根因修复）
        const parts: Array<
          | { type: "text"; text: string }
          | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
        > = [];
        if (pendingText !== null) {
          parts.push({ type: "text", text: pendingText });
          pendingText = null;
        }
        parts.push({
          type: "tool-call",
          toolCallId: event.id,
          toolName: event.name,
          input: event.args,
        });
        messages.push({ role: "assistant", content: parts } as ModelMessage);
        break;
      }
      case "tool_result": {
        const toolName = pendingCalls.get(event.id) ?? "unknown";
        messages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: event.id,
              toolName,
              output: { type: "text", value: event.output },
            },
          ],
        });
        break;
      }
      case "usage":
        usageTotals.inputTokens += event.inputTokens;
        usageTotals.outputTokens += event.outputTokens;
        usageTotals.cacheReadTokens += event.cacheReadTokens;
        usageTotals.cacheWriteTokens += event.cacheWriteTokens;
        usageTotals.costUsd += event.costUsd;
        break;
      default:
        break;
    }
  }
  flushText();
  return { messages, usageTotals };
}
