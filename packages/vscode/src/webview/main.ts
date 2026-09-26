/**
 * M5 D2/D3：webview UI（浏览器环境，esbuild iife 打包）。
 * 与扩展宿主经 postMessage 通信；所有网络请求都在宿主侧。
 */

type VsCodeApi = { postMessage(msg: unknown): void };
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

interface ModouEvent {
  type: string;
  id?: string;
  name?: string;
  text?: string;
  delta?: string;
  output?: string;
  reason?: string;
  diff?: string;
  message?: string;
  granted?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  args?: unknown;
}

interface SessionSummary {
  sessionId: string;
  active: boolean;
  preview: string;
}

// ---------- DOM ----------

const list = document.getElementById("messages") as HTMLDivElement;
const sessionSelect = document.getElementById("sessions") as HTMLSelectElement;
const input = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const newBtn = document.getElementById("new") as HTMLButtonElement;
const usageBar = document.getElementById("usage") as HTMLDivElement;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scrollBottom(): void {
  list.scrollTop = list.scrollHeight;
}

function setBusy(busy: boolean): void {
  input.disabled = busy;
  sendBtn.disabled = busy;
}

function addUser(text: string): void {
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  list.appendChild(el);
  scrollBottom();
}

let streamingBlock: HTMLDivElement | null = null;
let streamingText = "";

function appendDelta(delta: string): void {
  if (!streamingBlock) {
    streamingBlock = document.createElement("div");
    streamingBlock.className = "msg assistant streaming";
    list.appendChild(streamingBlock);
    streamingText = "";
  }
  streamingText += delta;
  streamingBlock.textContent = streamingText;
  scrollBottom();
}

function finalizeAssistant(text: string): void {
  if (streamingBlock && streamingText === text) {
    streamingBlock.classList.remove("streaming");
    streamingBlock = null;
    return;
  }
  if (streamingBlock) {
    streamingBlock.textContent = text;
    streamingBlock.classList.remove("streaming");
    streamingBlock = null;
  } else {
    const el = document.createElement("div");
    el.className = "msg assistant";
    el.textContent = text;
    list.appendChild(el);
  }
  scrollBottom();
}

interface ToolRow {
  row: HTMLDivElement;
  detail: HTMLPreElement;
}

const toolRows = new Map<string, ToolRow>();

function toolTitle(name: string, args: unknown): string {
  let argsText = "";
  try {
    argsText = JSON.stringify(args);
  } catch {
    argsText = String(args);
  }
  return `${name} ${argsText.slice(0, 120)}`;
}

function addToolCall(id: string, name: string, args: unknown): void {
  const row = document.createElement("div");
  row.className = "tool";
  const head = document.createElement("div");
  head.className = "tool-head";
  head.textContent = `⚙ ${toolTitle(name, args)}`;
  const detail = document.createElement("pre");
  detail.className = "tool-detail";
  detail.textContent = "（执行中…）";
  head.addEventListener("click", () => detail.classList.toggle("open"));
  row.append(head, detail);
  list.appendChild(row);
  toolRows.set(id, { row, detail });
  scrollBottom();
}

function addToolResult(id: string, output: string): void {
  const entry = toolRows.get(id);
  if (entry) {
    entry.detail.textContent = output;
    entry.row.classList.add("done");
  } else {
    // 无配对 tool_call（历史回放截断等）：独立展示
    const row = document.createElement("div");
    row.className = "tool done";
    const detail = document.createElement("pre");
    detail.className = "tool-detail open";
    detail.textContent = output;
    row.append(detail);
    list.appendChild(row);
  }
  scrollBottom();
}

const approvalCards = new Map<string, HTMLDivElement>();

function addApproval(event: ModouEvent): void {
  const card = document.createElement("div");
  card.className = "approval";
  const title = document.createElement("div");
  title.className = "approval-title";
  title.textContent = `🔐 ${event.name ?? "工具"} 需要审批`;
  const reason = document.createElement("div");
  reason.className = "approval-reason";
  reason.textContent = event.reason ?? "";
  const diff = document.createElement("pre");
  diff.className = "approval-diff";
  if (event.diff) {
    diff.textContent = event.diff;
    diff.classList.add("open");
  }
  const buttons = document.createElement("div");
  buttons.className = "approval-buttons";
  const allow = document.createElement("button");
  allow.textContent = "允许";
  allow.className = "primary";
  const deny = document.createElement("button");
  deny.textContent = "拒绝";
  for (const [btn, granted] of [
    [allow, true],
    [deny, false],
  ] as const) {
    btn.addEventListener("click", () => {
      vscode.postMessage({ type: "approve", requestId: event.id, granted });
      for (const b of [allow, deny]) b.disabled = true;
      title.textContent = granted ? "✅ 已允许" : "🚫 已拒绝";
    });
    buttons.appendChild(btn);
  }
  card.append(title, reason, ...(event.diff ? [diff] : []), buttons);
  list.appendChild(card);
  if (event.id) approvalCards.set(event.id, card);
  scrollBottom();
}

