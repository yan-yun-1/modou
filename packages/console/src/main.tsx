import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { h, render, type JSX } from "preact";
import {
  applyLiveEvent,
  emptyState,
  markBusy,
  replayEvents,
  setCurrent,
  setNotice,
  setSessions,
  type ConsoleState,
  type ModouEvent,
  type RenderItem,
  type SessionView,
} from "./state.js";
import { ModouClient, clearToken, loadToken, saveToken, type SessionSummary } from "./client.js";

/**
 * plan-web B3/C1/C2/D1/D2：墨斗 Web 控制台（Preact SPA）。
 * 状态变更全部走 state.ts 纯函数；本文件只做挂载、订阅生命周期与 DOM 渲染。
 */

const client = new ModouClient(() => (location.origin === "null" ? "http://127.0.0.1:4711" : location.origin));

// ---------- 渲染组件 ----------

function ToolItem({ item }: { item: RenderItem }): JSX.Element {
  const [open, setOpen] = useState(false);
  const statusIcon = item.status === "pending" ? "⏳" : "⚙";
  return (
    <div class="card tool">
      <div class="tool-head" onClick={() => setOpen(!open)}>
        <span>{statusIcon}</span>
        <span>{item.text}</span>
        {item.status === "done" && <span class="hint">{open ? "▾" : "▸"}</span>}
      </div>
      {open && item.output !== undefined && <pre class="tool-detail">{item.output}</pre>}
    </div>
  );
}

function ApprovalItem({
  item,
  disabled,
  onAnswer,
}: {
  item: RenderItem;
  disabled: boolean;
  onAnswer: (requestId: string, granted: boolean, remembered: boolean) => void;
}): JSX.Element | null {
  const [decided, setDecided] = useState(false);
  const statusText =
    item.status === "granted" ? "✅ 已允许" : item.status === "denied" ? "🚫 已拒绝" : null;
  if (item.status !== "pending" && !statusText && !decided) return null;
  const locked = disabled || decided || item.status !== "pending";
  return (
    <div class="card approval">
      <div class="approval-title">🔐 {item.text} 需要审批</div>
      {item.output && <div class="approval-reason">{item.output}</div>}
      {item.diff && <pre class="diff">{item.diff}</pre>}
      {item.status === "granted" || item.status === "denied" || decided ? (
        <div class="status">{statusText ?? (decided ? "已提交应答" : "")}</div>
      ) : (
        <div class="buttons">
          <button disabled={locked} onClick={() => { setDecided(true); onAnswer(item.id ?? "", true, false); }}>
            允许
          </button>
          <button disabled={locked} onClick={() => { setDecided(true); onAnswer(item.id ?? "", true, true); }}>
            总是允许
          </button>
          <button class="secondary" disabled={locked} onClick={() => { setDecided(true); onAnswer(item.id ?? "", false, false); }}>
            拒绝
          </button>
        </div>
      )}
    </div>
  );
}

