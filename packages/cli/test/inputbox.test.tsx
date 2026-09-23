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

describe("displayWidth（S 固定宽度）", () => {
  it("counts CJK as 2 columns and ASCII as 1", async () => {
    const { displayWidth } = await import("../src/components/InputBox.js");
    expect(displayWidth("/plan")).toBe(5);
    expect(displayWidth("查看能力包")).toBe(10);
    expect(displayWidth("")).toBe(0);
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

  it("shows command names on one line and only the first hint below", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/pl");
    await settle();
    expect(harness.text).toContain("/plan");
    expect(harness.text).toContain("只读调研并产出实施计划");
    // 唯一匹配：提示行无 ↑↓（仍教 Tab/回车 补全）
    expect(harness.text).not.toContain("↑↓ 选择");
    harness.unmount();
  });

  it("shows all commands as a single-column panel when typing just the slash", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    // 面板首屏可见（MAX_VISIBLE_ROWS=6 截断），底部固定提示含 ↑↓
    expect(harness.text).toContain("/plan");
    expect(harness.text).toContain("只读调研并产出实施计划");
    expect(harness.text).toContain("(Tab/回车 补全 · 继续输入筛选 · ↑↓ 选择)");
    harness.unmount();
  });

  it("highlights the selected row and navigates with arrows", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    // 首项默认选中（反色高亮包含命令名）
    expect(harness.text).toContain("/plan");
    // ↓ 移到第二项：/init 进入可见区
    harness.stdin.write("[B"); // down arrow
    await settle();
    expect(harness.text).toContain("/init");
    // ↑ 回到首项
    harness.stdin.write("[A"); // up arrow
    await settle();
    expect(harness.text).toContain("/plan");
    harness.unmount();
  });

  it("confirms the selected command with Enter in the panel", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    harness.stdin.write("\x1b[B"); // 选中 /init
    await settle();
    harness.stdin.write("\r"); // 面板内回车 = 补全（value 变 "/init "），不提交
    await settle();
    expect(harness.text).toContain("生成 AGENTS.md 模板");
    harness.unmount();
  });

  it("shows Tab hint only when multiple commands match", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/s");
    await settle();
    expect(harness.text).toContain("/sessions");
    expect(harness.text).toContain("↑↓ 选择");
    harness.unmount();
  });

  it("completes the first match on Tab", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/pl");
    await settle();
    harness.stdin.write("\t");
    await settle();
    expect(harness.text).toContain("/plan");
    expect(harness.text).toContain("只读调研并产出实施计划");
    // 唯一匹配不再教 Tab
    expect(harness.text).not.toContain("Tab 补全");
    harness.unmount();
  });
});
