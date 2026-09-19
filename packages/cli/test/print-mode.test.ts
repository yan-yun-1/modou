import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { runPrintMode } from "../src/print-mode.js";
import { SessionStore } from "@luban/core";
import type { Settings } from "../src/settings.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-print-"));
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

function textModel(text: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: text },
          { type: "text-end", id: "1" },
          {
            type: "finish",
            finishReason: "stop",
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  });
}

describe("runPrintMode", () => {
  it("runs a task headlessly and returns the final output with cost", async () => {
    const result = await runPrintMode({
      settings,
      cwd: dir,
      prompt: "总结项目",
      model: textModel("这是一个测试项目"),
      store: new SessionStore(dir),
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("这是一个测试项目");
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("auto-denies approvals in headless mode (execute tools never run)", async () => {
    // 无头模式没有任何人审批：ask 一律拒绝，模型收到拒绝后仍能继续收尾
    const chunks = [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "t1",
              toolName: "bash",
              input: JSON.stringify({ command: "echo hi" }),
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "已收到拒绝，收尾" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              finishReason: "stop",
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ],
        }),
      },
    ];
    const result = await runPrintMode({
      settings,
      cwd: dir,
      prompt: "执行命令",
      model: new MockLanguageModelV4({ doStream: chunks as never }),
      store: new SessionStore(dir),
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("收尾");
  });

  it("returns exit code 1 when the model call fails fatally", async () => {
    const result = await runPrintMode({
      settings,
      cwd: dir,
      prompt: "任何输入",
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "error", error: new Error("provider down") },
            ],
          }),
        }),
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toBe("");
  });
});
