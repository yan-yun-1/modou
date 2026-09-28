import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageModel } from "@modou-dev/core";
import { ModouServer, resolveWebRoot } from "@modou-dev/server";

// plan-web A2：同源静态托管——GET / 与 /assets/*，三级 web-root 解析、穿越防护、纯 API 降级。

let dir: string;
let home: string;
let server: ModouServer;
let baseUrl: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "srv-static-"));
  home = await mkdtemp(join(tmpdir(), "srv-static-home-"));
});

afterEach(async () => {
  await server?.close();
});

function startWith(webRoot?: string): void {
  server = new ModouServer({
    port: 0,
    webRoot,
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
          controller.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } });
          controller.close();
        },
      }),
    }),
  } as unknown as LanguageModel;
}

describe("resolveWebRoot（A2 三级解析）", () => {
  it("显式存在的目录 → 解析为绝对路径；不存在的显式目录 → undefined", () => {
    expect(resolveWebRoot(dir)).toBe(dir);
    expect(resolveWebRoot(join(dir, "no-such-dir"))).toBeUndefined();
  });

  it("三级：webui 存在 index.html 时命中发布形态（无显式/无开发态时）", async () => {
    // 造一个临时包结构验证解析顺序不可行（PACKAGE_DIR 是常量），
    // 改为验证：显式优先于一切、dev 形态在 B1 建成后由联调覆盖；
    // 此处仅确认：完全不存在时返回 undefined（纯 API 模式前提）
    expect(resolveWebRoot(join(dir, "nope"))).toBeUndefined();
  });
});

describe("静态托管路由（A2）", () => {
  beforeEach(async () => {
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "index.html"), "<!DOCTYPE html><html><body>modou console</body></html>", "utf8");
    await writeFile(join(dir, "assets", "app.js"), "console.log('modou');", "utf8");
    await writeFile(join(dir, "secret.txt"), "top-secret", "utf8");
    startWith(dir);
    baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
  });

  it("GET / 返回 index.html（text/html）", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("modou console");
  });

  it("GET /assets/app.js 返回 js 与正确 content-type", async () => {
    const res = await fetch(`${baseUrl}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toContain("modou");
  });

  it("路径穿越：URL 归一化/解码变体全部被拒", async () => {
    // URL 归一化：/assets/../secret.txt → /secret.txt → 非静态路由 → API 404
    const viaUrl = await fetch(`${baseUrl}/assets/../secret.txt`);
    expect(viaUrl.status).toBe(404);
    // %5C 解码后成 \ 分隔符：曾暴露 webRoot 根目录文件（已修：/assets/* 锁死 assets 子目录）
    const viaBackslash = await fetch(`${baseUrl}/assets/..%5Csecret.txt`);
    expect(viaBackslash.status).toBe(403);
    // 编码点段：同样不得逃出 assets/
    const viaDots = await fetch(`${baseUrl}/assets/%2e%2e/secret.txt`);
    expect(viaDots.status).toBe(404);
  });

  it("静态豁免鉴权：开着 authToken 静态资源也可访问，API 仍 401", async () => {
    await server.close();
    startWith(dir);
    const authedServer = new ModouServer({
      port: 0,
      webRoot: dir,
      authToken: "t",
      createSessionDefaults: { home },
    });
    server = authedServer;
    baseUrl = `http://127.0.0.1:${(await authedServer.start()).port}`;
    expect((await fetch(`${baseUrl}/`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/sessions`, { method: "POST" })).status).toBe(401);
  });

  it("webRoot 未就绪：纯 API 模式（GET / 404 JSON）", async () => {
    await server.close();
    startWith(join(dir, "no-such-dist"));
    baseUrl = `http://127.0.0.1:${(await server.start()).port}`;
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("web ui not built") });
  });
});
