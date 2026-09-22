import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentLoop, type ModelCapabilities } from "@modou-dev/core";
import { createLoopFromSettings } from "../src/loop-factory.js";
import { ApprovalBridge } from "../src/approval-bridge.js";
import type { Settings } from "../src/settings.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "modou-factory-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const settings: Settings = {
  provider: "anthropic",
  modelId: "claude-sonnet-4-5",
  apiKey: "sk-test",
  permissionMode: "default",
};

const glmOverride: ModelCapabilities = {
  id: "glm-4.5-air",
  provider: "glm",
  displayName: "GLM-4.5-Air",
  contextWindow: 128_000,
  maxOutputTokens: 96_000,
  supportsTools: true,
  supportsReasoning: true,
  pricing: {
    inputPerMtokUsd: 0.11,
    outputPerMtokUsd: 0.28,
    cacheReadPerMtokUsd: 0.011,
    cacheWritePerMtokUsd: 0,
  },
};

describe("createLoopFromSettings", () => {
  it("injects discovered skills into the system prompt (D2)", async () => {
    const skillDir = join(dir, ".luban", "skills", "commit-style");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: commit-style\ndescription: 项目提交规范\n---\n使用 Conventional Commits。",
      "utf8",
    );
    const bundle = await createLoopFromSettings({ settings, cwd: dir });
    expect(bundle.systemPrompt).toContain("## 可用 Skills");
    expect(bundle.systemPrompt).toContain("commit-style");
    expect(bundle.systemPrompt).toContain("项目提交规范");
  });

  it("omits the skills section when none are discovered (D2)", async () => {
    const bundle = await createLoopFromSettings({ settings, cwd: dir });
    expect(bundle.systemPrompt).not.toContain("## 可用 Skills");
  });

  it("creates a loop bound to a fresh session in the store", async () => {
    const bundle = await createLoopFromSettings({ settings, cwd: dir });
    expect(bundle.loop).toBeInstanceOf(AgentLoop);
    expect(bundle.sessionId).toBeTruthy();
    expect(await bundle.store.list()).toContain(bundle.sessionId);
  });

  it("resolves catalog models without overrides", async () => {
    await expect(createLoopFromSettings({ settings, cwd: dir })).resolves.toBeTruthy();
  });

  it("resolves catalog-external models via modelOverrides", async () => {
    const bundle = await createLoopFromSettings({
      settings: { ...settings, provider: "glm", modelId: "glm-4.5-air" },
      modelOverrides: [glmOverride],
      cwd: dir,
    });
    expect(bundle.loop).toBeInstanceOf(AgentLoop);
  });

  it("rejects catalog-external models without overrides", async () => {
    await expect(
      createLoopFromSettings({
        settings: { ...settings, provider: "glm", modelId: "glm-4.5-air" },
        cwd: dir,
      }),
    ).rejects.toThrow(/glm-4.5-air/);
  });

  it("wires the approvals bridge into the loop's approve callback", async () => {
    const approvals = new ApprovalBridge();
    const bundle = await createLoopFromSettings({ settings, cwd: dir, approvals });
    expect(bundle.approvals).toBe(approvals);
  });

  it("exposes isOverBudget driven by updateSpent and settings.budgetUsd", async () => {
    const bundle = await createLoopFromSettings({
      settings: { ...settings, budgetUsd: 0.01 },
      cwd: dir,
    });
    expect(bundle.isOverBudget()).toBe(false);
    bundle.updateSpent(0.02);
    expect(bundle.isOverBudget()).toBe(true);
  });

  it("auto-denies approvals when no bridge is provided (headless semantics)", async () => {
    const bundle = await createLoopFromSettings({ settings, cwd: dir });
    // 通过内部 deps 不可达，行为在 print-mode 集成中验证；此处断言 bundle 无桥
    expect(bundle.approvals).toBeUndefined();
    void bundle;
  });

  it("registers the explore subagent tool", async () => {
    const bundle = await createLoopFromSettings({ settings, cwd: dir });
    // explore 注册在工具注册表中：从 systemPrompt 的工具列表断言
    expect(bundle.systemPrompt).toContain("explore");
  });

  it("composes AGENTS.md agreements and repo map into the system prompt", async () => {
    await writeFile(join(dir, "AGENTS.md"), "项目约定：使用 pnpm", "utf8");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "demo.ts"), "export function demoFunction() {}\n", "utf8");

    const bundle = await createLoopFromSettings({ settings, cwd: dir, home: dir });
    expect(bundle.systemPrompt).toContain("使用 pnpm");
    expect(bundle.systemPrompt).toContain("demoFunction");
    expect(bundle.systemPrompt).toContain("不可信");
  });
});
