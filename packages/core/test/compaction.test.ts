import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { ModouEvent } from "../src/events.js";
import type { ModelCapabilities, ModelMessage } from "../src/models/catalog.js";
import { AgentLoop } from "../src/agent-loop.js";
import { estimateTokens, needsCompaction } from "../src/context/compaction.js";
import { PermissionEngine } from "../src/permissions.js";
import { SessionStore } from "../src/session-store.js";
import { ToolRegistry } from "../src/tools/registry.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-compact-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// 极小窗口，便于用短消息触发压缩
const smallCaps: ModelCapabilities = {
  id: "test-model",
  provider: "anthropic",
  displayName: "Test",
  contextWindow: 1000,
  maxOutputTokens: 500,
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

describe("estimateTokens / needsCompaction", () => {
  it("estimates tokens as chars/4 including JSON overhead", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "x".repeat(400) }];
    const estimate = estimateTokens(messages);
    // 400 内容字符 + JSON 包装约 32 字符 → (432±)/4
    expect(estimate).toBeGreaterThanOrEqual(100);
    expect(estimate).toBeLessThan(130);
  });

  it("triggers compaction above the threshold of the context window", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "x".repeat(3400) }];
    expect(needsCompaction(messages, 1000, 0.8)).toBe(true);
    expect(needsCompaction([{ role: "user", content: "hi" }], 1000, 0.8)).toBe(false);
  });
});

describe("AgentLoop compaction", () => {
  it("compacts long histories before the model call and persists a compaction event", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-compact");
    const summaryText = "用户之前在讨论登录模块的修复方案。";
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: summaryText }],
        finishReason: "stop",
        usage,
        warnings: [],
      }),
      doStream: [textStream("继续任务")],
    });
    const loop = new AgentLoop({
      model,
      capabilities: smallCaps,
      tools: new ToolRegistry(),
      store,
      permissions: new PermissionEngine({ mode: "default" }),
      approve: async () => ({ granted: false, remembered: false }),
      systemPrompt: "t",
      cwd: dir,
    });

    const events: ModouEvent[] = [];
    // 4000 字符 ≈ 1000 token > 1000 窗口的 80% → 触发压缩
    for await (const event of loop.run("任务背景：".concat("x".repeat(3900)), sessionId)) {
      events.push(event);
    }

    const compaction = events.find((e) => e.type === "compaction");
    expect(compaction).toMatchObject({ summary: summaryText });
    const stored = await store.read(sessionId);
    expect(stored.some((e) => e.type === "compaction")).toBe(true);
    // 压缩后发给模型的 prompt 包含摘要
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain(summaryText);
    // 正常完成
    expect(events.some((e) => e.type === "assistant_message" && e.text === "继续任务")).toBe(true);
  });

  it("meters the summarization call cost into a usage event", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-compact-cost");
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "摘要" }],
        finishReason: "stop",
        usage,
        warnings: [],
      }),
      doStream: [textStream("继续")],
    });
    const loop = new AgentLoop({
      model,
      capabilities: smallCaps,
      tools: new ToolRegistry(),
      store,
      permissions: new PermissionEngine({ mode: "default" }),
      approve: async () => ({ granted: false, remembered: false }),
      systemPrompt: "t",
      cwd: dir,
    });

    const events: ModouEvent[] = [];
    for await (const event of loop.run("任务背景：".concat("x".repeat(3900)), sessionId)) {
      events.push(event);
    }

    // 压缩事件的用量应单独落盘为 usage 事件（成本可见）
    const usageEvents = events.filter((e) => e.type === "usage");
    const metered = usageEvents.some(
      (e) => e.type === "usage" && e.costUsd > 0 && e.inputTokens === 10,
    );
    expect(metered).toBe(true);
  });

  it("falls back to no compaction when the summarization call fails", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-compact-fail");
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("summarizer down");
      },
      doStream: [textStream("不压缩也能继续")],
    });
    const loop = new AgentLoop({
      model,
      capabilities: smallCaps,
      tools: new ToolRegistry(),
      store,
      permissions: new PermissionEngine({ mode: "default" }),
      approve: async () => ({ granted: false, remembered: false }),
      systemPrompt: "t",
      cwd: dir,
    });

    const events: ModouEvent[] = [];
    for await (const event of loop.run("任务背景：".concat("x".repeat(3900)), sessionId)) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "compaction")).toBe(false);
    const nonFatal = events.find(
      (e) => e.type === "error" && !e.fatal && e.message.includes("压缩"),
    );
    expect(nonFatal).toBeTruthy();
    expect(events.some((e) => e.type === "assistant_message" && e.text === "不压缩也能继续")).toBe(
      true,
    );
  });

  it("does not compact short histories", async () => {
    const store = new SessionStore(dir);
    const sessionId = await store.create("s-no-compact");
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "不该被调用" }],
        finishReason: "stop",
        usage,
        warnings: [],
      }),
      doStream: [textStream("好的")],
    });
    const loop = new AgentLoop({
      model,
      capabilities: smallCaps,
      tools: new ToolRegistry(),
      store,
      permissions: new PermissionEngine({ mode: "default" }),
      approve: async () => ({ granted: false, remembered: false }),
      systemPrompt: "t",
      cwd: dir,
    });
    const events: ModouEvent[] = [];
    for await (const event of loop.run("hi", sessionId)) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "compaction")).toBe(false);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
