import { describe, expect, it } from "vitest";
import type { ModouEvent } from "../src/events.js";
import { rebuildState } from "../src/session.js";

const base: ModouEvent[] = [
  { type: "session_started", sessionId: "s-1", model: "claude-sonnet-4", at: 1 },
  { type: "user_message", text: "修复登录 bug", at: 2 },
  { type: "assistant_message", text: "我先看一下相关代码", at: 3 },
  { type: "tool_call", id: "t1", name: "read", args: { path: "src/auth.ts" }, at: 4 },
  { type: "tool_result", id: "t1", output: "export function login() {}", truncated: false, at: 5 },
  { type: "assistant_message", text: "问题在第 3 行，已修复", at: 6 },
  {
    type: "usage",
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 4,
    cacheWriteTokens: 1,
    costUsd: 0.01,
    at: 7,
  },
  {
    type: "usage",
    inputTokens: 50,
    outputTokens: 5,
    cacheReadTokens: 2,
    cacheWriteTokens: 2,
    costUsd: 0.02,
    at: 8,
  },
  { type: "approval_request", id: "t2", name: "bash", args: {}, reason: "r", at: 9 },
  { type: "approval_result", id: "t2", granted: true, remembered: false, at: 10 },
  { type: "error", message: "无碍", fatal: false, at: 11 },
];

describe("rebuildState", () => {
  it("rebuilds AI SDK messages and usage totals from an event stream", () => {
    const { messages, usageTotals } = rebuildState(base);
    expect(messages).toEqual([
      { role: "user", content: "修复登录 bug" },
      { role: "assistant", content: [{ type: "text", text: "我先看一下相关代码" }] },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "t1", toolName: "read", input: { path: "src/auth.ts" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "t1",
            toolName: "read",
            output: { type: "text", value: "export function login() {}" },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "问题在第 3 行，已修复" }] },
    ]);
    expect(usageTotals).toEqual({
      inputTokens: 150,
      outputTokens: 15,
      cacheReadTokens: 6,
      cacheWriteTokens: 3,
      costUsd: 0.03,
    });
  });

  it("returns empty state for an empty event list", () => {
    const { messages, usageTotals } = rebuildState([]);
    expect(messages).toEqual([]);
    expect(usageTotals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    });
  });

  it("keeps a trailing assistant text that was never flushed by a tool call", () => {
    const { messages } = rebuildState([
      { type: "user_message", text: "hi", at: 1 },
      { type: "assistant_message", text: "hello", at: 2 },
    ]);
    expect(messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
  });
});
