import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import { McpConnection } from "../src/mcp/client.js";
import { mcpToolsFromConnection } from "../src/mcp/tools.js";
import { writeTestServer } from "./mcp-server-fixture.js";

describe("mcpToolsFromConnection", () => {
  it("wraps server tools with prefixed names and execute kind", async () => {
    const fixture = await writeTestServer();
    try {
      const connection = new McpConnection("test", fixture);
      await connection.connect();
      try {
        const tools = await mcpToolsFromConnection(connection);
        const names = tools.map((t) => t.name);
        expect(names).toContain("mcp__test__echo");
        expect(names).toContain("mcp__test__noargs");
        for (const tool of tools) {
          expect(tool.kind).toBe("execute");
          expect(tool.source).toBe("mcp");
        }
      } finally {
        await connection.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("runs through the registry with the same permission gate as builtin tools", async () => {
    const fixture = await writeTestServer();
    try {
      const connection = new McpConnection("test", fixture);
      await connection.connect();
      const registry = new ToolRegistry();
      for (const tool of await mcpToolsFromConnection(connection)) {
        registry.register(tool);
      }

      const ctx = { cwd: process.cwd(), signal: new AbortController().signal };
      const result = await registry.validateAndRun(
        "mcp__test__echo",
        { message: "通过注册表" },
        ctx,
      );
      expect(result.output).toContain("echo: 通过注册表");

      // 未知参数形状也直接透传给 server（由 server 校验）
      const noargs = await registry.validateAndRun("mcp__test__noargs", {}, ctx);
      expect(noargs.output).toContain("ok");
      await connection.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("produces a readable error after the server connection is closed", async () => {
    const fixture = await writeTestServer();
    try {
      const connection = new McpConnection("test", fixture);
      await connection.connect();
      const tools = await mcpToolsFromConnection(connection);
      await connection.close();

      const tool = tools.find((t) => t.name === "mcp__test__echo")!;
      const ctx = { cwd: process.cwd(), signal: new AbortController().signal };
      await expect(tool.run({ message: "x" }, ctx)).rejects.toThrow(/未连接|断开/);
    } finally {
      await fixture.cleanup();
    }
  });
});
