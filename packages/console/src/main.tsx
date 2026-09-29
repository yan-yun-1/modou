import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { render, type ComponentChildren, type JSX } from "preact";
import { gsap } from "gsap";
import {
  applyEventToView, applyLiveEvent, emptyState, markBusy, replayEvents, setCurrent, setNeedsToken, setNotice, setSessions,
  type ConsoleState, type ModouEvent, type RenderItem, type SessionSummary, type SessionView,
} from "./state.js";
import { ModouClient } from "./client.js";
import { SessionPanel, triggerLabel } from "./SessionPanel.js";
import { TokenGate } from "./TokenGate.js";
import { fadeUp, panelIn, snapReveal } from "./motion.js";

/** v2 重设计（DESIGN.md §6 磷光屏 PHOSPHOR）：开机自检空状态 / gutter 行号消息流 / 受控 markdown 子集 /
 * ❯ 命令台 / LED 状态灯 / 面板 stagger / 复制回底 / 审批乐观应答；状态走 state.ts 纯函数，reduced-motion 降级。 */

const client = new ModouClient(() => (location.origin === "null" ? "http://127.0.0.1:4711" : location.origin));
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 主题（§1.2）：默认跟随 prefers-color-scheme，localStorage 覆写
(function initTheme() {
  try {
    const saved = localStorage.getItem("modou.theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch { /* 存储不可用则跟随系统 */ }
  syncThemeColor();
})();
/** theme-color 随主题（§6.4 收尾）：把当前生效 --bg0 写回浏览器框 meta（含亮暗强制覆写） */
function syncThemeColor(): void {
  const c = getComputedStyle(document.documentElement).getPropertyValue("--bg0").trim();
  if (c) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", c);
}

// ---------- 复制按钮 / 受控 markdown 子集（§6.4） ----------

function CopyBtn({ text }: { text: string }): JSX.Element {
  const [ok, setOk] = useState(false);
  const copy = () => {
    const done = () => { setOk(true); setTimeout(() => setOk(false), 1200); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  };
  return (
    <button class={"copy" + (ok ? " done" : "")} title="复制" aria-label="复制" onClick={copy}>
      <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
        {ok
          ? <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          : <><rect x="4.5" y="4.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" /><path d="M9.5 4.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" fill="none" stroke="currentColor" stroke-width="1.3" /></>}
      </svg>
    </button>
  );
}

function CodeBlock({ code }: { code: string }): JSX.Element {
  return <div class="codeblock"><pre><code>{code}</code></pre><CopyBtn text={code} /></div>;
}

/** 行内子集：`code` 与 **粗体**。split 捕获组：偶数位=纯文本，奇数位=标记。Preact 字符串天然转义。 */
function inlineMd(text: string): ComponentChildren[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((tok, i) => (i % 2 === 0 ? tok || null : tok.startsWith("`") ? <code key={i}>{tok.slice(1, -1)}</code> : <strong key={i}>{tok.slice(2, -2)}</strong>));
}

/** 块级子集：``` 围栏代码块 + 空行分段；单换行由 pre-wrap 保留。 */
function MdText({ text }: { text: string }): JSX.Element {
  return (
    <div class="md">
      {text.split("```").map((part, i) =>
        i % 2 === 1 ? <CodeBlock key={i} code={part.replace(/^[^\n]*\n/, "").replace(/\n$/, "")} /> : (
          part.split(/\n{2,}/).map((para, j) => (para.trim() ? <p key={`${i}.${j}`}>{inlineMd(para.trim())}</p> : null))
        ),
      )}
    </div>
  );
}

function DiffBlock({ diff }: { diff: string }): JSX.Element {
  return (<pre class="diff">{diff.split("\n").map((line, i) => (<span key={i} class={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") || line.startsWith("---") ? "meta" : undefined}>{line + "\n"}</span>))}</pre>);
}

function ToolItem({ item }: { item: RenderItem }): JSX.Element {
  const [open, setOpen] = useState(false);
  const pending = item.status === "pending";
  return (
    <div class={"tool" + (open && !pending ? " open" : "") + (pending ? " pending" : "")}>
      <div class="tool-head" onClick={() => !pending && setOpen(!open)}>
        <span class={"st" + (pending ? " pending" : "")}>{pending ? "●" : "✓"}</span>
        {item.name && <span class="chip">{item.name}</span>}
        <span class="text">{item.text}</span>
        {!pending && <span class="arrow">▸</span>}
      </div>
      <div class="tool-body"><div class="codeblock"><pre>{item.output ?? ""}</pre>{!pending && <CopyBtn text={item.output ?? ""} />}</div></div>
    </div>
  );
}

type Answer = (requestId: string, granted: boolean, remembered: boolean) => void;

function ApprovalItem({ item, disabled, onAnswer }: { item: RenderItem; disabled: boolean; onAnswer: Answer }): JSX.Element {
  const [local, setLocal] = useState<null | "granted" | "denied">(null);
  const snapRef = useRef<HTMLDivElement>(null);
  const status = item.status === "granted" ? "granted" : item.status === "denied" ? "denied" : local;
  const answered = status === "granted" || status === "denied";
  useEffect(() => {
    if (status === "granted" || status === "denied") snapReveal(snapRef.current!, status === "denied");
  }, [status]);
  const answer = (granted: boolean, remembered: boolean) => {
    setLocal(granted ? "granted" : "denied");
    onAnswer(item.id ?? "", granted, remembered);
  };
  return (
    <div class={"approval" + (answered ? " answered" : "") + (status === "denied" ? " denied" : "")}>
      <div class="snap" ref={snapRef}><div class="snap-solid" /></div>
      <div class="head">
        <span class={"stamp" + (answered ? " done" : "")}>{status === "granted" ? "已批" : status === "denied" ? "已拒" : "待批"}</span>
        <span class="name">{item.text}</span>
      </div>
      {item.output && <div class="reason">{item.output}</div>}
      {item.diff && <DiffBlock diff={item.diff} />}
      {answered ? (
        <div class={"status-line " + (status === "granted" ? "ok" : "no")}>{status === "granted" ? "✓ 已允许 · 回执已发送" : "✕ 已拒绝"}</div>
      ) : (
        <div class="buttons">
          <button class="btn" disabled={disabled} onClick={() => answer(false, false)}>拒绝<kbd>1</kbd></button>
          <button class="btn acc" disabled={disabled} onClick={() => answer(true, false)}>允许<kbd>2</kbd></button>
          <button class="btn primary" disabled={disabled} onClick={() => answer(true, true)}>总是允许<kbd>3</kbd></button>
        </div>
      )}
    </div>
  );
}

/** gutter 行号容器：用户消息=$ 命令行式，其余为 01 起的 tabular 行号（§6.4） */
function Row({ n, kind, children }: { n: number; kind: string; children: ComponentChildren }): JSX.Element {
  return <div class="ln-row" data-ln={kind === "user" ? "$" : String(n + 1).padStart(2, "0")}>{children}</div>;
}

function MessageList({ view, onAnswer }: { view: SessionView; onAnswer: Answer }): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const idRef = useRef(view.sessionId);
  const prevItemsRef = useRef(view.items.length);
  const [showJump, setShowJump] = useState(false);
  const itemCount = view.items.length + (view.streaming?.length ?? 0);
  // 切会话：瞬时落底 + 子项 stagger 入列（§4.2 首屏/切会话）
  useEffect(() => {
    if (idRef.current === view.sessionId) return;
    idRef.current = view.sessionId;
    const box = boxRef.current;
    if (!box) return;
    stickRef.current = true;
    setShowJump(false);
    box.scrollTop = box.scrollHeight;
    if (!reduced() && box.children.length) {
      // §4.1④ 优先于 §4.2 行规格：数百条历史全量 stagger 是十几秒动画队列——只动视口内头部 20 条
      const heads = Array.from(box.children).slice(0, 20);
      gsap.fromTo(heads, { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, ease: "power3.out", stagger: 0.05, clearProps: "transform,opacity,visibility" });
    }
  }, [view.sessionId]);
  // 条目增减 fadeUp 末条；流式增量（text_delta）只滚动不动画——防频闪（用户实测反馈）
  useEffect(() => {
    const box = boxRef.current;
    if (stickRef.current) box?.scrollTo({ top: box.scrollHeight });
    if (view.items.length !== prevItemsRef.current) {
      prevItemsRef.current = view.items.length;
      const last = box?.lastElementChild;
      if (last && stickRef.current) fadeUp(last);
    }
  }, [itemCount, view.items.length]);
  // 上翻读历史不强拽：贴底才跟随；离底 >240px 露「回到底部」
  const onScroll = () => {
    const box = boxRef.current;
    if (!box) return;
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    stickRef.current = atEnd; setShowJump(!atEnd && box.scrollHeight > box.clientHeight + 240);
  };
  const toBottom = () => {
    const box = boxRef.current;
    if (!box) return;
    stickRef.current = true; setShowJump(false);
    box.scrollTo({ top: box.scrollHeight, behavior: reduced() ? "auto" : "smooth" });
  };
  const who = (kind: string) => (kind === "user" ? "你" : kind === "assistant" ? "墨斗" : null);
  return (
    <div id="messages" ref={boxRef} onScroll={onScroll}>
      {view.replay && view.items.length > 0 && <div class="replay-badge">⟲ 只读回放</div>}
      {view.items.length === 0 && !view.streaming && (
        <div class="empty-session"><Snapline /><p>把任务交给墨斗——先弹线，后动锯。</p><div class="hint">输入任务开始 · Enter 发送</div></div>
      )}
      {view.items.map((item, idx) => {
        if (item.kind === "user")
          return (<Row key={idx} n={idx} kind="user"><div class="msg user"><span class="who">{who(item.kind)}</span>{item.text}<CopyBtn text={item.text ?? ""} /></div></Row>);
        if (item.kind === "assistant")
          return (<Row key={idx} n={idx} kind="assistant"><div class="msg assistant"><span class="who">{who(item.kind)}</span><MdText text={item.text ?? ""} /><CopyBtn text={item.text ?? ""} /></div></Row>);
        if (item.kind === "error")
          return <Row key={idx} n={idx} kind="error"><div class="msg error">{item.text}</div></Row>;
        if (item.kind === "tool")
          return <Row key={idx} n={idx} kind="tool"><ToolItem item={item} /></Row>;
        if (item.kind === "approval")
          return <Row key={idx} n={idx} kind="approval"><ApprovalItem item={item} disabled={view.replay} onAnswer={onAnswer} /></Row>;
        return null;
      })}
      {view.streaming !== null && (
        <Row n={view.items.length} kind="assistant"><div class="msg assistant streaming"><span class="who">墨斗</span>{view.streaming}</div></Row>
      )}
      {showJump && (
        <button class="jump" onClick={toBottom}>
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 1v9M2 7l4 3.4L10 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          回到底部
        </button>
      )}
    </div>
  );
}

function Snapline(): JSX.Element {
  return (
    <svg class="snapline" viewBox="0 0 220 14" aria-hidden="true">
      <line x1="6" y1="7" x2="214" y2="7" stroke="var(--line2)" stroke-width="1" stroke-dasharray="4 4" />
      <line class="solid-line" x1="6" y1="7" x2="214" y2="7" stroke="var(--acc)" stroke-width="2" />
      <circle cx="6" cy="7" r="3" fill="var(--acc)" /><circle cx="214" cy="7" r="3" fill="var(--line2)" />
    </svg>
  );
}

const BOOT: Array<[string, string]> = [["> self-check", "OK"], ["> phosphor tube", "OK"], ["> mount workspace", "OK"]];
const CHIPS = ["跑通当前模块的测试并修复失败", "审查最近改动，指出三个风险点", "把 README 的安装步骤改到可直接运行"];

function EmptyState({ cwd, setCwd, onNew, onPick, sessions }: { cwd: string; setCwd: (v: string) => void; onNew: () => void; onPick: (text: string) => void; sessions: number; }): JSX.Element {
  return (
    <div class="empty-state">
      <div class="boot">
        <div class="bl bl-t">MODOU CONSOLE v0.6</div>
        {BOOT.map(([cmd, ok]) => <div class="bl" key={cmd}>{cmd}<span class="dots" /><b class="ok">{ok}</b></div>)}
        <div class="bl">{"> sessions loaded " + sessions}<span class="dots" /><b class="ok">OK</b></div>
        <h2 class="boot-wait">等待指令<span class="wcaret">▍</span></h2>
        <p class="boot-cwd">cwd: {cwd.trim() || "服务端默认"}</p>
      </div>
      <div class="chips">{CHIPS.map((c) => <button class="chip-btn" key={c} onClick={() => onPick(c)}>{c}</button>)}</div>
      <div class="new-row">
        <input placeholder="项目目录（留空 = 服务端默认）" value={cwd}
          onInput={(e) => setCwd((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) onNew(); }} />
        <button class="btn primary" onClick={onNew}>＋ 新会话</button>
      </div>
      <div class="hint">Enter 新建 · 或从会话面板选择历史会话</div>
    </div>
  );
}

/** 用量 k 缩写（§2.8）：≥1000 取 1 位小数 */
const kfmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ---------- 应用 ----------

function App(): JSX.Element {
  const [state, setState] = useState<ConsoleState>(emptyState());
  const [cwd, setCwd] = useState("");
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [theme, setThemeState] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : document.documentElement.dataset.theme === "dark" ? "dark"
      : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
  );
  const dockRef = useRef<HTMLTextAreaElement>(null);
  const subsRef = useRef(new Map<string, { dispose(): void; attempts: number }>());
  // 输入台自动增高（§6.5）：替代原生 resize 手柄
  useEffect(() => {
    const ta = dockRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }, [input]);
  // 主题切换（§1.2）：覆写 html[data-theme] 并持久化；无覆写时跟随系统
  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("modou.theme", next); } catch { /* 存储不可用仅内存生效 */ }
    setThemeState(next);
    syncThemeColor();
  }, [theme]);

  const refreshSessions = useCallback(async () => {
    const { sessions, total } = await client.listSessions();
    setState((s) => setSessions(s, sessions, total));
  }, []);

  const subscribe = useCallback((sessionId: string) => {
    const attempts = subsRef.current.get(sessionId)?.attempts ?? 0;
    subsRef.current.get(sessionId)?.dispose();
    const sub = client.subscribeEvents(
      sessionId,
      (event: ModouEvent) => {
        setState((s) => applyLiveEvent(s, sessionId, event));
        if ((event as { turnEnd?: boolean }).turnEnd === true) void refreshSessions();
      },
      (error) => {
        if (!error) { subsRef.current.delete(sessionId); return; } // 非活跃会话 404 静默退出：发送消息时会重订阅
        const entry = subsRef.current.get(sessionId);
        if (!entry) return;
        if (error !== "unauthorized" && entry.attempts < 5) {
          entry.attempts += 1;
          setTimeout(async () => { const history = await client.history(sessionId); setState((s) => replayEvents(s, sessionId, history)); subscribe(sessionId); }, 1_000 * entry.attempts);
        } else if (error === "unauthorized") unauthorizedListener?.();
        else setState((s) => setNotice(s, `事件流断开（${error ?? "未知"}），可重新选择会话重连`));
      },
    );
    subsRef.current.set(sessionId, { ...sub, attempts });
  }, [refreshSessions]);

  const openSession = useCallback(async (sessionId: string) => {
    setPanelOpen(false);
    setState((s) => setCurrent(s, sessionId));
    const history = await client.history(sessionId);
    setState((s) => replayEvents(s, sessionId, history));
    subscribe(sessionId);
  }, [subscribe]);

  const newSession = useCallback(async (cwdText: string) => {
    const result = await client.createSession(cwdText);
    if (result.status === 401) { unauthorizedListener?.(); return null; }
    if (result.error || !result.sessionId) { setState((s) => setNotice(s, translateServerError(result.error, "创建会话失败"))); return null; }
    setState((s) => setCurrent(s, result.sessionId!));
    if (result.cwdWarning) setState((s) => setNotice(s, result.cwdWarning ?? null));
    await refreshSessions();
    subscribe(result.sessionId!);
    return result.sessionId;
  }, [refreshSessions, subscribe]);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

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
    // 非活跃会话（回放中打开）的 SSE 已静默退出——发送前重订阅，否则事件全部丢失（续跑）
    if (!subsRef.current.has(target)) subscribe(target);
    const result = await client.sendMessage(target, text);
    if (!result.ok) {
      setState((s) => setNotice(s, translateServerError(result.error, "发送失败")));
      setState((s) => ({ ...s, views: { ...s.views, [target!]: { ...s.views[target!]!, busy: false } } }));
    }
  }, [input, state.currentId, cwd, newSession, subscribe]);

  // 键盘与按钮同一「已应答」态（§2.6）：应答乐观写入 status（复用 approval_result 纯函数，幂等），回执仍走 client；SSE 回程对账
  const answerApproval = useCallback((requestId: string, granted: boolean, remembered: boolean) => {
    if (!state.currentId) return;
    setState((s) => {
      const id = s.currentId;
      const v = id ? s.views[id] : null;
      return id && v ? { ...s, views: { ...s.views, [id]: applyEventToView(v, { type: "approval_result", id: requestId, granted }) } } : s;
    });
    void client.answerApproval(state.currentId, requestId, granted, remembered);
  }, [state.currentId]);

  const cancelTurn = useCallback(() => {
    if (state.currentId) void client.cancelTurn(state.currentId);
  }, [state.currentId]);

  // 审批键盘（§2.6）：1=拒绝 2=允许 3=总是允许；仅响应当前会话最早一张 pending 卡
  const currentView = state.currentId ? (state.views[state.currentId] ?? null) : null;
  const earliestPending = currentView?.items.find((it) => it.kind === "approval" && it.status === "pending" && it.id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // 长按连发守卫：事件回程前不重复发回执
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      if (currentView?.replay) return; // §2.6 replay 闸：回放只读，键盘不应答
      if (!earliestPending?.id) return;
      if (e.key === "1" || e.key === "2" || e.key === "3") answerApproval(earliestPending.id, e.key !== "1", e.key === "3");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [earliestPending?.id, answerApproval, currentView?.replay]);
  // 顶栏触发器文案：当前会话预览；空状态示例任务 → 灌入命令台并聚焦
  const currentSummary = state.sessions.find((s: SessionSummary) => s.sessionId === state.currentId) ?? null;
  const pickPrompt = useCallback((text: string) => { setInput(text); dockRef.current?.focus(); }, []);
  // 面板入场动效：useCallback 固定 ref 身份——内联箭头每次渲染换身份会被 detach/attach 重调，
  // 面板开着时任何 App setState（敲字/流式 delta/busy 翻转）都重跑入场动画（回弹闪烁）
  const panelMountRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    panelIn(el);
    const rows = el.querySelectorAll(".panel .row");
    if (rows.length && !reduced())
      gsap.fromTo(rows, { y: 6, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, ease: "power2.out", stagger: 0.04, delay: 0.05, clearProps: "transform,opacity,visibility" });
  }, []);
  const themeLabel = theme === "dark" ? "切换到亮色主题" : "切换到暗色主题";

  if (state.needsToken) {
    return <TokenGate onSaved={() => { setState((s) => setNeedsToken(s, false)); void refreshSessions(); }} />;
  }

  return (
    <>
      <header>
        <span class="seal">墨</span>
        <span class="wordmark">墨斗 MODOU</span>
        <span class={"led" + (currentView?.busy ? " on" : "")} aria-hidden="true" />
        <span class="status-txt">{currentView?.busy ? "执行中" : "空闲"}</span>
        <span class="spacer" />
        <button class="btn icon theme-toggle" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
          {theme === "dark"
            ? <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
            : <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>}
        </button>
        <span class="session-anchor">
          <button class="btn icon" onClick={() => setPanelOpen(!panelOpen)}>
            <span class="label">{triggerLabel(currentSummary?.preview ?? null, state.currentId)}</span>
            <span class="caret">▼</span>
          </button>
          {panelOpen && (
            <div class="panel-mount" ref={panelMountRef}>
              <SessionPanel
                sessions={state.sessions} currentId={state.currentId} onOpen={(id) => void openSession(id)} onClose={() => setPanelOpen(false)}
                onCloseSession={(id) => void client.deleteSession(id).then((ok) => {
                  void refreshSessions();
                  if (state.currentId === id) setState((s) => setCurrent(s, ok ? null : s.currentId));
                  if (ok) subsRef.current.delete(id);
                })}
                onBulkDeleteAll={async () => {
                  const deleted = await client.bulkDeleteAllHistory();
                  if (deleted > 0) {
                    // 清空历史后当前会话可能已被删——回到无会话态
                    setState((s) => (s.currentId && !s.sessions.some((x) => x.sessionId === s.currentId) ? setCurrent(s, null) : s));
                    void refreshSessions();
                    subsRef.current.clear();
                  }
                  return deleted;
                }}
                historyTotal={state.totalSessions}
              />
            </div>
          )}
        </span>
        <button class="btn primary" onClick={() => void newSession(cwd)}>＋ 新会话</button>
      </header>
      {state.notice && (
        <div class="notice" onClick={() => setState((s) => setNotice(s, null))}><span>{state.notice}</span><button>关闭</button></div>
      )}
      <main>
        <div class="col">
          {currentView ? <MessageList view={currentView} onAnswer={answerApproval} /> : (
            <EmptyState cwd={cwd} setCwd={setCwd} onNew={() => void newSession(cwd)} onPick={pickPrompt} sessions={state.sessions.length} />
          )}
        </div>
      </main>
      <footer>
        <div class="dock">
          <textarea ref={dockRef} placeholder="把任务交给墨斗…（Enter 发送，Shift+Enter 换行）" value={input}
            disabled={currentView?.busy === true} onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); } }} />
          <div class="bar">
            <span class="kbd-hint">Enter 发送 · Shift+Enter 换行{earliestPending ? " · 1 拒绝 / 2 允许 / 3 总是允许" : ""}</span>
            {currentView?.busy
              ? <button class="btn ghost" onClick={cancelTurn}>取消本轮</button>
              : <button class="btn primary" onClick={() => void send()} aria-label="发送">
                  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" fill="none" stroke-width="1.5" /></svg>
                </button>}
          </div>
        </div>
        {currentView && (
          <div class="usage">
            <span class="up">↑ {kfmt(currentView.usage.inputTokens)}</span><span class="down">↓ {kfmt(currentView.usage.outputTokens)}</span>
            <span class="cost">· 累计 ${currentView.usage.costUsd.toFixed(4)}</span>
          </div>
        )}
      </footer>
    </>
  );
}

// ---------- server 错误中文化（plan-web A7 配额等） ----------
function translateServerError(error: string | undefined, fallback: string): string {
  if (!error) return fallback;
  const quota = error.match(/session limit reached \((\d+)\)/);
  if (quota) return `会话数已达上限（${quota[1]} 个）——请在会话面板把不用的会话关闭（悬停行尾 ✕）后重试`;
  if (error.includes("session busy")) return "上一轮还在进行中——可点「取消本轮」后再发";
  if (error.includes("cwd 不存在")) return error; // server 侧已是中文
  return error;
}

// ---------- 401 门 ----------
let unauthorizedListener: (() => void) | null = null;
client.onUnauthorized = () => unauthorizedListener?.();

function Root(): JSX.Element {
  const [gate, setGate] = useState(false);
  useEffect(() => {
    unauthorizedListener = () => setGate(true);
    return () => { unauthorizedListener = null; };
  }, []);
  return gate ? <TokenGate onSaved={() => setGate(false)} /> : <App />;
}

render(<Root />, document.getElementById("app")!);
