import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageModel, ModouEvent } from "@modou-dev/core";
import { AgentLoop, createBuiltinTools, SessionStore } from "../src/index.js";
import type { AgentHooks } from "../src/agent-loop.js";

// M4 D1/D3（PRD F14）：工具生命周期钩子

let dir: string;
let store: SessionStore;
let sessionId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hooks-"));
  store = new SessionStore(dir);
  sessionId = await store.create("sess-hooks");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 两步模型：第一步发起 bash 工具调用，第二步纯文本回复 */
function toolThenTextModel(): LanguageModel {
  let call = 0;
  return {
    specificationVersion: "v2",
    provider: "stub",
    modelId: "stub",
    doStream: async () => {
      call++;
      const chunks =
        call === 1
          ? [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: "call-1", toolName: "bash", input: JSON.stringify({ command: "echo hi" }) },
              { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 5, outputTokens: 1 } },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "2" },
              { type: "text-delta", id: "2", delta: "完成" },
              { type: "text-end", id: "2" },
              { type: "finish", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 1 } },
            ];
      return { stream: new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } }) };
    },
  } as unknown as LanguageModel;
}

function makeLoop(hooks: AgentHooks, model?: LanguageModel): AgentLoop {
  return new AgentLoop({
    model: model ?? toolThenTextModel(),
    capabilities: {
      id: "fake",
      provider: "openai",
      displayName: "f",
      contextWindow: 100_000,
      maxOutputTokens: 8_000,
      supportsTools: true,
      supportsReasoning: false,
      pricing: { inputPerMtokUsd: 0, outputPerMtokUsd: 0, cacheReadPerMtokUsd: 0, cacheWritePerMtokUsd: 0 },
    },
    tools: createBuiltinTools(),
    systemPrompt: "t",
    store,
    cwd: dir,
    permissions: { decide: () => "allow" } as never,
    hooks,
  });
}

describe("AgentHooks（F14）", () => {
  it("preToolUse deny blocks execution with the hook reason", async () => {
    const loop = makeLoop({
      preToolUse: async () => ({ decision: "deny", reason: "测试钩子禁止" }),
    });
    const events: ModouEvent[] = [];
    for await (const e of loop.run("跑命令", sessionId)) {
      events.push(e);
    }
    const result = events.find((e) => e.type === "tool_result");
    expect(result && "output" in result).toBe(true);
    expect((result as { output: string }).output).toContain("Hook 拒绝：测试钩子禁止");
  });

  it("preToolUse rewrites args before execution", async () => {
    const loop = makeLoop({
      preToolUse: async (ctx) => ({ args: { ...ctx.args, command: "echo rewritten-by-hook" } }),
    });
    const events: ModouEvent[] = [];
    for await (const e of loop.run("跑命令", sessionId)) {
      events.push(e);
    }
    const result = events.find((e) => e.type === "tool_result");
    expect(result && "output" in result).toBe(true);
    expect((result as { output: string }).output).toContain("rewritten-by-hook");
  });

  it("postToolUse appends output on success", async () => {
    const loop = makeLoop({
      postToolUse: async () => "[hook] 已附加诊断信息",
    });
    const events: ModouEvent[] = [];
    for await (const e of loop.run("跑命令", sessionId)) {
      events.push(e);
    }
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toContain("已附加诊断信息");
  });
});
