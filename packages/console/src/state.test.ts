import { describe, expect, it } from "vitest";
import {
  applyEventToView,
  emptyState,
  emptyView,
  markBusy,
  replayEvents,
  setCurrent,
  type ModouEvent,
} from "./state.js";

// plan-web B2：事件→状态纯函数层测试（不依赖 DOM）

const view = () => emptyView("s1");

describe("applyEventToView（B2 状态层）", () => {
  it("user_message 置 busy 并入列", () => {
    const next = applyEventToView(view(), { type: "user_message", text: "你好" });
    expect(next.busy).toBe(true);
    expect(next.items[0]).toMatchObject({ kind: "user", text: "你好" });
  });

  it("text_delta 累积、assistant_message finalize 清空", () => {
    let v = applyEventToView(view(), { type: "user_message", text: "hi" });
    v = applyEventToView(v, { type: "text_delta", delta: "你好" });
    v = applyEventToView(v, { type: "text_delta", delta: "，世界" });
    expect(v.streaming).toBe("你好，世界");
    v = applyEventToView(v, { type: "assistant_message", text: "你好，世界" });
    expect(v.streaming).toBeNull();
    expect(v.items.filter((i) => i.kind === "assistant")).toHaveLength(1);
  });

  it("assistant 与流式不一致时追加而非重复（对账去重）", () => {
    let v = applyEventToView(view(), { type: "text_delta", delta: "部分" });
    v = applyEventToView(v, { type: "assistant_message", text: "完整回复" });
    expect(v.items.filter((i) => i.kind === "assistant")).toHaveLength(1);
    expect(v.items.at(-1)?.text).toBe("完整回复");
  });

  it("tool_call/tool_result 按 id 配对，result 更新原卡", () => {
    let v = applyEventToView(view(), { type: "tool_call", id: "t1", name: "bash", args: { command: "ls" } });
    expect(v.items[0]).toMatchObject({ kind: "tool", status: "pending" });
    v = applyEventToView(v, { type: "tool_result", id: "t1", output: "done-out" });
    expect(v.items).toHaveLength(1);
    expect(v.items[0]).toMatchObject({ status: "done", output: "done-out" });
  });

  it("审批卡三态：pending → granted/denied", () => {
    let v = applyEventToView(view(), {
      type: "approval_request",
      id: "a1",
      name: "write",
      reason: "写入文件需要审批",
      diff: "-old\n+new",
    });
    expect(v.items[0]).toMatchObject({ kind: "approval", status: "pending", diff: "-old\n+new" });
    v = applyEventToView(v, { type: "approval_result", id: "a1", granted: true, remembered: false });
    expect(v.items[0]?.status).toBe("granted");
  });

  it("error 非致命：入列并清 busy", () => {
    const v = applyEventToView({ ...view(), busy: true }, { type: "error", message: "模型调用失败" });
    expect(v.items[0]).toMatchObject({ kind: "error" });
    expect(v.busy).toBe(false);
  });

  it("usage 累计；turnEnd 清 busy", () => {
    let v = { ...view(), busy: true };
    v = applyEventToView(v, { type: "usage", inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    expect(v.busy).toBe(true);
    expect(v.usage).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    v = applyEventToView(v, { type: "usage", inputTokens: 3, outputTokens: 2, costUsd: 0.02, turnEnd: true });
    expect(v.usage.inputTokens).toBe(13);
    expect(v.usage.outputTokens).toBe(7);
    expect(v.usage.costUsd).toBeCloseTo(0.03, 10);
    expect(v.busy).toBe(false);
  });

  it("回放完整一轮后 busy 为 false（取消按钮不显示）——用户实测回归", () => {
    const events: ModouEvent[] = [
      { type: "user_message", text: "介绍一下自己" },
      { type: "text_delta", delta: "忽略" },
      { type: "assistant_message", text: "我是墨斗" },
      { type: "usage", inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
    ];
    const state = replayEvents(emptyState(), "s1", events);
    expect(state.views["s1"]!.busy).toBe(false);
  });

  it("回放模式跳过 text_delta（assistant_message 是唯一文本事实）", () => {
    const events: ModouEvent[] = [
      { type: "user_message", text: "hi" },
      { type: "text_delta", delta: "应被跳过" },
      { type: "assistant_message", text: "最终文本" },
    ];
    const state = replayEvents(emptyState(), "s1", events);
    const v = state.views["s1"]!;
    expect(v.replay).toBe(true);
    expect(v.items.filter((i) => i.kind === "assistant")).toHaveLength(1);
    expect(v.streaming).toBeNull();
  });
});

describe("会话切换与 busy（B3）", () => {
  it("setCurrent 为新会话建空视图", () => {
    const state = setCurrent(emptyState(), "s9");
    expect(state.currentId).toBe("s9");
    expect(state.views["s9"]?.items).toEqual([]);
  });

  it("markBusy 置位后由 turnEnd usage 清除", () => {
    let state = setCurrent(emptyState(), "s1");
    state = markBusy(state, "s1");
    expect(state.views["s1"]?.busy).toBe(true);
    state = { ...state, views: { ...state.views, ["s1"]: applyEventToView(state.views["s1"]!, { type: "usage", turnEnd: true }) } };
    expect(state.views["s1"]?.busy).toBe(false);
  });
});
