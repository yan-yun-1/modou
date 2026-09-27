import { createServer, type Server } from "node:http";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpConnection } from "../src/mcp/client.js";

// M5 E2（backlog-m3 #7）：HTTP 型 MCP server 集成测试——
// 用官方 SDK 起一个 StreamableHTTP 测试 server（stateless 模式），
// 验证 McpConnection 的 url 传输：握手/列举/调用/关闭。

let server: Server;
let url: string;

beforeEach(async () => {
  server = createServer(async (req, res) => {
    try {
      // stateless：每请求一个独立 transport + server（官方推荐的无状态模式）
      const mcp = new McpServer({ name: "test-http-mcp", version: "1.0.0" });
      mcp.tool("echo", "回显消息", { message: z.string() }, async ({ message }) => ({
        content: [{ type: "text", text: `echo:${message}` }],
      }));
      mcp.tool("add", "加法", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.method === "POST" ? await readBody(req) : undefined);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500).end(JSON.stringify({ error: (error as Error).message }));
      }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}/mcp`;
});

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch (error) {
        reject(error as Error);
      }
    });
    req.on("error", reject);
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("MCP HTTP 传输（E2）", () => {
  it("connect → listTools → callTool → close 全链路", async () => {
    const conn = new McpConnection("test-http", { url });
    expect(conn.isConnected()).toBe(false);

    await conn.connect();
    expect(conn.isConnected()).toBe(true);

    const tools = await conn.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["add", "echo"]);
    const echo = tools.find((t) => t.name === "echo");
    expect(echo?.description).toBe("回显消息");

    const output = await conn.callTool("echo", { message: "hello-http" });
    expect(output).toBe("echo:hello-http");

    const sum = await conn.callTool("add", { a: 2, b: 40 });
    expect(sum).toBe("42");

    await conn.close();
    expect(conn.isConnected()).toBe(false);
  });

  it("连接非 MCP 的 HTTP 服务时连接失败", async () => {
    // 端口 9 在部分平台行为不可靠；用「HTTP 服务存在但不是 MCP（恒 500）」做确定性场景
    const plain = createServer((_req, res) => {
      res.writeHead(500).end("not mcp");
    });
    await new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", resolve));
    const port = (plain.address() as { port: number }).port;
    const conn = new McpConnection("bad-http", { url: `http://127.0.0.1:${port}/mcp` });
    await expect(conn.connect()).rejects.toThrow();
    expect(conn.isConnected()).toBe(false);
    const final = new Promise<void>((resolve) => plain.close(() => resolve()));
    await final;
  });
});
