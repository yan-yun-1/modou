import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "@luban/core";
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
});
