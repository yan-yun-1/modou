import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "../src/onboarding.js";
import { loadSettings, type Settings } from "../src/settings.js";
import { renderInk, settle } from "./ink-test-utils.js";

let home: string;

// V3：流程改为 供应商 → Key → 拉模型列表 → 选择。测试里 mock 远端列表，
// 不发真实网络请求。
const fetchMock = vi.hoisted(() =>
  vi.fn(async (_url: string | URL | RequestInfo, _init?: RequestInit) => {
    return new Response(JSON.stringify({ data: [{ id: "remote-model-a" }, { id: "remote-model-b" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
);

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "luban-onboard-"));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("Onboarding（V3：先 Key 后模型列表）", () => {
  it("renders the provider list on first screen", async () => {
    const harness = renderInk(<Onboarding home={home} onDone={() => {}} />);
    await settle();
    const text = harness.text;
    expect(text).toContain("模型提供商");
    expect(text).toContain("Anthropic（Claude）");
    expect(text).toContain("Ollama（本地，免 Key）");
    harness.unmount();
  });

  it("walks provider → key → fetched model list → save", async () => {
    const done: Settings[] = [];
    const harness = renderInk(<Onboarding home={home} onDone={(s) => done.push(s)} />);
    await settle();

    harness.stdin.write("\r"); // 回车确认第一个 provider（anthropic）
    await settle();
    harness.stdin.write("sk-onboard-test"); // 输入 API Key
    await settle();
    harness.stdin.write("\r"); // 提交 Key → 拉模型列表
    await settle(200);

    // 远端列表已展示（mock 返回 remote-model-a/b）
    expect(harness.text).toContain("remote-model-a");
    expect(harness.text).toContain("remote-model-b");

    harness.stdin.write("\r"); // 确认第一个模型
    await settle(150);

    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      provider: "anthropic",
      modelId: "remote-model-a",
      apiKey: "sk-onboard-test",
    });
    const persisted = await loadSettings(home);
    expect(persisted?.apiKey).toBe("sk-onboard-test");
    harness.unmount();
  }, 30_000);

  it("falls back to the builtin catalog when the remote list fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("HTTP 401"));
    const done: Settings[] = [];
    const harness = renderInk(<Onboarding home={home} onDone={(s) => done.push(s)} />);
    await settle();

    harness.stdin.write("\r"); // anthropic
    await settle();
    harness.stdin.write("\r"); // 空 Key（直接提交）
    await settle(200);

    // 回退内置目录：claude-sonnet-4-5 可见，且提示失败原因
    expect(harness.text).toContain("claude-sonnet-4-5");
    expect(harness.text).toContain("HTTP 401");

    harness.stdin.write("\r"); // 确认 claude-sonnet-4-5
    await settle(150);
    expect(done[0]?.modelId).toBe("claude-sonnet-4-5");
    harness.unmount();
  }, 30_000);

  it("skips the key prompt for ollama and loads the local list", async () => {
    const done: Settings[] = [];
    const harness = renderInk(<Onboarding home={home} onDone={(s) => done.push(s)} />);
    await settle();

    // 移到 Ollama
    for (let attempt = 0; attempt < 20 && !harness.text.includes("❯ Ollama"); attempt++) {
      harness.stdin.write("\u001b[B");
      await settle(30);
    }
    expect(harness.text).toContain("❯ Ollama（本地，免 Key）");

    harness.stdin.write("\r"); // 确认 ollama → 直接拉本地列表（免 Key）
    await settle(200);

    expect(harness.text).toContain("remote-model-a"); // mock 端点对 ollama 也生效
    harness.stdin.write("\r"); // 确认第一个模型
    await settle(150);

    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ provider: "ollama", modelId: "remote-model-a" });
    expect(done[0]?.apiKey).toBeUndefined();
    harness.unmount();
  }, 30_000);

  it("supports manual model id entry with M", async () => {
    const done: Settings[] = [];
    const harness = renderInk(<Onboarding home={home} onDone={(s) => done.push(s)} />);
    await settle();

    harness.stdin.write("\r"); // anthropic
    await settle();
    harness.stdin.write("sk-x");
    await settle();
    harness.stdin.write("\r"); // Key → 拉列表
    await settle(200);
    harness.stdin.write("m"); // 手动输入模式
    await settle();
    harness.stdin.write("my-custom-model");
    await settle();
    harness.stdin.write("\r");
    await settle(150);

    expect(done).toHaveLength(1);
    expect(done[0]?.modelId).toBe("my-custom-model");
    harness.unmount();
  }, 30_000);

  it("merges base settings so re-selection keeps permissionMode and budget", async () => {
    const done: Settings[] = [];
    const base: Settings = {
      provider: "deepseek",
      modelId: "deepseek-chat",
      apiKey: "old-key",
      permissionMode: "yolo",
      budgetUsd: 5,
    };
    const harness = renderInk(<Onboarding home={home} base={base} onDone={(s) => done.push(s)} />);
    await settle();

    // anthropic → 输入新 key → 列表确认第一个
    harness.stdin.write("\r");
    await settle();
    harness.stdin.write("sk-new-key");
    await settle();
    harness.stdin.write("\r");
    await settle(200);
    harness.stdin.write("\r");
    await settle(150);

    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      provider: "anthropic",
      modelId: "remote-model-a",
      apiKey: "sk-new-key",
      permissionMode: "yolo",
      budgetUsd: 5,
    });
    harness.unmount();
  }, 30_000);
});
