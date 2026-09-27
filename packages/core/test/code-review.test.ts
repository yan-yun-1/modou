import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { ModelCapabilities } from "../src/models/catalog.js";
import { createCodeReviewTool } from "../src/tools/code-review.js";
import { SessionStore } from "../src/session-store.js";

// M5 E1（F13 补全）：code-review 子代理工具

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-review-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const caps: ModelCapabilities = {
  id: "test-model",
  provider: "anthropic",
  displayName: "Test",
  contextWindow: 200_000,
  maxOutputTokens: 64_000,
  supportsTools: true,
  supportsReasoning: false,
  pricing: {
    inputPerMtokUsd: 3,
    outputPerMtokUsd: 15,
    cacheReadPerMtokUsd: 0.3,
    cacheWritePerMtokUsd: 3.75,
  },
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function textStream(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: text },
        { type: "text-end", id: "1" },
        { type: "finish", finishReason: "stop", usage },
      ],
    }),
  };
}

function makeTool(model: MockLanguageModelV4) {
  return createCodeReviewTool({
    model,
    capabilities: caps,
    cwd: dir,
    store: new SessionStore(dir),
  });
}

const ctx = { cwd: dir, signal: new AbortController().signal, sessionId: "s-review" };

describe("code_review 工具（E1）", () => {
  it("git 仓库内默认审查未提交改动，diff 进入子代理任务", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    await writeFile(join(dir, "a.ts"), "const broken: string = 123;\n", "utf8");
    execFileSync("git", ["add", "a.ts"], { cwd: dir });

    let capturedTask = "";
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "text-start", id: "1" });
              controller.enqueue({ type: "text-delta", id: "1", delta: "【高】a.ts:1 类型不匹配" });
              controller.enqueue({ type: "text-end", id: "1" });
              controller.enqueue({ type: "finish", finishReason: "stop", usage });
              controller.close();
            },
          }),
        } as never,
      ],
    });
    // 用 doStreamCalls 捕获子代理收到的任务文本
    const tool = makeTool(model);
    const result = await tool.run({}, ctx);

    expect(result.output).toContain("【高】a.ts:1 类型不匹配");
    capturedTask = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(capturedTask).toContain("diff");
    expect(capturedTask).toContain("broken");
  });

  it("非 git 仓库且无 scope 时给可操作提示", async () => {
    const model = new MockLanguageModelV4({ doStream: [textStream("不会被调用")] });
    const result = await makeTool(model).run({}, ctx);
    expect(result.output).toContain("scope");
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("非 git 仓库但指定 scope 时由子代理自行阅读", async () => {
    const model = new MockLanguageModelV4({ doStream: [textStream("审查通过")] });
    const result = await makeTool(model).run({ scope: "src/utils.ts" }, ctx);
    expect(result.output).toBe("审查通过");
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain("src/utils.ts");
  });
});
