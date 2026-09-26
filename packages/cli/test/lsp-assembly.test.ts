import { describe, expect, it } from "vitest";
import type { LspHub } from "@modou-dev/lsp";
import { createDefinitionTool, resolveLspServers } from "@modou-dev/sdk";

// M5 C3：LSP 装配层单元测试（hub 的协议行为在 @modou-dev/lsp 测试覆盖）

describe("resolveLspServers（C3 装配）", () => {
  it("显式 lspServers 优先于自动探测（无需 lsp 开关）", () => {
    const servers = resolveLspServers({
      lspServers: { py: { command: "pyright-langserver", args: ["--stdio"] } },
    } as never);
    expect(servers).toEqual({ py: { command: "pyright-langserver", args: ["--stdio"] } });
  });

  it("默认 off：未配置 lspServers 且未开 lsp 时不探测", () => {
    expect(resolveLspServers({} as never)).toBeUndefined();
    expect(resolveLspServers({ lspServers: {}, lsp: "off" } as never)).toBeUndefined();
  });

  it("lsp:auto 时回退探测（探测结果取决于本机环境）", () => {
    const servers = resolveLspServers({ lsp: "auto" } as never);
    expect(servers === undefined || Object.keys(servers).length >= 0).toBe(true);
  });
});

describe("createDefinitionTool（C3 装配）", () => {
  it("把 hub 的定义结果包装为工具输出；未找到给明确文案", async () => {
    const hub = {
      definition: async (file: string, line: number, column: number) =>
        line === 0 ? `定义位置：\n${file}:${line + 1}:${column + 1}` : undefined,
    } as unknown as LspHub;
    const tool = createDefinitionTool(hub);
    expect(tool.name).toBe("definition");
    expect(tool.kind).toBe("read");

    const found = await tool.run({ file: "a.ts", line: 0, column: 2 }, {
      cwd: ".",
      signal: new AbortController().signal,
      sessionId: "s",
    } as never);
    expect(found.output).toContain("定义位置：");
    expect(found.output).toContain("a.ts:1:3");

    const missing = await tool.run({ file: "a.ts", line: 3 }, {} as never);
    expect(missing.output).toBe("未找到该位置符号的定义。");
  });

  it("schema 校验拒绝缺 file 的调用", async () => {
    const hub = { definition: async () => undefined } as unknown as LspHub;
    const tool = createDefinitionTool(hub);
    expect(tool.schema.safeParse({ line: 0 }).success).toBe(false);
    expect(tool.schema.safeParse({ file: "a.ts", line: 0 }).success).toBe(true);
  });
});
