import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageModel, ModouEvent } from "@modou-dev/core";
import { ModouServer } from "@modou-dev/server";

// M4 Phase B（PRD F18）：HTTP + SSE 会话 API。模型注入 stub，不发真实请求。
describe("ModouServer（F18）", () => {
  let dir: string;
  let home: string;
  let server: ModouServer;
  let baseUrl: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "srv-"));
    home = await mkdtemp(join(tmpdir(), "srv-home-"));
    server = new ModouServer({
      port: 0,
      createSessionDefaults: {
        home,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
      },
      createSessionOverrides: () => ({ model: textModel("你好，我是墨斗"), cwd: dir }),
    });
    const { port } = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.close();
  });

  function textModel(text: string): LanguageModel {
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

  it("GET /health", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("POST /sessions → 201 with sessionId", async () => {
    const res = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    if (res.status !== 201) console.log("CREATE_ERR=" + JSON.stringify(await res.json()));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sessionId: string };
    expect(body.sessionId).toBeTruthy();
  });

  it("full turn: POST message → SSE receives assistant_message → history replay", async () => {
    const create = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const { sessionId } = (await create.json()) as { sessionId: string };

    // 先挂 SSE，再发消息
    const controller = new AbortController();
    const received: ModouEvent[] = [];
    const sseRes = await fetch(`${baseUrl}/sessions/${sessionId}/events`, { signal: controller.signal });
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream");

    const post = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "打个招呼" }),
    });
    expect(post.status).toBe(202);

    // 读取 SSE 直到 usage（一轮结束）
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (line) {
          try {
            received.push(JSON.parse(line.slice(6)) as ModouEvent);
          } catch {
            /* 跨块 JSON，忽略 */
          }
        }
      }
      if (received.some((e) => e.type === "usage")) break;
    }
    controller.abort();
    expect(received.some((e) => e.type === "text_delta")).toBe(true);
    expect(received.some((e) => e.type === "assistant_message")).toBe(true);
    expect(received.some((e) => e.type === "usage")).toBe(true);

    // 历史回放
    const history = await fetch(`${baseUrl}/sessions/${sessionId}`);
    const historyBody = (await history.json()) as { events: ModouEvent[] };
    expect(historyBody.events.some((e) => e.type === "user_message")).toBe(true);
    expect(historyBody.events.some((e) => e.type === "assistant_message")).toBe(true);
  }, 20_000);

  it("rejects empty input with 400", async () => {
    const create = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const { sessionId } = (await create.json()) as { sessionId: string };
    const empty = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "" }),
    });
    expect(empty.status).toBe(400);
  });

  it("approval flow: approval_request over SSE → POST approval → turn continues", async () => {
    // 模型先发起 bash 工具调用（standard 模式 → ask → 审批），拿到结果后回复
    const toolModel: LanguageModel = {
      specificationVersion: "v2",
      provider: "stub",
      modelId: "stub",
      doStream: (() => {
        let call = 0;
        return async () => {
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
                  { type: "text-delta", id: "2", delta: "工具说 hi" },
                  { type: "text-end", id: "2" },
                  { type: "finish", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 1 } },
                ];
          return {
            stream: new ReadableStream({
              start(controller) {
                for (const c of chunks) controller.enqueue(c);
                controller.close();
              },
            }),
          };
        };
      })(),
    } as unknown as LanguageModel;

    const overrideServer = new ModouServer({
      port: 0,
      createSessionDefaults: {
        home,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
      },
      createSessionOverrides: () => ({ model: toolModel, cwd: dir }),
    });
    const { port } = await overrideServer.start();
    const base = `http://127.0.0.1:${port}`;
    try {
      const create = await fetch(`${base}/sessions`, { method: "POST" });
      const { sessionId } = (await create.json()) as { sessionId: string };

      const sseRes = await fetch(`${base}/sessions/${sessionId}/events`);
      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();
      const received: ModouEvent[] = [];
      const readerLoop = (async () => {
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (line) {
              try {
                received.push(JSON.parse(line.slice(6)) as ModouEvent);
              } catch {
                /* ignore */
              }
            }
          }
        }
      })();
      void readerLoop;

      await fetch(`${base}/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "echo hi" }),
      });

      // 等 approval_request 到达 SSE
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !received.some((e) => e.type === "approval_request")) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const approval = received.find((e) => e.type === "approval_request");
      expect(approval).toBeTruthy();

      // HTTP 应答审批 → 任务继续 → assistant_message 到达
      const approve = await fetch(`${base}/sessions/${sessionId}/approvals/${approval!.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ granted: true, remembered: false }),
      });
      expect(approve.status).toBe(200);

      const doneDeadline = Date.now() + 10_000;
      while (Date.now() < doneDeadline && !received.some((e) => e.type === "assistant_message")) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(received.some((e) => e.type === "assistant_message")).toBe(true);
    } finally {
      await overrideServer.close().catch(() => {});
    }
  }, 30_000);
});
