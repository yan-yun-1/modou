import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpConnection } from "../src/mcp/client.js";

let dir: string;
let mcpDir: string;
let serverPath: string;

// 用 SDK 底层 Server 写一个最小 MCP server（stdio，无 zod 依赖），作为真实子进程 fixture。
// 脚本必须放在包目录内，子进程才能解析 @modelcontextprotocol/sdk。
const SERVER_SOURCE = `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "echo", description: "回声", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } },
    { name: "noargs", description: "无参", inputSchema: { type: "object", properties: {} } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "echo") {
    return { content: [{ type: "text", text: "echo: " + req.params.arguments?.message }] };
  }
  return { content: [{ type: "text", text: "ok" }] };
});
await server.connect(new StdioServerTransport());
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-mcp-"));
  mcpDir = join(process.cwd(), ".tmp-mcp-fixture");
  await mkdir(mcpDir, { recursive: true });
  serverPath = join(mcpDir, "test-server.mjs");
  await writeFile(serverPath, SERVER_SOURCE, "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(mcpDir, { recursive: true, force: true });
});

describe("McpConnection", () => {
  it("connects over stdio and lists tools from a real server subprocess", async () => {
    const connection = new McpConnection("test", {
      command: process.execPath,
      args: [serverPath],
    });
    await connection.connect();
    try {
      const tools = await connection.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("echo");
      expect(names).toContain("noargs");
      expect(connection.isConnected()).toBe(true);
    } finally {
      await connection.close();
    }
    expect(connection.isConnected()).toBe(false);
  });

  it("calls a tool and returns text content", async () => {
    const connection = new McpConnection("test", {
      command: process.execPath,
      args: [serverPath],
    });
    await connection.connect();
    try {
      const result = await connection.callTool("echo", { message: "你好" });
      expect(result).toContain("echo: 你好");
    } finally {
      await connection.close();
    }
  });

  it("marks itself disconnected when the server process dies", async () => {
    const connection = new McpConnection("test", {
      command: process.execPath,
      args: [serverPath],
    });
    await connection.connect();
    await connection.close();
    await expect(connection.callTool("echo", { message: "x" })).rejects.toThrow(/未连接|断开/);
  });
});
