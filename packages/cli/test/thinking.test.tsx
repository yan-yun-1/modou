import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { thinkingToExtraBody } from "../src/provider-models.js";
import { parseCommand } from "../src/commands.js";
import { OptionPicker } from "../src/components/OptionPicker.js";
import { ModouApp } from "../src/app.js";
import type { UsageTotals } from "@modou-dev/core";
import { StatusBar, displayCwd } from "../src/components/StatusBar.js";
import { renderInk, settle } from "./ink-test-utils.js";

const usage: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

describe("thinkingToExtraBody（思考强度映射）", () => {
  it("glm: off → disabled, others → enabled", () => {
    expect(thinkingToExtraBody("glm", "off")).toEqual({ thinking: { type: "disabled" } });
    expect(thinkingToExtraBody("glm", "low")).toEqual({ thinking: { type: "enabled" } });
    expect(thinkingToExtraBody("glm", "high")).toEqual({ thinking: { type: "enabled" } });
  });

  it("qwen: enable_thinking boolean", () => {
    expect(thinkingToExtraBody("qwen", "off")).toEqual({ enable_thinking: false });
    expect(thinkingToExtraBody("qwen", "medium")).toEqual({ enable_thinking: true });
  });

  it("openrouter: reasoning effort / disabled", () => {
    expect(thinkingToExtraBody("openrouter", "off")).toEqual({ reasoning: { enabled: false } });
    expect(thinkingToExtraBody("openrouter", "high")).toEqual({ reasoning: { effort: "high" } });
  });

  it("providers without a standard param return undefined (setting ignored)", () => {
    expect(thinkingToExtraBody("deepseek", "high")).toBeUndefined();
    expect(thinkingToExtraBody("kimi", "low")).toBeUndefined();
    expect(thinkingToExtraBody("ollama", "off")).toBeUndefined();
    expect(thinkingToExtraBody("anthropic", "high")).toBeUndefined();
    expect(thinkingToExtraBody("openai", "high")).toBeUndefined();
  });
});

describe("/thinking 命令", () => {
  it("no argument → show current level", () => {
    expect(parseCommand("/thinking", usage)).toEqual({ action: "thinking" });
  });

  it("valid level → thinking action", () => {
    expect(parseCommand("/thinking high", usage)).toEqual({ action: "thinking", level: "high" });
    expect(parseCommand("/THINKING off", usage)).toEqual({ action: "thinking", level: "off" });
  });

  it("invalid level → usage message", () => {
    const result = parseCommand("/thinking ultra", usage);
    expect(result.action).toBe("message");
  });
});

describe("StatusBar 思考强度显示", () => {
  it("shows 思考X after model when set", async () => {
    const harness = renderInk(
      <StatusBar
        model="glm-4.5-air"
        thinking="high"
        permissionMode="default"
        usage={usage}
        cwd={displayCwd("E:\\Agent")}
      />,
    );
    await settle();
    expect(harness.text).toContain("default · glm-4.5-air · 思考high");
    harness.unmount();
  });

  it("omits the thinking segment when unset (permission mode unambiguous)", async () => {
    const harness = renderInk(
      <StatusBar model="glm-4.5-air" permissionMode="default" usage={usage} />,
    );
    await settle();
    expect(harness.text).toContain("default · glm-4.5-air");
    expect(harness.text).not.toContain("思考");
    harness.unmount();
  });
});

describe("/permission 命令", () => {
  it("no argument → picker action", () => {
    expect(parseCommand("/permission", usage)).toEqual({ action: "permission" });
  });

  it("valid mode → permission action", () => {
    expect(parseCommand("/permission yolo", usage)).toEqual({ action: "permission", level: "yolo" });
    expect(parseCommand("/permission default", usage)).toEqual({
      action: "permission",
      level: "default",
    });
  });

  it("invalid mode → usage message", () => {
    expect(parseCommand("/permission sudo", usage).action).toBe("message");
  });
});

describe("OptionPicker（通用选择器）", () => {
  it("arrows move selection, enter confirms", async () => {
    const confirmed: string[] = [];
    const harness = renderInk(
      <OptionPicker
        title="选择思考强度"
        options={[
          { value: "off", label: "off" },
          { value: "low", label: "low" },
          { value: "high", label: "high" },
        ]}
        onConfirm={(v) => confirmed.push(v)}
        onCancel={() => {}}
      />,
    );
    await settle();
    expect(harness.text).toContain("off");
    expect(harness.text).toContain("↑/↓ 移动");
    harness.stdin.write("\u001b[B"); // down → low
    await settle();
    harness.stdin.write("\r");
    await settle();
    expect(confirmed).toEqual(["low"]);
    harness.unmount();
  });

  it("esc cancels", async () => {
    let cancelled = 0;
    const harness = renderInk(
      <OptionPicker
        title="t"
        options={[{ value: "a", label: "a" }]}
        onConfirm={() => {}}
        onCancel={() => cancelled++}
      />,
    );
    await settle();
    harness.stdin.write("\u001b");
    await settle();
    expect(cancelled).toBe(1);
    harness.unmount();
  });
});

describe("/thinking 选择器（App 集成）", () => {
  it("opens the picker on /thinking and saves the picked level", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "thinking-home-"));
    try {
      const loop = { run: async function* () {} } as never;
      const harness = renderInk(
        <ModouApp loop={loop} sessionId="s" onSubmitTask={() => {}} showLogo={false} home={homeDir} />,
      );
      await settle();
      harness.stdin.write("/thinking");
      await settle();
      harness.stdin.write("\r"); // 提交 → 打开选择器
      await settle();
      expect(harness.text).toContain("选择思考强度");
      harness.stdin.write("\u001b[B"); // down → low
      await settle();
      harness.stdin.write("\r"); // 确认
      await settle(300);
      // 静默保存：不追加任何提示条目
      expect(harness.text).not.toContain("思考强度已设为");
      const saved = JSON.parse(
        await readFile(join(homeDir, ".modou", "settings.json"), "utf8"),
      ) as { thinking?: string };
      expect(saved.thinking).toBe("low");
      harness.unmount();
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 15_000);
});
