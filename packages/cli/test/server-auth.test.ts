import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageModel } from "@modou-dev/core";
import { ModouServer } from "@modou-dev/server";

// plan-web A1：Bearer 鉴权——opt-in、/health 豁免、401 语义、无 token 时零行为变化。

const TOKEN = "secret-token-abc123";

describe("ModouServer 鉴权（A1）", () => {
  let dir: string;
  let home: string;
  let server: ModouServer;
  let baseUrl: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "srv-auth-"));
    home = await mkdtemp(join(tmpdir(), "srv-auth-home-"));
  });

  afterEach(async () => {
    await server.close();
  });

  function startWith(authToken?: string): void {
    server = new ModouServer({
      port: 0,
      authToken,
      createSessionDefaults: {
        home,
        settings: { provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" },
      },
      createSessionOverrides: () => ({ model: stubModel(), cwd: dir }),
    });
  }

  function stubModel(): LanguageModel {
    return {
      specificationVersion: "v2",
      provider: "stub",
      modelId: "stub",
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "1" });
            controller.enqueue({ type: "text-delta", id: "1", delta: "ok" });
            controller.enqueue({ type: "text-end", id: "1" });
            controller.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } });
            controller.close();
          },
        }),
      }),
    } as unknown as LanguageModel;
  }

  it("未配置 authToken 时零行为变化（无 token 也能全流程）", async () => {
    startWith(undefined);
    baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    const create = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    expect(create.status).toBe(201);
  });

  it("开启鉴权：/health 豁免，无 token/错 token 一律 401", async () => {
    startWith(TOKEN);
    baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);

    const noToken = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    expect(noToken.status).toBe(401);
    expect(await noToken.json()).toMatchObject({ error: expect.stringContaining("unauthorized") });

    const badToken = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(badToken.status).toBe(401);
  });

  it("正确 token 时 API 与 SSE 全部可用", async () => {
    startWith(TOKEN);
    baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const headers = { authorization: `Bearer ${TOKEN}` };

    const create = await fetch(`${baseUrl}/sessions`, { method: "POST", headers });
    expect(create.status).toBe(201);
    const { sessionId } = (await create.json()) as { sessionId: string };

    const list = await fetch(`${baseUrl}/sessions`, { headers });
    expect(list.status).toBe(200);

    const message = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: "hi" }),
    });
    expect(message.status).toBe(202);

    // SSE 也受保护：无 token 连接被 401 拒绝
    const sseNoToken = await fetch(`${baseUrl}/sessions/${sessionId}/events`);
    expect(sseNoToken.status).toBe(401);
  });

  it("token 精确匹配：前缀 token 也不能通过", async () => {
    startWith(TOKEN);
    baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const prefix = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN.slice(0, 6)}` },
    });
    expect(prefix.status).toBe(401);
  });
});
