import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageModel } from "@modou-dev/core";
import { createSession } from "@modou-dev/sdk";

// M4 A4（验收 1）：SDK 高层 API —— createSession 约 10 行嵌入
describe("createSession（@modou-dev/sdk 嵌入验收）", () => {
  let dir: string;
  let home: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sdk-session-"));
    home = await mkdtemp(join(tmpdir(), "sdk-session-home-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  function textModel(text: string): LanguageModel {
    return {
      // streamText 校验 v2 规范版本（缺失会报 Unsupported model version）
      specificationVersion: "v2",
      provider: "stub",
      modelId: "stub",
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
              usage: { inputTokens: 10, outputTokens: 5 },
            });
            controller.close();
          },
        }),
      }),
    } as unknown as LanguageModel;
  }

  it("10-line embedding: createSession → run → events → close", { timeout: 15_000 }, async () => {
    const session = await createSession({
      settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
      cwd: dir,
      home,
      model: textModel("你好，我是墨斗"),
    });
    expect(session.sessionId).toBeTruthy();
    const events: string[] = [];
    for await (const event of session.run("打个招呼")) {
      events.push(event.type);
      if (event.type === "assistant_message") expect(event.text).toContain("墨斗");
    }
    // 流式增量与最终消息与用量齐备
    expect(events).toContain("text_delta");
    expect(events).toContain("assistant_message");
    expect(events).toContain("usage");
    await session.close();
  });

  it("throws a friendly error when no settings exist", async () => {
    await expect(createSession({ home, cwd: dir })).rejects.toThrow("尚未配置");
  });
});
