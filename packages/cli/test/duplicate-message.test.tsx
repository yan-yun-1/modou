import { describe, expect, it } from "vitest";
import { ModouApp } from "../src/app.js";
import { renderInk, settle } from "./ink-test-utils.js";

/**
 * 真机 bug 复现（conhost 截图：回复重复出现多次）：
 * 多步工具循环中，模型每步都会产出一条 assistant_message——
 * GLM 在工具步只回 "\n"（纯空白消息被渲染成空行块），完成步有时整段复述上一条。
 * 修复：空白消息过滤 + 相邻完全相同的 assistant 消息去重。
 */
function loopWithEvents(events: unknown[]) {
  let called = false;
  return {
    run: async function* () {
      if (!called) {
        called = true;
        for (const e of events) {
          yield e as never;
        }
      }
    },
  } as never;
}

describe("assistant 消息去重（真机重复 bug）", () => {
  it("filters blank assistant messages from tool steps", async () => {
    const loop = loopWithEvents([
      { type: "user_message", text: "读 readme", at: 1 },
      { type: "text_delta", delta: "我来帮您读取", at: 2 },
      { type: "assistant_message", text: "\n我来帮您读取\n", at: 3 },
      { type: "tool_call", id: "t1", name: "read", args: { path: "readme.md" }, at: 4 },
      { type: "tool_result", id: "t1", output: "ok", at: 5 },
      { type: "assistant_message", text: "\n", at: 6 }, // GLM 工具步空消息
      { type: "tool_call", id: "t2", name: "read", args: { path: "notes.md" }, at: 7 },
      { type: "tool_result", id: "t2", output: "ok", at: 8 },
      { type: "assistant_message", text: "最终回答", at: 9 },
      { type: "usage", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costUsd: 0.001, at: 10 },
    ]);
    const harness = renderInk(
      <ModouApp loop={loop} sessionId="s1" onSubmitTask={() => {}} showLogo={false} />,
    );
    await settle();
    harness.stdin.write("读 readme");
    await settle();
    harness.stdin.write("\r");
    await settle(500);
    const esc = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
    const all = harness.frames.join("").replace(esc, "");
    expect(all).toContain("我来帮您读取");
    expect(all).toContain("最终回答");
    harness.unmount();
  });

  it("dedupes adjacent identical assistant messages (model restating)", async () => {
    const loop = loopWithEvents([
      { type: "user_message", text: "hi", at: 1 },
      { type: "assistant_message", text: "同样的回复", at: 2 },
      { type: "assistant_message", text: "同样的回复", at: 3 },
      { type: "assistant_message", text: "同样的回复", at: 4 },
      { type: "usage", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costUsd: 0.001, at: 5 },
    ]);
    const harness = renderInk(
      <ModouApp loop={loop} sessionId="s1" onSubmitTask={() => {}} showLogo={false} />,
    );
    await settle();
    harness.stdin.write("hi");
    await settle();
    harness.stdin.write("\r");
    await settle(500);
    const esc = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
    const staticFrames = harness.frames.filter((f) => f.replace(esc, "").includes("同样的回复"));
    // Static 每条 item 单独一帧：3 条重复消息 → 去重后只剩 1 帧
    expect(staticFrames).toHaveLength(1);
    harness.unmount();
  });

  it("keeps distinct consecutive assistant messages", async () => {
    const loop = loopWithEvents([
      { type: "user_message", text: "hi", at: 1 },
      { type: "assistant_message", text: "第一步结论", at: 2 },
      { type: "assistant_message", text: "第二步结论", at: 3 },
      { type: "usage", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costUsd: 0.001, at: 4 },
    ]);
    const harness = renderInk(
      <ModouApp loop={loop} sessionId="s1" onSubmitTask={() => {}} showLogo={false} />,
    );
    await settle();
    harness.stdin.write("hi");
    await settle();
    harness.stdin.write("\r");
    await settle(500);
    const esc = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
    const all = harness.frames.join("").replace(esc, "");
    expect(all).toContain("第一步结论");
    expect(all).toContain("第二步结论");
    harness.unmount();
  });
});
