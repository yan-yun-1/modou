import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { render, type JSX } from "preact";
import {
  applyLiveEvent,
  emptyState,
  markBusy,
  replayEvents,
  setCurrent,
  setNeedsToken,
  setNotice,
  setSessions,
  type ConsoleState,
  type ModouEvent,
  type RenderItem,
  type SessionView,
} from "./state.js";
import { ModouClient, saveToken, type SessionSummary } from "./client.js";
import { SessionPanel, triggerLabel } from "./SessionPanel.js";
import { TokenGate } from "./TokenGate.js";
import { fadeUp, panelIn, snapReveal } from "./motion.js";

/**
 * plan-web 重设计实现（DESIGN.md §2）：印章标顶栏 / 会话下拉面板 / 弹线空状态 /
 * 消息重排 / 工具卡与审批三键 / 框式输入台 / 用量条。状态变更全走 state.ts 纯函数。
 */

const client = new ModouClient(() => (location.origin === "null" ? "http://127.0.0.1:4711" : location.origin));

// 主题（§1.2）：默认跟随 prefers-color-scheme，localStorage 覆写
(function initTheme() {
  try {
    const saved = localStorage.getItem("modou.theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.dataset.theme = saved;
    }
  } catch {
    /* 存储不可用则跟随系统 */
  }
})();

// ---------- 消息子组件 ----------

function DiffBlock({ diff }: { diff: string }): JSX.Element {
  const rows = diff.split("\n");
  return (
    <pre class="diff">
      {rows.map((line, i) => {
        const cls = line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : line.startsWith("@@") || line.startsWith("---")
              ? "meta"
              : "";
        return cls ? (
          <span key={i} class={cls}>
            {line + "\n"}
          </span>
        ) : (
          <span key={i}>{line + "\n"}</span>
        );
      })}
    </pre>
  );
}

function ToolItem({ item }: { item: RenderItem }): JSX.Element {
  const [open, setOpen] = useState(false);
  const pending = item.status === "pending";
  const expanded = open && !pending;
  return (
    <div class={"tool" + (expanded ? " open" : "")}>
      <div
        class="tool-head"
        onClick={() => !pending && setOpen(!open)}
        style={pending ? "cursor: default" : undefined}
      >
        <span class={"st" + (pending ? " pending" : "")}>{pending ? "●" : "✓"}</span>
        {item.name && <span class="chip">{item.name}</span>}
        <span class="text">{item.text}</span>
        {!pending && <span class="arrow">▸</span>}
      </div>
      <div class="tool-body">
        <pre>{item.output ?? ""}</pre>
      </div>
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
}): JSX.Element {
  const [local, setLocal] = useState<null | "granted" | "denied">(null);
  const snapRef = useRef<HTMLDivElement>(null);
  const status = item.status === "granted" ? "granted" : item.status === "denied" ? "denied" : local;
  const answered = status === "granted" || status === "denied";

  useEffect(() => {
    if (status === "granted" || status === "denied") {
      snapReveal(snapRef.current!, status === "denied");
    }
  }, [status]);

  const answer = (granted: boolean, remembered: boolean) => {
    setLocal(granted ? "granted" : "denied");
    onAnswer(item.id ?? "", granted, remembered);
  };

  return (
    <div class={"approval" + (answered ? " answered" : "") + (status === "denied" ? " denied" : "")}>
      <div class="snap" ref={snapRef}>
        <div class="snap-solid" />
      </div>
      <div class="head">
        <span class={"stamp" + (answered ? " done" : "")}>
          {status === "granted" ? "已批" : status === "denied" ? "已拒" : "待批"}
        </span>
        <span class="name">{item.text}</span>
      </div>
      {item.output && <div class="reason">{item.output}</div>}
      {item.diff && <DiffBlock diff={item.diff} />}
      {answered ? (
        <div class={"status-line " + (status === "granted" ? "ok" : "no")}>
          {status === "granted" ? "✓ 已允许 · 回执已发送" : "✕ 已拒绝"}
        </div>
      ) : (
        <div class="buttons">
          <button class="btn" disabled={disabled} onClick={() => answer(false, false)}>
            拒绝
          </button>
          <button class="btn acc" disabled={disabled} onClick={() => answer(true, false)}>
            允许
          </button>
          <button class="btn primary" disabled={disabled} onClick={() => answer(true, true)}>
            总是允许
          </button>
        </div>
      )}
    </div>
  );
}

