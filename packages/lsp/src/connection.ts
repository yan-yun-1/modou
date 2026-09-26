import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import {
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  ExitNotification,
  InitializeRequest,
  InitializedNotification,
  PublishDiagnosticsNotification,
  ShutdownRequest,
  type Diagnostic,
} from "vscode-languageserver-protocol";

/** M5 C1（PRD F16）：单个 language server 的 LSP 连接（stdio transport） */

export interface LspServerConfig {
  command: string;
  args?: string[];
}

export interface DiagnosticInfo {
  severity: number;
  message: string;
  source?: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface LocationInfo {
  path: string;
  line: number;
  character: number;
}

function toUri(path: string): string {
  return pathToFileURL(resolve(path)).href;
}

function languageIdFor(path: string): string {
  switch (extname(path)) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    case ".py":
      return "python";
    case ".json":
      return "json";
    case ".md":
      return "markdown";
    default:
      return "plaintext";
  }
}

export interface StartOptions {
  cwd: string;
  /** initialize 等待上限（毫秒） */
  initTimeoutMs?: number;
}

export class LspConnection {
  #child: ChildProcess;
  #connection: MessageConnection;
  #cwd: string;
  #diagnostics = new Map<string, Diagnostic[]>();
  #open = new Set<string>();
  #version = new Map<string, number>();
  #revision = 0;
  #closed = false;

  private constructor(child: ChildProcess, connection: MessageConnection, cwd: string) {
    this.#child = child;
    this.#connection = connection;
    this.#cwd = cwd;
    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      this.#revision += 1;
      this.#diagnostics.set(params.uri, params.diagnostics ?? []);
    });
    connection.onError(([error]) => {
      process.stderr.write(`[modou-lsp] server error: ${error.message}\n`);
    });
  }

  /** 启动 server 并完成 initialize 握手 */
  static async start(config: LspServerConfig, options: StartOptions): Promise<LspConnection> {
    const child = spawn(config.command, config.args ?? [], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    const conn = new LspConnection(child, connection, options.cwd);
    connection.listen();
    const initTimeoutMs = options.initTimeoutMs ?? 15_000;
    const rootUri = pathToFileURL(resolve(options.cwd)).href;
    const result = await Promise.race([
      connection.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: { synchronization: { dynamicRegistration: false, didSave: false } },
        },
        workspaceFolders: [{ uri: rootUri, name: basename(resolve(options.cwd)) }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`LSP initialize 超时（${initTimeoutMs}ms）`)), initTimeoutMs),
      ),
    ]);
    conn.#serverCapabilities = (result?.capabilities ?? {}) as object;
    connection.sendNotification(InitializedNotification.type, {});
    return conn;
  }

  #serverCapabilities: object = {};

  get capabilities(): object {
    return this.#serverCapabilities;
  }

  get exited(): boolean {
    return this.#closed || this.#child.exitCode !== null;
  }

  #ensureOpen(path: string): string {
    const abs = resolve(path);
    const uri = toUri(abs);
    if (this.#open.has(uri)) {
      return uri;
    }
    const content = readFileSync(abs, "utf8");
    const version = 1;
    this.#open.add(uri);
    this.#version.set(uri, version);
    this.#connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId: languageIdFor(abs), version, text: content },
    });
    return uri;
  }

  /** 全量同步文件内容（edit/write 后调用；未打开过则先 didOpen） */
  applyChanges(path: string, content: string): void {
    const uri = this.#ensureOpen(path);
    const version = (this.#version.get(uri) ?? 1) + 1;
    this.#version.set(uri, version);
    this.#connection.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
  }

  diagnosticsFor(path: string): DiagnosticInfo[] {
    const diags = this.#diagnostics.get(toUri(resolve(path))) ?? [];
    return diags.map((d: Diagnostic) => ({
      severity: d.severity ?? 1,
      // MarkupContent（含 markdown）降级为纯文本
      message: typeof d.message === "string" ? d.message : d.message.value,
      source: d.source,
      range: {
        start: { line: d.range.start.line, character: d.range.start.character },
        end: { line: d.range.end.line, character: d.range.end.character },
      },
    }));
  }

  /** 诊断缓存修订号：每次 publishDiagnostics 递增（等待"本次变更之后"的发布用） */
  get diagnosticRevision(): number {
    return this.#revision;
  }

  /**
   * 等待诊断满足谓词。默认等待修订号推进之后的非空诊断，避免被旧快照满足；
   * 超时返回当前快照。
   */
  async waitForDiagnostics(
    path: string,
    options: {
      timeoutMs?: number;
      predicate?: (diags: DiagnosticInfo[]) => boolean;
      /** 只认该修订号之后的发布（缺省=当前值，即要求一次新发布） */
      sinceRevision?: number;
    } = {},
  ): Promise<DiagnosticInfo[]> {
    const predicate = options.predicate ?? ((diags) => diags.length > 0);
    const since = options.sinceRevision ?? this.#revision;
    const deadline = Date.now() + (options.timeoutMs ?? 2_000);
    for (;;) {
      const current = this.diagnosticsFor(path);
      if (this.#revision > since && predicate(current)) {
        return current;
      }
      if (Date.now() >= deadline) {
        return current;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** 跳转到定义：返回归一化位置列表（0-based line/character） */
  async definition(path: string, line: number, character: number): Promise<LocationInfo[]> {
    const uri = this.#ensureOpen(path);
    const result = await this.#connection.sendRequest(DefinitionRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
    if (!result) {
      return [];
    }
    const locations = Array.isArray(result) ? result : [result];
    const out: LocationInfo[] = [];
    for (const loc of locations) {
      // Location 与 LocationLink 两种形状
      if ("targetUri" in loc) {
        out.push({
          path: fileURLToPath(loc.targetUri),
          line: loc.targetSelectionRange.start.line,
          character: loc.targetSelectionRange.start.character,
        });
      } else {
        out.push({
          path: fileURLToPath(loc.uri),
          line: loc.range.start.line,
          character: loc.range.start.character,
        });
      }
    }
    return out;
  }

  /** shutdown → exit → 等待子进程退出（Windows 上释放 cwd 目录锁）。幂等 */
  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const exited = new Promise<void>((resolveExit) => {
      if (this.#child.exitCode !== null) {
        resolveExit();
      } else {
        this.#child.once("close", () => resolveExit());
      }
    });
    try {
      await Promise.race([
        this.#connection.sendRequest(ShutdownRequest.type, undefined),
        new Promise((r) => setTimeout(r, 1_500)),
      ]);
      this.#connection.sendNotification(ExitNotification.type);
    } catch {
      // server 已死或超时：下面统一等退出，超时则杀
    }
    await Promise.race([
      exited,
      new Promise<void>((r) =>
        setTimeout(() => {
          if (this.#child.exitCode === null) {
            this.#child.kill();
          }
          r();
        }, 2_000),
      ),
    ]);
    this.#connection.dispose();
  }
}
