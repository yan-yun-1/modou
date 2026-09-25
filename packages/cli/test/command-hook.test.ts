import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageModel, ModouEvent } from "@modou-dev/core";
import { createLoopFromSettings } from "../src/loop-factory.js";
import type { Settings } from "../src/settings.js";

// M4 D2/D3：settings.hooks 命令式钩子 → core AgentHooks（stdin JSON → stdout JSON）

let dir: string;
let home: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cmd-hook-"));
  home = await mkdtemp(join(tmpdir(), "cmd-hook-home-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

function toolThenTextModel(): LanguageModel {
  let call = 0;
  return {
    specificationVersion: "v2",
    provider: "stub",
    modelId: "stub",
    doStream: async () => {
      call++;
      const chunks =
        call === 1
          ? [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: "call-1", toolName: "bash", input: JSON.stringify({ command: "echo hi" }) },
              { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 5, outputTokens: 1 } },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "2" },
              { type: "text-delta", id: "2", delta: "完成" },
              { type: "text-end", id: "2" },
              { type: "finish", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 1 } },
            ];
      return { stream: new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } }) };
    },
  } as unknown as LanguageModel;
}

describe("settings.hooks 命令式钩子（D2）", () => {
  it("preToolUse command can deny a tool call", async () => {
    const settings: Settings = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      apiKey: "sk-test",
      permissionMode: "yolo",
      hooks: {
        preToolUse: `node -e "process.stdout.write(JSON.stringify({decision:'deny',reason:'cmd-hook 禁止'}))"`,
      },
    };
    const bundle = await createLoopFromSettings({
      settings,
      cwd: dir,
      home,
      model: toolThenTextModel(),
    });
    const events: ModouEvent[] = [];
    for await (const e of bundle.loop.run("跑命令", bundle.sessionId)) {
      events.push(e);
    }
    const result = events.find((e) => e.type === "tool_result");
    expect(result && "output" in result).toBe(true);
    expect((result as { output: string }).output).toContain("cmd-hook");
    await bundle.closeMcp();
  }, 20_000);
});
