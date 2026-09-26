import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDefaultServers, resetDetectionCache, type DetectProbe } from "../src/detect.js";
import { LspHub } from "../src/hub.js";

// M5 C2：LspHub 路由/格式化/容错 + 自动探测

const FIXTURE = fileURLToPath(new URL("./lsp-server-fixture.mjs", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "modou-lsp-hub-"));
});

afterEach(async () => {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      break;
    } catch {
      if (attempt >= 5) throw new Error(`清理临时目录失败：${dir}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

describe("LspHub（C2）", () => {
  it("按扩展名路由到匹配的 server", async () => {
    const hub = await LspHub.start({
      cwd: dir,
      servers: { typescript: { command: process.execPath, args: [FIXTURE] } },
    });
    expect(hub.serverFor("src/a.ts")?.exited).toBe(false);
    expect(hub.serverFor("src/b.tsx")?.exited).toBe(false);
    expect(hub.serverFor("README.md")).toBeUndefined();
    await hub.close();
  });

  it("显式 extensions 配置覆盖默认映射", async () => {
    const hub = await LspHub.start({
      cwd: dir,
      servers: { py: { command: process.execPath, args: [FIXTURE], extensions: [".py"] } },
    });
    expect(hub.serverFor("m.py")?.exited).toBe(false);
    expect(hub.serverFor("m.ts")).toBeUndefined();
    await hub.close();
  });

  it("diagnosticsAfterWrite 同步内容并返回格式化诊断文本", async () => {
    const hub = await LspHub.start({
      cwd: dir,
      servers: { typescript: { command: process.execPath, args: [FIXTURE] } },
    });
    const file = join(dir, "a.ts");
    await writeFile(file, "const x = ERROR_MARKER;\n");
    const text = await hub.diagnosticsAfterWrite(file, "const x = ERROR_MARKER;\n");
    expect(text).toContain("--- LSP 诊断 ---");
    expect(text).toContain("a.ts:1:11 error  mock: type error (mock-lsp)");
    // 修正后返回 undefined（空诊断不产生噪声）
    const cleared = await hub.diagnosticsAfterWrite(file, "const x = 1;\n");
    expect(cleared).toBeUndefined();
    await hub.close();
  });

  it("definition 返回格式化位置", async () => {
    const hub = await LspHub.start({
      cwd: dir,
      servers: { typescript: { command: process.execPath, args: [FIXTURE] } },
    });
    const file = join(dir, "c.ts");
    await writeFile(file, "const y = z;\n");
    const text = await hub.definition(file, 0, 0);
    expect(text).toContain(`定义位置：`);
    expect(text).toContain(join(dir, "target.ts") + ":3:5");
    expect(await hub.definition(file, 1, 0)).toBeUndefined();
    await hub.close();
  });

  it("单个 server 启动失败不阻断其余 server", async () => {
    const hub = await LspHub.start({
      cwd: dir,
      servers: {
        broken: { command: "nonexistent-lsp-server-xyz" },
        typescript: { command: process.execPath, args: [FIXTURE] },
      },
    });
    expect(hub.serverNames).toEqual(["typescript"]);
    await hub.close();
    expect(hub.serverNames).toEqual([]);
  });
});

describe("detectDefaultServers（C2 自动探测）", () => {
  beforeEach(() => resetDetectionCache());
  afterEach(() => resetDetectionCache());

  it("探测成功返回 typescript server 配置并按进程缓存", () => {
    const probe: DetectProbe = (command) =>
      command === "typescript-language-server" ? { status: 0 } : { status: 1 };
    const first = detectDefaultServers(probe);
    expect(first.typescript).toEqual({
      command: "typescript-language-server",
      args: ["--stdio"],
    });
    // 第二次走缓存（换一个必失败的 probe 也不影响）
    const second = detectDefaultServers(() => ({ status: 1 }));
    expect(second.typescript).toBeDefined();
  });

  it("探测失败返回空对象", () => {
    const servers = detectDefaultServers(() => ({ status: 1 }));
    expect(servers).toEqual({});
  });
});
