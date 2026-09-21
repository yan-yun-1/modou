import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig;

export interface McpToolInfo {
  name: string;
  description?: string;
  /** MCP 工具的入参是 JSON Schema */
  inputSchema: unknown;
}

const CLIENT_INFO = { name: "modou", version: "0.3.0" };

function isHttpConfig(config: McpServerConfig): config is McpHttpConfig {
  return "url" in config;
}

/**
 * 单个 MCP server 的连接封装（plan-m2 N1/N3）：
 * - stdio 传输（子进程）或 Streamable HTTP 传输
 * - initialize 握手 + 工具列举/调用
 * - close 后 isConnected 变为 false，后续调用给出可读错误（不中断宿主会话）
 */
export class McpConnection {
  readonly name: string;
  readonly config: McpServerConfig;
  #client: Client | null = null;

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.config = config;
  }

  async connect(): Promise<void> {
    const transport = isHttpConfig(this.config)
      ? new StreamableHTTPClientTransport(new URL(this.config.url), {
          requestInit: { headers: this.config.headers },
        })
      : new StdioClientTransport({
          command: this.config.command,
          args: this.config.args ?? [],
          env: this.config.env as Record<string, string> | undefined,
        });
    this.#client = new Client(CLIENT_INFO, { capabilities: {} });
    await this.#client.connect(transport);
  }

  isConnected(): boolean {
    return this.#client !== null;
  }

  async listTools(): Promise<McpToolInfo[]> {
    const client = this.#requireClient();
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /** 调用工具并把 content 拼成纯文本（text 部件逐个拼接） */
  async callTool(name: string, args: unknown): Promise<string> {
    const client = this.#requireClient();
    const result = (await client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const parts = (result.content ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text!);
    const text = parts.join("\n");
    if (result.isError) {
      throw new Error(`MCP 工具 "${name}" 返回错误：${text || "（无详情）"}`);
    }
    return text;
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    if (client) {
      await client.close().catch(() => {});
    }
  }

  #requireClient(): Client {
    if (!this.#client) {
      throw new Error(`MCP server "${this.name}" 未连接或已断开`);
    }
    return this.#client;
  }
}
