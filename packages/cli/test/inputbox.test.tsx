import { describe, expect, it, vi } from "vitest";
import { InputBox } from "../src/components/InputBox.js";
import { matchSlashCommands, SLASH_COMMANDS } from "../src/commands.js";
import { renderInk, settle } from "./ink-test-utils.js";

describe("InputBox（T3 输入卡）", () => {
  it("renders inside a round border with a placeholder", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    expect(harness.text).toContain("╭");
    expect(harness.text).toContain("❯");
    expect(harness.text).toContain("输入任务，/ 开头为命令…");
    harness.unmount();
  });

  it("renders nothing while busy", async () => {
    const harness = renderInk(<InputBox busy onSubmit={() => {}} />);
    await settle();
    expect(harness.text).not.toContain("❯");
    harness.unmount();
  });

  it("shows the custom placeholder when provided", async () => {
    const harness = renderInk(
      <InputBox busy={false} onSubmit={() => {}} placeholder="正在装配上下文…" />,
    );
    await settle();
    expect(harness.text).toContain("正在装配上下文…");
    harness.unmount();
  });

  it("ignores submit while disabled", async () => {
    const onSubmit = vi.fn();
    const harness = renderInk(
      <InputBox busy={false} onSubmit={onSubmit} disabled placeholder="x" />,
    );
    await settle();
    harness.stdin.write("hello\r");
    await settle();
    expect(onSubmit).not.toHaveBeenCalled();
    harness.unmount();
  });
});

describe("slash command completion（T4）", () => {
  it("exposes SLASH_COMMANDS with hints", () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThanOrEqual(10);
    const plan = SLASH_COMMANDS.find((c) => c.name === "/plan");
    expect(plan?.hint).toContain("计划");
  });

  it("matches commands by prefix", () => {
    expect(matchSlashCommands("/pl").map((c) => c.name)).toEqual(["/plan"]);
    expect(
      matchSlashCommands("/s")
        .map((c) => c.name)
        .sort(),
    ).toEqual(["/sessions", "/skills"]);
    expect(matchSlashCommands("").length).toBe(SLASH_COMMANDS.length);
    expect(matchSlashCommands("/nope")).toEqual([]);
  });

  it("shows matching suggestions when input starts with /", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/pl");
    await settle();
    expect(harness.text).toContain("/plan");
    expect(harness.text).toContain("Tab 补全");
    harness.unmount();
  });

  it("completes the first match on Tab", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/pl");
    await settle();
    harness.stdin.write("\t");
    await settle();
    expect(harness.text).toContain("/plan 只读调研并产出实施计划");
    // 提示行仍显示（value 以 / 开头）
    expect(harness.text).toContain("Tab 补全");
    harness.unmount();
  });
});
