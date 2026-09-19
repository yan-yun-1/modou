import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LubanApp } from "../src/app.js";
import { renderInk, settle } from "./ink-test-utils.js";
import type { LubanEvent } from "@luban/core";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-app-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeLoop(events: LubanEvent[]) {
  return {
    run: async function* (input: string, _sessionId: string): AsyncIterable<LubanEvent> {
      for (const event of events) {
        if (event.type === "user_message") {
          yield { ...event, text: input };
        } else {
          yield event;
        }
      }
    },
  };
}

describe("LubanApp", () => {
  it("echoes the user input and renders the assistant reply with cost", async () => {
    const loop = fakeLoop([
      { type: "session_started", sessionId: "s1", model: "test-model", at: 1 },
      { type: "user_message", text: "", at: 2 },
      { type: "text_delta", delta: "你好", at: 3 },
      { type: "assistant_message", text: "你好，我是鲁班", at: 4 },
      {
        type: "usage",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.000105,
        at: 5,
      },
    ]);
    const harness = renderInk(<LubanApp loop={loop} sessionId="s1" />);
    await settle();

    harness.stdin.write("hi");
    await settle();
    harness.stdin.write("\r");
    await settle(200);

    const text = harness.text;
    expect(text).toContain("hi");
    expect(text).toContain("你好，我是鲁班");
    expect(text).toContain("$0.000105");
    harness.unmount();
  }, 30_000);

  it("shows tool activity lines for tool calls and results", async () => {
    const loop = fakeLoop([
      { type: "user_message", text: "", at: 1 },
      { type: "tool_call", id: "t1", name: "grep", args: { pattern: "login" }, at: 2 },
      { type: "tool_result", id: "t1", output: "src/a.ts:1: login", truncated: false, at: 3 },
      { type: "assistant_message", text: "找到了", at: 4 },
    ]);
    const harness = renderInk(<LubanApp loop={loop} sessionId="s1" />);
    await settle();
    harness.stdin.write("go");
    await settle();
    harness.stdin.write("\r");
    await settle(200);

    const text = harness.text;
    expect(text).toContain("grep");
    expect(text).toContain("login");
    expect(text).toContain("找到了");
    harness.unmount();
  }, 30_000);

  it("renders errors from the loop without crashing", async () => {
    const loop = fakeLoop([
      { type: "user_message", text: "", at: 1 },
      { type: "error", message: "预算已用尽", fatal: false, at: 2 },
    ]);
    const harness = renderInk(<LubanApp loop={loop} sessionId="s1" />);
    await settle();
    harness.stdin.write("go");
    await settle();
    harness.stdin.write("\r");
    await settle(200);

    expect(harness.text).toContain("预算已用尽");
    harness.unmount();
  }, 30_000);
});
