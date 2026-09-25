import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HelpPanel } from "../src/components/HelpPanel.js";
import { ModouApp } from "../src/app.js";
import { renderInk, settle } from "./ink-test-utils.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "help-panel-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("HelpPanel（/help 临时面板）", () => {
  it("lists every slash command from SLASH_COMMANDS", async () => {
    const closed: number[] = [];
    const harness = renderInk(<HelpPanel onClose={() => closed.push(1)} />);
    await settle();
    // 清单与补全面板同源（SLASH_COMMANDS）
    expect(harness.text).toContain("可用命令");
    expect(harness.text).toContain("/cost");
    expect(harness.text).toContain("用量与成本");
    expect(harness.text).toContain("/permission");
    expect(harness.text).toContain("权限模式");
    expect(harness.text).toContain("esc 关闭");
    harness.unmount();
  });

  it("esc closes the panel", async () => {
    let closed = 0;
    const harness = renderInk(<HelpPanel onClose={() => closed++} />);
    await settle();
    harness.stdin.write("\u001b");
    await settle();
    expect(closed).toBe(1);
    harness.unmount();
  });

  it("enter also closes the panel", async () => {
    let closed = 0;
    const harness = renderInk(<HelpPanel onClose={() => closed++} />);
    await settle();
    harness.stdin.write("\r");
    await settle();
    expect(closed).toBe(1);
    harness.unmount();
  });
});

describe("/help App 集成", () => {
  it("opens the overlay on /help and returns to input on esc", async () => {
    const loop = { run: async function* () {} } as never;
    const harness = renderInk(
      <ModouApp loop={loop} sessionId="s" onSubmitTask={() => {}} showLogo={false} home={home} />,
    );
    await settle();
    harness.stdin.write("/help");
    await settle();
    harness.stdin.write("\r"); // 选择 /help 并回车 → 打开面板
    await settle();
    expect(harness.text).toContain("可用命令");
    expect(harness.text).toContain("/thinking");
    harness.stdin.write("\u001b"); // esc → 关闭
    await settle(150);
    // text 是全部帧拼接（面板帧曾出现过），关面板要看最后一帧
    expect(harness.frame).not.toContain("可用命令");
    expect(harness.frame).not.toContain("— 用量与成本");
    harness.unmount();
  }, 15_000);
});