function MessageList({
  view,
  onAnswer,
}: {
  view: SessionView;
  onAnswer: (requestId: string, granted: boolean, remembered: boolean) => void;
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const itemCount = view.items.length + (view.streaming?.length ?? 0);
  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
    // 新消息入列动效（§4.2：fadeUp 10px 0.25s）
    const last = boxRef.current?.lastElementChild;
    if (last) fadeUp(last);
  }, [itemCount]);

  const who = (kind: string) => (kind === "user" ? "你" : kind === "assistant" ? "墨斗" : null);

  return (
    <div id="messages" ref={boxRef}>
      {view.replay && view.items.length > 0 && <div class="replay-badge">⟲ 只读回放</div>}
      {view.items.length === 0 && !view.streaming && (
        <div class="empty-session">
          <Snapline />
          <p>把任务交给墨斗——先弹线，后动锯。</p>
          <div class="hint">输入任务开始 · Enter 发送</div>
        </div>
      )}
      {view.items.map((item, idx) => {
        if (item.kind === "user")
          return (
            <div class="msg user" key={idx}>
              <span class="who">{who(item.kind)}</span>
              {item.text}
            </div>
          );
        if (item.kind === "assistant")
          return (
            <div class="msg assistant" key={idx}>
              <span class="who">{who(item.kind)}</span>
              {item.text}
            </div>
          );
        if (item.kind === "error")
          return (
            <div class="msg error" key={idx}>
              {item.text}
            </div>
          );
        if (item.kind === "tool") return <ToolItem item={item} />;
        if (item.kind === "approval") return <ApprovalItem item={item} disabled={view.replay} onAnswer={onAnswer} />;
        return null;
      })}
      {view.streaming !== null && (
        <div class="msg assistant streaming">
          <span class="who">墨斗</span>
          {view.streaming}
        </div>
      )}
    </div>
  );
}

// ---------- 空状态（§2.3 弹线） ----------

function Snapline(): JSX.Element {
  return (
    <svg class="snapline" viewBox="0 0 220 14" aria-hidden="true">
      <line x1="6" y1="7" x2="214" y2="7" stroke="var(--line2)" stroke-width="1" stroke-dasharray="4 4" />
      <line class="solid-line" x1="6" y1="7" x2="214" y2="7" stroke="var(--acc)" stroke-width="2" />
      <circle cx="6" cy="7" r="3" fill="var(--acc)" />
      <circle cx="214" cy="7" r="3" fill="var(--line2)" />
    </svg>
  );
}

