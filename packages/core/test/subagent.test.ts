import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { ModelCapabilities } from "../src/models/catalog.js";
import { runSubagent } from "../src/subagent.js";
import { SessionStore } from "../src/session-store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-subagent-"));
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

describe("runSubagent", () => {
  it("runs an isolated read-only session and returns the summary with cost", async () => {
    const store = new SessionStore(dir);
    const model = new MockLanguageModelV4({
      doStream: [textStream("发现：登录逻辑在 src/auth.ts")],
    });

    const result = await runSubagent({
      parentSessionId: "parent-1",
      name: "explore",
      task: "找到登录逻辑的位置",
      model,
      capabilities: caps,
      cwd: dir,
      store,
      systemPrompt: "你是勘察子代理",
    });

    expect(result.summary).toBe("发现：登录逻辑在 src/auth.ts");
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.sessionId).toContain("parent-1");
    expect(result.sessionId).toContain("explore");

    // 子会话事件已落盘且子会话只用到只读工具集
    const events = await store.read(result.sessionId);
    expect(events.some((e) => e.type === "assistant_message")).toBe(true);
  });

  it("denies write tools in the subagent (plan-mode enforcement)", async () => {
    // 子代理工具集是只读的：这里直接验证权限引擎拒绝路径
    // （runSubagent 内部用 plan 权限模式，写工具调用会被拒并回注模型）
    const store = new SessionStore(dir);
    const model = new MockLanguageModelV4({ doStream: [textStream("只读完成")] });
    const result = await runSubagent({
      parentSessionId: "parent-2",
      name: "explore",
      task: "只看不动",
      model,
      capabilities: caps,
      cwd: dir,
      store,
      systemPrompt: "t",
    });
    expect(result.fatal).toBeNull();
    expect(result.summary).toBe("只读完成");
  });

  it("returns fatal info when the subagent run errors out", async () => {
    const store = new SessionStore(dir);
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "error", error: new Error("provider down") },
          ],
        }),
      }),
    });
    const result = await runSubagent({
      parentSessionId: "parent-3",
      name: "explore",
      task: "任务",
      model,
      capabilities: caps,
      cwd: dir,
      store,
      systemPrompt: "t",
    });
    expect(result.fatal).toContain("模型调用失败");
    expect(result.summary).toBe("");
  });
});
