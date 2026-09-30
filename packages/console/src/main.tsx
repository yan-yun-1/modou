import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { render, type JSX } from "preact";
import {
  applyEventToView,
  applyLiveEvent,
  emptyState,
  emptyView,
  markBusy,
  replayEvents,
  setCurrent,
  setNeedsToken,
  setNotice,
  setSessions,
  setViewCwd,
  type ConsoleState,
  type ModouEvent,
  type SessionSummary,
} from "./state.js";
import { client, saveToken } from "./client.js";
import { DirPicker, shortPath } from "./DirPicker.js";
import { Icon, MessageList, relTime } from "./MessageLog.js";

/**
 * 重设计 v3「中性面阶」：左会话侧栏 260px + 右主列（52px 顶栏 / 消息流 / 驻底输入台），
 * 内容列 768px 居中，零横向滚动；视觉分层=一档底色差 + 1px 线，强调色仅一枚靛蓝。
 * 状态变更全走 state.ts 纯函数；主题 data-theme + localStorage + theme-color 同步。
 */

// ---------- 主题（dark 默认，localStorage 覆写；theme-color 随主题同步） ----------

function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-app").trim();
  if (bg) meta.setAttribute("content", bg);
}

function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("modou.theme", theme);
  } catch {
    /* 存储不可用则仅内存生效 */
  }
  syncThemeColor();
}

(function initTheme() {
  try {
    const saved = localStorage.getItem("modou.theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch {
    /* 存储不可用则暗色默认（基准：暗默认、亮可选，机制沿用） */
  }
  syncThemeColor();
})();

// ---------- 展示辅助 ----------

/** ≥1000 一位小数 k 缩写（DESIGN.md §6.6#7）；相对时间 relTime 见 MessageLog.tsx（消息流共用） */
function kfmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Phase F4：cwd chip 文案——过长时头部省略保尾部（目录尾部更有区分度） */
function cwdLabel(p: string): string {
  return p.length > 44 ? "…" + p.slice(-42) : p;
}

/** F7：项目名 = 路径末段（会话行标注所属项目用） */
function lastSeg(p: string): string {
  const segs = p.split(/[\\/]+/).filter(Boolean);
  return segs[segs.length - 1] ?? p;
}

const SAMPLES = [
  "梳理 packages/console 的会话存储结构",
  "修复删除后列表不刷新的问题",
  "为发送失败补一条可见的错误通知",
];

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
    <div class="gate">
      <div class="gatecard">
        <h2>需要访问令牌</h2>
        <p>此服务开启了 Bearer 鉴权。输入 modou serve 启动时打印的 token：</p>
        <input
          type="password"
          placeholder="token"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) submit();
          }}
        />
        <button class="abtn primary" onClick={submit}>
          保存并继续
        </button>
      </div>
    </div>
  );
}

// ---------- 应用 ----------

