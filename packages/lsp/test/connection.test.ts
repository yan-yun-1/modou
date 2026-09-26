import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LspConnection } from "../src/connection.js";

// M5 C1：LSP 连接协议级集成测试——用 mock server（stdio 子进程）走完整握手/同步/诊断/定义，
// 不依赖外部 language server 二进制（真实 server 的验证在 C4）。

const FIXTURE = fileURLToPath(new URL("./lsp-server-fixture.mjs", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "modou-lsp-"));
});

afterEach(async () => {
  // Windows 上进程退出与目录解锁之间有短暂延迟，重试 rmdir
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

describe("LspConnection（C1 集成）", () => {
  it("完成 initialize 握手并暴露 server 能力", async () => {
    const conn = await LspConnection.start(
      { command: process.execPath, args: [FIXTURE] },
      { cwd: dir },
    );
    expect(conn.capabilities.textDocumentSync).toBe(1);
    await conn.close();
  });

  it("didOpen 触发诊断发布，waitForDiagnostics 收到非空诊断", async () => {
    const conn = await LspConnection.start(
      { command: process.execPath, args: [FIXTURE] },
      { cwd: dir },
    );
    const file = join(dir, "a.ts");
    await writeFile(file, "const x = ERROR_MARKER;\n");
    conn.applyChanges(file, "const x = ERROR_MARKER;\n");
    const diags = await conn.waitForDiagnostics(file);
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      severity: 1,
      message: "mock: type error",
      source: "mock-lsp",
    });
    expect(diags[0]!.range.start).toEqual({ line: 0, character: 10 });
    await conn.close();
  });

  it("内容修正后收到空诊断（全量同步生效）", async () => {
    const conn = await LspConnection.start(
      { command: process.execPath, args: [FIXTURE] },
      { cwd: dir },
    );
    const file = join(dir, "b.ts");
    await writeFile(file, "const x = ERROR_MARKER;\n");
    conn.applyChanges(file, "const x = ERROR_MARKER;\n");
    await conn.waitForDiagnostics(file);
    conn.applyChanges(file, "const x = 1;\n");
    const cleared = await conn.waitForDiagnostics(file, {
      predicate: (diags) => diags.length === 0,
    });
    expect(cleared).toEqual([]);
    await conn.close();
  });

  it("definition 归一化 Location 为 {path, line, character}", async () => {
    const conn = await LspConnection.start(
      { command: process.execPath, args: [FIXTURE] },
      { cwd: dir },
    );
    const file = join(dir, "c.ts");
    await writeFile(file, "const y = z;\n");
    const locations = await conn.definition(file, 0, 0);
    expect(locations).toEqual([{ path: join(dir, "target.ts"), line: 2, character: 4 }]);
    // 非 0:0 位置返回空数组
    expect(await conn.definition(file, 1, 0)).toEqual([]);
    await conn.close();
  });

  it("close 幂等且子进程退出", async () => {
    const conn = await LspConnection.start(
      { command: process.execPath, args: [FIXTURE] },
      { cwd: dir },
    );
    await conn.close();
    await conn.close(); // 幂等
    await new Promise((r) => setTimeout(r, 900));
    expect(conn.exited).toBe(true);
  });
});
