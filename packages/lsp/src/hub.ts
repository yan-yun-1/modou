import { LspConnection, type LspServerConfig } from "./connection.js";

/**
 * M5 C2：多 language server 管理 + 按扩展名路由。
 * 一个 server 默认处理的扩展名：显式配置 extensions 优先；缺省查 DEFAULT_EXTENSIONS。
 */

export interface HubServerConfig extends LspServerConfig {
  /** 该 server 处理的文件扩展名（含点号，如 ".ts"）；缺省用内置映射 */
  extensions?: string[];
}

/** 内置扩展名映射（缺省名为 typescript 的 server 处理 TS/JS 系） */
export const DEFAULT_EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
};

export interface LspHubOptions {
  cwd: string;
  servers: Record<string, HubServerConfig>;
}

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx).toLowerCase();
}

export class LspHub {
  #connections = new Map<string, LspConnection>();
  #configs: Record<string, HubServerConfig>;
  #cwd: string;

  private constructor(configs: Record<string, HubServerConfig>, cwd: string) {
    this.#configs = configs;
    this.#cwd = cwd;
  }

  /** 并发启动全部 server；单个失败不阻断（记 stderr，继续用其余 server） */
  static async start(options: LspHubOptions): Promise<LspHub> {
    const hub = new LspHub(options.servers, options.cwd);
    await Promise.allSettled(
      Object.entries(options.servers).map(async ([name, config]) => {
        const connection = await LspConnection.start(config, { cwd: options.cwd });
        hub.#connections.set(name, connection);
      }),
    );
    return hub;
  }

  get serverNames(): string[] {
    return [...this.#connections.keys()];
  }

  /** 按扩展名路由到 server；无匹配返回 undefined */
  serverFor(path: string): LspConnection | undefined {
    const ext = extensionOf(path);
    for (const [name, connection] of this.#connections) {
      const extensions = this.#configs[name]?.extensions ?? DEFAULT_EXTENSIONS[name] ?? [];
      if (extensions.includes(ext)) {
        return connection;
      }
    }
    return undefined;
  }

  /** edit/write 后调用：同步内容并等待本次变更后的诊断，返回格式化文本（无诊断或无 server 返回 undefined） */
  async diagnosticsAfterWrite(
    path: string,
    content: string,
    options: { timeoutMs?: number } = {},
  ): Promise<string | undefined> {
    const connection = this.serverFor(path);
    if (!connection || connection.exited) {
      return undefined;
    }
    const since = connection.diagnosticRevision;
    connection.applyChanges(path, content);
    const diags = await connection.waitForDiagnostics(path, {
      timeoutMs: options.timeoutMs ?? 2_500,
      sinceRevision: since,
    });
    return formatDiagnostics(path, diags);
  }

  async definition(path: string, line: number, character: number): Promise<string | undefined> {
    const connection = this.serverFor(path);
    if (!connection || connection.exited) {
      return undefined;
    }
    const locations = await connection.definition(path, line, character);
    if (locations.length === 0) {
      return undefined;
    }
    const lines = locations.map((loc) => `${loc.path}:${loc.line + 1}:${loc.character + 1}`);
    return `定义位置：\n${lines.join("\n")}`;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.#connections.values()].map((c) => c.close()));
    this.#connections.clear();
  }
}

const SEVERITY_NAMES: Record<number, string> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

/** 诊断 → 工具输出文本（空诊断返回 undefined，避免给模型噪声） */
export function formatDiagnostics(
  path: string,
  diags: { severity: number; message: string; source?: string; range: { start: { line: number; character: number } } }[],
): string | undefined {
  if (diags.length === 0) {
    return undefined;
  }
  const lines = diags.map((d) => {
    const severity = SEVERITY_NAMES[d.severity] ?? String(d.severity);
    const pos = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
    return `${path}:${pos} ${severity}  ${d.message}${d.source ? ` (${d.source})` : ""}`;
  });
  return `--- LSP 诊断 ---\n${lines.join("\n")}`;
}
