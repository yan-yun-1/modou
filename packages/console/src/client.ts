/**
 * plan-web B2：modou serve 的 REST+SSE 客户端（浏览器端）。
 * - Authorization: Bearer 来自 localStorage（键 modou.token）；401 → onUnauthorized 清凭据回 token 门
 * - SSE 用 fetch ReadableStream（可带自定义头），断线由上层 onDone 决策重连
 */

const TOKEN_KEY = "modou.token";

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* 隐私模式等存储不可用：仅内存持有 */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 同上 */
  }
}

export interface SessionSummary {
  sessionId: string;
  active: boolean;
  preview: string;
  /** server 未提供（plan-web §3.5 服务端待办）；当前恒 undefined，时间位显示「—」 */
  updatedAt?: number;
  /** F7：所属项目目录（创建时 server 落索引；旧会话/他端会话无则缺省） */
  cwd?: string;
}

export interface ModouEvent {
  type: string;
  id?: string;
  [key: string]: unknown;
}

export class ModouClient {
  #getBase: () => string;
  onUnauthorized?: () => void;

  constructor(getBase: () => string) {
    this.#getBase = getBase;
  }

  #headers(json = false): HeadersInit {
    const headers: Record<string, string> = {};
    const token = loadToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (json) headers["content-type"] = "application/json";
    return headers;
  }

  async #request(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${this.#getBase()}${path}`, { ...init, headers: { ...this.#headers(Boolean(init?.body)), ...(init?.headers as Record<string, string>) } });
    if (res.status === 401) {
      clearToken();
      this.onUnauthorized?.();
    }
    return res;
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.#getBase()}/health`, { signal: AbortSignal.timeout(2_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<{ sessions: SessionSummary[]; total: number }> {
    const res = await this.#request("/sessions");
    if (!res.ok) return { sessions: [], total: 0 };
    const body = (await res.json()) as { sessions?: SessionSummary[]; total?: number };
    return { sessions: body.sessions ?? [], total: body.total ?? 0 };
  }

  /** 清空全部历史会话（scope=all-history；活跃会话保留）。返回实际删除数 */
  async bulkDeleteAllHistory(): Promise<number> {
    const res = await this.#request("/sessions/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ scope: "all-history" }),
    });
    if (!res.ok) return -1;
    const body = (await res.json()) as { deleted?: number };
    return body.deleted ?? 0;
  }

  /** 创建会话；400/401 返回错误文案（cwd 不存在等）。F11/F12：可带权限模式、模型、思考强度 */
  async createSession(
    cwd: string,
    permissionMode?: string,
    model?: string,
    thinking?: string,
  ): Promise<{
    sessionId: string;
    cwd?: string;
    cwdWarning?: string;
    permissionMode?: string;
    modelId?: string;
    error?: string;
    status: number;
  }> {
    const res = await this.#request("/sessions", {
      method: "POST",
      body: JSON.stringify({
        cwd,
        ...(permissionMode ? { permissionMode } : {}),
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {}),
      }),
    });
    const body = (await res.json()) as {
      sessionId?: string;
      cwd?: string;
      cwdWarning?: string;
      permissionMode?: string;
      modelId?: string;
      error?: string;
    };
    return {
      sessionId: body.sessionId ?? "",
      cwd: body.cwd,
      cwdWarning: body.cwdWarning,
      permissionMode: body.permissionMode,
      modelId: body.modelId,
      error: body.error,
      status: res.status,
    };
  }

  /** F12：可用模型列表（当前 provider；控制台模型选择器用） */
  async listModels(): Promise<{ provider: string; models: { id: string; displayName: string; supportsReasoning: boolean }[] }> {
    const res = await this.#request("/models");
    if (!res.ok) return { provider: "", models: [] };
    const body = (await res.json()) as {
      provider?: string;
      models?: { id: string; displayName: string; supportsReasoning: boolean }[];
    };
    return { provider: body.provider ?? "", models: body.models ?? [] };
  }

  /** F12：运行时切换会话模型 */
  async setSessionModel(sessionId: string, model: string): Promise<{ ok: boolean; modelId?: string; error?: string; status: number }> {
    const res = await this.#request(`/sessions/${sessionId}/model`, {
      method: "POST",
      body: JSON.stringify({ model }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; modelId?: string; error?: string };
    return { ok: res.ok, modelId: body.modelId, error: body.error, status: res.status };
  }

  /** F12：运行时切换思考强度 */
  async setSessionThinking(sessionId: string, level: string): Promise<{ ok: boolean; error?: string; status: number }> {
    const res = await this.#request(`/sessions/${sessionId}/thinking`, {
      method: "POST",
      body: JSON.stringify({ level }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: res.ok, error: body.error, status: res.status };
  }

  /** F11：运行时切换活跃会话的权限模式（历史回放会话不支持，返回 404） */
  async setPermissionMode(sessionId: string, mode: string): Promise<{ ok: boolean; permissionMode?: string; error?: string; status: number }> {
    const res = await this.#request(`/sessions/${sessionId}/permission`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; permissionMode?: string; error?: string };
    return { ok: res.ok, permissionMode: body.permissionMode, error: body.error, status: res.status };
  }

  /** Phase F3：列子目录（目录选择弹层）；缺省 path = serve 启动目录。400/403 返回 error 文案 */
  async listDirs(path?: string): Promise<{
    path: string;
    parent: string | null;
    dirs: { name: string; path: string }[];
    error?: string;
    status: number;
  }> {
    const qs = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await this.#request(`/fs/dirs${qs}`);
    const body = (await res.json().catch(() => ({}))) as {
      path?: string;
      parent?: string | null;
      dirs?: { name: string; path: string }[];
      error?: string;
    };
    return { path: body.path ?? "", parent: body.parent ?? null, dirs: body.dirs ?? [], error: body.error, status: res.status };
  }

  /** Phase F3：最近项目目录 + serve 启动目录（旧版 server 无此端点时回退空） */
  async getCwdRecents(): Promise<{ serveCwd: string; recents: string[] }> {
    const res = await this.#request("/fs/recents");
    if (!res.ok) return { serveCwd: "", recents: [] };
    const body = (await res.json()) as { serveCwd?: string; recents?: string[] };
    return { serveCwd: body.serveCwd ?? "", recents: body.recents ?? [] };
  }

  /** F9：从最近目录移除一项（控制台「移除工作区」；不动磁盘文件） */
  async removeRecent(path: string): Promise<boolean> {
    const res = await this.#request("/fs/recents/remove", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    return res.ok;
  }

  /** Phase F6：请求 serve 弹出系统目录选择对话框（同机场景）。选完返回 path；取消返回 canceled。请求会挂到对话框关闭 */
  async pickDirNative(): Promise<{ path: string; canceled: boolean; error?: string; status: number }> {
    const res = await this.#request("/fs/pick", { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { path: "", canceled: false, error: body.error ?? `系统对话框不可用（${res.status}）`, status: res.status };
    }
    const body = (await res.json()) as { path?: string; canceled?: boolean; error?: string };
    return { path: body.path ?? "", canceled: body.canceled === true, error: body.error, status: res.status };
  }

  async history(sessionId: string): Promise<ModouEvent[]> {
    const res = await this.#request(`/sessions/${sessionId}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { events?: ModouEvent[] };
    return body.events ?? [];
  }

  /** 发送消息；返回 {ok, busy?, error?} */
  async sendMessage(sessionId: string, input: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this.#request(`/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ input }),
    });
    if (res.status === 202) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `发送失败（${res.status}）` };
  }

  /**
   * 批量删除：活跃会话走完整关闭，其余删历史文件（plan-web 全选清理）。
   * 返回实际删除数；请求失败（如 server 为不含 bulk-delete 的旧版本）返回 -1。
   */
  async bulkDelete(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.#request("/sessions/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return -1;
    const body = (await res.json()) as { deleted?: number };
    return body.deleted ?? 0;
  }

  /** 关闭（删除）活跃会话：abort + 释放资源 + 移出注册表（plan-web A7 配额的配套操作） */
  async deleteSession(sessionId: string): Promise<boolean> {
    const res = await this.#request(`/sessions/${sessionId}`, { method: "DELETE" });
    return res.ok;
  }

  async answerApproval(sessionId: string, requestId: string, granted: boolean, remembered = false): Promise<void> {
    await this.#request(`/sessions/${sessionId}/approvals/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ granted, remembered }),
    });
  }

  async cancelTurn(sessionId: string): Promise<void> {
    await this.#request(`/sessions/${sessionId}/cancel`, { method: "POST" });
  }

  /** 订阅 SSE；返回取消句柄。onDone(带错误文案) 由上层决策重连 */
  subscribeEvents(
    sessionId: string,
    onEvent: (event: ModouEvent) => void,
    onDone?: (error?: string) => void,
  ): { dispose(): void } {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`${this.#getBase()}/sessions/${sessionId}/events`, {
          headers: this.#headers(),
          signal: controller.signal,
        });
        if (res.status === 401) {
          clearToken();
          this.onUnauthorized?.();
          onDone?.("unauthorized");
          return;
        }
        if (res.status === 404) {
          // 非活跃会话（server 重启后）不在注册表——只读回放已完成，静默结束
          onDone?.();
          return;
        }
        if (!res.ok || !res.body) {
          onDone?.(`SSE ${res.status}`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line.startsWith("data: ")) {
              try {
                onEvent(JSON.parse(line.slice(6)) as ModouEvent);
              } catch {
                /* 忽略非 JSON 行（心跳注释行不以 data: 开头） */
              }
            }
          }
        }
        onDone?.();
      } catch (error) {
        if (!controller.signal.aborted) {
          onDone?.((error as Error).message);
        }
      }
    })();
    return { dispose: () => controller.abort() };
  }
}

/** 应用级单例：file:// 预览时 origin 为 "null"，回退本地 serve 默认端口 */
export const client = new ModouClient(() =>
  location.origin === "null" ? "http://127.0.0.1:4711" : location.origin,
);
