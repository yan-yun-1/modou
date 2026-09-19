import { describe, expect, it } from "vitest";
import { isLubanEvent, lubanEventSchema, parseEvent } from "../src/events.js";

const validEvents = [
  { type: "session_started", sessionId: "s-1", model: "claude-sonnet-4", at: 1 },
  { type: "user_message", text: "你好", at: 2 },
  { type: "assistant_message", text: "你好！", at: 3 },
  { type: "text_delta", delta: "正在流式输出", at: 4 },
  { type: "tool_call", id: "t1", name: "read", args: { path: "a.txt" }, at: 5 },
  { type: "tool_result", id: "t1", output: "line 1", truncated: false, at: 6 },
  {
    type: "approval_request",
    id: "t2",
    name: "bash",
    args: { command: "rm x" },
    reason: "执行命令需审批",
    at: 7,
  },
  { type: "approval_result", id: "t2", granted: false, remembered: false, at: 8 },
  {
    type: "usage",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 5,
    cacheWriteTokens: 3,
    costUsd: 0.001234,
    at: 9,
  },
  { type: "error", message: "超时", fatal: false, at: 10 },
] as const;

describe("LubanEvent schema", () => {
  it("accepts and round-trips every valid event type", () => {
    for (const event of validEvents) {
      const parsed = parseEvent(event);
      expect(parsed).toEqual(event);
      expect(lubanEventSchema.safeParse(JSON.parse(JSON.stringify(parsed))).success).toBe(true);
    }
  });

  it("exposes a discriminated union type usable in switch", () => {
    const event = parseEvent(validEvents[1]);
    let text: string;
    switch (event.type) {
      case "user_message":
        text = event.text;
        break;
      default:
        text = "other";
    }
    expect(text).toBe("你好");
  });

  it("rejects unknown event types", () => {
    expect(() => parseEvent({ type: "mystery", at: 1 })).toThrow();
  });

  it("rejects events with missing required fields", () => {
    expect(() => parseEvent({ type: "user_message", at: 1 })).toThrow();
    expect(() => parseEvent({ type: "session_started", sessionId: "s-1", at: 1 })).toThrow();
    expect(() => parseEvent({ type: "tool_result", id: "t1", output: "x", at: 1 })).toThrow();
  });

  it("rejects negative or non-integer timestamps", () => {
    expect(() => parseEvent({ type: "user_message", text: "x", at: -1 })).toThrow();
    expect(() => parseEvent({ type: "user_message", text: "x", at: 1.5 })).toThrow();
  });

  it("isLubanEvent narrows unknown values", () => {
    expect(isLubanEvent(validEvents[0])).toBe(true);
    expect(isLubanEvent({ hello: 1 })).toBe(false);
    expect(isLubanEvent(null)).toBe(false);
  });
});
