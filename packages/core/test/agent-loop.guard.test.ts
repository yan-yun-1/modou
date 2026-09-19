import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { LubanEvent } from "../src/events.js";
import type { ModelCapabilities } from "../src/models/catalog.js";
import { AgentLoop } from "../src/agent-loop.js";
import { PermissionEngine } from "../src/permissions.js";
import { SessionStore } from "../src/session-store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { Tool } from "../src/tools/types.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-loop-guard-"));
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

const loopingTool: Tool = {
  name: "loop",
  description: "永远继续的工具",
  kind: "read",
  schema: z.object({}),
  run: async () => ({ output: "ok" }),
};

function toolCallStream() {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-call", toolCallId: `t-${Math.random()}`, toolName: "loop", input: "{}" },
        { type: "finish", finishReason: "tool-calls", usage },
      ],
    }),
  };
}

describe("AgentLoop guards", () => {
  it("stops after maxSteps and emits a non-fatal error", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-steps");
    const model = new MockLanguageModelV4({ doStream: () => toolCallStream() });
    const registry = new ToolRegistry();
    registry.register(loopingTool);
    const loop = new AgentLoop({
      model,
      capabilities: caps,
      tools: registry,
      store,
      permissions: new PermissionEngine({ mode: "yolo" }),
      approve: async () => ({ granted: false, remembered: false }),
      systemPrompt: "t",
      cwd: dir,
      maxSteps: 3,
    });

    const events: LubanEvent[] = [];
    for await (const event of loop.run("一直干", sessionId)) {
      events.push(event);
    }

    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls).toHaveLength(3);
    const error = events.at(-1);
    expect(error).toMatchObject({ type: "error", fatal: false });
    expect((error as { message: string }).message).toContain("最大步数");

    const stored = await store.read(sessionId);
    expect(stored.at(-1)).toMatchObject({ type: "error", fatal: false });
  }, 30_000);

  it("stops immediately when the budget is exhausted, without calling the model", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-budget");
    const model = new MockLanguageModelV4({ doStream: [toolCallStream()] });
    const registry = new ToolRegistry();
    registry.register(loopingTool);
    const loop = new AgentLoop({
      model,
      capabilities: caps,
      tools: registry,
      store,
      permissions: new PermissionEngine({ mode: "yolo" }),
      approve: async () => ({ granted: false, remembered: false }),
      systemPrompt: "t",
      cwd: dir,
      isOverBudget: () => true,
    });

    const events: LubanEvent[] = [];
    for await (const event of loop.run("干活", sessionId)) {
      events.push(event);
    }

    expect(model.doStreamCalls).toHaveLength(0);
    const error = events.at(-1);
    expect(error).toMatchObject({ type: "error", fatal: false });
    expect((error as { message: string }).message).toContain("预算");
  }, 30_000);
});
