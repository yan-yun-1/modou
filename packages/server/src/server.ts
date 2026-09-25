import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ModouEvent } from "@modou-dev/core";
import { VERSION } from "@modou-dev/core";
import {
  createSession,
  loadModelOverrides,
  SessionStore,
  type CreateSessionOptions,
  type ModouSession,
} from "@modou-dev/sdk";

/**
 * M4 server 包（PRD F18）：HTTP + SSE 会话 API，多端复用。
 * node:http 手写路由（零新依赖）。事件持久化由 sdk/core 负责，server 只做转发与审批路由。
 */

export interface ModouServerOptions {
  port?: number;
  host?: string;
  /** 透传给 createSession 的默认项（home/settings/model 注入等，测试用） */
  createSessionDefaults?: Omit<CreateSessionOptions, "cwd">;
  /** 每会话覆盖项工厂（按请求体 body.cwd 等），测试注入 model 用 */
  createSessionOverrides?: (body: Record<string, unknown>) => Partial<CreateSessionOptions>;
}

interface SessionEntry {
  session: ModouSession;
  busy: boolean;
  sseClients: Set<ServerResponse>;
  abort?: AbortController;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export class ModouServer {
  readonly #options: ModouServerOptions;
  #http: Server | null = null;
  #sessions = new Map<string, SessionEntry>();

  constructor(options: ModouServerOptions = {}) {
    this.#options = options;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  async start(): Promise<{ port: number; host: string }> {
    const host = this.#options.host ?? "127.0.0.1";
    const port = this.#options.port ?? 4711;
    const http = createServer((req, res) => {
      void this.#handle(req, res);
    });
    this.#http = http;
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(port, host, () => resolve());
    });
    // port=0 时由系统分配实际端口
    const address = http.address();
    const actualPort = typeof address === "object" && address !== null ? address.port : port;
    return { port: actualPort, host };
  }

  /** 关闭全部会话（abort + closeMcp）并停监听——SIGINT 优雅退出用 */
  async close(): Promise<void> {
    for (const [id, entry] of this.#sessions) {
      entry.abort?.abort();
      // 先断开 SSE 客户端，否则 http.close 会等待活跃连接导致挂起
      for (const client of entry.sseClients) {
        client.end();
      }
      entry.sseClients.clear();
      await entry.session.close().catch(() => {});
      this.#sessions.delete(id);
    }
    await new Promise<void>((resolve) => {
      if (!this.#http) {
        resolve();
        return;
      }
      // 强制断开 keep-alive 连接（undici fetch 等），否则 close 等到超时
      this.#http.closeAllConnections?.();
      this.#http.close(() => resolve());
    });
    this.#http = null;
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return this.#json(res, 200, { ok: true, version: VERSION });
      }
      if (url.pathname === "/sessions") {
        if (req.method === "POST") {
          return await this.#createSession(req, res);
        }
        if (req.method === "GET") {
          return await this.#list(res);
        }
      }
      if (parts[0] === "sessions" && parts[1] !== undefined) {
        const id = parts[1];
        if (!SESSION_ID_PATTERN.test(id)) {
          return this.#json(res, 400, { error: "invalid session id" });
        }
        if (req.method === "GET" && parts.length === 2) {
          return await this.#history(id, res);
        }
        if (req.method === "DELETE" && parts.length === 2) {
          return await this.#closeSession(id, res);
        }
        if (parts[2] === "events" && req.method === "GET") {
          return this.#sse(id, res);
        }
        if (parts[2] === "messages" && req.method === "POST") {
          const body = await this.#readJson(req);
          return this.#postMessage(id, String(body?.input ?? ""), res);
        }
        if (parts[2] === "approvals" && parts[3] !== undefined && req.method === "POST") {
          const body = (await this.#readJson(req)) ?? {};
          return this.#answerApproval(id, parts[3], body, res);
        }
      }
      this.#json(res, 404, { error: "not found" });
    } catch (error) {
      this.#json(res, 500, { error: (error as Error).message });
    }
  }

  async #createSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await this.#readJson(req)) ?? {};
    const defaults = this.#options.createSessionDefaults ?? {};
    const session = await createSession({
      ...defaults,
      // models.json 自定义能力（目录外模型如 glm-4.5-air 需要它解析能力与计价）
      modelOverrides: await loadModelOverrides(defaults.home),
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      ...(this.#options.createSessionOverrides?.(body) ?? {}),
    });
    const entry: SessionEntry = { session, busy: false, sseClients: new Set() };
    this.#sessions.set(session.sessionId, entry);
    this.#json(res, 201, {
      sessionId: session.sessionId,
      contextWindow: session.contextWindow,
      mcpStatus: session.mcpStatus,
    });
  }

  /** 会话列表：最近 50 个，标出本进程活跃会话，附首条用户消息预览 */
  async #list(res: ServerResponse): Promise<void> {
    const store = new SessionStore();
    const ids = await store.list();
    const sessions: { sessionId: string; active: boolean; preview: string }[] = [];
    for (const sid of ids.slice(-50).reverse()) {
      let preview: string;
      try {
        const events = await store.read(sid);
        const user = events.find((ev): ev is typeof ev & { text: string } => ev.type === "user_message");
        preview = user ? user.text.slice(0, 60) : "";
      } catch {
        preview = "（会话文件损坏，无法预览）";
      }
      sessions.push({ sessionId: sid, active: this.#sessions.has(sid), preview });
    }
    this.#json(res, 200, { sessions });
  }

  async #history(id: string, res: ServerResponse): Promise<void> {
    const entry = this.#sessions.get(id);
    if (!entry) {
      // 会话不在本进程注册表（可能重启过）——仍可从 SessionStore 回放
      return this.#json(res, 404, { error: "session not found" });
    }
    const events: ModouEvent[] = await entry.session.store.read(id);
    this.#json(res, 200, { sessionId: id, events });
  }

  async #closeSession(id: string, res: ServerResponse): Promise<void> {
    const entry = this.#sessions.get(id);
    if (!entry) {
      return this.#json(res, 404, { error: "session not found" });
    }
    entry.abort?.abort();
    for (const client of entry.sseClients) {
      client.end();
    }
    await entry.session.close().catch(() => {});
    this.#sessions.delete(id);
    this.#json(res, 200, { ok: true });
  }

  #sse(id: string, res: ServerResponse): void {
    const entry = this.#sessions.get(id);
    if (!entry) {
      console.error("[dbg] sse 404 id=" + JSON.stringify(id) + " keys=" + JSON.stringify([...this.#sessions.keys()]));
      this.#json(res, 404, { error: "session not found" });
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`retry: 2000\n\n`);
    entry.sseClients.add(res);
    // 快照：把当前待审批请求补发给新连上的客户端（重连不丢审批）
    for (const req of entry.session.approvals.pendingRequests()) {
      this.#writeEvent(res, { type: "approval_request", ...req, at: Date.now() });
    }
    res.on("close", () => {
      entry.sseClients.delete(res);
    });
  }

  #postMessage(id: string, input: string, res: ServerResponse): void {
    const entry = this.#sessions.get(id);
    if (!entry) {
      this.#json(res, 404, { error: "session not found" });
      return;
    }
    if (entry.busy) {
      this.#json(res, 409, { error: "session busy: a turn is already running" });
      return;
    }
    if (input.trim() === "") {
      this.#json(res, 400, { error: "input is required" });
      return;
    }
    entry.busy = true;
    entry.abort = new AbortController();
    // 202 先应答，事件走 SSE
    this.#json(res, 202, { ok: true, sessionId: id });
    void this.#runTurn(entry, input);
  }

  async #runTurn(entry: SessionEntry, input: string): Promise<void> {
    const abort = entry.abort;
    try {
      for await (const event of entry.session.run(input, {
        signal: abort?.signal,
      })) {
        this.#broadcast(entry, event);
      }
    } catch (error) {
      this.#broadcast(entry, {
        type: "error",
        message: (error as Error).message,
        fatal: false,
        at: Date.now(),
      });
    } finally {
      entry.busy = false;
      this.#broadcast(entry, { type: "usage", ...{ turnEnd: true }, at: Date.now() } as unknown as ModouEvent);
    }
  }

  #answerApproval(id: string, requestId: string, body: Record<string, unknown>, res: ServerResponse): void {
    const entry = this.#sessions.get(id);
    if (!entry) {
      this.#json(res, 404, { error: "session not found" });
      return;
    }
    const ok = entry.session.approvals.answerById(requestId, {
      granted: body.granted === true,
      remembered: body.remembered === true,
    });
    this.#json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "approval request not found" });
  }

  #broadcast(entry: SessionEntry, event: ModouEvent): void {
    for (const client of entry.sseClients) {
      this.#writeEvent(client, event);
    }
  }

  #writeEvent(res: ServerResponse, event: ModouEvent): void {
    res.write(`event: modou\ndata: ${JSON.stringify(event)}\n\n`);
  }

  async #readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    if (chunks.length === 0) {
      return null;
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  #json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }
}