function MessageList({
  view,
  onAnswer,
  onCancel,
}: {
  view: SessionView;
  onAnswer: (requestId: string, granted: boolean, remembered: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const itemCount = view.items.length + (view.streaming?.length ?? 0);
  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [itemCount]);
  return (
    <div id="messages" ref={boxRef}>
      {view.items.length === 0 && !view.streaming && <div class="empty">把任务交给墨斗…</div>}
      {view.items.map((item, idx) => {
        if (item.kind === "user") return <div class="msg user">{item.text}</div>;
        if (item.kind === "assistant") return <div class="msg assistant">{item.text}</div>;
        if (item.kind === "error") return <div class="msg error">{item.text}</div>;
        if (item.kind === "tool") return <ToolItem item={item} />;
        if (item.kind === "approval")
          return <ApprovalItem item={item} disabled={view.replay} onAnswer={onAnswer} />;
        return null;
      })}
      {view.streaming !== null && <div class="msg assistant streaming">{view.streaming}</div>}
      {view.busy && (
        <div class="cancel-row">
          <button class="secondary" onClick={onCancel}>⏹ 取消本轮</button>
        </div>
      )}
    </div>
  );
}

function TokenGate({ onSaved }: { onSaved: () => void }): JSX.Element {
  const [value, setValue] = useState("");
  const submit = () => {
    if (value.trim()) {
      saveToken(value.trim());
      onSaved();
    }
  };
  return (
    <div class="token-gate card">
      <h2>需要访问令牌</h2>
      <p>此服务开启了 Bearer 鉴权。输入 modou serve 启动时打印的 token：</p>
      <input
        type="password"
        placeholder="token"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button onClick={submit}>保存并继续</button>
    </div>
  );
}

// ---------- 应用 ----------

function App(): JSX.Element {
  const [state, setState] = useState<ConsoleState>(emptyState());
  const [cwd, setCwd] = useState("");
  const [input, setInput] = useState("");
  const subsRef = useRef(new Map<string, { dispose(): void; attempts: number }>());

  const refreshSessions = useCallback(async () => {
    const sessions = await client.listSessions();
    setState((s) => setSessions(s, sessions));
  }, []);

  /** 订阅某会话事件；断线自动重连并重拉历史对账（plan-web 验收 3） */
  const subscribe = useCallback(
    (sessionId: string) => {
      const attempts = subsRef.current.get(sessionId)?.attempts ?? 0;
      subsRef.current.get(sessionId)?.dispose();
      const sub = client.subscribeEvents(
        sessionId,
        (event: ModouEvent) => {
          setState((s) => applyLiveEvent(s, sessionId, event));
          if ((event as { turnEnd?: boolean }).turnEnd === true) void refreshSessions();
        },
        (error) => {
          const entry = subsRef.current.get(sessionId);
          if (!entry) return;
          if (error && error !== "unauthorized" && entry.attempts < 5) {
            entry.attempts += 1;
            // 断线重连：重拉历史对账后重新订阅
            setTimeout(async () => {
              const history = await client.history(sessionId);
              setState((s) => replayEvents(s, sessionId, history));
              subscribe(sessionId);
            }, 1_000 * entry.attempts);
          } else if (error === "unauthorized") {
            unauthorizedListener?.();
          } else {
            setState((s) => setNotice(s, `事件流断开（${error ?? "未知"}），可重新选择会话重连`));
          }
        },
      );
      subsRef.current.set(sessionId, { ...sub, attempts });
    },
    [refreshSessions],
  );

  const openSession = useCallback(
    async (sessionId: string) => {
      setState((s) => setCurrent(s, sessionId));
      const history = await client.history(sessionId);
      setState((s) => replayEvents(s, sessionId, history));
      subscribe(sessionId);
    },
    [subscribe],
  );

  const newSession = useCallback(
    async (cwdText: string) => {
      const result = await client.createSession(cwdText);
      if (result.status === 401) {
        unauthorizedListener?.();
        return null;
      }
      if (result.error || !result.sessionId) {
        setState((s) => setNotice(s, result.error ?? "创建会话失败"));
        return null;
      }
      const created = result.sessionId;
      if (!created) return null;
      setState((s) => setCurrent(s, created));
      if (result.cwdWarning) setState((s) => setNotice(s, result.cwdWarning ?? null));
      await refreshSessions();
      subscribe(created);
      return created;
    },
    [refreshSessions, subscribe],
  );

  // 初始：健康检查 + 会话列表
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    let target = state.currentId;
    if (!target) {
      target = await newSession(cwd);
      if (!target) return;
    }
    setInput("");
    setState((s) => markBusy(s, target!));
    const result = await client.sendMessage(target, text);
    if (!result.ok) {
      setState((s) => setNotice(s, result.error ?? "发送失败"));
      setState((s) => ({
        ...s,
        views: { ...s.views, [target!]: { ...s.views[target!]!, busy: false } },
      }));
    }
  }, [input, state.currentId, cwd, newSession]);

  const answerApproval = useCallback(
    (requestId: string, granted: boolean, remembered: boolean) => {
      if (state.currentId) void client.answerApproval(state.currentId, requestId, granted, remembered);
    },
    [state.currentId],
  );

  const cancelTurn = useCallback(() => {
    if (state.currentId) void client.cancelTurn(state.currentId);
  }, [state.currentId]);

  const current = state.currentId ? (state.views[state.currentId] ?? null) : null;

  return (
    <>
      <header>
        <h1>墨斗 Modou</h1>
        <div class="spacer" />
        <select
          value={state.currentId ?? ""}
          onChange={(e) => {
            const id = (e.target as HTMLSelectElement).value;
            if (id) void openSession(id);
          }}
        >
          <option value="">选择会话…</option>
          {state.sessions.map((s: SessionSummary) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.active ? "● " : ""}
              {s.preview || s.sessionId.slice(0, 18)}
            </option>
          ))}
        </select>
        <button class="secondary" onClick={() => void newSession(cwd)} title="新建会话">
          ＋ 新会话
        </button>
      </header>
      {state.notice && (
        <div class="notice card" onClick={() => setState((s) => setNotice(s, null))}>
          {state.notice}（点击关闭）
        </div>
      )}
      <main>
        {current ? (
          <MessageList view={current} onAnswer={answerApproval} onCancel={cancelTurn} />
        ) : (
          <div class="empty">
            <p>新建或选择一个会话开始。</p>
            <input
              placeholder="项目目录（留空 = 服务端默认）"
              value={cwd}
              onInput={(e) => setCwd((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === "Enter" && void newSession(cwd)}
            />
          </div>
        )}
      </main>
      <footer>
        <div class="inputbar">
          <textarea
            placeholder="把任务交给墨斗…（Enter 发送，Shift+Enter 换行）"
            value={input}
            disabled={current?.busy === true}
            onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button disabled={current?.busy === true} onClick={() => void send()}>
            发送
          </button>
        </div>
        {current && (
          <div class="usage">
            tokens ↑{current.usage.inputTokens} ↓{current.usage.outputTokens} · 累计 ${current.usage.costUsd.toFixed(4)}
            {loadToken() ? "" : " · 未配置 token"}
          </div>
        )}
      </footer>
    </>
  );
}

// ---------- 401 门 ----------
// client 收到 401 时清凭据并通知 Root 弹 token 门（App 自身不感知鉴权）
let unauthorizedListener: (() => void) | null = null;
client.onUnauthorized = () => unauthorizedListener?.();

function Root(): JSX.Element {
  const [gate, setGate] = useState(false);
  useEffect(() => {
    unauthorizedListener = () => setGate(true);
    return () => {
      unauthorizedListener = null;
    };
  }, []);
  return gate ? <TokenGate onSaved={() => setGate(false)} /> : <App />;
}

render(<Root />, document.getElementById("app")!);
