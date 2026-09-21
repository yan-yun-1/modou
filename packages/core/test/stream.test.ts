import { describe, expect, it } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { ModouEvent } from "../src/events.js";
import type { ModelCapabilities } from "../src/models/catalog.js";
import { streamTurn } from "../src/models/stream.js";
import type { ModelMessage } from "ai";

const caps: ModelCapabilities = {
  id: "test-model",
  provider: "anthropic",
  displayName: "Test",
  contextWindow: 200_000,
  maxOutputTokens: 64_000,
  supportsTools: true,
  supportsReasoning: false,
  pricing: {
    inputPerMtokUsd: 3,
    outputPerMtokUsd: 15,
    cacheReadPerMtokUsd: 0.3,
    cacheWritePerMtokUsd: 3.75,
  },
};

const messages: ModelMessage[] = [{ role: "user", content: "hi" }];

function makeModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "你好" },
          { type: "text-delta", id: "1", delta: "，世界" },
          { type: "text-end", id: "1" },
          {
            type: "tool-call",
            toolCallId: "t1",
            toolName: "read",
            input: JSON.stringify({ path: "a.ts" }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: {
              inputTokens: { total: 100, noCache: 90, cacheRead: 8, cacheWrite: 2 },
              outputTokens: { total: 20, text: 18, reasoning: 2 },
            },
          },
        ],
      }),
    }),
  });
}

describe("streamTurn", () => {
  it("maps an AI SDK stream into luban events with cost", async () => {
    let tick = 1;
    const events: ModouEvent[] = [];
    for await (const event of streamTurn({
      model: makeModel(),
      messages,
      capabilities: caps,
      at: () => tick++,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", delta: "你好", at: 1 },
      { type: "text_delta", delta: "，世界", at: 2 },
      // M3：tool_call 前先 flush 文本（主循环把 text+tool-call 合并为一条 assistant 消息）
      { type: "assistant_message", text: "你好，世界", at: 3 },
      { type: "tool_call", id: "t1", name: "read", args: { path: "a.ts" }, at: 4 },
      {
        type: "usage",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 8,
        cacheWriteTokens: 2,
        // 0.00009M*3 + 0.000008M*0.3 + 0.000002M*3.75 + 0.00002M*15 = 0.0005799 → 0.00058
        costUsd: 0.00058,
        at: 5,
      },
    ]);
  });

  it("emits assistant_message even when the stream ends without a tool call", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "只有文本" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              finishReason: "stop",
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ],
        }),
      }),
    });
    const events: ModouEvent[] = [];
    for await (const event of streamTurn({ model, messages, capabilities: caps })) {
      events.push(event);
    }
    expect(events.map((e) => e.type)).toEqual(["text_delta", "assistant_message", "usage"]);
    const usage = events.find((e) => e.type === "usage");
    // 0.00001M*3 + 0.000005M*15 = 0.000105
    expect(usage && usage.type === "usage" && usage.costUsd).toBe(0.000105);
  });
});
