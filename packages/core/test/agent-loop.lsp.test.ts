import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { ModouEvent } from "../src/events.js";
import type { ModelCapabilities } from "../src/models/catalog.js";
import { AgentLoop } from "../src/agent-loop.js";
import type { LspIntegration } from "../src/lsp.js";
import { PermissionEngine } from "../src/permissions.js";
import { SessionStore } from "../src/session-store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { Tool } from "../src/tools/types.js";

// M5 C3（PRD F16）：write 类工具成功后注入 LSP 诊断；失败静默；execute 不注入

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-loop-lsp-"));
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

function toolCallStream(id: string, name: string, args: object) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(args) },
        { type: "finish", finishReason: "tool-calls", usage },
      ],
    }),
  };
}

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

const fakeWrite: Tool<{ path: string; text: string }> = {
  name: "fakeWrite",
  description: "写入",
  kind: "write",
  schema: z.object({ path: z.string(), text: z.string() }),
  run: async (args, ctx) => {
    const { writeFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    await writeFile(resolve(ctx.cwd, args.path), args.text, "utf8");
    return { output: `wrote-${args.path}` };
  },
};

const fakeBash: Tool<{ command: string }> = {
  name: "fakeBash",
  description: "执行",
  kind: "execute",
  schema: z.object({ command: z.string() }),
  run: async (args) => ({ output: `ran-${args.command}` }),
};

async function runWithLsp(
  streams: unknown[],
  lsp: LspIntegration | undefined,
): Promise<{ events: ModouEvent[]; calls: unknown[] }> {
  const store = new SessionStore(dir);
  const sessionId = await store.create("s-lsp");
  const registry = new ToolRegistry();
  registry.register(fakeWrite);
  registry.register(fakeBash);
  const loop = new AgentLoop({
    model: new MockLanguageModelV4({ doStream: streams as never }),
    capabilities: caps,
    tools: registry,
    store,
    permissions: new PermissionEngine({ mode: "default" }),
    approve: async () => ({ granted: true, remembered: false }),
    systemPrompt: "test",
    cwd: dir,
    lsp,
  });
  const events: ModouEvent[] = [];
  for await (const event of loop.run("做点事", sessionId)) {
    events.push(event);
  }
  return { events, calls: [] };
}

describe("AgentLoop LSP 诊断注入（C3）", () => {
  it("write 成功后把 LSP 诊断附加到 tool_result", async () => {
    const diagnosticsAfterWrite = vi.fn(async (path: string) => `--- LSP 诊断 ---\n${path}:1:1 error`);
    const { events } = await runWithLsp(
      [toolCallStream("t1", "fakeWrite", { path: "a.ts", text: "broken" }), textStream("完成")],
      { diagnosticsAfterWrite, definition: async () => undefined },
    );
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toContain("wrote-a.ts");
    expect((result as { output: string }).output).toContain("--- LSP 诊断 ---");
    expect(diagnosticsAfterWrite).toHaveBeenCalledTimes(1);
    const [calledPath, content] = diagnosticsAfterWrite.mock.calls[0] as [string, string];
    expect(calledPath).toBe(join(dir, "a.ts"));
    expect(content).toBe("broken");
  });

  it("execute 工具不触发诊断注入", async () => {
    const diagnosticsAfterWrite = vi.fn(async () => undefined);
    await runWithLsp(
      [toolCallStream("t2", "fakeBash", { command: "ls" }), textStream("完成")],
      { diagnosticsAfterWrite, definition: async () => undefined },
    );
    expect(diagnosticsAfterWrite).not.toHaveBeenCalled();
  });

  it("诊断实现抛错时静默跳过，tool_result 照常回注", async () => {
    const { events } = await runWithLsp(
      [toolCallStream("t3", "fakeWrite", { path: "a.ts", text: "x" }), textStream("完成")],
      {
        diagnosticsAfterWrite: async () => {
          throw new Error("lsp down");
        },
        definition: async () => undefined,
      },
    );
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toBe("wrote-a.ts");
  });

  it("未配置 lsp 时行为不变", async () => {
    const { events } = await runWithLsp(
      [toolCallStream("t4", "fakeWrite", { path: "a.ts", text: "x" }), textStream("完成")],
      undefined,
    );
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toBe("wrote-a.ts");
  });
});
