import { describe, expect, it } from "vitest";
import { ModouApp } from "../src/app.js";
import { renderInk, settle } from "./ink-test-utils.js";

describe("App 层补全面板回归（Static+gap 吞行 bug）", () => {
  it("keeps the selected /plan row visible in the app tree", async () => {
    const harness = renderInk(
      <ModouApp
        loop={null as never}
        sessionId="s"
        onSubmitTask={() => {}}
        showLogo
        contextWindow={100000}
      />,
    );
    await settle();
    harness.stdin.write("/");
    await settle();
    const esc = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
    const clean = harness.frame.replace(esc, "");
    // 曾因外层 gap 与 Static 叠加导致选中行整行消失（真机 conhost 复现）
    expect(clean).toContain("❯ /plan");
    expect(clean).toContain("只读调研并产出实施计划");
    expect(clean).toContain("(1/14)");
    // 状态栏在输入框/面板下方（U1）：在最后一帧内比较行序
    const last = harness.frame.replace(esc, "");
    const lastLines = last.split("\n");
    const panelIdx = lastLines.findIndex((l) => l.includes("(1/14)"));
    const statusIdx = lastLines.findIndex((l) => l.includes("ctx 0% (0/100k)"));
    expect(panelIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(panelIdx);
    // Logo 在 Static 首条（顶部横幅），历史消息在它下面；无品牌残留（U2/U3）
    expect(last).not.toContain("墨斗 · MODOU");
    expect(last).not.toContain("墨斗 v");
    // 新消息渲染在 logo 之下（Static 首条 = logo）
    const all = harness.frames.join("").replace(esc, "");
    const allLines = all.split("\n").filter((l) => l.trim() !== "");
    const logoLine = allLines.findIndex((l) => l.includes("███╗"));
    const msgLine = allLines.findIndex((l) => l.includes("❯ /"));
    expect(logoLine).toBeGreaterThanOrEqual(0);
    expect(msgLine).toBeGreaterThan(logoLine);
    harness.unmount();
  });
});
