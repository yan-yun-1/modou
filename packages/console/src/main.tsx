import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { render, type JSX } from "preact";
import {
  applyLiveEvent,
  emptyState,
  emptyView,
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
import { DiffBlock, MessageList, ToolItem, ApprovalItem } from "./MessageLog.js";

/**
 * plan-web 重设计 v2（方向 A 晒图 BLUEPRINT）：左图纸目录 + 右图纸主体。
 * 消息=编号标注+基准线；工具=双线框工序卡；审批=签章处（盖章动画）；
 * 用量=图签块材料表；输入=刻度边条命令台。状态变更全走 state.ts 纯函数。
 */

const client = new ModouClient(() => (location.origin === "null" ? "http://127.0.0.1:4711" : location.origin));

// 主题（晒图/白图）：默认晒图，localStorage 覆写
(function initTheme() {
  try {
    const saved = localStorage.getItem("modou.theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.dataset.theme = saved;
    }
  } catch {
    /* 存储不可用则晒图默认 */
  }
})();

// ---------- 空状态：圆规刻度圆 ----------

function SnapHero({ onPick }: { onPick: (cmd: string) => void }): JSX.Element {
  const samples = [
    "梳理 packages/console 的会话存储结构",
    "修复删除后列表不刷新的问题",
    "为审批卡加一次盖章动画",
  ];
  return (
    <div class="hero">
      <div class="stage">
        <svg class="blp" viewBox="0 0 1100 540" aria-hidden="true">
          <line class="x" x1="0" y1="270" x2="1100" y2="270" />
          <line class="x" x1="575" y1="0" x2="575" y2="540" />
          <line class="c2" x1="441" y1="136" x2="709" y2="404" />
          <line class="c2" x1="709" y1="136" x2="441" y2="404" />
          <circle class="c1" cx="575" cy="270" r="170" />
          <circle class="c2" cx="575" cy="270" r="110" />
          <circle class="ticks" cx="575" cy="270" r="178" stroke-dasharray="1 14.53" />
          <circle class="ctr" cx="575" cy="270" r="3" />
          <text x="575" y="76" text-anchor="middle">000°</text>
          <text x="785" y="274" text-anchor="start">090°</text>
          <text x="575" y="484" text-anchor="middle">180°</text>
          <text x="365" y="274" text-anchor="end">270°</text>
          <polyline class="ldr" points="370,116 430,116 455,150" />
          <polyline class="ldr" points="734,108 690,108 662,122" />
          <polyline class="ldr" points="714,444 676,444 662,418" />
        </svg>
        <div class="copy">
          <h2>尚无图样</h2>
          <div class="dash" />
          <p>——输入第一条指令开始制图</p>
        </div>
        {samples.map((cmd, i) => (
          <button class={`ex ex${i + 1}`} onClick={() => onPick(cmd)} key={i}>
            <span class="no">{`0${i + 1}`}</span>
            <span class="tx">{cmd}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- 令牌门 ----------

function TokenGate({ onSaved }: { onSaved: () => void }): JSX.Element {
  const [value, setValue] = useState("");
  const submit = () => {
    if (value.trim()) {
      saveToken(value.trim());
      onSaved();
    }
  };
  return (
    <div class="token-gate">
      <h2>⌘ 需要访问令牌</h2>
      <p>此服务开启了 Bearer 鉴权。输入 modou serve 启动时打印的 token：</p>
      <input
        type="password"
        placeholder="token"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button class="sealbtn" onClick={submit}>
        保存并继续
      </button>
    </div>
  );
}

// ---------- 应用 ----------

function App(): JSX.Element {
  const [state, setState] = useState<ConsoleState>(emptyState());
  const [cwd, setCwd] = useState("");
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const subsRef = useRef(new Map<string, { dispose(): void; attempts: number }>());

  const refreshSessions = useCallback(async () => {
    const { sessions, total } = await client.listSessions();
    setState((s) => setSessions(s, sessions, total));
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
          if (!error) return;
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

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text) return;
      let target = state.currentId;
      if (!target) {
        target = await newSession(cwd);
        if (!target) return;
      }
      if (raw === undefined) setInput("");
      setState((s) => markBusy(s, target!));
      if (!subsRef.current.has(target)) subscribe(target);
      const result = await client.sendMessage(target, text);
      if (!result.ok) {
        setState((s) => setNotice(s, result.error ?? "发送失败"));
        setState((s) => ({
          ...s,
          views: { ...s.views, [target!]: { ...s.views[target!]!, busy: false } },
        }));
      }
    },
    [input, state.currentId, cwd, newSession, subscribe],
  );

  const answerApproval = useCallback(
    (requestId: string, granted: boolean, remembered: boolean) => {
      if (state.currentId) void client.answerApproval(state.currentId, requestId, granted, remembered);
    },
    [state.currentId],
  );

  const cancelTurn = useCallback(() => {
    if (state.currentId) void client.cancelTurn(state.currentId);
  }, [state.currentId]);

  const deleteSession = useCallback(
    (id: string) => {
      void client.deleteSession(id).then((ok) => {
        void refreshSessions();
        if (state.currentId === id) setState((s) => setCurrent(s, ok ? null : s.currentId));
        if (ok) subsRef.current.delete(id);
      });
    },
    [state.currentId, refreshSessions],
  );

  const currentView = state.currentId ? (state.views[state.currentId] ?? emptyView(state.currentId)) : null;
  const currentSummary = state.sessions.find((s: SessionSummary) => s.sessionId === state.currentId) ?? null;
  const earliestPending = currentView?.items.find(
    (it) => it.kind === "approval" && it.status === "pending" && it.id,
  );
  const today = new Date().toISOString().slice(0, 10);

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
      <div class="board">
        <aside class="index">
          <div class="ph">
            <b>图纸目录</b>
            <span class="en">SHEET INDEX</span>
          </div>
          <nav class="ilist">
            {state.sessions.map((s: SessionSummary, i: number) => (
              <button
                key={s.sessionId}
                class={"si" + (s.sessionId === state.currentId ? " active" : "")}
                onClick={() => void openSession(s.sessionId)}
              >
                <span class="no">{`T-${String(state.sessions.length - i).padStart(2, "0")}`}</span>
                <span class="nm">{s.preview || `空会话 ${s.sessionId.slice(0, 8)}`}</span>
                <span
                  class="del"
                  title="删除此图纸（不可恢复）"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(s.sessionId);
                  }}
                >
                  ✕
                </span>
              </button>
            ))}
            <button class="si blank" onClick={() => void newSession(cwd)}>
              ＋ 新图纸 NEW SHEET
            </button>
          </nav>
          <div class="pf">
            <span class="cnt">
              {state.sessions.length} SHEETS · {today}
            </span>
          </div>
        </aside>

        <div class="main">
          <header class="head">
            <div class="cell brand">
              <span class="v">墨斗</span>
              <span class="en">MODOU · ENGINEERING CONSOLE</span>
            </div>
            <div class="cell">
              <span class="k">图号 Sheet</span>
              <span class="v mono">{state.currentId ? state.currentId.slice(0, 14) : "B-00"}</span>
            </div>
            <div class="cell">
              <span class="k">图名 Subject</span>
              <span class="v">{currentSummary?.preview ?? "空白图样"}</span>
            </div>
            <div class="cell">
              <span class="k">日期 Date</span>
              <span class="v mono">{today}</span>
            </div>
            <div class="cell status">
              <span class="k">状态 Status</span>
              <span class="v">
                {currentView?.busy ? (
                  <>
                    <span class="stamp run">RUN</span>&nbsp;制图中
                  </>
                ) : currentView ? (
                  <>
                    <span class="dot" />
                    已停笔
                  </>
                ) : (
                  "待图 NO DATA"
                )}
              </span>
            </div>
          </header>

          <span class="cm tl" aria-hidden="true" />
          <span class="cm tr" aria-hidden="true" />
          <span class="cm bl" aria-hidden="true" />
          <span class="cm br" aria-hidden="true" />

          {currentView ? (
            <>
              {currentView.replay && <div class="replay-badge">⟲ 只读回放 · SERVER 重启后的归档图纸</div>}
              <MessageList view={currentView} sessionId={state.currentId!} onAnswer={answerApproval} />
            </>
          ) : (
            <div class="flow">
              <SnapHero onPick={(cmd) => void send(cmd)} />
            </div>
          )}

          <div class="tblock">
            <div class="tb-head">
              <b>用量</b>
              <span class="en">MATERIALS</span>
              <span class="sh">{state.currentId ? state.currentId.slice(0, 4).toUpperCase() : "B-00"}</span>
            </div>
            <div class="tb-bar">
              <i
                class="in"
                style={`width:${
                  currentView && currentView.usage.inputTokens + currentView.usage.outputTokens > 0
                    ? Math.min(
                        72,
                        (currentView.usage.inputTokens / (currentView.usage.inputTokens + currentView.usage.outputTokens)) * 100,
                      )
                    : 0
                }%`}
              />
              <i
                class="out"
                style={`width:${
                  currentView && currentView.usage.inputTokens + currentView.usage.outputTokens > 0
                    ? Math.min(
                        60,
                        (currentView.usage.outputTokens / (currentView.usage.inputTokens + currentView.usage.outputTokens)) * 100,
                      )
                    : 0
                }%`}
              />
            </div>
            <div class="tb-row">
              <span class="k">输入 IN</span>
              <span class="v">{currentView?.usage.inputTokens ?? 0}</span>
            </div>
            <div class="tb-row">
              <span class="k">输出 OUT</span>
              <span class="v">{currentView?.usage.outputTokens ?? 0}</span>
            </div>
            <div class="tb-row total">
              <span class="k">合计 SUM</span>
              <span class="v">{currentView ? (currentView.usage.inputTokens + currentView.usage.outputTokens).toFixed(0) : "0"}</span>
            </div>
            <div class="tb-ctl">
              <button class="rew" disabled={!currentView?.replay} onClick={() => void openSession(state.currentId!)}>
                REW ◄◄
              </button>
              <div class="flip" role="group" aria-label="主题切换">
                <button class="on" onClick={() => (document.documentElement.dataset.theme = "dark")}>晒图</button>
                <button onClick={() => (document.documentElement.dataset.theme = "light")}>白图</button>
              </div>
            </div>
          </div>

          <div class="dock">
            <div class="ruler" aria-hidden="true" />
            <div class="inline">
              <input
                ref={inputRef}
                class="cmd"
                type="text"
                placeholder="输入指令，按 Enter 出图…"
                spellcheck={false}
                autocomplete="off"
                value={input}
                disabled={currentView?.busy === true}
                onInput={(e) => setInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && input.trim()) void send();
                  if (e.key === "Escape" && input) setInput("");
                }}
              />
              <span class="keys">
                {earliestPending ? "1 驳回 · 2 批准 · 3 批准全部" : "Enter 出图 · Esc 清空"}
              </span>
            </div>
          </div>
        </div>
      </div>
      {state.notice && (
        <div class="strip">
          <span class="l">{state.notice}</span>
          <button class="r" onClick={() => setState((s) => setNotice(s, null))}>
            关闭 CLOSE ✕
          </button>
        </div>
      )}
      <div class="strip">
        <span class="l">
          {state.currentId ? `Sheet · ${state.currentId.slice(0, 14)} · ` : ""}
          <span class="zh">{currentView?.busy ? "会话 · 制图中" : "墨斗 · 待图"}</span>
        </span>
        <span class="r">Blueprint · Direction A · {today} · Scale 1:1</span>
      </div>
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
