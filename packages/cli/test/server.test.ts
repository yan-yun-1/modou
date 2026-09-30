import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageModel, ModouEvent } from "@modou-dev/core";
import { SessionStore } from "@modou-dev/core";
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

  it("DELETE /sessions/:id：活跃会话同样移除历史文件（与 bulk-delete 语义一致）", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "srv-store-"));
    const store = new SessionStore(storeDir);
    const s2 = new ModouServer({
      port: 0,
      store,
      createSessionDefaults: {
        home,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
      },
      createSessionOverrides: () => ({ model: textModel("你好，我是墨斗"), cwd: dir }),
    });
    const { port: port2 } = await s2.start();
    const base2 = `http://127.0.0.1:${port2}`;
    try {
      const created = await fetch(`${base2}/sessions`, { method: "POST" });
      expect(created.status).toBe(201);
      const { sessionId } = (await created.json()) as { sessionId: string };
      await expect(fetch(`${base2}/sessions`).then((r) => r.json())).resolves.toMatchObject({ total: 1 });
      const del = await fetch(`${base2}/sessions/${sessionId}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect(await del.json()).toMatchObject({ ok: true, deletedHistory: true });
      await expect(fetch(`${base2}/sessions`).then((r) => r.json())).resolves.toMatchObject({ total: 0 });
    } finally {
      await s2.close();
    }
  });

  // Phase F1（plan-web）：目录浏览端点 + fsAllowRoots 白名单
  it("GET /fs/dirs：列子目录（跳过 dotfiles 与文件），缺省 path=进程目录", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "fs-dirs-"));
    await mkdir(join(root, "alpha"));
    await mkdir(join(root, ".hidden"));
    await writeFile(join(root, "file.txt"), "x");
    const res = await fetch(`${baseUrl}/fs/dirs?path=${encodeURIComponent(root)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; parent: string | null; dirs: { name: string; path: string }[] };
    expect(body.path).toBe(resolve(root));
    expect(body.dirs).toEqual([{ name: "alpha", path: join(resolve(root), "alpha") }]);
    expect(body.parent).toBe(dirname(resolve(root)));
    const def = await fetch(`${baseUrl}/fs/dirs`);
    expect(def.status).toBe(200);
    expect(((await def.json()) as { path: string }).path).toBe(resolve(process.cwd()));
  });

  it("GET /fs/dirs：不存在 400、非目录 400", async () => {
    const { writeFile } = await import("node:fs/promises");
    const file = join(dir, "plain.txt");
    await writeFile(file, "x");
    const notExist = await fetch(`${baseUrl}/fs/dirs?path=${encodeURIComponent(join(dir, "nope"))}`);
    expect(notExist.status).toBe(400);
    const notDir = await fetch(`${baseUrl}/fs/dirs?path=${encodeURIComponent(file)}`);
    expect(notDir.status).toBe(400);
  });

  it("fsAllowRoots：/fs/dirs 与 POST /sessions cwd 越界一律 403，穿越样本不逃逸", async () => {
    const outside = await mkdtemp(join(tmpdir(), "fs-out-"));
    const s2 = new ModouServer({
      port: 0,
      fsAllowRoots: [dir],
      createSessionDefaults: {
        home,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
      },
      createSessionOverrides: () => ({ model: textModel("你好，我是墨斗"), cwd: dir }),
    });
    const { port: port2 } = await s2.start();
    const base2 = `http://127.0.0.1:${port2}`;
    try {
      expect((await fetch(`${base2}/fs/dirs?path=${encodeURIComponent(dir)}`)).status).toBe(200);
      // 越界样本：直出界外 / .. 上跳 / 反斜杠 URL 编码变体
      for (const p of [outside, join(dir, "..", "fs-out-x"), "..\\..\\etc"]) {
        const res = await fetch(`${base2}/fs/dirs?path=${encodeURIComponent(p)}`);
        expect(res.status).toBe(403);
      }
      const denied = await fetch(`${base2}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: outside }),
      });
      expect(denied.status).toBe(403);
      // 未指定 cwd 回落进程目录（白名单外）同样 403，防绕过
      const noCwd = await fetch(`${base2}/sessions`, { method: "POST" });
      expect(noCwd.status).toBe(403);
      // 界内 .. 归一后仍在界内 → 正常创建
      const inside = await fetch(`${base2}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: join(dir, "sub", "..") }),
      });
      expect(inside.status).toBe(201);
    } finally {
      await s2.close();
    }
  });

  it.skipIf(process.platform !== "win32")(
    "fsAllowRoots：Windows 盘符大小写归一（小写盘符 cwd 不误判越界）",
    async () => {
      const s2 = new ModouServer({
        port: 0,
        fsAllowRoots: [dir],
        createSessionDefaults: {
          home,
          settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
        },
        createSessionOverrides: () => ({ model: textModel("你好，我是墨斗"), cwd: dir }),
      });
      const { port: port2 } = await s2.start();
      const base2 = `http://127.0.0.1:${port2}`;
      try {
        const lowerDrive = dir.replace(/^[A-Z]:/, (m) => m.toLowerCase());
        expect(lowerDrive).not.toBe(dir);
        const res = await fetch(`${base2}/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: lowerDrive }),
        });
        expect(res.status).toBe(201);
      } finally {
        await s2.close();
      }
    },
  );

  // Phase F2（plan-web）：最近目录 recents
  it("GET /fs/recents：创建落盘、去重置顶、上限 8、serveCwd 回显", async () => {
    const { readFile } = await import("node:fs/promises");
    const storeDir = await mkdtemp(join(tmpdir(), "srv-store2-"));
    const home2 = await mkdtemp(join(tmpdir(), "srv-home2-"));
    const store = new SessionStore(storeDir);
    const s2 = new ModouServer({
      port: 0,
      store,
      maxSessions: 20,
      createSessionDefaults: {
        home: home2,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
      },
      createSessionOverrides: () => ({ model: textModel("你好，我是墨斗"), cwd: dir }),
    });
    const { port: port2 } = await s2.start();
    const base2 = `http://127.0.0.1:${port2}`;
    const recents = async (): Promise<{ serveCwd: string; recents: string[] }> => {
      const r = await fetch(`${base2}/fs/recents`);
      expect(r.status).toBe(200);
      return r.json() as Promise<{ serveCwd: string; recents: string[] }>;
    };
    const create = async (cwd: string): Promise<void> => {
      const r = await fetch(`${base2}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      expect(r.status).toBe(201);
    };
    try {
      const initial = await recents();
      expect(initial.serveCwd).toBe(resolve(process.cwd()));
      expect(initial.recents).toEqual([]);
      const a = await mkdtemp(join(tmpdir(), "cwd-a-"));
      const b = await mkdtemp(join(tmpdir(), "cwd-b-"));
      await create(a);
      expect((await recents()).recents).toEqual([a]);
      await create(b);
      expect((await recents()).recents).toEqual([b, a]);
      await create(a);
      expect((await recents()).recents).toEqual([a, b]);
      // 上限 8：再建 7 个不同目录 → 共 9 个候选，最早者被挤出
      const extra: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = await mkdtemp(join(tmpdir(), `cwd-x${i}-`));
        extra.push(d);
        await create(d);
      }
      const capped = (await recents()).recents;
      expect(capped).toHaveLength(8);
      expect(capped[0]).toBe(extra[6]);
      expect(capped).not.toContain(b);
      expect(capped).toContain(a);
      // 落盘：文件在 home 下，重启可读
      expect(JSON.parse(await readFile(join(home2, "cwd-recents.json"), "utf8"))).toEqual(capped);
    } finally {
      await s2.close();
    }
  });

  it("GET /fs/recents：损坏文件容错为空 + 白名单过滤越界项", async () => {
    const { writeFile } = await import("node:fs/promises");
    const home3 = await mkdtemp(join(tmpdir(), "srv-home3-"));
    const s3 = new ModouServer({
      port: 0,
      fsAllowRoots: [dir],
      createSessionDefaults: {
        home: home3,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
      },
      createSessionOverrides: () => ({ model: textModel("你好，我是墨斗"), cwd: dir }),
    });
    const { port: port3 } = await s3.start();
    const base3 = `http://127.0.0.1:${port3}`;
    try {
      await writeFile(join(home3, "cwd-recents.json"), "not-json{");
      const corrupted = (await fetch(`${base3}/fs/recents`).then((r) => r.json())) as { recents: string[] };
      expect(corrupted.recents).toEqual([]);
      const outside = await mkdtemp(join(tmpdir(), "fs-out2-"));
      await writeFile(join(home3, "cwd-recents.json"), JSON.stringify([outside, dir]));
      const filtered = (await fetch(`${base3}/fs/recents`).then((r) => r.json())) as { recents: string[] };
      expect(filtered.recents).toEqual([dir]);
    } finally {
      await s3.close();
    }
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
