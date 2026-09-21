import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "@modou/core";
import { ApprovalPrompt } from "../src/components/ApprovalPrompt.js";
import { renderInk, settle } from "./ink-test-utils.js";

const request: ApprovalRequest = {
  id: "t1",
  name: "bash",
  args: { command: "npm test" },
  reason: "执行命令需要审批",
};

describe("ApprovalPrompt", () => {
  it("renders the tool name, reason and args", async () => {
    const harness = renderInk(<ApprovalPrompt request={request} onAnswer={() => {}} />);
    await settle();
    const text = harness.text;
    expect(text).toContain("bash");
    expect(text).toContain("执行命令需要审批");
    expect(text).toContain("npm test");
    expect(text).toContain("y=允许");
    harness.unmount();
  });

  it("y grants once", async () => {
    const onAnswer = vi.fn();
    const harness = renderInk(<ApprovalPrompt request={request} onAnswer={onAnswer} />);
    await settle();
    harness.stdin.write("y");
    await settle();
    expect(onAnswer).toHaveBeenCalledWith({ granted: true, remembered: false });
    harness.unmount();
  });

  it("n rejects", async () => {
    const onAnswer = vi.fn();
    const harness = renderInk(<ApprovalPrompt request={request} onAnswer={onAnswer} />);
    await settle();
    harness.stdin.write("n");
    await settle();
    expect(onAnswer).toHaveBeenCalledWith({ granted: false, remembered: false });
    harness.unmount();
  });

  it("a grants and remembers", async () => {
    const onAnswer = vi.fn();
    const harness = renderInk(<ApprovalPrompt request={request} onAnswer={onAnswer} />);
    await settle();
    harness.stdin.write("a");
    await settle();
    expect(onAnswer).toHaveBeenCalledWith({ granted: true, remembered: true });
    harness.unmount();
  });

  it("shows the queued count when more approvals are pending (C2)", async () => {
    const harness = renderInk(
      <ApprovalPrompt request={request} queueCount={3} onAnswer={() => {}} />,
    );
    await settle();
    expect(harness.text).toContain("队列中还有 2 个待审批");
    harness.unmount();
  });

  it("hides the queue hint for a single pending approval (C2)", async () => {
    const harness = renderInk(
      <ApprovalPrompt request={request} queueCount={1} onAnswer={() => {}} />,
    );
    await settle();
    expect(harness.text).not.toContain("队列中还有");
    harness.unmount();
  });

  it("exposes pendingCount on the bridge and decrements after answer (C2)", async () => {
    const { ApprovalBridge } = await import("../src/approval-bridge.js");
    const bridge = new ApprovalBridge();
    void bridge.request(request);
    void bridge.request({ ...request, id: "t2" });
    expect(bridge.pendingCount).toBe(2);
    bridge.answer({ granted: true, remembered: false });
    expect(bridge.pendingCount).toBe(1);
    bridge.answer({ granted: false, remembered: false });
    expect(bridge.pendingCount).toBe(0);
  });

  it("renders the diff with add/remove lines when provided", async () => {
    const withDiff: ApprovalRequest = {
      ...request,
      diff: "@@ -1,1 +1,1 @@\n-old line\n+new line",
    };
    const harness = renderInk(<ApprovalPrompt request={withDiff} onAnswer={() => {}} />);
    await settle();
    const text = harness.text;
    expect(text).toContain("-old line");
    expect(text).toContain("+new line");
    // 有 diff 时不再重复显示原始参数 JSON
    expect(text).not.toContain('"command"');
    harness.unmount();
  });
});
