import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageModel, ModouEvent } from "@modou-dev/core";
import { SessionStore } from "@modou-dev/core";
import { ModouServer } from "@modou-dev/server";

// plan-web A5：cwd 语义修正（请求优先/不存在 400/结果回传）
// plan-web A6：serve 注入 home → remembered 审批落盘 permissionRules

let dir: string;
let home: string;
let otherDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "srv-cwd-"));
  otherDir = await mkdtemp(join(tmpdir(), "srv-cwd-other-"));
  home = await mkdtemp(join(tmpdir(), "srv-cwd-home-"));
  await mkdir(join(home, ".modou"), { recursive: true });
});

afterEach(async () => {
  await server?.close().catch(() => {});
});

let server: ModouServer;

function stubModel(text: string): LanguageModel {
  return {
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
          controller.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } });
          controller.close();
        },
      }),
    }),
  } as unknown as LanguageModel;
}

/** 审批场景模型：首轮 bash tool_call，之后文本收尾 */
function approvalModel(): LanguageModel {
  let calls = 0;
  return {
    specificationVersion: "v2",
    provider: "stub",
    modelId: "stub",
    doStream: async () => {
      calls += 1;
      const chunks: unknown[] =
        calls === 1
          ? [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: "c1", toolName: "bash", input: JSON.stringify({ command: "echo remember-me" }) },
              { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1 } },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
            ];
      return { stream: new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); } }) };
    },
  } as unknown as LanguageModel;
}

describe("cwd 语义（A5）", () => {
  it("请求 cwd 优先于 settings.cwd，201 回传解析结果与覆盖警告", async () => {
    server = new ModouServer({
      port: 0,
      store: new SessionStore(join(dir, "store")),
      createSessionDefaults: {
        home,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "k", permissionMode: "default", cwd: dir },
      },
      createSessionOverrides: () => ({ model: stubModel("ok") }),
    });
    const baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const res = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      body: JSON.stringify({ cwd: otherDir }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { cwd: string; cwdWarning?: string };
    expect(body.cwd).toBe(otherDir);
    expect(body.cwdWarning).toContain("覆盖");
  });

  it("cwd 不存在返回 400（不再静默回退）", async () => {
    server = new ModouServer({
      port: 0,
      store: new SessionStore(join(dir, "store")),
      createSessionDefaults: {
        home,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "k", permissionMode: "default" },
      },
      createSessionOverrides: () => ({ model: stubModel("ok") }),
    });
    const baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const res = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      body: JSON.stringify({ cwd: join(dir, "no-such-dir") }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("cwd 不存在") });
  });

  it("未带 cwd 时回落 settings.cwd 并回传", async () => {
    server = new ModouServer({
      port: 0,
      store: new SessionStore(join(dir, "store")),
      createSessionDefaults: {
        home,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "k", permissionMode: "default", cwd: dir },
      },
      createSessionOverrides: () => ({ model: stubModel("ok") }),
    });
    const baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const res = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const body = (await res.json()) as { cwd: string; cwdWarning?: string };
    expect(body.cwd).toBe(dir);
    expect(body.cwdWarning).toBeUndefined();
  });
});

describe("remembered 落盘（A6 前提）", () => {
  it("审批 remembered:true 经 onRemember 写入 home 的 settings.json", async () => {
    server = new ModouServer({
      port: 0,
      store: new SessionStore(join(dir, "store")),
      createSessionDefaults: {
        home,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "k", permissionMode: "default" },
      },
      createSessionOverrides: () => ({ model: approvalModel() }),
    });
    const baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const create = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const { sessionId } = (await create.json()) as { sessionId: string };

    const events: ModouEvent[] = [];
    const controller = new AbortController();
    void (async () => {
      const res = await fetch(`${baseUrl}/sessions/${sessionId}/events`, { signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line.startsWith("data: ")) {
            try {
              events.push(JSON.parse(line.slice(6)) as ModouEvent);
            } catch { /* 忽略 */ }
          }
        }
      }
    })();
    const waitFor = async (predicate: (e: ModouEvent) => boolean): Promise<void> => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (events.some(predicate)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("等待超时：" + events.map((e) => e.type).join(","));
    };

    await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ input: "跑命令" }),
    });
    await waitFor((e) => e.type === "approval_request");

    // 总是允许（remembered: true）
    const answer = await fetch(`${baseUrl}/sessions/${sessionId}/approvals/c1`, {
      method: "POST",
      body: JSON.stringify({ granted: true, remembered: true }),
    });
    expect(answer.status).toBe(200);
    await waitFor((e) => e.type === "approval_result" && e.granted === true && e.remembered === true);
    controller.abort();

    // home 的 settings.json 出现 always-allow 规则（A6 接线生效）
    const stored = JSON.parse(await readFile(join(home, ".modou", "settings.json"), "utf8")) as {
      permissionRules?: { type: string; value: string }[];
    };
    expect(stored.permissionRules?.some((r) => r.type === "execute-prefix")).toBe(true);
  });
});
