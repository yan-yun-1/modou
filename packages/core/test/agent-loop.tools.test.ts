import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  dir = await mkdtemp(join(tmpdir(), "luban-loop-tools-"));
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
        {
          type: "tool-call",
          toolCallId: id,
          toolName: name,
          input: JSON.stringify(args),
        },
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

const fakeRead: Tool<{ path: string }> = {
  name: "fakeRead",
  description: "读取",
  kind: "read",
  schema: z.object({ path: z.string() }),
  run: async (args) => ({ output: `content-of-${args.path}` }),
};

const fakeBash: Tool<{ command: string }> = {
  name: "fakeBash",
  description: "执行",
  kind: "execute",
  schema: z.object({ command: z.string() }),
  run: async (args) => ({ output: `ran-${args.command}` }),
};

const fakeWrite: Tool<{ path: string; text: string }> = {
  name: "fakeWrite",
  description: "写入",
  kind: "write",
  schema: z.object({ path: z.string(), text: z.string() }),
  run: async (args) => ({ output: `wrote-${args.path}` }),
  preview: async (args) => `-旧内容\n+${args.text}`,
};

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(fakeRead);
  registry.register(fakeBash);
  registry.register(fakeWrite);
  return registry;
}

interface FixtureOptions {
  mode?: "plan" | "default" | "yolo";
  approve?: (req: { id: string; name: string; args: unknown; reason: string }) => Promise<{
    granted: boolean;
    remembered: boolean;
  }>;
  rules?: Parameters<PermissionEngine["remember"]>[0][];
}

async function runFixture(
  streams: unknown[],
  input: string,
  options: FixtureOptions = {},
): Promise<{
  events: LubanEvent[];
  store: SessionStore;
  sessionId: string;
  approveSpy: ReturnType<typeof vi.fn>;
}> {
  const store = new SessionStore(dir);
  const sessionId = await store.create("s-tools");
  const engine = new PermissionEngine({
    mode: options.mode ?? "default",
    rules: options.rules ?? [],
  });
  const approveSpy = vi.fn(
    options.approve ?? (async () => ({ granted: false, remembered: false })),
  );
  const loop = new AgentLoop({
    model: new MockLanguageModelV4({ doStream: streams as never }),
    capabilities: caps,
    tools: makeRegistry(),
    store,
    permissions: engine,
    approve: approveSpy,
    systemPrompt: "test",
    cwd: dir,
  });
  const events: LubanEvent[] = [];
  for await (const event of loop.run(input, sessionId)) {
    events.push(event);
  }
  return { events, store, sessionId, approveSpy };
}

const TYPE_SEQUENCE_WITH_RESULT = [
  "session_started",
  "user_message",
  "tool_call",
  "tool_result",
  "usage",
  "text_delta",
  "assistant_message",
  "usage",
];

describe("AgentLoop tools", () => {
  it("auto-allows read tools and executes them without approval", async () => {
    const { events, store, sessionId, approveSpy } = await runFixture(
      [toolCallStream("t1", "fakeRead", { path: "a.txt" }), textStream("读取完成")],
      "看看 a.txt",
    );
    expect(events.map((e) => e.type)).toEqual(TYPE_SEQUENCE_WITH_RESULT);
    const result = events.find((e) => e.type === "tool_result");
    expect(result).toMatchObject({ id: "t1", output: "content-of-a.txt", truncated: false });
    expect(approveSpy).not.toHaveBeenCalled();

    const stored = await store.read(sessionId);
    expect(stored.some((e) => e.type === "approval_request")).toBe(false);
  });

  it("asks for approval on execute tools, persists the round-trip, remembers the rule", async () => {
    const { events, approveSpy } = await runFixture(
      [toolCallStream("t2", "fakeBash", { command: "ls -la" }), textStream("执行完成")],
      "列目录",
      { approve: async () => ({ granted: true, remembered: true }) },
    );
    expect(events.map((e) => e.type)).toEqual([
      "session_started",
      "user_message",
      "tool_call",
      "approval_request",
      "approval_result",
      "tool_result",
      "usage",
      "text_delta",
      "assistant_message",
      "usage",
    ]);
    expect(events.find((e) => e.type === "approval_request")).toMatchObject({
      id: "t2",
      name: "fakeBash",
      args: { command: "ls -la" },
    });
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({
      output: "ran-ls -la",
    });
    expect(approveSpy).toHaveBeenCalledTimes(1);
    expect(approveSpy.mock.calls[0]?.[0].reason).toContain("审批");
  });

  it("feeds a rejection back to the model as a tool result", async () => {
    const { events } = await runFixture(
      [toolCallStream("t3", "fakeBash", { command: "node bad.js" }), textStream("好的，我不执行")],
      "跑坏脚本",
      { approve: async () => ({ granted: false, remembered: false }) },
    );
    const result = events.find((e) => e.type === "tool_result");
    expect(result).toMatchObject({ id: "t3" });
    expect((result as { output: string }).output).toContain("拒绝");
    const approvalResult = events.find((e) => e.type === "approval_result");
    expect(approvalResult).toMatchObject({ granted: false, remembered: false });
  });

  it("attaches a preview diff to approval requests for tools that implement preview", async () => {
    const { events } = await runFixture(
      [toolCallStream("t3b", "fakeWrite", { path: "a.ts", text: "新内容" }), textStream("完成")],
      "写文件",
      { approve: async () => ({ granted: true, remembered: false }) },
    );
    const request = events.find((e) => e.type === "approval_request");
    expect(request).toMatchObject({ diff: "-旧内容\n+新内容" });
  });

  it("denies execute tools in plan mode without prompting", async () => {
    const { events, approveSpy } = await runFixture(
      [toolCallStream("t4", "fakeBash", { command: "node x.js" }), textStream("明白")],
      "跑脚本",
      { mode: "plan" },
    );
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toContain("权限拒绝");
    expect(events.some((e) => e.type === "approval_request")).toBe(false);
    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("reports schema validation failures as a non-fatal error and tool result", async () => {
    const { events } = await runFixture(
      [toolCallStream("t5", "fakeRead", { nope: true }), textStream("我重试")],
      "读文件",
    );
    const error = events.find((e) => e.type === "error");
    expect(error).toMatchObject({ fatal: false });
    expect((error as { message: string }).message).toContain("fakeRead");
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toContain("参数校验失败");
  });

  it("reports unknown tools without crashing the loop", async () => {
    const { events } = await runFixture(
      [toolCallStream("t6", "ghostTool", {}), textStream("好吧")],
      "用幻影工具",
    );
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toContain("未知工具");
  });
});
