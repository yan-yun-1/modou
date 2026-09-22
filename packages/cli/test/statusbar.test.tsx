import { describe, expect, it } from "vitest";
import { StatusBar, ctxBar, ctxColor, fmtTokens, fmtUsd } from "../src/components/StatusBar.js";
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

describe("StatusBar", () => {
  it("renders three segments: model·mode, tokens·cost, ctx bar", async () => {
    const harness = renderInk(
      <StatusBar
        model="glm-4.5-air"
        permissionMode="default"
        usage={usage}
        contextWindow={128_000}
        ctxUsedTokens={1234 + 567 + 89}
      />,
    );
    await settle();
    const text = harness.text;
    expect(text).toContain("glm-4.5-air · default");
    expect(text).toContain("↑1.2k");
    expect(text).toContain("↓567");
    expect(text).toContain("$0.000315");
    expect(text).toContain("ctx");
    expect(text).toContain("░");
    harness.unmount();
  });

  it("hides the ctx segment when contextWindow is absent", async () => {
    const harness = renderInk(
      <StatusBar model="glm-4.5-air" permissionMode="default" usage={usage} />,
    );
    await settle();
    expect(harness.text).not.toContain("ctx");
    harness.unmount();
  });

  it("shows budget after cost when provided", async () => {
    const harness = renderInk(
      <StatusBar
        model="m"
        permissionMode="default"
        usage={usage}
        budgetUsd={5}
        contextWindow={128_000}
        ctxUsedTokens={1000}
      />,
    );
    await settle();
    expect(harness.text).toContain("$0.000315/$5");
    harness.unmount();
  });

  it("shows $0 for a fresh session", async () => {
    const harness = renderInk(
      <StatusBar
        model="m"
        permissionMode="default"
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

describe("ctx helpers", () => {
  it("ctxBar fills proportionally (10 cells)", () => {
    expect(ctxBar(0)).toBe("░░░░░░░░░░");
    expect(ctxBar(0.31)).toBe("███░░░░░░░");
    expect(ctxBar(1)).toBe("██████████");
    expect(ctxBar(-1)).toBe("░░░░░░░░░░");
    expect(ctxBar(2)).toBe("██████████");
  });

  it("ctxColor warns at 80% and alerts at 95%", () => {
    expect(ctxColor(0.31)).toBeUndefined();
    expect(ctxColor(0.8)).toBe("yellow");
    expect(ctxColor(0.96)).toBe("red");
  });

  it("fmtTokens abbreviates", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(567)).toBe("567");
    expect(fmtTokens(1234)).toBe("1.2k");
    expect(fmtTokens(123_456)).toBe("123.5k");
    expect(fmtTokens(1_234_567)).toBe("1.2m");
  });

  it("fmtUsd keeps the legacy format", () => {
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(0.000315)).toBe("$0.000315");
    expect(fmtUsd(0.5)).toBe("$0.5");
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

    expect(seen).toEqual([null, "t1", "t1"]);
    bridge.answer({ granted: true, remembered: false });
    await expect(first).resolves.toEqual({ granted: true, remembered: false });
    expect(seen.at(-1)).toBe("t2");
    bridge.answer({ granted: false, remembered: false });
    await expect(second).resolves.toEqual({ granted: false, remembered: false });
    expect(seen.at(-1)).toBeNull();
  });
});
