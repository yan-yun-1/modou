import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModouApp } from "../src/app.js";
import { renderInk, settle } from "./ink-test-utils.js";
import type { ModouEvent } from "@modou-dev/core";

describe("T10 装配切换", () => {
  it("shows boot placeholder then ready note after onAssemble resolves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t10-"));
    const { SessionStore } = await import("@modou-dev/core");
    const store = new SessionStore(join(dir, "s"));
    const sessionId = await store.create("s-real");
    const loop = {
      run: async function* (input: string): AsyncIterable<ModouEvent> {
        yield { type: "assistant_message", text: `回复@${input}`, at: 1 };
      },
    };
    // 300ms 后完成的装配 promise（模拟 MCP/repo map 延迟）
    const promise = new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            loop,
            sessionId,
            store,
            mcpStatus: [{ name: "fs", connected: true, tools: 3 }],
            contextWindow: 128_000,
            updateSpent: () => {},
          }),
        300,
      );
    });
    const harness = renderInk(
      <ModouApp
        loop={null}
        sessionId="boot"
        store={store}
        modelId="glm-4.5-air"
        permissionMode="default"
        onAssemble={promise as never}
      />,
    );
    await settle();
    // 装配期：placeholder 是"正在装配上下文…"，提交被拦截
    expect(harness.text).toContain("正在装配上下文…");
    harness.stdin.write("你好");
    await settle();
    harness.stdin.write("\r");
    await settle();
    // 装配期：disabled 输入卡忽略提交——不产生 assistant 回复（"❯ 你好"是输入框回显，属正常）
    expect(harness.text).not.toContain("回复@");

    // 装配完成
    await new Promise((r) => setTimeout(r, 500));
    await settle();
    expect(harness.text).toContain("✓ 上下文就绪（MCP 1 server 已连接）");
    // ctx 段出现（contextWindow 接通）
    expect(harness.text).toContain("ctx");

    // 提交走真 loop
    harness.stdin.write("任务");
    await settle();
    harness.stdin.write("\r");
    await settle(400);
    // Static 帧里找（回复在独立 Static 帧；给足渲染时间）
    await settle(200);
    expect(harness.frames.some((f) => f.includes("回复@"))).toBe(true); // 提交文本含残留输入"你好"，只断言前缀
    harness.unmount();
    await rm(dir, { recursive: true, force: true });
  }, 15_000);
});
