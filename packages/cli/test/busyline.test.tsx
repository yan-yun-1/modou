import { describe, expect, it, vi } from "vitest";
import { BusyLine } from "../src/components/BusyLine.js";
import { renderInk, settle } from "./ink-test-utils.js";

describe("BusyLine（T5 忙碌行）", () => {
  it("shows the action, spinner frame, esc hint and step count", async () => {
    const harness = renderInk(
      <BusyLine
        action={'read {"path":"a.ts"}'}
        startedAt={Date.now()}
        steps={3}
        elapsedSeconds={12.3}
      />,
    );
    await settle();
    const text = harness.text;
    expect(text).toContain('read {"path":"a.ts"}');
    expect(text).toContain("esc 中断");
    expect(text).toContain("12.3s");
    expect(text).toContain("第 3 步");
    // spinner 帧字符之一
    expect(text).toMatch(/[✻✽✜✢✣✲✳]/);
    harness.unmount();
  });

  it("falls back to 思考中… when no tool has run yet", async () => {
    const harness = renderInk(<BusyLine startedAt={Date.now()} steps={0} elapsedSeconds={0.5} />);
    await settle();
    expect(harness.text).toContain("思考中…");
    expect(harness.text).not.toContain("第");
    harness.unmount();
  });

  it("animates the spinner over time", async () => {
    const harness = renderInk(<BusyLine action="x" startedAt={Date.now()} steps={1} />);
    await settle();
    const first = harness.frame;
    // 等待 ≥2 个 spinner 帧（120ms/帧）——真实定时器，避免与夹具 settle 的真实 setTimeout 冲突
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    expect(harness.frame).not.toBe(first);
    harness.unmount();
  }, 10_000);
});
