import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageModel, ModouEvent } from "@modou-dev/core";
import { SessionStore } from "@modou-dev/core";
import { ModouServer } from "@modou-dev/server";

// plan-web A3/A4：turn 取消（含审批挂起中取消）+ 重启后历史只读回放。

let dir: string;
let home: string;
let storeDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "srv-cancel-"));
  home = await mkdtemp(join(tmpdir(), "srv-cancel-home-"));
  storeDir = await mkdtemp(join(tmpdir(), "srv-cancel-store-"));
});

afterEach(async () => {
  // server 由各用例自行 close（closeServer 助手），这里兜底清理
});

// 注意：raw LanguageModel 不经 AI SDK 归一化，usage 必须是扁平 {inputTokens,outputTokens}
const usage = { inputTokens: 10, outputTokens: 5 };

/** 第一轮发 bash tool_call（触发审批）；后续轮纯文本收尾 */
function approvalThenTextModel(): LanguageModel {
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
              { type: "tool-call", toolCallId: "call-cancel-1", toolName: "bash", input: JSON.stringify({ command: "echo hi" }) },
              { type: "finish", finishReason: "tool-calls", usage },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "1" },
              { type: "text-delta", id: "1", delta: "done" },
              { type: "text-end", id: "1" },
              { type: "finish", finishReason: "stop", usage },
            ];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModel;
}

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
          controller.enqueue({ type: "finish", finishReason: "stop", usage });
          controller.close();
        },
      }),
    }),
  } as unknown as LanguageModel;
}

function startServer(model: LanguageModel): ModouServer {
  return new ModouServer({
    port: 0,
    store: new SessionStore(storeDir),
    createSessionDefaults: {
      home,
      settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
    },
    createSessionOverrides: () => ({ model, cwd: dir }),
  });
}

/** 订阅 SSE 并收集事件，直到谓词满足或超时 */
function collectSse(baseUrl: string, sessionId: string) {
  const events: ModouEvent[] = [];
  const controller = new AbortController();
  const done = (async () => {
    const res = await fetch(`${baseUrl}/sessions/${sessionId}/events`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.startsWith("data: ")) {
          try {
            events.push(JSON.parse(line.slice(6)) as ModouEvent);
          } catch {
            /* 忽略非 JSON 行 */
          }
        }
      }
    }
  })();
  return {
    events,
    async waitFor(predicate: (e: ModouEvent) => boolean, timeoutMs = 8000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (events.some(predicate)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`SSE 等待超时，已收到：${events.map((e) => e.type).join(",")}`);
    },
    stop(): void {
      controller.abort();
      void done.catch(() => {});
    },
  };
}

describe("turn 取消（A3）", () => {
  let server: ModouServer;
  let baseUrl: string;

  afterEach(async () => {
    await server.close().catch(() => {});
  });

  it("审批挂起中取消：busy 释放、待审批自动拒绝、后续消息不再 409", async () => {
    server = startServer(approvalThenTextModel());
    baseUrl = `http://127.0.0.1:${(await server.start()).port}`;

    const create = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const { sessionId } = (await create.json()) as { sessionId: string };

    const sse = collectSse(baseUrl, sessionId);
    await new Promise((r) => setTimeout(r, 100));

    const send = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ input: "跑个命令" }),
    });
    expect(send.status).toBe(202);

    // 等审批请求挂起
    await sse.waitFor((e) => e.type === "approval_request");

    // 取消
    const cancel = await fetch(`${baseUrl}/sessions/${sessionId}/cancel`, { method: "POST" });
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({ ok: true, cancelled: true });

    // 待审批被自动拒绝（granted:false）
    await sse.waitFor((e) => e.type === "approval_result" && e.granted === false);
    // turn 终止（中断错误或 usage 收尾）→ busy 释放
    await sse.waitFor(
      (e) =>
        (e.type === "error" && e.message?.includes("中断")) ||
        (e.type === "usage" && (e as { turnEnd?: boolean }).turnEnd === true),
    );
    sse.stop();

    // 后续消息不再 409
    const again = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ input: "下一题" }),
    });
    expect(again.status).toBe(202);
  });

  it("非 busy 会话取消返回 cancelled:false", async () => {
    server = startServer(textModel("ok"));
    baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const create = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const { sessionId } = (await create.json()) as { sessionId: string };
    const cancel = await fetch(`${baseUrl}/sessions/${sessionId}/cancel`, { method: "POST" });
    expect(await cancel.json()).toMatchObject({ ok: true, cancelled: false });
  });
});

describe("历史只读回放（A4）", () => {
  let server: ModouServer;

  afterEach(async () => {
    await server.close().catch(() => {});
  });

  it("server 重启后：列表仍可见旧会话、历史可只读回放（active:false）", async () => {
    server = startServer(textModel("首轮回复"));
    const baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const create = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const { sessionId } = (await create.json()) as { sessionId: string };
    const sse = collectSse(baseUrl, sessionId);
    await new Promise((r) => setTimeout(r, 100));
    await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ input: "首轮输入" }),
    });
    await sse.waitFor((e) => e.type === "assistant_message");
    sse.stop();
    await server.close();

    // 重启：新 server 实例、同一 store 目录
    server = startServer(textModel("unused"));
    const baseUrl2 = `http://127.0.0.1:${(await server.start()).port}`;

    const list = await fetch(`${baseUrl2}/sessions`);
    const { sessions } = (await list.json()) as { sessions: { sessionId: string }[] };
    expect(sessions.some((s) => s.sessionId === sessionId)).toBe(true);

    const history = await fetch(`${baseUrl2}/sessions/${sessionId}`);
    expect(history.status).toBe(200);
    const body = (await history.json()) as { events: ModouEvent[]; active: boolean };
    expect(body.active).toBe(false);
    expect(body.events.some((e) => e.type === "assistant_message" && e.text === "首轮回复")).toBe(true);
  });

  it("不存在的会话仍 404", async () => {
    server = startServer(textModel("x"));
    const baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const res = await fetch(`${baseUrl}/sessions/no-such-id`);
    expect(res.status).toBe(404);
  });
});
