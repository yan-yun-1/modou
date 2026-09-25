import { describe, expect, it } from "vitest";
import { isUnfilledTemplate } from "../src/context/agents-md.js";

// M4 E1（dogfood#4）：未填写的 init 模板整段跳过
describe("isUnfilledTemplate（M4 E1）", () => {
  it("detects the unfilled init template placeholders", () => {
    const template = [
      "# AGENTS.md",
      "",
      "<一到三句话说明这个项目>",
      "",
      "- 安装依赖：<例如 pnpm install>",
    ].join("\n");
    expect(isUnfilledTemplate(template)).toBe(true);
    // 真实填写的 AGENTS.md 不误伤
    expect(isUnfilledTemplate(["# AGENTS.md", "", "本项目用 pnpm，测试跑 vitest。"].join("\n"))).toBe(
      false,
    );
  });
});
