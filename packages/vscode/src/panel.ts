import type {
  ExtensionContext,
  WebviewView,
  WebviewViewProvider,
  CancellationToken,
} from "vscode";
import * as vscode from "vscode";
import type { ModouClient, ModouEvent, SessionSummary } from "./client.js";

/**
 * M5 D2/D3：侧边栏 webview 宿主。会话生命周期、SSE 订阅与 webview 消息路由。
 */
export class ModouPanelProvider implements WebviewViewProvider {
  #context: ExtensionContext;
  #client: ModouClient;
  #view?: WebviewView;
  #sessionId?: string;
  #sse?: { dispose(): void };

  constructor(context: ExtensionContext, client: ModouClient) {
    this.#context = context;
    this.#client = client;
  }

  resolveWebviewView(view: WebviewView, _cwd?: CancellationToken): void {
    void _cwd;
    this.#view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.#context.extensionUri, "dist")],
    };
    view.webview.html = this.#html(view);
    view.webview.onDidReceiveMessage((msg) => void this.#onMessage(msg));
  }

  #html(view: WebviewView): string {
    const script = view.webview
      .asWebviewUri(vscode.Uri.joinPath(this.#context.extensionUri, "dist", "webview", "main.js"))
      .toString();
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';" />
<style>
  body { margin: 0; display: flex; flex-direction: column; height: 100vh;
         font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
         color: var(--vscode-foreground); }
  #bar { display: flex; gap: 4px; padding: 6px; align-items: center;
         border-bottom: 1px solid var(--vscode-panel-border); }
  #sessions { flex: 1; min-width: 0; background: var(--vscode-dropdown-background);
              color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 4px 10px; cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
  #messages { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .msg { white-space: pre-wrap; word-break: break-word; border-radius: 4px; padding: 6px 8px; }
  .msg.user { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
  .msg.assistant { background: var(--vscode-editor-background); }
  .msg.assistant.streaming::after { content: "▌"; opacity: 0.6; }
  .msg.error { color: var(--vscode-errorForeground); }
  .tool { border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-size: 0.92em; }
  .tool-head { padding: 4px 8px; cursor: pointer; opacity: 0.9; }
  .tool.done .tool-head { opacity: 1; }
  .tool-detail { display: none; margin: 0; padding: 4px 8px; overflow-x: auto;
                 border-top: 1px dashed var(--vscode-panel-border);
                 white-space: pre-wrap; word-break: break-word; }
  .tool-detail.open { display: block; }
  .approval { border: 1px solid var(--vscode-inputValidation-warningBorder);
              background: var(--vscode-inputValidation-warningBackground);
              border-radius: 4px; padding: 6px 8px; }
  .approval-title { font-weight: 600; }
  .approval-reason { opacity: 0.85; margin: 2px 0; }
  .approval-diff { margin: 4px 0; padding: 4px 8px; overflow-x: auto; font-size: 0.88em;
                   background: var(--vscode-editor-background); white-space: pre-wrap; }
  .approval-buttons { display: flex; gap: 6px; margin-top: 4px; }
  #inputbar { display: flex; gap: 4px; padding: 6px; border-top: 1px solid var(--vscode-panel-border); }
  #input { flex: 1; resize: none; height: 44px; background: var(--vscode-input-background);
           color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
           font-family: inherit; }
  #usage { padding: 2px 8px 6px; opacity: 0.7; font-size: 0.85em; }
</style>
</head>
<body>
  <div id="bar">
    <select id="sessions"></select>
    <button id="new" class="secondary" title="新建会话">＋</button>
  </div>
  <div id="messages"></div>
  <div id="inputbar">
    <textarea id="input" placeholder="把任务交给墨斗…（Enter 发送，Shift+Enter 换行）"></textarea>
    <button id="send">发送</button>
  </div>
  <div id="usage"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  async #onMessage(msg: {
    type: string;
    text?: string;
    sessionId?: string;
    requestId?: string;
    granted?: boolean;
  }): Promise<void> {
    try {
      switch (msg.type) {
        case "ready":
          await this.#refreshSessions();
          break;
        case "newSession":
          await this.#newSession();
          break;
        case "selectSession":
          if (msg.sessionId) await this.#selectSession(msg.sessionId);
          break;
        case "send":
          if (msg.text && this.#sessionId) {
            this.#post({ type: "sending", error: msg.text });
            await this.#client.sendMessage(this.#sessionId, msg.text);
          } else if (!this.#sessionId) {
            await this.#newSession(msg.text ?? "");
          }
          break;
        case "approve":
          if (this.#sessionId && msg.requestId) {
            await this.#client.answerApproval(this.#sessionId, msg.requestId, msg.granted === true);
          }
          break;
        default:
          break;
      }
    } catch (error) {
      this.#post({ type: "error", error: (error as Error).message });
    }
  }

  #post(msg: unknown): void {
    void this.#view?.webview.postMessage(msg);
  }

  async #refreshSessions(): Promise<void> {
    let sessions: SessionSummary[] = [];
    try {
      sessions = await this.#client.listSessions();
    } catch (error) {
      this.#post({ type: "error", error: (error as Error).message });
    }
    this.#post({ type: "sessions", sessions });
  }

  #workspaceCwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  async #newSession(input?: string): Promise<void> {
    const sessionId = await this.#client.createSession(this.#workspaceCwd());
    this.#setSession(sessionId);
    await this.#refreshSessions();
    if (input) {
      this.#post({ type: "sending", error: input });
      await this.#client.sendMessage(sessionId, input);
    }
  }

  async #selectSession(sessionId: string): Promise<void> {
    this.#setSession(sessionId);
    const events = await this.#client.history(sessionId);
    this.#post({ type: "history", events });
  }

  #setSession(sessionId: string): void {
    this.#sessionId = sessionId;
    this.#sse?.dispose();
    this.#post({ type: "session", sessionId });
    this.#sse = this.#client.subscribeEvents(sessionId, (event: ModouEvent) => {
      this.#post({ type: "event", event });
    }, (error) => {
      if (error) {
        this.#post({ type: "error", error: `事件流断开：${error}（可重选会话重连）` });
      }
    });
  }
}
