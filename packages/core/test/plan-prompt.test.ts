import { describe, expect, it } from "vitest";
import { buildPlanTaskPrompt } from "../src/prompt.js";

describe("buildPlanTaskPrompt", () => {
  it("wraps the task with read-only plan instructions", () => {
    const prompt = buildPlanTaskPrompt("重构登录模块");
    expect(prompt).toContain("重构登录模块");
    expect(prompt).toContain("只读");
    expect(prompt).toContain("实施计划");
    expect(prompt).toMatch(/不要.*执行|禁止.*修改/);
  });
});
