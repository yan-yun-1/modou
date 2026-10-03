import { createHash, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModouEvent, ModelCapabilities } from "@modou-dev/core";
import { MODEL_CATALOG, VERSION } from "@modou-dev/core";
import {
  createSession,
  loadModelOverrides,
  loadSettings,
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
      // Phase F2（plan-web）：最近项目目录（建会话时落盘，控制台快选）
      if (url.pathname === "/fs/recents" && req.method === "GET") {
        return await this.#cwdRecents(res);
      }
      // F9：从最近目录移除一项（控制台「移除工作区」用，不动磁盘文件）
      if (url.pathname === "/fs/recents/remove" && req.method === "POST") {
        return await this.#removeRecent(req, res);
      }
      // Phase F6：系统目录选择对话框（浏览器与 serve 同机时；对话框弹在 serve 所在机器）
      if (url.pathname === "/fs/pick" && req.method === "POST") {
        return this.#pickDialog(res);
      }
      // F12：可用模型列表（当前 provider 内；控制台模型选择器用）
      if (url.pathname === "/models" && req.method === "GET") {
        return await this.#listModels(res);
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
        // F11：运行时切换权限模式（plan/default/yolo；忙时可切，下一工具调用生效）
        if (parts[2] === "permission" && req.method === "POST") {
          return await this.#setPermissionMode(id, req, res);
        }
        // F12：运行时切换模型 / 思考强度
        if (parts[2] === "model" && req.method === "POST") {
          return await this.#setSessionModel(id, req, res);
        }
        if (parts[2] === "thinking" && req.method === "POST") {
          return await this.#setSessionThinking(id, req, res);
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
      // F12：创建时指定模型 id（当前 provider 内）
      ...(typeof body.model === "string" && body.model !== "" ? { modelId: body.model } : {}),
      ...(this.#options.createSessionOverrides?.(body) ?? {}),
    });
    // F11：按请求覆盖权限模式（plan/default/yolo），与会话一一对应
    const requestedMode = typeof body.permissionMode === "string" ? body.permissionMode : undefined;
    if (requestedMode === "plan" || requestedMode === "default" || requestedMode === "yolo") {
      session.setPermissionMode(requestedMode);
    }
    // F12：创建时指定思考强度
    const requestedThinking = body.thinking;
    if (
      requestedThinking === "off" ||
      requestedThinking === "low" ||
      requestedThinking === "medium" ||
      requestedThinking === "high"
    ) {
      session.setThinking(requestedThinking);
    }
    const entry: SessionEntry = { session, busy: false, sseClients: new Set() };
    this.#sessions.set(session.sessionId, entry);
    const effectiveCwd = normalizeDir(chosenAbs ?? process.cwd());
    await this.#recordCwd(effectiveCwd);
    // F7：会话→目录索引（列表每行标注所属项目）
    await this.#rememberSessionCwd(session.sessionId, effectiveCwd);
    this.#json(res, 201, {
      sessionId: session.sessionId,
      contextWindow: session.contextWindow,
      mcpStatus: session.mcpStatus,
      cwd: chosenAbs,
      cwdWarning,
      permissionMode: session.permissionMode,
      modelId: session.modelId,
    });
  }

  /** Phase F2：最近 cwd 落盘文件（defaults.home 注入时启用；库内嵌无 home 自动禁用）。与 core 同惯例放 <home>/.modou/ 下 */
  get #recentsFile(): string | undefined {
    const home = this.#options.createSessionDefaults?.home;
    return home ? join(home, ".modou", "cwd-recents.json") : undefined;
  }

  /** F7：会话→项目目录索引（与 store 同目录；/sessions 每行标注所属项目用） */
  get #cwdIndexFile(): string {
    const store = this.#options.store ?? new SessionStore();
    return join(store.baseDir, "cwd-index.json");
  }

  async #readCwdIndex(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#cwdIndexFile, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") out[k] = v;
        }
        return out;
      }
    } catch {
      // 缺失/损坏 → 空
    }
    return {};
  }

  async #rememberSessionCwd(sessionId: string, abs: string): Promise<void> {
    const index = await this.#readCwdIndex();
    index[sessionId] = abs;
    try {
      await mkdir(dirname(this.#cwdIndexFile), { recursive: true });
      await writeFile(this.#cwdIndexFile, JSON.stringify(index, null, 2));
    } catch {
      // 写失败静默：索引是便利功能
    }
  }

  async #forgetSessionCwd(sessionId: string): Promise<void> {
    const index = await this.#readCwdIndex();
    if (!(sessionId in index)) return;
    delete index[sessionId];
    try {
      await writeFile(this.#cwdIndexFile, JSON.stringify(index, null, 2));
    } catch {
      // 同上
    }
  }

  async #readRecents(): Promise<string[]> {
    const file = this.#recentsFile;
    if (!file) return [];
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // 缺失/损坏 → 视为空（测试覆盖损坏容错）
    }
    return [];
  }

  /** Phase F2：建会话成功后记录有效 cwd（realpath 归一去重置顶、上限 8）；落盘失败不阻塞建会话 */
  async #recordCwd(abs: string): Promise<void> {
    const file = this.#recentsFile;
    if (!file) return;
    const prev = await this.#readRecents();
    const next = [abs, ...prev.filter((r) => r !== abs)].slice(0, 8);
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(next, null, 2));
    } catch {
      // 写失败静默：recents 是便利功能，不阻断会话创建
    }
  }

  /** Phase F6：GET /fs/recents → { serveCwd, recents }；过滤已不存在目录与白名单外目录 */
  async #cwdRecents(res: ServerResponse): Promise<void> {
    let recents = await this.#readRecents();
    recents = recents.filter((r) => {
      try {
        return statSync(r).isDirectory();
      } catch {
        return false;
      }
    });
    const roots = this.#options.fsAllowRoots;
    if (roots?.length) recents = recents.filter((r) => isPathAllowed(r, roots));
    this.#json(res, 200, { serveCwd: process.cwd(), recents });
  }

  /** F9：POST /fs/recents/remove {path}——从最近目录摘除（resolve 归一比对；不动磁盘文件） */
  async #removeRecent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await this.#readJson(req)) ?? {};
    const raw = typeof body.path === "string" ? body.path : "";
    if (!raw) {
      return this.#json(res, 400, { error: "path required" });
    }
    const file = this.#recentsFile;
    if (!file) {
      return this.#json(res, 200, { ok: true, removed: 0 });
    }
    const prev = await this.#readRecents();
    const next = prev.filter((r) => resolve(r) !== resolve(raw));
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(next, null, 2));
    } catch {
      // 写失败仍按已移除响应（下次建会话覆盖写入自然收敛）
    }
    this.#json(res, 200, { ok: true, removed: prev.length - next.length });
  }

  /** Phase F6：系统目录选择对话框（Windows FolderBrowserDialog / macOS choose folder / Linux zenity） */
  #pickChild: ReturnType<typeof spawn> | null = null;

  #pickDialog(res: ServerResponse): void {
    // 单例：新请求杀掉上一个未关闭的对话框进程，避免堆积
    if (this.#pickChild) {
      this.#pickChild.kill();
      this.#pickChild = null;
    }
    let cmd: string;
    let args: string[];
    if (process.platform === "win32") {
      cmd = "powershell.exe";
      // 路径按 UTF-8 字节直写 stdout（默认 OEM 码页下中文路径会乱码）。
      // 对话框挂置顶隐形属主窗体：无属主时会被浏览器窗口压在后面，用户以为没弹出
      args = [
        "-NoProfile",
        "-STA",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '选择项目目录'; $d.ShowNewFolderButton = $true; $o = New-Object System.Windows.Forms.Form; $o.TopMost = $true; $o.ShowInTaskbar = $false; $o.FormBorderStyle = 'None'; $o.Size = New-Object System.Drawing.Size(1,1); $bnd = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $o.StartPosition = 'Manual'; $o.Location = New-Object System.Drawing.Point([int]($bnd.X + $bnd.Width/2), [int]($bnd.Y + $bnd.Height/2)); $o.Show(); $null = $o.Focus(); $null = $d.ShowDialog($o); if ($d.SelectedPath) { $bb = [Text.Encoding]::UTF8.GetBytes($d.SelectedPath); [Console]::OpenStandardOutput().Write($bb, 0, $bb.Length) }; $o.Dispose()",
      ];
    } else if (process.platform === "darwin") {
      cmd = "osascript";
      args = ["-e", 'POSIX path of (choose folder with prompt "选择项目目录")'];
    } else {
      cmd = "zenity";
      args = ["--file-selection", "--directory", "--title=选择项目目录"];
    }
    let settled = false;
    const done = (status: number, payload: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.#json(res, status, payload);
    };
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.#pickChild = child;
    // 用户弃置对话框的兜底：10 分钟后回收
    const timer = setTimeout(() => {
      child.kill();
      done(200, { canceled: true });
    }, 600_000);
    let out = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("error", (err) => {
      this.#pickChild = null;
      done(501, { error: `无法启动系统对话框（${err.message}）` });
    });
    child.on("close", (code) => {
      this.#pickChild = null;
      const picked = out.trim();
      if (picked) {
        done(200, { path: picked });
      } else {
        done(200, { canceled: true, ...(code ? { error: `对话框异常退出（${code}）` } : {}) });
      }
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
    // Phase F3 反馈：过滤系统目录（$RECYCLE.BIN 等 $ 前缀、System Volume Information）与 dotfiles
    const dirs = entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          !e.name.startsWith("$") &&
          e.name !== "System Volume Information",
      )
      .map((e) => ({ name: e.name, path: join(abs, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = dirname(abs);
    this.#json(res, 200, { path: abs, parent: parent === abs ? null : parent, dirs });
  }

  /** 会话列表：最近 50 个，标出本进程活跃会话，附首条用户消息预览与所属项目目录（F7 索引） */
  async #list(res: ServerResponse): Promise<void> {
    const store = this.#options.store ?? new SessionStore();
    const ids = await store.list();
    const cwdIndex = await this.#readCwdIndex();
    const sessions: { sessionId: string; active: boolean; preview: string; cwd?: string }[] = [];
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
      const cwd = cwdIndex[sid];
      sessions.push({ sessionId: sid, active: this.#sessions.has(sid), preview, ...(cwd ? { cwd } : {}) });
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
        await this.#forgetSessionCwd(id);
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
      await this.#forgetSessionCwd(id);
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
    await this.#forgetSessionCwd(id);
    this.#json(res, 200, { ok: true, deletedHistory: true });
  }

  /** F11：POST /sessions/:id/permission {mode}——运行时切换权限模式（活跃会话） */
  async #setPermissionMode(id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const entry = this.#sessions.get(id);
    if (!entry) {
      return this.#json(res, 404, { error: "session not found（重启后的历史会话不支持切换，请新建会话时选择）" });
    }
    const body = (await this.#readJson(req)) ?? {};
    const mode = body.mode;
    if (mode !== "plan" && mode !== "default" && mode !== "yolo") {
      return this.#json(res, 400, { error: "mode 须为 plan | default | yolo" });
    }
    entry.session.setPermissionMode(mode);
    this.#json(res, 200, { ok: true, permissionMode: entry.session.permissionMode });
  }

  /** F12：GET /models——当前 provider 的可用模型（目录 + models.json 覆盖） */
  async #listModels(res: ServerResponse): Promise<void> {
    const home = this.#options.createSessionDefaults?.home;
    const settings = this.#options.createSessionDefaults?.settings ?? (home ? await loadSettings(home) : null);
    const provider = settings?.provider ?? "anthropic";
    const overrides = await loadModelOverrides(home);
    const models = [...MODEL_CATALOG, ...overrides]
      .filter((m) => m.provider === provider)
      .map((m) => ({ id: m.id, displayName: m.displayName, provider: m.provider, supportsReasoning: m.supportsReasoning }));
    this.#json(res, 200, { provider, models });
  }

  /** F12：POST /sessions/:id/model {model}——运行时切换模型（未知 id 400） */
  async #setSessionModel(id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const entry = this.#sessions.get(id);
    if (!entry) {
      return this.#json(res, 404, { error: "session not found" });
    }
    const body = (await this.#readJson(req)) ?? {};
    const modelId = typeof body.model === "string" ? body.model : "";
    if (!modelId) {
      return this.#json(res, 400, { error: "model required" });
    }
    try {
      entry.session.setModelId(modelId);
    } catch (error) {
      return this.#json(res, 400, { error: (error as Error).message });
    }
    this.#json(res, 200, { ok: true, modelId: entry.session.modelId });
  }

  /** F12：POST /sessions/:id/thinking {level}——运行时切换思考强度 */
  async #setSessionThinking(id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const entry = this.#sessions.get(id);
    if (!entry) {
      return this.#json(res, 404, { error: "session not found" });
    }
    const body = (await this.#readJson(req)) ?? {};
    const level = body.level;
    if (level !== "off" && level !== "low" && level !== "medium" && level !== "high") {
      return this.#json(res, 400, { error: "level 须为 off | low | medium | high" });
    }
    entry.session.setThinking(level);
    this.#json(res, 200, { ok: true, thinking: level });
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
    // 控制台产物随版本变化：禁启发式缓存（本地开发常态更新，避免浏览器拿旧 bundle）
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    createReadStream(target).pipe(res);
  }

  #json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }
}
