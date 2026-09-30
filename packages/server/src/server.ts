import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
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
  /**
   * Web 控制台（plan-web A1）：Bearer 鉴权 token；未配置时零行为变化。
   * `/health` 豁免（VS Code 插件探测兼容，无敏感数据）。
   */
  authToken?: string;
  /**
   * Web 控制台（plan-web A2）：静态资源根目录（控制台构建产物）。
   * 缺省三级解析：显式 webRoot → 开发态 packages/console/dist → 发布形态包内 webui/。
   * 都不存在时保持纯 API 模式（GET / 404）。
   */
  webRoot?: string;
  /**
   * 会话存储目录（plan-web A4）：createSession 与历史回放/列表共用同一 store，
   * 重启后非活跃会话仍可只读回放。缺省 ~/.modou/sessions。
   */
  store?: import("@modou-dev/sdk").SessionStore;
  /** plan-web A7：并发会话上限（默认 8，超出 429）——每会话真实成本为 MCP/LSP/模型连接 */
  maxSessions?: number;
  /**
   * Phase F1（plan-web）：目录白名单（CLI --fs-allow-root 可重复）。空/未配置 = 不限（本地单用户默认）。
   * 配置后 /fs/dirs 与会话 cwd（含缺省回落 process.cwd()）越界一律 403——部署期收紧手段。
   */
  fsAllowRoots?: string[];
  /** 透传给 createSession 的默认项（home/settings/model 注入等，测试用） */
  createSessionDefaults?: Omit<CreateSessionOptions, "cwd">;
  /** 每会话覆盖项工厂（按请求体 body.cwd 等），测试注入 model 用 */
  createSessionOverrides?: (body: Record<string, unknown>) => Partial<CreateSessionOptions>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/** server 包根目录（dist/server.js → 包根），web-root 二三级解析的锚点 */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * plan-web A2：web-root 三级解析。导出以便测试。
 * ① 显式 webRoot；② 开发态 packages/console/dist；③ 发布形态包内 webui/。
 */
export function resolveWebRoot(explicit?: string): string | undefined {
  if (explicit) {
    return existsSync(explicit) ? resolve(explicit) : undefined;
  }
  const dev = resolve(PACKAGE_DIR, "..", "console", "dist");
  if (existsSync(join(dev, "index.html"))) {
    return dev;
  }
  const published = join(PACKAGE_DIR, "webui");
  if (existsSync(join(published, "index.html"))) {
    return published;
  }
  return undefined;
}

