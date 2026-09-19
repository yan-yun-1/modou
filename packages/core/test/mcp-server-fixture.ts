import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

/**
 * 写一个最小 MCP stdio server 到包目录内（子进程必须能解析到 SDK），
 * 返回启动命令与清理函数。
 */
export async function writeTestServer(): Promise<{
  command: string;
  args: string[];
  cleanup: () => Promise<void>;
}> {
  const dir = join(process.cwd(), ".tmp-mcp-fixture");
  await mkdir(dir, { recursive: true });
  const serverPath = join(dir, "test-server.mjs");
  await writeFile(serverPath, SERVER_SOURCE, "utf8");
  return {
    command: process.execPath,
    args: [serverPath],
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
