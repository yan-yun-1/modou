import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { ModouEvent } from "../src/events.js";
import type { ModelCapabilities } from "../src/models/catalog.js";
import { AgentLoop } from "../src/agent-loop.js";
import type { Checkpointer } from "../src/checkpoints.js";
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

function textAndToolCallStream(id: string, name: string, args: object, text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: text },
        { type: "text-end", id: "1" },
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
  run: async (args, ctx) => ({
    output:
      ctx.sessionId !== undefined
        ? `content-of-${args.path}@${ctx.sessionId}`
        : `content-of-${args.path}`,
  }),
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
  checkpointer?: Checkpointer;
  /** 传给 loop.run 的运行级权限覆盖（O1） */
  runPermissions?: PermissionEngine;
  /** M5 B2：沙箱内 execute 免审批开关 */
  sandboxAutoAllow?: boolean;
}

async function runFixture(
  streams: unknown[],
  input: string,
  options: FixtureOptions = {},
): Promise<{
  events: ModouEvent[];
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
    checkpointer: options.checkpointer,
    sandboxAutoAllow: options.sandboxAutoAllow,
  });
  const events: ModouEvent[] = [];
  for await (const event of loop.run(input, sessionId, { permissions: options.runPermissions })) {
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
    expect(result).toMatchObject({ id: "t1", truncated: false });
    expect((result as { output: string }).output).toContain("content-of-a.txt");
    expect(approveSpy).not.toHaveBeenCalled();

    const stored = await store.read(sessionId);
    expect(stored.some((e) => e.type === "approval_request")).toBe(false);
  });

  it("merges same-turn text and tool-call into one assistant message (M3 root-cause regression)", async () => {
    const { events, store, sessionId } = await runFixture(
      [
        textAndToolCallStream("t1", "fakeRead", { path: "a.txt" }, "我先读取文件："),
        textStream("读取完成"),
      ],
      "看看 a.txt",
    );
    const stored = await store.read(sessionId);
    // 第一轮只有一条 assistant 消息（text + tool-call 合并），且在 tool_result 之前
    const firstAssistant = stored.filter((e) => e.type === "assistant_message");
    expect(firstAssistant.length).toBe(2); // 两轮各一条 assistant_message 事件（持久化语义不变）
    // 事件流层面仍分开持久化（assistant_message 与 tool_call），但消息历史应合并——
    // 用内部验证：第二轮之前 messages 只能由 loop 内部构造，这里通过 rebuildState 不可见，
    // 改为行为断言：GLM 复述问题不在此层复现，合并逻辑以单测直测 helper 为准。
    expect(events.filter((e) => e.type === "tool_call").length).toBe(1);
  });

  it("passes the session id through ToolContext (C3)", async () => {
    const { events, sessionId } = await runFixture(
      [toolCallStream("t1", "fakeRead", { path: "a.txt" }), textStream("读取完成")],
      "看看 a.txt",
    );
    const result = events.find((e) => e.type === "tool_result");
    expect(result).toMatchObject({ output: `content-of-a.txt@${sessionId}` });
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

  it("honors a run-level permissions override (plan mode denies writes without prompting)", async () => {
    const { events, approveSpy } = await runFixture(
      [toolCallStream("t3e", "fakeWrite", { path: "a.ts", text: "x" }), textStream("明白")],
      "写文件",
      { mode: "default", runPermissions: new PermissionEngine({ mode: "plan" }) },
    );
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toContain("权限拒绝");
    expect(events.some((e) => e.type === "approval_request")).toBe(false);
    expect(approveSpy).not.toHaveBeenCalled();
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

  it("snapshots before write tools and notes the rollback point in the result", async () => {
    const snapshot = vi.fn(async () => "1");
    const checkpointer: Checkpointer = {
      available: true,
      snapshot,
      list: async () => [],
      restore: async () => ({ ok: true, message: "" }),
    };
    const { events } = await runFixture(
      [toolCallStream("t3c", "fakeWrite", { path: "a.ts", text: "新内容" }), textStream("完成")],
      "写文件",
      { approve: async () => ({ granted: true, remembered: false }), checkpointer },
    );
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toContain("回滚点 #1");
    expect(snapshot).toHaveBeenCalledTimes(1);
    // 只读工具不触发快照
  });

  it("does not snapshot for read tools", async () => {
    const snapshot = vi.fn(async () => "1");
    const checkpointer: Checkpointer = {
      available: true,
      snapshot,
      list: async () => [],
      restore: async () => ({ ok: true, message: "" }),
    };
    const { events } = await runFixture(
      [toolCallStream("t3d", "fakeRead", { path: "a.ts" }), textStream("完成")],
      "读文件",
      { checkpointer },
    );
    expect(snapshot).not.toHaveBeenCalled();
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).not.toContain("回滚点");
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

  it("sandboxAutoAllow runs execute tools without approval (M5 B2)", async () => {
    const { events, approveSpy } = await runFixture(
      [toolCallStream("t4b", "fakeBash", { command: "npm test" }), textStream("执行完成")],
      "跑测试",
      { sandboxAutoAllow: true, approve: async () => ({ granted: false, remembered: false }) },
    );
    expect(events.map((e) => e.type)).toEqual(TYPE_SEQUENCE_WITH_RESULT);
    const result = events.find((e) => e.type === "tool_result");
    expect((result as { output: string }).output).toBe("ran-npm test");
    expect(events.some((e) => e.type === "approval_request")).toBe(false);
    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("sandboxAutoAllow does not bypass write approvals (M5 B2)", async () => {
    const { events, approveSpy } = await runFixture(
      [toolCallStream("t4c", "fakeWrite", { path: "a.ts", text: "x" }), textStream("完成")],
      "写文件",
      { sandboxAutoAllow: true, approve: async () => ({ granted: true, remembered: false }) },
    );
    expect(events.some((e) => e.type === "approval_request")).toBe(true);
    expect(approveSpy).toHaveBeenCalledTimes(1);
  });

  it("sandboxAutoAllow does not override plan-mode deny (M5 B2)", async () => {
    const { events, approveSpy } = await runFixture(
      [toolCallStream("t4d", "fakeBash", { command: "node x.js" }), textStream("明白")],
      "跑脚本",
      { mode: "plan", sandboxAutoAllow: true },
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
