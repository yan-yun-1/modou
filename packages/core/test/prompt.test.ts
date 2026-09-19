import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/prompt.js";

describe("buildSystemPrompt", () => {
  it("injects identity, environment and tool discipline", () => {
    const prompt = buildSystemPrompt({
      cwd: "E:/demo/project",
      platform: "win32",
      tools: ["read", "grep", "glob", "bash"],
      now: new Date("2026-09-19T12:00:00+08:00"),
    });
    expect(prompt).toContain("鲁班");
    expect(prompt).toContain("E:/demo/project");
    expect(prompt).toContain("win32");
    expect(prompt).toContain("2026-09-19");
    for (const tool of ["read", "grep", "glob", "bash"]) {
      expect(prompt).toContain(tool);
    }
  });

  it("keeps the exploration-before-action and verify-after-edit disciplines", () => {
    const prompt = buildSystemPrompt({
      cwd: "/tmp/x",
      platform: "linux",
      tools: ["read"],
    });
    expect(prompt).toMatch(/探索|定位/);
    expect(prompt).toMatch(/验证|测试/);
    expect(prompt).toContain("安全");
  });

  it("defaults now to the current date", () => {
    const prompt = buildSystemPrompt({ cwd: "/x", platform: "darwin", tools: [] });
    expect(prompt).toContain(new Date().toISOString().slice(0, 10));
  });
});