function markApprovalResult(event: ModouEvent): void {
  const card = event.id && approvalCards.get(event.id);
  if (!card) return;
  const title = card.querySelector(".approval-title") as HTMLDivElement;
  title.textContent = event.granted ? "✅ 已允许" : "🚫 已拒绝";
  for (const btn of card.querySelectorAll("button")) {
    (btn as HTMLButtonElement).disabled = true;
  }
}

function addError(message: string): void {
  const el = document.createElement("div");
  el.className = "msg error";
  el.textContent = message;
  list.appendChild(el);
  scrollBottom();
}

let totalCost = 0;

function addUsage(event: ModouEvent): void {
  totalCost += event.costUsd ?? 0;
  usageBar.textContent = `tokens ↑${event.inputTokens ?? 0} ↓${event.outputTokens ?? 0} · 累计 $${totalCost.toFixed(4)}`;
}

// ---------- 事件分发 ----------

function handleEvent(event: ModouEvent, replay: boolean): void {
  switch (event.type) {
    case "user_message":
      addUser(event.text ?? "");
      break;
    case "text_delta":
      // 回放时不渲染增量（assistant_message 是持久化事实）
      if (!replay) appendDelta(event.delta ?? "");
      break;
    case "assistant_message":
      if (!replay) finalizeAssistant(event.text ?? "");
      else {
        const el = document.createElement("div");
        el.className = "msg assistant";
        el.textContent = event.text ?? "";
        list.appendChild(el);
      }
      break;
    case "tool_call":
      addToolCall(event.id ?? "", event.name ?? "tool", event.args);
      break;
    case "tool_result":
      addToolResult(event.id ?? "", event.output ?? "");
      break;
    case "approval_request":
      addApproval(event);
      break;
    case "approval_result":
      markApprovalResult(event);
      break;
    case "usage":
      addUsage(event);
      break;
    case "error":
      addError(event.message ?? "发生错误");
      setBusy(false);
      break;
    default:
      break;
  }
}

function clearMessages(): void {
  list.textContent = "";
  streamingBlock = null;
  toolRows.clear();
  approvalCards.clear();
  totalCost = 0;
  usageBar.textContent = "";
}

// ---------- 会话选择 ----------

function fillSessions(sessions: SessionSummary[]): void {
  sessionSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "选择会话…";
  sessionSelect.appendChild(placeholder);
  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = session.sessionId;
    option.textContent = `${session.active ? "● " : ""}${session.preview || session.sessionId.slice(0, 18)}`;
    sessionSelect.appendChild(option);
  }
}

newBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "newSession" });
});

sessionSelect.addEventListener("change", () => {
  const value = (sessionSelect as HTMLSelectElement).value;
  if (value) vscode.postMessage({ type: "selectSession", sessionId: value });
});

sendBtn.addEventListener("click", send);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

function send(): void {
  const text = input.value.trim();
  if (!text) return;
  vscode.postMessage({ type: "send", text });
  input.value = "";
}

// ---------- 宿主消息 ----------

window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as {
    type: string;
    sessions?: SessionSummary[];
    sessionId?: string;
    events?: ModouEvent[];
    event?: ModouEvent;
    error?: string;
  };
  switch (msg.type) {
    case "sessions":
      fillSessions(msg.sessions ?? []);
      break;
    case "session":
      clearMessages();
      sessionSelect.value = msg.sessionId ?? "";
      setBusy(false);
      break;
    case "history":
      clearMessages();
      for (const event of msg.events ?? []) handleEvent(event, true);
      scrollBottom();
      break;
    case "event":
      if (msg.event) handleEvent(msg.event, false);
      if (msg.event?.type === "usage") setBusy(false);
      break;
    case "sending":
      addUser(msg.error ?? "");
      setBusy(true);
      break;
    case "error":
      addError(msg.error ?? "未知错误");
      setBusy(false);
      break;
  }
});

vscode.postMessage({ type: "ready" });
