import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModouApp } from "../src/app.js";
import { renderInk, settle } from "./ink-test-utils.js";
import type { ModouEvent } from "@modou-dev/core";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-app-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeLoop(events: ModouEvent[]) {
  return {
    run: async function* (input: string, _sessionId: string): AsyncIterable<ModouEvent> {
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

describe("ModouApp", () => {
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
    const harness = renderInk(<ModouApp loop={loop} sessionId="s1" />);
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
    const harness = renderInk(<ModouApp loop={loop} sessionId="s1" />);
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
    const harness = renderInk(<ModouApp loop={loop} sessionId="s1" />);
    await settle();
    harness.stdin.write("go");
    await settle();
    harness.stdin.write("\r");
    await settle(200);

    expect(harness.text).toContain("预算已用尽");
    harness.unmount();
  }, 30_000);
});

describe("ModouApp sessions", () => {
  it("lists sessions and resumes one, switching the active session", async () => {
    const usedSessionIds: string[] = [];
    const loop = {
      run: async function* (input: string, sid: string): AsyncIterable<ModouEvent> {
        usedSessionIds.push(sid);
        yield { type: "assistant_message", text: `回复于 ${sid}`, at: 1 };
      },
    };
    const store = {
      list: async () => ["session-old-1", "session-old-2"],
    };
    const harness = renderInk(<ModouApp loop={loop} sessionId="session-current" store={store} />);
    await settle();

    harness.stdin.write("/sessions");
    await settle();
    harness.stdin.write("\r");
    await settle(150);
    expect(harness.text).toContain("session-old-1");

    harness.stdin.write("/resume session-old-1");
    await settle();
    harness.stdin.write("\r");
    await settle(150);

    harness.stdin.write("继续干活");
    await settle();
    harness.stdin.write("\r");
    await settle(200);

    expect(usedSessionIds).toContain("session-old-1");
    expect(harness.text).toContain("已切换到会话 session-old-1");
    harness.unmount();
  }, 30_000);

  it("notifies via onModelSwitch for /model", async () => {
    const onModelSwitch = vi.fn();
    const loop = {
      run: async function* (): AsyncIterable<ModouEvent> {
        yield { type: "assistant_message", text: "ok", at: 1 };
      },
    };
    const harness = renderInk(<ModouApp loop={loop} sessionId="s" onModelSwitch={onModelSwitch} />);
    await settle();
    harness.stdin.write("/model");
    await settle();
    harness.stdin.write("\r");
    await settle(150);
    expect(onModelSwitch).toHaveBeenCalledTimes(1);
    harness.unmount();
  }, 30_000);
});

describe("logo block（L2 修复）", () => {
  it("renders the ASCII logo above the welcome line when showLogo", async () => {
    const { SessionStore } = await import("@modou-dev/core");
    const store = new SessionStore(join(dir, "sessions-logo"));
    const sessionId = await store.create("s-logo");
    const loop = fakeLoop([
      { type: "session_started", sessionId, model: "test-model", at: 1 },
      {
        type: "usage",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.001,
        at: 2,
      },
    ]);
    const harness = renderInk(
      <ModouApp
        loop={loop}
        sessionId={sessionId}
        store={store}
        showLogo
        modelId="m"
        permissionMode="default"
      />,
    );
    await settle();
    expect(harness.text).toContain("███╗");
    expect(harness.text).toContain("██████╔╝");
    expect(harness.text).toContain("墨斗 · MODOU");
    // 版本行仍在 Logo 下方
    expect(harness.text).toContain("墨斗 v");
    harness.unmount();
  });

  it("hides the logo by default", async () => {
    const { SessionStore } = await import("@modou-dev/core");
    const store = new SessionStore(join(dir, "sessions-nologo"));
    const sessionId = await store.create("s-nologo");
    const loop = fakeLoop([
      {
        type: "usage",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.001,
        at: 1,
      },
    ]);
    const harness = renderInk(
      <ModouApp
        loop={loop}
        sessionId={sessionId}
        store={store}
        modelId="m"
        permissionMode="default"
      />,
    );
    await settle();
    expect(harness.text).not.toContain("███╗   ███╗");
    harness.unmount();
  });
});

describe("message history Static（T7）", () => {
  it("renders completed items once and keeps them frozen", async () => {
    const { SessionStore } = await import("@modou-dev/core");
    const store = new SessionStore(join(dir, "sessions-tui"));
    const sessionId = await store.create("s-tui");
    const loop = fakeLoop([
      { type: "session_started", sessionId, model: "test-model", at: 1 },
      { type: "user_message", text: "", at: 2 },
      { type: "assistant_message", text: "答案", at: 3 },
      {
        type: "usage",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.001,
        at: 4,
      },
    ]);
    const harness = renderInk(
      <ModouApp
        loop={loop}
        sessionId={sessionId}
        store={store}
        modelId="m"
        permissionMode="default"
      />,
    );
    await settle();
    harness.stdin.write("你好");
    await settle();
    harness.stdin.write("\r");
    await settle(300);
    // Static 模式下消息条目在"打印后冻结"：所有帧拼接中每条消息只出现一次
    expect(harness.text).toContain("❯ 你好");
    expect(harness.frames.some((f) => f.includes("答案"))).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    await settle();
    // Static 冻结验证：assistant 消息在全部帧拼接中只出现一次（不随动态区重渲而重复）
    expect(harness.text.split("答案").length - 1).toBe(1);
    harness.unmount();
  });
});
