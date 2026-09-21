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
