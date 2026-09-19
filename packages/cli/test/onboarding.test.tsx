import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Onboarding } from "../src/onboarding.js";
import { loadSettings, type Settings } from "../src/settings.js";
import { renderInk, settle } from "./ink-test-utils.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "luban-onboard-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("Onboarding", () => {
  it("renders the provider list on first screen", async () => {
    const harness = renderInk(<Onboarding home={home} onDone={() => {}} />);
    await settle();
    const text = harness.text;
    expect(text).toContain("模型提供商");
    expect(text).toContain("Anthropic（Claude）");
    expect(text).toContain("Ollama（本地，免 Key）");
    harness.unmount();
  });

  it("walks provider → model → key → save with keyboard input", async () => {
    const done: Settings[] = [];
    const harness = renderInk(<Onboarding home={home} onDone={(s) => done.push(s)} />);
    await settle();

    harness.stdin.write("\r"); // 回车确认第一个 provider（anthropic）
    await settle();
    harness.stdin.write("\r"); // 直接回车用默认模型
    await settle();
    harness.stdin.write("sk-onboard-test");
    await settle();
    harness.stdin.write("\r");
    await settle(150);

    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      apiKey: "sk-onboard-test",
    });
    const persisted = await loadSettings(home);
    expect(persisted?.apiKey).toBe("sk-onboard-test");
    harness.unmount();
  }, 30_000);

  it("skips the key step for ollama", async () => {
    const done: Settings[] = [];
    const harness = renderInk(<Onboarding home={home} onDone={(s) => done.push(s)} />);
    await settle();

    // ink 可能把连续转义序列合并成一个 data 事件，逐条写并校验光标到位
    for (let attempt = 0; attempt < 20 && !harness.text.includes("❯ Ollama"); attempt++) {
      harness.stdin.write("\u001b[B");
      await settle(30);
    }
    expect(harness.text).toContain("❯ Ollama（本地，免 Key）");

    harness.stdin.write("\r"); // 确认 ollama
    await settle();
    harness.stdin.write("\r"); // 默认模型 llama3.3:70b → 跳过 Key 直接保存
    await settle(150);

    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ provider: "ollama", modelId: "llama3.3:70b" });
    expect(done[0]?.apiKey).toBeUndefined();
    harness.unmount();
  }, 30_000);
});
