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

  async listSessions(): Promise<SessionSummary[]> {
    const res = await this.#request("/sessions");
    if (!res.ok) return [];
    const body = (await res.json()) as { sessions?: SessionSummary[] };
    return body.sessions ?? [];
  }

  /** 创建会话；400/401 返回错误文案（cwd 不存在等） */
  async createSession(cwd: string): Promise<{ sessionId: string; cwd?: string; cwdWarning?: string; error?: string; status: number }> {
    const res = await this.#request("/sessions", {
      method: "POST",
      body: JSON.stringify({ cwd }),
    });
    const body = (await res.json()) as { sessionId?: string; cwd?: string; cwdWarning?: string; error?: string };
    return { sessionId: body.sessionId ?? "", cwd: body.cwd, cwdWarning: body.cwdWarning, error: body.error, status: res.status };
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
