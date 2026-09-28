/**
 * plan-web B2/C1：事件 → 状态的纯函数层（vitest 直测，不依赖 DOM）。
 * 渲染词汇对齐 packages/vscode/src/webview/main.ts 的已验证模式：
 * text_delta 增量累积、assistant_message finalize 对账、tool_call/result 按 id 配对、
 * 审批卡三键状态、usage 累计、error 非致命不破坏流。
 */

export interface ModouEvent {
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
  remembered?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  args?: unknown;
  turnEnd?: boolean;
  at?: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface RenderItem {
  kind: "user" | "assistant" | "tool" | "approval" | "error";
  /** tool/approval 的配对键（toolCallId / requestId） */
  id?: string;
  /** user/assistant 的文本；tool 的参数摘要；approval 的工具名；error 的消息 */
  text?: string;
  /** 工具名（tool 卡 chip） */
  name?: string;
  /** 工具参数摘要 */
  args?: unknown;
  /** tool 结果输出 / 审批 reason / 审批 diff */
  output?: string;
  diff?: string;
  /** tool：pending→done；approval：pending→granted/denied */
  status?: "pending" | "done" | "granted" | "denied" | "cancelled";
}

export interface SessionView {
  sessionId: string;
  items: RenderItem[];
  /** 进行中的流式增量（assistant_message finalize 后清空） */
  streaming: string | null;
  usage: UsageTotals;
  /** 一轮进行中（发送时置位，turnEnd/error 清除） */
  busy: boolean;
  /** 历史回放模式（重启后只读） */
  replay: boolean;
}

export interface ConsoleState {
  sessions: SessionSummary[];
  /** 会话视图按 id 索引；回放/订阅按需创建 */
  views: Record<string, SessionView>;
  currentId: string | null;
  /** 当前是否处于 401 未授权（token 门） */
  needsToken: boolean;
  /** 全局提示（网络错误等） */
  notice: string | null;
}

// plan-web §3.5：SessionSummary 以 client.ts 为单一来源（消除双份定义漂移）
import type { SessionSummary } from "./client.js";

export type { SessionSummary };

export function emptyState(): ConsoleState {
  return { sessions: [], views: {}, currentId: null, needsToken: false, notice: null };
}

export function emptyView(sessionId: string): SessionView {
  return {
    sessionId,
    items: [],
    streaming: null,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    busy: false,
    replay: false,
  };
}

/** 取会话视图；不存在则创建（纯函数：返回新对象） */
function ensureView(state: ConsoleState, sessionId: string): SessionView {
  const existing = state.views[sessionId];
  if (existing) return existing;
  return emptyView(sessionId);
}

/** 单事件 → 单视图变更。返回新视图；未知事件原样返回 */
export function applyEventToView(view: SessionView, event: ModouEvent): SessionView {
  const items = view.items.slice();
  switch (event.type) {
    case "user_message": {
      items.push({ kind: "user", text: event.text ?? "" });
      // 回放：历史 user_message 不代表一轮正在进行（落盘 usage 无 turnEnd 标记）
      return { ...view, items, busy: view.replay ? false : true };
    }
    case "text_delta": {
      if (view.replay) return view; // 回放跳过增量（assistant_message 是持久化事实）
      return { ...view, streaming: (view.streaming ?? "") + (event.delta ?? "") };
    }
    case "assistant_message": {
      const text = event.text ?? "";
      // finalize 对账：流式内容与最终文本一致则就地位；不一致（如回放）追加
      if (view.streaming !== null && view.streaming === text) {
        items.push({ kind: "assistant", text });
        return { ...view, items, streaming: null };
      }
      items.push({ kind: "assistant", text });
      return { ...view, items, streaming: null };
    }
    case "tool_call": {
      items.push({
        kind: "tool",
        id: event.id,
        name: event.name,
        text: JSON.stringify(event.args ?? {}).slice(0, 160),
        args: event.args,
        status: "pending",
      });
      return { ...view, items };
    }
    case "tool_result": {
      const idx = items.findIndex((it) => it.kind === "tool" && it.id === event.id && it.status === "pending");
      if (idx !== -1) {
        items[idx] = { ...items[idx]!, output: event.output ?? "", status: "done" };
        return { ...view, items };
      }
      items.push({ kind: "tool", id: event.id, text: "tool result", output: event.output ?? "", status: "done" });
      return { ...view, items };
    }
    case "approval_request": {
      items.push({
        kind: "approval",
        id: event.id,
        text: event.name ?? "tool",
        output: event.reason ?? "",
        diff: event.diff,
        status: "pending",
      });
      return { ...view, items };
    }
    case "approval_result": {
      const idx = items.findIndex((it) => it.kind === "approval" && it.id === event.id);
      if (idx !== -1) {
        items[idx] = {
          ...items[idx]!,
          status: event.granted ? "granted" : "denied",
        };
        return { ...view, items };
      }
      return view;
    }
    case "error": {
      items.push({ kind: "error", text: event.message ?? "发生错误" });
      return { ...view, items, busy: false };
    }
    case "usage": {
      const usage = {
        inputTokens: view.usage.inputTokens + (event.inputTokens ?? 0),
        outputTokens: view.usage.outputTokens + (event.outputTokens ?? 0),
        costUsd: view.usage.costUsd + (event.costUsd ?? 0),
      };
      const turnEnd = event.turnEnd === true;
      return { ...view, usage, busy: turnEnd ? false : view.busy };
    }
    default:
      return view;
  }
}

/** 整条事件流回放（历史只读模式） */
export function replayEvents(state: ConsoleState, sessionId: string, events: ModouEvent[]): ConsoleState {
  let view = { ...emptyView(sessionId), replay: true };
  for (const event of events) {
    view = applyEventToView(view, event);
  }
  // 兜底：落盘 usage 不带 turnEnd，回放结束强制非 busy（不显示取消按钮）
  return { ...state, views: { ...state.views, [sessionId]: { ...view, busy: false } } };
}

/** 实时事件（当前订阅的会话） */
export function applyLiveEvent(state: ConsoleState, sessionId: string, event: ModouEvent): ConsoleState {
  const view = ensureView(state, sessionId);
  const next = applyEventToView({ ...view, replay: false }, event);
  return { ...state, views: { ...state.views, [sessionId]: next } };
}

/** 会话列表刷新 */
export function setSessions(state: ConsoleState, sessions: SessionSummary[]): ConsoleState {
  return { ...state, sessions };
}

/** 切换/创建当前会话 */
export function setCurrent(state: ConsoleState, sessionId: string | null): ConsoleState {
  const views = sessionId && !state.views[sessionId] ? { ...state.views, [sessionId]: emptyView(sessionId) } : state.views;
  return { ...state, views, currentId: sessionId };
}

/** 发送前：把用户消息立即本地回显并置 busy（202 后的真实 user_message 事件到来时不重复） */
export function markBusy(state: ConsoleState, sessionId: string): ConsoleState {
  const view = ensureView(state, sessionId);
  return { ...state, views: { ...state.views, [sessionId]: { ...view, busy: true } } };
}

export function setNotice(state: ConsoleState, notice: string | null): ConsoleState {
  return { ...state, notice };
}

export function setNeedsToken(state: ConsoleState, needsToken: boolean): ConsoleState {
  return { ...state, needsToken };
}
