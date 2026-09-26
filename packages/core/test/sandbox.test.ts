import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bashTool, createBashTool } from "../src/tools/bash.js";
import {
  buildSeatbeltProfile,
  createSandboxAdapter,
  createSeatbeltAdapter,
  type SandboxAdapter,
} from "../src/sandbox/index.js";
import type { ToolContext } from "../src/tools/types.js";

// M5 B2（PRD 6.5）：沙箱适配层。macOS 真实执行路径需实机验证（docs/sandbox-eval.md），
// 本文件覆盖 profile 生成、平台选择、参数拼装与 bash 工具接线。

const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal, sessionId: "t" };

describe("buildSeatbeltProfile", () => {
  it("deny 全部文件写，放行 /dev、cwd 与临时目录，路径去重并转义", () => {
    const profile = buildSeatbeltProfile({ writePaths: ["/proj", "/tmp", "/tmp"] });
    expect(profile).toContain("(version 1)");
    expect(profile).toContain("(allow default)");
    expect(profile).toContain("(deny file-write*)");
    expect(profile).toContain('(subpath "/dev")');
    expect(profile).toContain('(subpath "/proj")');
    expect(profile).toContain('(subpath "/tmp")');
    expect(profile.match(/subpath "\/tmp"/g)).toHaveLength(1);
  });

  it("转义路径中的引号与反斜杠", () => {
    const profile = buildSeatbeltProfile({ writePaths: ['C:\\us"ers'] });
    expect(profile).toContain('(subpath "C:\\\\us\\"ers")');
  });
});

describe("createSandboxAdapter 平台选择", () => {
  it("off 恒为 undefined；undefined 等同 off", () => {
    expect(createSandboxAdapter("off", "darwin")).toBeUndefined();
    expect(createSandboxAdapter(undefined, "darwin")).toBeUndefined();
  });

  it("auto 仅 darwin 启用，win32/linux 返回 undefined", () => {
    expect(createSandboxAdapter("auto", "darwin")?.name).toBe("seatbelt");
    expect(createSandboxAdapter("auto", "win32")).toBeUndefined();
    expect(createSandboxAdapter("auto", "linux")).toBeUndefined();
  });
});

describe("seatbelt wrapExec", () => {
  it("包装为 sandbox-exec -f <profile> 且内层命令原样透传，profile 落盘内容正确", () => {
    const adapter = createSeatbeltAdapter();
    const cwd = "/tmp/proj";
    const wrapped = adapter.wrapExec("/bin/sh", ["-c", "npm test"], { cwd });
    expect(wrapped.cmd).toBe("sandbox-exec");
    expect(wrapped.args[0]).toBe("-f");
    const profilePath = wrapped.args[1]!;
    expect(existsSync(profilePath)).toBe(true);
    expect(readFileSync(profilePath, "utf8")).toBe(
      buildSeatbeltProfile({ writePaths: [cwd, tmpdir()] }),
    );
    // 内层命令完整跟在 profile 之后
    expect(wrapped.args.slice(2)).toEqual(["/bin/sh", "-c", "npm test"]);
  });
});

describe("bash 工具接线", () => {
  it("透传适配器：包一层后命令语义不变", async () => {
    const passThrough: SandboxAdapter = {
      name: "fake",
      wrapExec: (cmd, args) => ({ cmd, args }),
    };
    const result = await createBashTool({ sandbox: passThrough }).run(
      { command: "echo wired-sandbox" },
      ctx,
    );
    expect(result.output).toContain("wired-sandbox");
    expect(result.output).toMatch(/\[exit 0\]/);
  });

  it("无沙箱时行为与旧 bashTool 一致", async () => {
    const a = await createBashTool().run({ command: "echo plain" }, ctx);
    const b = await bashTool.run({ command: "echo plain" }, ctx);
    expect(a.output).toBe(b.output);
    expect(a.output).toContain("plain");
  });
});