function App(): JSX.Element {
  const [state, setState] = useState<ConsoleState>(emptyState());
  const [input, setInput] = useState("");
  const [sideOpen, setSideOpen] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [serveCwd, setServeCwd] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  /** Phase F3：创建会话核心——成功接线订阅/刷新；失败返回错误文案（弹层内联回显用） */
  const createAt = useCallback(
    async (cwdText: string): Promise<{ ok: boolean; sessionId?: string; error?: string }> => {
      const result = await client.createSession(cwdText);
      if (result.status === 401) {
        unauthorizedListener?.();
        return { ok: false };
      }
      if (result.error || !result.sessionId) {
        return { ok: false, error: result.error ?? "创建会话失败" };
      }
      const created = result.sessionId;
      setState((s) => setCurrent(s, created));
      if (result.cwd) setState((s) => setViewCwd(s, created, result.cwd!));
      if (result.cwdWarning) setState((s) => setNotice(s, result.cwdWarning ?? null));
      await refreshSessions();
      subscribe(created);
      return { ok: true, sessionId: created };
    },
    [refreshSessions, subscribe],
  );

  const newSession = useCallback(
    async (cwdText: string) => {
      const r = await createAt(cwdText);
      if (!r.ok && r.error) setState((s) => setNotice(s, r.error!));
      return r.ok;
    },
    [createAt],
  );

  useEffect(() => {
    void refreshSessions();
    void client.getCwdRecents().then(({ serveCwd }) => setServeCwd(serveCwd));
  }, [refreshSessions]);

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text) return;
      let target = state.currentId;
      if (!target) {
        // 空态直接发送：在 serve 启动目录零摩擦建会话（选目录走「+ 新会话」弹层）
        const r = await createAt("");
        if (!r.ok || !r.sessionId) {
          const errText = r.error;
          if (errText) setState((s) => setNotice(s, errText));
          return;
        }
        target = r.sessionId;
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
    [input, state.currentId, createAt, subscribe],
  );

  /** 审批应答：乐观写入（幂等，复用 approval_result 分支）+ 回执发送 */
  const answerApproval = useCallback(
    (requestId: string, granted: boolean, remembered: boolean) => {
      if (!state.currentId) return;
      void client.answerApproval(state.currentId, requestId, granted, remembered);
      setState((s) => {
        const view = s.views[s.currentId!];
        if (!view) return s;
        const next = applyEventToView(view, { type: "approval_result", id: requestId, granted });
        return { ...s, views: { ...s.views, [s.currentId!]: next } };
      });
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
  const busy = currentView?.busy === true;
  const replayMode = currentView?.replay === true;
  const earliestPending = currentView?.items.find(
    (it) => it.kind === "approval" && it.status === "pending" && it.id,
  );
  const pendingId = replayMode ? null : (earliestPending?.id ?? null);

  // 键盘 1/2/3 应答（三闸：isComposing / e.repeat / 回放早退；输入框聚焦不触发）
  useEffect(() => {
    if (!pendingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat || e.keyCode === 229) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "1") answerApproval(pendingId, false, false);
      else if (e.key === "2") answerApproval(pendingId, true, false);
      else if (e.key === "3") answerApproval(pendingId, true, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingId, answerApproval]);

  // 输入台行数自适应（max-height 200px 由 CSS 限）
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

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

  const usage = currentView?.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const total = usage.inputTokens + usage.outputTokens;
  return (
    <div class="board" data-side={sideOpen ? "open" : "closed"}>
      <aside class="side">
        <div class="sidehead">
          <span class="sidetitle">会话{state.sessions.length > 0 ? ` · ${state.sessions.length}` : ""}</span>
        </div>
        <button class="snew" onClick={() => setPickerOpen(true)}>
          ＋ 新会话
        </button>
        <nav class="slist">
          {state.sessions.length === 0 && <div class="sempty">暂无会话</div>}
          {state.sessions.map((s: SessionSummary) => {
            const preview = s.preview.trim();
            const time = s.updatedAt ? relTime(s.updatedAt) : "—";
            const proj = s.cwd ? lastSeg(s.cwd) : null;
            return (
              <div key={s.sessionId} class={"srow" + (s.sessionId === state.currentId ? " active" : "")}>
                <button class="sopen" onClick={() => void openSession(s.sessionId)}>
                  <span class="l1">{preview || `空会话 ${s.sessionId.slice(0, 8)}`}</span>
                  <span class="l2">
                    {proj ? (
                      <>
                        <b>{proj}</b> · {time}
                      </>
                    ) : preview ? (
                      `${time} · ${s.sessionId.slice(0, 8)}`
                    ) : (
                      time
                    )}
                  </span>
                </button>
                <button class="sdel" title="删除此会话（不可恢复）" aria-label="删除此会话" onClick={() => deleteSession(s.sessionId)}>
                  <Icon size={12}>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </Icon>
                </button>
              </div>
            );
          })}
        </nav>
        {currentView?.cwd && (
          <div class="sidefoot" title={currentView.cwd}>
            <Icon size={12}>
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </Icon>
            <span>{cwdLabel(currentView.cwd)}</span>
          </div>
        )}
      </aside>

      <div class="main">
        <header class="top">
          <button class="iconbtn" title={sideOpen ? "收起侧栏" : "展开侧栏"} onClick={() => setSideOpen((v) => !v)}>
            <Icon>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </Icon>
          </button>
          <span class="brand">墨斗</span>
          <span class="topstatus">
            <span class={"sdot" + (busy ? " run" : "")} />
            {currentView ? (busy ? "生成中" : "空闲") : "待机"}
          </span>
          <button
            class="iconbtn"
            title="切换主题"
            onClick={() => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")}
          >
            <span class="icon-sun">
              <Icon>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </Icon>
            </span>
            <span class="icon-moon">
              <Icon>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </Icon>
            </span>
          </button>
        </header>

        {state.notice && (
          <div class="notice" role="status">
            <span class="ntext">{state.notice}</span>
            <button class="iconbtn" title="关闭通知" onClick={() => setState((s) => setNotice(s, null))}>
              <Icon>
                <path d="M18 6L6 18M6 6l12 12" />
              </Icon>
            </button>
          </div>
        )}

        {currentView ? (
          <MessageList
            key={currentView.sessionId}
            view={currentView}
            onAnswer={answerApproval}
            onReplay={() => void openSession(state.currentId!)}
          />
        ) : (
          <div class="flow">
          <div class="empty">
            <h2>开始一个新会话</h2>
            <p>输入第一条指令，或从下面的示例开始</p>
            <button class="escwd" title="更换项目目录" onClick={() => setPickerOpen(true)}>
              目录：{serveCwd ? shortPath(serveCwd) : "serve 启动目录"}（更改）
            </button>
            <div class="exlist">
                {SAMPLES.map((cmd) => (
                  <button
                    class="excard"
                    key={cmd}
                    onClick={() => {
                      setInput(cmd);
                      inputRef.current?.focus();
                    }}
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div class="bottom">
          <div class="col">
            <div class="dock">
              <textarea
                ref={inputRef}
                rows={1}
                placeholder="输入指令…"
                spellcheck={false}
                value={input}
                onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    if (e.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    if (busy) return; // 生成中可预输入，Enter 不发送（取消钮在本轮出口）
                    if (input.trim()) void send();
                  } else if (e.key === "Escape" && input) {
                    setInput("");
                  }
                }}
              />
              <div class="dockfoot">
                <span class="dockhint">
                  {pendingId ? "1 拒绝 · 2 允许 · 3 总是允许" : "Enter 发送 · Shift+Enter 换行"}
                </span>
                {busy ? (
                  <button class="send cancel" title="取消本轮" onClick={cancelTurn}>
                    取消
                  </button>
                ) : (
                  <button class="send" title="发送" disabled={!input.trim()} onClick={() => void send()}>
                    <Icon>
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </Icon>
                  </button>
                )}
              </div>
            </div>
            {total > 0 && (
              <div class="usage">
                <span class="ubar" aria-hidden="true">
                  <i class="in" style={`width:${(usage.inputTokens / total) * 100}%`} />
                  <i class="out" style={`width:${(usage.outputTokens / total) * 100}%`} />
                </span>
                <span>
                  ↑ <b>{kfmt(usage.inputTokens)}</b> ↓ <b>{kfmt(usage.outputTokens)}</b> · 合计{" "}
                  <b>{kfmt(total)}</b> · ${usage.costUsd.toFixed(4)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      {pickerOpen && <DirPicker onPick={createAt} onClose={() => setPickerOpen(false)} />}
    </div>
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
