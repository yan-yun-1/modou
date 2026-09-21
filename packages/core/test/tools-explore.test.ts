import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { ModelCapabilities } from "../src/models/catalog.js";
import { createExploreTool } from "../src/tools/explore.js";
import type { ToolContext } from "../src/tools/types.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-explore-"));
  ctx = { cwd: dir, signal: new AbortController().signal };
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

function textModel(text: string) {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: text },
            { type: "text-end", id: "1" },
            { type: "finish", finishReason: "stop", usage },
          ],
        }),
      },
    ],
  });
}

describe("explore tool", () => {
  it("is a read tool marked as subagent", () => {
    const tool = createExploreTool({
      model: textModel("x"),
      capabilities: caps,
      cwd: dir,
    });
    expect(tool.kind).toBe("read");
    expect(tool.subagentName).toBe("explore");
  });

  it("returns the subagent summary as tool output", async () => {
    const tool = createExploreTool({
      model: textModel("发现：登录在 src/auth.ts"),
      capabilities: caps,
      cwd: dir,
    });
    const result = await tool.run({ question: "登录逻辑在哪" }, ctx);
    expect(result.output).toContain("src/auth.ts");
  });

  it("propagates fatal subagent errors as readable failures", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "error", error: new Error("provider down") },
          ],
        }),
      }),
    });
    const tool = createExploreTool({ model, capabilities: caps, cwd: dir });
    await expect(tool.run({ question: "x" }, ctx)).rejects.toThrow(/provider down/);
  });
});
