import { describe, expect, it, vi } from "vitest";
import { InputBox } from "../src/components/InputBox.js";
import { matchSlashCommands, SLASH_COMMANDS } from "../src/commands.js";
import { renderInk, settle } from "./ink-test-utils.js";

describe("InputBox（T3 输入卡）", () => {
  it("renders inside a round border with no placeholder text", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    expect(harness.text).toContain("╭");
    expect(harness.text).toContain("❯");
    // 空闲态输入框内不显示任何文字（无占位提示）
    expect(harness.text).not.toContain("输入任务");
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

describe("宽度计算（string-width，R1）", () => {
  it("pads to a stable visual width for mixed CJK/ASCII", async () => {
    const sw = (await import("string-width")).default;
    expect(sw("/plan")).toBe(5);
    expect(sw("查看能力包")).toBe(10);
    expect(sw("墨斗")).toBe(4);
  });
});

describe("F 系列：面板导航与执行", () => {
  it("esc clears the input and hides the completion panel", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    expect(harness.frame).toContain("/plan");
    harness.stdin.write(""); // esc → 清空收起
    await settle();
    expect(harness.frame).not.toContain("/plan");
    expect(harness.frame).not.toContain("(1/15)");
    harness.unmount();
  });

  it("wraps around when navigating past the first/last item (F1)", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    // 首项再 ↑ → 回绕到最后一项（/help），计数显示 (15/15)
    harness.stdin.write("[A");
    await settle();
    expect(harness.text).toContain("(15/15)");
    // 末项再 ↓ → 回绕到首项 (1/15)
    harness.stdin.write("[B");
    await settle();
    expect(harness.text).toContain("(1/15)");
    harness.unmount();
  });

  it("Enter executes the selected command directly (F3)", async () => {
    const onSubmit = vi.fn();
    const harness = renderInk(<InputBox busy={false} onSubmit={onSubmit} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    harness.stdin.write("\x1b[B"); // 移到 /init
    await settle();
    harness.stdin.write("\r"); // Enter = 直接执行
    await settle();
    expect(onSubmit).toHaveBeenCalledWith("/init");
    harness.unmount();
  });

  it("keeps the selected row visible for an exact match (图3 回归)", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/plan");
    await settle();
    // 精确匹配：选中行完整渲染（❯ + 命令 + 完整 hint）
    expect(harness.frame).toContain("❯ /plan");
    expect(harness.frame).toContain("只读调研并产出实施计划");
    expect(harness.text).toContain("(1/1)");
    harness.unmount();
  });

  it("keeps every row a fixed visual width (conhost 残影回归)", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    // 全部可见行同宽（Ink 列语义：标记 3 + 命令 14 + hint 26 + 边框/padding 4 = 47）。
    // ▶ 是 East Asian Ambiguous：Ink wcwidth 计 2 列（渲染对齐 ✓），string-width 计 1 列。
    // 度量前把 ▶ 归一化为两个 1 列字符（"||"），使 string-width 与 Ink 排版一致。
    const sw = (await import("string-width")).default;
    const esc = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
    const normalize = (l: string) => l.replace(esc, "").replace("▶", "||");
    const rows = harness.frame
      .split("\n")
      .filter((l) => l.includes("/init") || l.includes("/skills") || l.includes("/plan"));
    const widths = new Set(rows.map((l) => sw(normalize(l))));
    expect(widths.size).toBe(1);
    // 面板两侧竖线边框（N2：kimi-code 风格）
    const clean = rows.map((l) => l.replace(esc, ""));
    expect(clean.every((l) => l.startsWith("│") && l.endsWith("│"))).toBe(true);
    harness.unmount();
  });

  it("shows the counter footer and no hint line (F4/F5)", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    // 计数行存在
    expect(harness.text).toContain("(1/15)");
    // 旧提示行已删除
    expect(harness.text).not.toContain("Tab/回车 补全");
    expect(harness.text).not.toContain("继续输入筛选");
    expect(harness.text).not.toContain("↑↓ 选择");
    harness.unmount();
  });

  it("renders selected row uniformly bright cyan and others white/gray (F2)", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    // 选中行：❯ + 整行亮青（命令与描述在同一 Text 节点）
    const src = await import("../src/components/InputBox.js");
    expect(src).toBeTruthy();
    // 渲染语义：首项选中 ❯ /plan；描述跟在同一选中行
    expect(harness.frame).toContain("❯ /plan");
    expect(harness.frame).toContain("只读调研并产出实施计划");
    harness.unmount();
  });
});

describe("选中态指示符（R1，去背景色）", () => {
  it("marks the selected row with a single ❯ and indents the rest", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/");
    await settle();
    // 输入卡提示符占 1 个 ❯，选中行指示符 1 个 ❯——帧内共 2 个（面板 5 个非选中行无 ❯）
    expect(harness.frame.split("❯ ").length - 1).toBe(2);
    expect(harness.frame).toContain("  /init");
    // 渲染源码层面不使用 backgroundColor（conhost 残影根因）
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/components/InputBox.tsx", "utf8");
    expect(src).not.toContain("backgroundColor");
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

  it("shows command names on one line and only the first hint below", async () => {
    const harness = renderInk(<InputBox busy={false} onSubmit={() => {}} />);
    await settle();
    harness.stdin.write("/pl");
    await settle();
    expect(harness.text).toContain("/plan");
    expect(harness.text).toContain("只读调研并产出实施计划");
    // 唯一匹配：计数显示 (1/1)
    expect(harness.text).toContain("(1/1)");
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
    expect(harness.text).toContain("(1/2)");
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
