import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { ModouEvent } from "../src/events.js";
import type { ModelCapabilities } from "../src/models/catalog.js";
import { AgentLoop } from "../src/agent-loop.js";
import { PermissionEngine } from "../src/permissions.js";
import { SessionStore } from "../src/session-store.js";
import { ToolRegistry } from "../src/tools/registry.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-loop-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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

function textStream(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: text },
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
  };
}

function makeLoop(model: MockLanguageModelV4, store: SessionStore) {
  return new AgentLoop({
    model,
    capabilities: caps,
    tools: new ToolRegistry(),
    store,
    permissions: new PermissionEngine({ mode: "default" }),
    approve: async () => ({ granted: false, remembered: false }),
    systemPrompt: "你是鲁班，一个终端编程 Agent。",
    cwd: dir,
  });
}

async function collect(loop: AgentLoop, input: string, sessionId: string): Promise<ModouEvent[]> {
  const events: ModouEvent[] = [];
  for await (const event of loop.run(input, sessionId)) {
    events.push(event);
  }
  return events;
}

describe("AgentLoop basic conversation", () => {
  it("streams a pure conversation turn, persisting everything except text_delta", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-basic");
    const model = new MockLanguageModelV4({ doStream: [textStream("你好，世界")] });
    const events = await collect(makeLoop(model, store), "你好", sessionId);

    expect(events.map((e) => e.type)).toEqual([
      "session_started",
      "user_message",
      "text_delta",
      "assistant_message",
      "usage",
    ]);
    expect(events[0]).toMatchObject({ type: "session_started", sessionId, model: "test-model" });
    expect(events.find((e) => e.type === "usage")).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
    });

    const stored = await store.read(sessionId);
    expect(stored.map((e) => e.type)).toEqual([
      "session_started",
      "user_message",
      "assistant_message",
      "usage",
    ]);
  });

  it("sends the system prompt ahead of the conversation", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-sys");
    const model = new MockLanguageModelV4({ doStream: [textStream("ok")] });
    await collect(makeLoop(model, store), "hi", sessionId);

    const prompt = model.doStreamCalls[0]?.prompt;
    expect(prompt?.[0]?.role).toBe("system");
    expect(JSON.stringify(prompt?.[0])).toContain("鲁班");
  });

  it("rebuilds prior context so a second run continues the conversation", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-resume");
    const model = new MockLanguageModelV4({
      doStream: [textStream("第一次回答"), textStream("第二次回答")],
    });
    const loop = makeLoop(model, store);
    await collect(loop, "第一问", sessionId);
    await collect(loop, "第二问", sessionId);

    const secondPrompt = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(secondPrompt).toContain("第一问");
    expect(secondPrompt).toContain("第一次回答");
    expect(secondPrompt).toContain("第二问");
  });
});
