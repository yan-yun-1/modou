import { describe, expect, it } from "vitest";
import { thinkingToExtraBody } from "../src/provider-models.js";
import { parseCommand } from "../src/commands.js";
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
    expect(harness.text).toContain("glm-4.5-air · 思考high · default");
    harness.unmount();
  });

  it("omits the thinking segment when unset (permission mode unambiguous)", async () => {
    const harness = renderInk(
      <StatusBar model="glm-4.5-air" permissionMode="default" usage={usage} />,
    );
    await settle();
    expect(harness.text).toContain("glm-4.5-air · default");
    expect(harness.text).not.toContain("思考");
    harness.unmount();
  });
});
