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
  dir = await mkdtemp(join(tmpdir(), "luban-loop-err-"));
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

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function textStream(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: text },
        { type: "text-end", id: "1" },
        { type: "finish", finishReason: "stop", usage },
      ],
    }),
  };
}

function errorPartStream(message: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "error", error: new Error(message) },
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
    systemPrompt: "t",
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

describe("AgentLoop stream errors", () => {
  it("persists a fatal error and ends the run when the stream emits an error part", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-err-part");
    const loop = makeLoop(
      new MockLanguageModelV4({ doStream: [errorPartStream("provider down")] }),
      store,
    );

    const events = await collect(loop, "干活", sessionId);

    const last = events.at(-1);
    expect(last).toMatchObject({ type: "error", fatal: true });
    expect((last as { message: string }).message).toContain("provider down");

    const stored = await store.read(sessionId);
    expect(stored.at(-1)).toMatchObject({ type: "error", fatal: true });
  });

  it("does not throw when doStream itself rejects (provider/network failure)", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-err-doStream");
    const loop = makeLoop(
      new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("网络中断");
        },
      }),
      store,
    );

    let thrown: Error | undefined;
    let events: ModouEvent[] = [];
    try {
      events = await collect(loop, "干活", sessionId);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeUndefined();
    const last = events.at(-1);
    expect(last).toMatchObject({ type: "error", fatal: true });
    const stored = await store.read(sessionId);
    expect(stored.at(-1)).toMatchObject({ type: "error", fatal: true });
  }, 60_000);

  it("reports a task interrupt (not provider failure) when the run signal aborts", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-abort");
    // 挂起的流：模型调用永不完成，直到信号中止
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "error", error: new Error("never") },
          ],
        }),
      }),
    });
    const loop = makeLoop(model, store);
    const events: ModouEvent[] = [];
    const runPromise = (async () => {
      for await (const event of loop.run("任务", sessionId, { signal: controller.signal })) {
        events.push(event);
      }
    })();
    controller.abort(); // 先于运行中止：分类逻辑应识别为用户中断
    await runPromise;
    const last = events.at(-1);
    expect(last).toMatchObject({ type: "error", fatal: true });
    expect((last as { message: string }).message).toContain("已中断");
  });

  it("allows the same session to continue after a fatal error", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-err-recover");
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls++;
        if (calls === 1) {
          return errorPartStream("provider down");
        }
        return textStream("恢复了");
      },
    });
    const loop = makeLoop(model, store);

    await collect(loop, "第一次", sessionId);
    const second = await collect(loop, "第二次", sessionId);

    expect(second.some((e) => e.type === "assistant_message" && e.text === "恢复了")).toBe(true);
    const stored = await store.read(sessionId);
    expect(stored.some((e) => e.type === "error" && e.fatal)).toBe(true);
    expect(stored.some((e) => e.type === "assistant_message")).toBe(true);
  });
});
