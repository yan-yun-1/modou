/**
 * M5 D2：modou serve 的 REST + SSE 客户端（扩展宿主侧）。
 * webview 不直接发网络请求（CSP 受限），全部经本客户端转发。
 */

export interface SessionSummary {
  sessionId: string;
  active: boolean;
  preview: string;
}

export interface ModouEvent {
  type: string;
  id?: string;
  [key: string]: unknown;
}

export class ModouClient {
  #getBase: () => Promise<string>;

  constructor(getBase: () => Promise<string>) {
    this.#getBase = getBase;
  }

  async #request(path: string, init?: RequestInit): Promise<Response> {
    const base = await this.#getBase();
    return fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  }

  async listSessions(): Promise<SessionSummary[]> {
    const res = await this.#request("/sessions");
    const body = (await res.json()) as { sessions: SessionSummary[] };
    return body.sessions ?? [];
  }

  async createSession(cwd: string): Promise<string> {
    const res = await this.#request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    if (res.status !== 201) {
      throw new Error(`创建会话失败（${res.status}）：${await res.text()}`);
    }
    const body = (await res.json()) as { sessionId: string };
    return body.sessionId;
  }

  async history(sessionId: string): Promise<ModouEvent[]> {
    const res = await this.#request(`/sessions/${sessionId}`);
    if (!res.ok) {
      return [];
    }
    const body = (await res.json()) as { events?: ModouEvent[] };
    return body.events ?? [];
  }

  async sendMessage(sessionId: string, input: string): Promise<void> {
    const res = await this.#request(`/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
    if (res.status !== 202) {
      throw new Error(`发送失败（${res.status}）：${await res.text()}`);
    }
  }

  async answerApproval(sessionId: string, requestId: string, granted: boolean): Promise<void> {
    const res = await this.#request(`/sessions/${sessionId}/approvals/${requestId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ granted, remembered: false }),
    });
    if (!res.ok) {
      throw new Error(`审批应答失败（${res.status}）`);
    }
  }

  /**
   * 订阅 SSE 事件流（fetch ReadableStream 解析，不用 EventSource）。
   * 返回取消句柄；网络断开时经 onDone 通知（webview 可重连）。
   */
  subscribeEvents(
    sessionId: string,
    onEvent: (event: ModouEvent) => void,
    onDone?: (error?: string) => void,
  ): { dispose(): void } {
    const controller = new AbortController();
    void (async () => {
      try {
        const base = await this.#getBase();
        const res = await fetch(`${base}/sessions/${sessionId}/events`, {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          onDone?.(`SSE ${res.status}`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line.startsWith("data: ")) {
              try {
                onEvent(JSON.parse(line.slice(6)) as ModouEvent);
              } catch {
                // 非 JSON 行忽略
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
