import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentLoop, type ModelCapabilities } from "@luban/core";
import { createLoopFromSettings } from "../src/loop-factory.js";
import { ApprovalBridge } from "../src/approval-bridge.js";
import type { Settings } from "../src/settings.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-factory-"));
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
});
