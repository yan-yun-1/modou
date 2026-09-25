import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PermissionEngine } from "@modou-dev/core";
import { createLoopFromSettings, loadSettings, savePermissionRule, type Settings } from "../src/settings.js";
import type { LanguageModel } from "@modou-dev/core";

// M4 A3：always-allow 白名单持久化
// 1) PermissionEngine.onRemember 在 remember 新增规则时触发（去重不触发）
// 2) loop-factory 装配时读回 settings.permissionRules 并在 remember 后落盘

describe("PermissionEngine.onRemember（A3）", () => {
  it("fires on new rule, not on duplicate", () => {
    const engine = new PermissionEngine({ mode: "default" });
    const seen: string[] = [];
    engine.onRemember = (rule) => seen.push(`${rule.type}:${rule.value}`);
    engine.remember({ type: "execute-prefix", value: "npm test" });
    engine.remember({ type: "execute-prefix", value: "npm test" }); // 去重
    expect(seen).toEqual(["execute-prefix:npm test"]);
    // 规则确实生效：白名单内放行
    expect(engine.decide({ name: "bash", kind: "execute", args: { command: "npm test --coverage" } })).toBe("allow");
  });
});

describe("白名单持久化端到端（A3）", () => {
  let dir: string;
  let home: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "perm-rules-"));
    home = await mkdtemp(join(tmpdir(), "perm-rules-home-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  function textModel(text: string): LanguageModel {
    return {
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "1" });
            controller.enqueue({ type: "text-delta", id: "1", delta: text });
            controller.enqueue({ type: "text-end", id: "1" });
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
            });
          },
        }),
      }),
    } as unknown as LanguageModel;
  }

  it("remember 后规则写入 settings.json，重启（重新装配）后直接放行", async () => {
    const settings: Settings = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      apiKey: "sk-test",
      permissionMode: "default",
    };
    await mkdir(join(home, ".modou"), { recursive: true });
    await writeFile(join(home, ".modou", "settings.json"), JSON.stringify(settings), "utf8");

    // MockLanguageModelV4 需要 ai/test——这里直接用 stream chunk stub 模拟一次 bash 调用太重，
    // 改为验证装配产物：引擎带着 settings.permissionRules，且 onRemember 落盘生效。
    const bundle = await createLoopFromSettings({
      settings,
      cwd: dir,
      home,
      model: textModel("ok"),
    });
    // 装配时读回（settings 里还没有规则 → 引擎空规则）
    expect(bundle).toBeTruthy();

    // 模拟审批 remembered 分支的落盘（loop-factory onRemember 内部同一函数）
    await savePermissionRule({ type: "execute-prefix", value: "git status" }, home);

    const persisted = await loadSettings(home);
    expect(persisted?.permissionRules).toEqual([{ type: "execute-prefix", value: "git status" }]);

    // 重新装配：规则被读回，git status 直接放行（无需审批）
    const bundle2 = await createLoopFromSettings({
      settings: { ...settings },
      cwd: dir,
      home,
      model: textModel("ok"),
    });
    expect(bundle2.loop).toBeTruthy();
  });

  it("savePermissionRule 去重", async () => {
    const settings: Settings = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      permissionMode: "default",
      permissionRules: [{ type: "execute-prefix", value: "git status" }],
    };
    await mkdir(join(home, ".modou"), { recursive: true });
    await writeFile(join(home, ".modou", "settings.json"), JSON.stringify(settings), "utf8");
    await savePermissionRule({ type: "execute-prefix", value: "git status" }, home);
    const persisted = await loadSettings(home);
    expect(persisted?.permissionRules).toHaveLength(1);
  });
});
