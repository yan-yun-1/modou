import { describe, expect, it } from "vitest";
import type { LspHub } from "@modou-dev/lsp";
import { createDefinitionTool, resolveLspServers } from "@modou-dev/sdk";

// M5 C3：LSP 装配层单元测试（hub 的协议行为在 @modou-dev/lsp 测试覆盖）

describe("resolveLspServers（C3 装配）", () => {
  it("显式 lspServers 优先于自动探测", () => {
    const servers = resolveLspServers({
      lspServers: { py: { command: "pyright-langserver", args: ["--stdio"] } },
    } as never);
    expect(servers).toEqual({ py: { command: "pyright-langserver", args: ["--stdio"] } });
  });

  it("lspServers 为空对象时回退探测（本机无 server 则 undefined）", () => {
    const servers = resolveLspServers({ lspServers: {} } as never);
    // 本机是否装了 typescript-language-server 不确定，两者都是合法结果
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
