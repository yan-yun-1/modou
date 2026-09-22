import { describe, expect, it } from "vitest";
import { CostBar } from "../src/components/CostBar.js";
import { ApprovalBridge } from "../src/approval-bridge.js";
import type { ApprovalRequest, UsageTotals } from "@modou-dev/core";
import { renderInk, settle } from "./ink-test-utils.js";

const usage: UsageTotals = {
  inputTokens: 1234,
  outputTokens: 567,
  cacheReadTokens: 89,
  cacheWriteTokens: 0,
  costUsd: 0.000315,
};

describe("CostBar", () => {
  it("shows token counts and cost", async () => {
    const harness = renderInk(<CostBar usage={usage} />);
    await settle();
    const text = harness.text;
    expect(text).toContain("↑1234");
    expect(text).toContain("↓567");
    expect(text).toContain("缓存读89");
    expect(text).toContain("$0.000315");
    harness.unmount();
  });

  it("shows the budget line when provided", async () => {
    const harness = renderInk(<CostBar usage={usage} budgetUsd={5} />);
    await settle();
    expect(harness.text).toContain("预算 $5");
    harness.unmount();
  });

  it("shows $0 for a fresh session", async () => {
    const harness = renderInk(
      <CostBar
        usage={{
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        }}
      />,
    );
    await settle();
    expect(harness.text).toContain("$0");
    harness.unmount();
  });
});

describe("ApprovalBridge", () => {
  const req: ApprovalRequest = { id: "t1", name: "bash", args: { command: "ls" }, reason: "r" };

  it("resolves the pending request on answer and notifies subscribers", async () => {
    const bridge = new ApprovalBridge();
    const seen: (ApprovalRequest | null)[] = [];
    bridge.subscribe((r) => seen.push(r));

    const promise = bridge.request(req);
    expect(seen.at(-1)).toBe(req);

    bridge.answer({ granted: true, remembered: false });
    await expect(promise).resolves.toEqual({ granted: true, remembered: false });
    expect(seen.at(-1)).toBeNull();
  });

  it("queues concurrent requests FIFO and resolves them in order", async () => {
    const bridge = new ApprovalBridge();
    const seen: (string | null)[] = [];
    bridge.subscribe((r) => seen.push(r?.id ?? null));

    const first = bridge.request(req);
    const second = bridge.request({ ...req, id: "t2" });

    // 队首展示 t1，t2 排队
    expect(seen).toEqual([null, "t1", "t1"]);
    bridge.answer({ granted: true, remembered: false });
    await expect(first).resolves.toEqual({ granted: true, remembered: false });
    // t1 回答后队首变为 t2
    expect(seen.at(-1)).toBe("t2");
    bridge.answer({ granted: false, remembered: false });
    await expect(second).resolves.toEqual({ granted: false, remembered: false });
    expect(seen.at(-1)).toBeNull();
  });
});