function EmptyState({
  cwd,
  setCwd,
  onNew,
}: {
  cwd: string;
  setCwd: (v: string) => void;
  onNew: () => void;
}): JSX.Element {
  return (
    <div class="empty-state">
      <Snapline />
      <h2>没有进行中的会话</h2>
      <p>把任务交给墨斗——先弹线，后动锯。</p>
      <div class="new-row">
        <input
          placeholder="项目目录（留空 = 服务端默认）"
          value={cwd}
          onInput={(e) => setCwd((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === "Enter" && onNew()}
        />
        <button class="btn primary" onClick={onNew}>
          ＋ 新会话
        </button>
      </div>
      <div class="hint">Enter 新建 · 或从会话面板选择历史会话</div>
    </div>
  );
}

// ---------- 应用 ----------

function App(): JSX.Element {
  const [state, setState] = useState<ConsoleState>(emptyState());
  const [cwd, setCwd] = useState("");
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [theme, setThemeState] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "light"
      ? "light"
      : document.documentElement.dataset.theme === "dark"
        ? "dark"
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark",
  );
  const subsRef = useRef(new Map<string, { dispose(): void; attempts: number }>());

  // 主题切换（§1.2）：覆写 html[data-theme] 并持久化；无覆写时跟随系统
  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("modou.theme", next);
    } catch {
      /* 存储不可用仅内存生效 */
    }
    setThemeState(next);
  }, [theme]);

  const refreshSessions = useCallback(async () => {
    const sessions = await client.listSessions();
    setState((s) => setSessions(s, sessions));
  }, []);

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
          if (!error) return; // 非活跃会话 404 静默退出
          const entry = subsRef.current.get(sessionId);
          if (!entry) return;
          if (error !== "unauthorized" && entry.attempts < 5) {
            entry.attempts += 1;
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
      setPanelOpen(false);
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
      setState((s) => setCurrent(s, created));
      if (result.cwdWarning) setState((s) => setNotice(s, result.cwdWarning ?? null));
      await refreshSessions();
      subscribe(created);
      return created;
    },
    [refreshSessions, subscribe],
  );

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

  // 审批键盘（§2.6）：1=拒绝 2=允许 3=总是允许；仅响应当前会话最早一张 pending 卡
  const currentView = state.currentId ? (state.views[state.currentId] ?? null) : null;
  const earliestPending = currentView?.items.find(
    (it) => it.kind === "approval" && it.status === "pending" && it.id,
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      if (!earliestPending?.id) return;
      if (e.key === "1") answerApproval(earliestPending.id, false, false);
      else if (e.key === "2") answerApproval(earliestPending.id, true, false);
      else if (e.key === "3") answerApproval(earliestPending.id, true, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [earliestPending?.id, answerApproval]);

  // 顶栏触发器文案：当前会话预览
  const currentSummary = state.sessions.find((s: SessionSummary) => s.sessionId === state.currentId) ?? null;

  if (state.needsToken) {
    return (
      <TokenGate
        onSaved={() => {
          setState((s) => setNeedsToken(s, false));
          void refreshSessions();
        }}
      />
    );
  }

  return (
    <>
      <header>
        <span class="seal">墨</span>
        <span class="wordmark">墨斗 MODOU</span>
        <span class="spacer" />
        <button
          class="btn icon theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
          title={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
        >
          {theme === "dark" ? (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4" />
              <path
                d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
              />
            </svg>
          )}
        </button>
        <span class="session-anchor">
          <button class="btn icon" onClick={() => setPanelOpen(!panelOpen)}>
            <span class="label">{triggerLabel(currentSummary?.preview ?? null, state.currentId)}</span>
            <span class="caret">▼</span>
          </button>
          {panelOpen && (
            <SessionPanel
              sessions={state.sessions}
              currentId={state.currentId}
              onOpen={(id) => void openSession(id)}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </span>
        <button class="btn primary" onClick={() => void newSession(cwd)}>
          ＋ 新会话
        </button>
      </header>
      {state.notice && (
        <div class="notice" onClick={() => setState((s) => setNotice(s, null))}>
          <span>{state.notice}</span>
          <button>关闭</button>
        </div>
      )}
      <main>
        <div class="col">
          {currentView ? (
            <MessageList view={currentView} onAnswer={answerApproval} />
          ) : (
            <EmptyState cwd={cwd} setCwd={setCwd} onNew={() => void newSession(cwd)} />
          )}
        </div>
      </main>
      <footer>
        <div class="dock">
          <textarea
            placeholder="把任务交给墨斗…（Enter 发送，Shift+Enter 换行）"
            value={input}
            disabled={currentView?.busy === true}
            onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div class="bar">
            <span class="kbd-hint">
              Enter 发送 · Shift+Enter 换行{earliestPending ? " · 1 拒绝 / 2 允许 / 3 总是允许" : ""}
            </span>
            {currentView?.busy ? (
              <button class="btn ghost" onClick={cancelTurn}>
                取消本轮
              </button>
            ) : (
              <button class="btn primary" onClick={() => void send()} aria-label="发送">
                <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                  <path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" fill="none" stroke-width="1.5" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {currentView && (
          <div class="usage">
            <span class="up">↑ {currentView.usage.inputTokens}</span>
            <span class="down">↓ {currentView.usage.outputTokens}</span>
            <span class="cost">· 累计 ${currentView.usage.costUsd.toFixed(4)}</span>
          </div>
        )}
      </footer>
    </>
  );
}

// ---------- 401 门 ----------

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