/** Phase F1：目录归一——realpath 优先（Windows 盘符大小写/符号链接一并归一），不存在回退 resolve */
function normalizeDir(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Phase F1：白名单越界判定（导出以便测试）。roots 空 = 不限。
 * realpath 归一后 path.relative：以 ".." 开头或为绝对路径即越界。
 */
export function isPathAllowed(target: string, roots: string[] | undefined): boolean {
  if (!roots || roots.length === 0) return true;
  const t = normalizeDir(target);
  return roots.some((root) => {
    const rel = relative(normalizeDir(root), t);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
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

  /** token 比较：sha256 后 timingSafeEqual，避免长度与逐字节时序侧信道 */
  #tokenMatches(provided: string): boolean {
    const expected = this.#options.authToken ?? "";
    if (provided.length === 0 || expected.length === 0) {
      return false;
    }
    const a = createHash("sha256").update(provided).digest();
    const b = createHash("sha256").update(expected).digest();
    return timingSafeEqual(a, b);
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    // plan-web A1：Bearer 鉴权（opt-in）。/health 与静态资源豁免（插件探测兼容、无敏感数据）
    const isStatic = url.pathname === "/" || parts[0] === "assets";
    if (this.#options.authToken !== undefined && url.pathname !== "/health" && !isStatic) {
      const header = req.headers.authorization ?? "";
      const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!this.#tokenMatches(provided)) {
        res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
        res.end(JSON.stringify({ error: "unauthorized: missing or invalid bearer token" }));
        return;
      }
    }
    // plan-web A2：同源静态托管（GET / 与 /assets/*；web-root 未就绪时纯 API 模式）
    if (req.method === "GET" && isStatic) {
      this.#serveStatic(url.pathname, res);
      return;
    }
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return this.#json(res, 200, { ok: true, version: VERSION });
      }
      // Phase F1（plan-web）：目录浏览（控制台选择项目目录；fsAllowRoots 白名单越界 403）
      if (url.pathname === "/fs/dirs" && req.method === "GET") {
        return await this.#listDirs(url, res);
      }
      if (url.pathname === "/sessions") {
        if (req.method === "POST") {
          return await this.#createSession(req, res);
        }
        if (req.method === "GET") {
          return await this.#list(res);
        }
      }
      // plan-web：历史会话批量删除（控制台全选清理；活跃会话自动走完整关闭）
      if (url.pathname === "/sessions/bulk-delete" && req.method === "POST") {
        return await this.#bulkDelete(req, res);
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
          return await this.#sse(id, res);
        }
        if (parts[2] === "cancel" && req.method === "POST") {
          return this.#cancelTurn(id, res);
        }
        if (parts[2] === "messages" && req.method === "POST") {
          const body = await this.#readJson(req);
          return await this.#postMessage(id, String(body?.input ?? ""), res);
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
    if (this.#bodyTooLarge) {
      this.#bodyTooLarge = false;
      return this.#json(res, 413, { error: "request body too large (1MB max)" });
    }
    const maxSessions = this.#options.maxSessions ?? 8;
    if (this.#sessions.size >= maxSessions) {
      return this.#json(res, 429, { error: `session limit reached (${maxSessions}); DELETE an unused session first` });
    }
    const defaults = this.#options.createSessionDefaults ?? {};
    // plan-web A5：cwd 语义修正——请求 body.cwd 优先于 settings.cwd（SDK 的 resolveCwd
    // 是 settings 优先，浏览器控制台不能被宿主配置静默钉死）；目录不存在 400 不静默回退
    const requested = typeof body.cwd === "string" && body.cwd !== "" ? body.cwd : undefined;
    const settingsCwd = defaults.settings?.cwd;
    const chosenCwd = requested ?? settingsCwd;
    let cwdWarning: string | undefined;
    if (requested && settingsCwd && resolve(requested) !== resolve(settingsCwd)) {
      cwdWarning = `请求 cwd 覆盖 settings.cwd（${resolve(settingsCwd)}）`;
    }
    let chosenAbs: string | undefined;
    if (chosenCwd) {
      chosenAbs = resolve(chosenCwd);
      // Phase F1：白名单越界 403 先于存在性 400——避免白名单外的存在性探测
      if (!isPathAllowed(chosenAbs, this.#options.fsAllowRoots)) {
        return this.#json(res, 403, { error: `cwd 越界：${chosenAbs} 不在 fs-allow-root 白名单内` });
      }
      if (!existsSync(chosenAbs) || !statSync(chosenAbs).isDirectory()) {
        return this.#json(res, 400, { error: `cwd 不存在或不是目录：${chosenAbs}` });
      }
    } else if (this.#options.fsAllowRoots?.length) {
      // 缺省 cwd 由 SDK 回落 process.cwd()，同样受白名单约束（防绕过）
      const fallback = resolve(process.cwd());
      if (!isPathAllowed(fallback, this.#options.fsAllowRoots)) {
        return this.#json(res, 403, { error: `未指定 cwd 时回落进程目录 ${fallback} 不在 fs-allow-root 白名单内` });
      }
    }
    const session = await createSession({
      ...defaults,
      // plan-web A4：server 级 store 覆盖（测试隔离 + 回放/列表同源）
      ...(this.#options.store ? { store: this.#options.store } : {}),
      // models.json 自定义能力（目录外模型如 glm-4.5-air 需要它解析能力与计价）
      modelOverrides: await loadModelOverrides(defaults.home),
      cwd: chosenAbs,
      // A5：settings.cwd 同步覆盖，杜绝 SDK 层 settings 优先把请求 cwd 钉死
      ...(chosenAbs && defaults.settings ? { settings: { ...defaults.settings, cwd: chosenAbs } } : {}),
      ...(this.#options.createSessionOverrides?.(body) ?? {}),
    });
    const entry: SessionEntry = { session, busy: false, sseClients: new Set() };
    this.#sessions.set(session.sessionId, entry);
    this.#json(res, 201, {
      sessionId: session.sessionId,
      contextWindow: session.contextWindow,
      mcpStatus: session.mcpStatus,
      cwd: chosenAbs,
      cwdWarning,
    });
  }

  /** Phase F1：列子目录（仅目录、跳过 dotfiles）；缺省 path = 进程启动目录 */
  async #listDirs(url: URL, res: ServerResponse): Promise<void> {
    const raw = url.searchParams.get("path") ?? process.cwd();
    const abs = resolve(raw);
    if (!isPathAllowed(abs, this.#options.fsAllowRoots)) {
      return this.#json(res, 403, { error: `path 越界：${abs} 不在 fs-allow-root 白名单内` });
    }
    let st;
    try {
      st = await stat(abs);
    } catch {
      return this.#json(res, 400, { error: `目录不存在：${abs}` });
    }
    if (!st.isDirectory()) {
      return this.#json(res, 400, { error: `不是目录：${abs}` });
    }
    const entries = await readdir(abs, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: join(abs, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = dirname(abs);
    this.#json(res, 200, { path: abs, parent: parent === abs ? null : parent, dirs });
  }

  /** 会话列表：最近 50 个，标出本进程活跃会话，附首条用户消息预览 */
  async #list(res: ServerResponse): Promise<void> {
    const store = this.#options.store ?? new SessionStore();
    const ids = await store.list();
    const sessions: { sessionId: string; active: boolean; preview: string }[] = [];
    // store.list 现为最新在前（plan-web 修复），取前 50 即最近 50
    for (const sid of ids.slice(0, 50)) {
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
    this.#json(res, 200, { sessions, total: ids.length });
  }

  async #history(id: string, res: ServerResponse): Promise<void> {
    const entry = this.#sessions.get(id);
    if (entry) {
      const events: ModouEvent[] = await entry.session.store.read(id);
      this.#json(res, 200, { sessionId: id, events, active: true });
      return;
    }
    // plan-web A4：非活跃会话（server 重启过）从同一 SessionStore 只读回放
    const store = this.#options.store ?? new SessionStore();
    const events = await store.read(id).catch((error: Error) => {
      process.stderr.write(`[modou] 回放会话 ${id} 失败：${error.message}
`);
      return [] as ModouEvent[];
    });
    if (events.length === 0) {
      return this.#json(res, 404, { error: "session not found" });
    }
    this.#json(res, 200, { sessionId: id, events, active: false });
  }

  /** plan-web：批量删除——活跃会话走完整关闭，其余删历史文件。ids 上限 5000 */
  async #bulkDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await this.#readJson(req)) ?? {};
    // plan-web：scope=all-history——清空全部非活跃会话（活跃会话不碰），
    // 一次请求删完，避免"删 50 冒 50"的窗口循环
    if (body.scope === "all-history") {
      const store = this.#options.store ?? new SessionStore();
      const all = await store.list();
      let deleted = 0;
      for (const id of all) {
        if (this.#sessions.has(id)) continue;
        await store.delete(id).catch(() => {});
        deleted += 1;
      }
      return this.#json(res, 200, { ok: true, deleted, total: all.length });
    }
    const raw = Array.isArray(body.ids) ? body.ids : [];
    const ids = raw
      .filter((x): x is string => typeof x === "string" && SESSION_ID_PATTERN.test(x))
      .slice(0, 5000);
    const store = this.#options.store ?? new SessionStore();
    let deleted = 0;
    for (const id of ids) {
      const entry = await this.#reattach(id);
      if (entry) {
        entry.abort?.abort();
        for (const client of entry.sseClients) {
          client.end();
        }
        await entry.session.close().catch(() => {});
        this.#sessions.delete(id);
      }
      // 批量删除 = 彻底删除：活跃会话关闭后同样移除历史文件
      await store.delete(id).catch(() => {});
      deleted += 1;
    }
    this.#json(res, 200, { ok: true, deleted, requested: ids.length });
  }

  async #closeSession(id: string, res: ServerResponse): Promise<void> {
    const store = this.#options.store ?? new SessionStore();
    const entry = this.#sessions.get(id);
    if (entry) {
      entry.abort?.abort();
      for (const client of entry.sseClients) {
        client.end();
      }
      await entry.session.close().catch(() => {});
      this.#sessions.delete(id);
    }
    // 删除语义与 bulk-delete 一致：活跃会话关闭后同样移除历史文件（不可恢复）
    await store.delete(id).catch(() => {});
    this.#json(res, 200, { ok: true, deletedHistory: true });
  }

  async #sse(id: string, res: ServerResponse): Promise<void> {
    const entry = await this.#reattach(id);
    if (!entry) {
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

  /**
   * plan-web A3：取消进行中的 turn。abort 只覆盖模型流与工具执行（agent-loop.ts:216,479），
   * 审批等待是纯 Promise 挂起——必须同时对 pendingRequests 逐个 answerById(granted:false)，
   * 否则 busy 永不释放、挂起审批仍被 SSE 补发、事后应答会让已取消的 turn 复活。
   */
  #cancelTurn(id: string, res: ServerResponse): void {
    const entry = this.#sessions.get(id);
    if (!entry) {
      this.#json(res, 404, { error: "session not found" });
      return;
    }
    if (!entry.busy) {
      this.#json(res, 200, { ok: true, cancelled: false });
      return;
    }
    for (const pending of entry.session.approvals.pendingRequests()) {
      entry.session.approvals.answerById(pending.id, { granted: false, remembered: false });
    }
    entry.abort?.abort();
    this.#json(res, 200, { ok: true, cancelled: true });
  }

  /**
   * plan-web：非活跃会话续跑——以同一 sessionId 重建 loop，
   * AgentLoop.run 会从 store 回放历史继续对话（用户实测要求的核心能力）。
   * 仅当 store 中确有该会话的历史时才重建（GET 不得凭空建档）。
   */
  async #reattach(id: string): Promise<SessionEntry | null> {
    const existing = this.#sessions.get(id);
    if (existing) {
      return existing;
    }
    const store = this.#options.store ?? new SessionStore();
    const events = await store.read(id).catch(() => [] as ModouEvent[]);
    if (events.length === 0) {
      return null;
    }
    const defaults = this.#options.createSessionDefaults ?? {};
    try {
      const session = await createSession({
        ...defaults,
        ...(this.#options.store ? { store: this.#options.store } : {}),
        modelOverrides: await loadModelOverrides(defaults.home),
        sessionId: id,
        ...(this.#options.createSessionOverrides?.({}) ?? {}),
      });
      const entry: SessionEntry = { session, busy: false, sseClients: new Set() };
      this.#sessions.set(id, entry);
      return entry;
    } catch {
      return null;
    }
  }

  async #postMessage(id: string, input: string, res: ServerResponse): Promise<void> {
    const entry = await this.#reattach(id);
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

  #bodyTooLarge = false;

  async #readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    const MAX_BODY_BYTES = 1 << 20; // plan-web A7：1MB 上限
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    for await (const chunk of req) {
      total += (chunk as Buffer).length;
      if (total > MAX_BODY_BYTES) {
        // 超限后继续排空（不销毁 socket），让客户端拿到干净的 413 而非 ECONNRESET
        tooLarge = true;
        continue;
      }
      if (!tooLarge) chunks.push(chunk as Buffer);
    }
    if (tooLarge) {
      this.#bodyTooLarge = true;
      return null;
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

  /** plan-web A2：静态资源服务。/assets/* 强制落在 webRoot/assets/ 内（穿越防护含解码后的分隔符） */
  #serveStatic(pathname: string, res: ServerResponse): void {
    const webRoot = resolveWebRoot(this.#options.webRoot);
    if (!webRoot) {
      this.#json(res, 404, { error: "web ui not built (pass --web-root or build packages/console)" });
      return;
    }
    let target: string;
    if (pathname === "/") {
      // 固定文件，无用户输入，无需守卫
      target = join(webRoot, "index.html");
    } else {
      const assetsRoot = join(webRoot, "assets");
      target = resolve(assetsRoot, decodeURIComponent(pathname.replace(/^\/assets\//, "")));
      // 穿越防护：resolve 展平（含解码出的 \ 与 ../）后必须仍在 assetsRoot 内
      if (!target.startsWith(assetsRoot + sep)) {
        this.#json(res, 403, { error: "forbidden" });
        return;
      }
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      this.#json(res, 404, { error: "not found" });
      return;
    }
    const type = CONTENT_TYPES[extname(target)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    createReadStream(target).pipe(res);
  }

  #json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }
}
