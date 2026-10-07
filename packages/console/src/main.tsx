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
  groupSessions,
  setSessions,
  setViewCwd,
  setViewPermissionMode,
  setViewRuntimeState,
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

/** F12：思考强度档位（off=自动：按模型默认） */
const THINKING_LEVELS = [
  { value: "off", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
] as const;

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
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [projOpen, setProjOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("modou.projOpen") ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  // F9：项目管理——别名（重命名展示）、隐藏（移除工作区）、行内编辑、下拉菜单
  const [projAlias, setProjAlias] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("modou.projAlias") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [projHidden, setProjHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("modou.projHidden") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [projMenu, setProjMenu] = useState<string | null>(null);
  // F12.5：分组「清空该项目会话」的两步确认（首次点击武装，再次点击执行）
  const [clearArmed, setClearArmed] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  // F10.5：见过的所有工作区（持久清单）——节点只随「移除工作区」消失，删会话不影响
  const [projKnown, setProjKnown] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("modou.projKnown") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  // F12：模型/思考强度（胶囊选择器状态）
  const [models, setModels] = useState<{ id: string; displayName: string; supportsReasoning: boolean }[]>([]);
  const [modelId, setModelId] = useState<string>(() => {
    try {
      return localStorage.getItem("modou.model") ?? "";
    } catch {
      return "";
    }
  });
  // F13：供应商切换（名单 / 当前选择 / 各家 API Key / 菜单内联 key 输入）
  const [providersList, setProvidersList] = useState<{ name: string; modelCount: number; current: boolean }[]>([]);
  const [serverCurrentProvider, setServerCurrentProvider] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    try {
      return localStorage.getItem("modou.provider") ?? "";
    } catch {
      return "";
    }
  });
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("modou.providerKeys") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [provKeyInput, setProvKeyInput] = useState("");
  const provRef = useRef(selectedProvider);
  const [thinking, setThinking] = useState<string>(() => {
    try {
      return localStorage.getItem("modou.thinking") ?? "off";
    } catch {
      return "off";
    }
  });
  const [dockMenu, setDockMenu] = useState<null | "prov" | "model" | "think">(null);
  // F11：权限模式（新建会话默认值；localStorage 持久）
  const [permMode, setPermMode] = useState<string>(() => {
    try {
      return localStorage.getItem("modou.permMode") ?? "default";
    } catch {
      return "default";
    }
  });
  const permModeRef = useRef(permMode);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const subsRef = useRef(new Map<string, { dispose(): void; attempts: number }>());

  const refreshSessions = useCallback(async () => {
    const { sessions, total } = await client.listSessions();
    setState((s) => setSessions(s, sessions, total));
    // F8：最近目录（项目树空节点）与 serve 目录一并刷新
    const rec = await client.getCwdRecents();
    setServeCwd(rec.serveCwd);
    setRecentDirs(rec.recents);
    const pl = await client.listProviders();
    setProvidersList(pl.providers);
    setServerCurrentProvider(pl.current);
    const ml = await client.listModels(provRef.current || undefined);
    setModels(ml.models);
    setModelId((prev) => prev || ml.models[0]?.id || "");
  }, []);

  /** F13：切换供应商——拉取该供应商模型列表并自动选第一个（记忆各家上次选择）；
   *  跨供应商需要 API Key 时菜单内联输入（存浏览器本地，随创建请求发送） */
  const selectProvider = useCallback(
    async (name: string) => {
      provRef.current = name;
      setSelectedProvider(name);
      try {
        localStorage.setItem("modou.provider", name);
      } catch {
        /* 存储不可用仅内存 */
      }
      const ml = await client.listModels(name);
      setModels(ml.models);
      const remembered = (() => {
        try {
          return localStorage.getItem(`modou.model.${name}`);
        } catch {
          return null;
        }
      })();
      const next = remembered || ml.models[0]?.id || "";
      setModelId(next);
      try {
        localStorage.setItem("modou.model", next);
      } catch {
        /* 存储不可用仅内存 */
      }
    },
    [],
  );

  /** F13：保存供应商 API Key（浏览器本地持久；随创建请求发送，服务端不落盘） */
  const saveProvKey = useCallback((name: string, key: string) => {
    const trimmed = key.trim();
    setProvKeyInput("");
    if (!trimmed) return;
    setProviderKeys((m) => {
      const next = { ...m, [name]: trimmed };
      try {
        localStorage.setItem("modou.providerKeys", JSON.stringify(next));
      } catch {
        /* 存储不可用仅内存 */
      }
      return next;
    });
  }, []);

  // F10.5：会话与最近目录里出现过的目录沉淀进工作区清单（持久，删会话不掉节点）
  useEffect(() => {
    const cwds = new Set(projKnown);
    for (const s of state.sessions) if (s.cwd) cwds.add(s.cwd);
    for (const d of recentDirs) cwds.add(d);
    if (cwds.size !== projKnown.length) {
      const next = [...cwds];
      setProjKnown(next);
      try {
        localStorage.setItem("modou.projKnown", JSON.stringify(next));
      } catch {
        /* 存储不可用仅内存 */
      }
    }
  }, [state.sessions, recentDirs, projKnown]);

  /** F8：展开/收起项目分组（记忆到 localStorage；缺省展开=含当前会话的项目） */
  const toggleProj = useCallback((cwd: string, open: boolean) => {
    setProjOpen((m) => {
      const next = { ...m, [cwd]: !open };
      try {
        localStorage.setItem("modou.projOpen", JSON.stringify(next));
      } catch {
        /* 存储不可用仅内存 */
      }
      return next;
    });
  }, []);

  /** F9：行内重命名提交（别名存 localStorage；与路径末段相同则视为清除别名） */
  const commitRename = useCallback((cwd: string, val: string) => {
    setRenaming(null);
    const name = val.trim();
    if (!name) return;
    setProjAlias((m) => {
      const fallback = cwd
        ? (cwd.split(/[\\/]+/).filter(Boolean).pop() ?? cwd)
        : "未标注项目";
      const next = { ...m };
      if (name === fallback) delete next[cwd];
      else next[cwd] = name;
      try {
        localStorage.setItem("modou.projAlias", JSON.stringify(next));
      } catch {
        /* 存储不可用仅内存 */
      }
      return next;
    });
  }, []);

  /** F9：复制项目路径到剪贴板（clipboard API 失败时退回 execCommand 兜底） */
  const copyPath = useCallback(async (cwd: string) => {
    setProjMenu(null);
    try {
      await navigator.clipboard.writeText(cwd);
      setState((s) => setNotice(s, `已复制路径：${cwd}`));
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = cwd;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        setState((s) => setNotice(s, ok ? `已复制路径：${cwd}` : "复制失败（浏览器未授权剪贴板）"));
      } catch {
        setState((s) => setNotice(s, "复制失败（浏览器未授权剪贴板）"));
      }
    }
  }, []);

  /** F12.5：清空该项目的全部会话（工作区节点保留；活跃会话由服务端完整关闭） */
  const clearProjectSessions = useCallback(
    (cwd: string, ids: string[]) => {
      setClearArmed(null);
      if (ids.length === 0) return;
      void client.bulkDelete(ids).then((n) => {
        if (n < 0) {
          setState((s) => setNotice(s, "批量删除失败（server 版本过旧？）"));
          return;
        }
        if (state.currentId && ids.includes(state.currentId)) {
          setState((s) => setCurrent(s, null));
        }
        void refreshSessions();
      });
    },
    [state.currentId, refreshSessions],
  );

  /** F9：移除工作区——侧栏隐藏该项目 + server 最近目录摘除；不删磁盘文件与会话历史 */
  const removeWorkspace = useCallback(
    (cwd: string) => {
      setProjMenu(null);
      setProjHidden((m) => {
        const next = m.includes(cwd) ? m : [...m, cwd];
        try {
          localStorage.setItem("modou.projHidden", JSON.stringify(next));
        } catch {
          /* 存储不可用仅内存 */
        }
        return next;
      });
      if (cwd) {
        void client
          .removeRecent(cwd)
          .catch(() => undefined)
          .then(() => refreshSessions());
      }
    },
    [refreshSessions],
  );

  /** F9：在指定工作区新建会话（项目行气泡+ 按钮；成功后展开该组） */

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

  /** F12：切换模型/思考强度——活跃会话即时生效；未开/回放会话仅更新默认值 */
  const applyRuntime = useCallback(
    (patch: { model?: string; thinking?: string }) => {
      const id = state.currentId;
      const view = id ? state.views[id] : null;
      const live = id && view && !view.replay;
      if (patch.model) {
        setModelId(patch.model);
        try {
          localStorage.setItem("modou.model", patch.model);
        } catch {
          /* 存储不可用仅内存 */
        }
      }
      if (patch.thinking) {
        setThinking(patch.thinking);
        try {
          localStorage.setItem("modou.thinking", patch.thinking);
        } catch {
          /* 存储不可用仅内存 */
        }
      }
      if (live && id) {
        const apply = (r: { ok: boolean; error?: string }) => {
          if (!r.ok && r.error) setState((s) => setNotice(s, r.error!));
        };
        if (patch.model) void client.setSessionModel(id, patch.model).then(apply);
        if (patch.thinking) void client.setSessionThinking(id, patch.thinking).then(apply);
        setState((s) => setViewRuntimeState(s, id, patch));
      }
    },
    [state.currentId, state.views],
  );

  // F12.5：菜单关闭即解除「清空」两步确认的武装状态
  useEffect(() => {
    if (!projMenu) setClearArmed(null);
  }, [projMenu]);

  /** F11：切换权限模式——活跃会话即时生效；回放会话与未开会话仅更新新建默认值 */
  const changePermMode = useCallback(
    (mode: string) => {
      permModeRef.current = mode;
      setPermMode(mode);
      try {
        localStorage.setItem("modou.permMode", mode);
      } catch {
        /* 存储不可用仅内存 */
      }
      const id = state.currentId;
      const view = id ? state.views[id] : null;
      if (!id || !view) return;
      if (view.replay) {
        setState((s) => setNotice(s, "历史回放会话不支持切换权限模式；新会话将以该模式创建"));
        return;
      }
      void client.setPermissionMode(id, mode).then((r) => {
        if (r.ok && r.permissionMode) setState((s) => setViewPermissionMode(s, id, r.permissionMode!));
        else if (r.error) setState((s) => setNotice(s, r.error!));
      });
    },
    [state.currentId, state.views],
  );

  /** Phase F3：创建会话核心——成功接线订阅/刷新；失败返回错误文案（弹层内联回显用） */
  const createAt = useCallback(
    async (cwdText: string): Promise<{ ok: boolean; sessionId?: string; error?: string }> => {
      const activeProvider = provRef.current || undefined;
      const activeKey = activeProvider ? providerKeys[activeProvider] || undefined : undefined;
      const result = await client.createSession(cwdText, permModeRef.current, modelId || undefined, thinking, activeProvider, activeKey);
      if (result.status === 401) {
        unauthorizedListener?.();
        return { ok: false };
      }
      if (result.error || !result.sessionId) {
        return { ok: false, error: result.error ?? "创建会话失败" };
      }
      const created = result.sessionId;
      setState((s) => setCurrent(s, created));
      if (result.cwd) {
        setState((s) => setViewCwd(s, created, result.cwd!));
        // F10.6：在被移除的工作区新建会话 = 重新启用该工作区（自动解除移除）
        setProjHidden((m) => {
          if (!m.includes(result.cwd!)) return m;
          const next = m.filter((c) => c !== result.cwd!);
          try {
            localStorage.setItem("modou.projHidden", JSON.stringify(next));
          } catch {
            /* 存储不可用仅内存 */
          }
          return next;
        });
      }
      // F11/F12：权限模式与模型入视图状态
      if (result.permissionMode) setState((s) => setViewPermissionMode(s, created, result.permissionMode!));
      if (result.modelId) setState((s) => setViewRuntimeState(s, created, { modelId: result.modelId }));
      if (result.cwdWarning) setState((s) => setNotice(s, result.cwdWarning ?? null));
      await refreshSessions();
      subscribe(created);
      return { ok: true, sessionId: created };
    },
    [refreshSessions, subscribe, providerKeys],
  );

  /** F9：在指定工作区新建会话（项目行气泡+ 按钮；成功后展开该组） */
  const createInWorkspace = useCallback(
    (cwd: string) => {
      void createAt(cwd).then((r) => {
        if (r.ok) setProjOpen((m) => ({ ...m, [cwd]: true }));
      });
    },
    [createAt],
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

  // F8：项目树 = 会话按目录分组（首现顺序，未标注最后）+ 已知工作区清单里的空节点。
  // F10.5 语义定版：工作区节点持久存在（projKnown），删会话不影响；只有「移除工作区」（projHidden）才从侧栏消失
  const groups = groupSessions(state.sessions);
  const knownCwds = new Set(groups.map((g) => g.cwd));
  const allProjects = [
    ...groups,
    ...projKnown.filter((d) => !knownCwds.has(d)).map((d) => ({ cwd: d, name: lastSeg(d), sessions: [] as SessionSummary[] })),
  ];
  const projects = allProjects.filter((g) => !projHidden.includes(g.cwd));
  const visibleCount = projects.reduce((n, g) => n + g.sessions.length, 0);
  // F13：供应商胶囊派生值
  const providerDisplayName = selectedProvider || serverCurrentProvider || "";
  const keyNeededFor = (name: string) =>
    name !== "ollama" && !providerKeys[name] && name !== serverCurrentProvider;
  // F12：模型/思考胶囊的派生值（依赖 currentView，置于其声明之后）
  const activeModelId = currentView?.modelId ?? modelId;
  const currentModel = models.find((m) => m.id === activeModelId);
  const thinkingAvailable = currentModel?.supportsReasoning ?? false;
  const modelDisplayName = currentModel?.displayName ?? activeModelId;
  const thinkLabel = THINKING_LEVELS.find((l) => l.value === (currentView?.thinking ?? thinking))?.label ?? "自动";
  return (
    <div class="board" data-side={sideOpen ? "open" : "closed"}>
      <aside class="side">
        <div class="sidehead">
          <span class="sidetitle">会话{visibleCount > 0 ? ` · ${visibleCount}` : ""}</span>
        </div>
        <button class="snew" onClick={() => setPickerOpen(true)}>
          ＋ 新会话
        </button>
        <nav class="slist">
          {projects.length === 0 && <div class="sempty">暂无会话</div>}
          {projects.map((g) => {
            const open = projOpen[g.cwd] ?? true;
            const name = projAlias[g.cwd] ?? g.name;
            return (
              <div key={g.cwd || "(none)"} class="pgroup">
                <div
                  class="pjrow"
                  title={g.cwd || "未标注项目（旧会话无目录记录）"}
                  onClick={() => {
                    if (renaming !== g.cwd) toggleProj(g.cwd, open);
                  }}
                >
                  {renaming === g.cwd ? (
                    <input
                      class="prename"
                      value={renameVal}
                      autoFocus
                      spellcheck={false}
                      onClick={(e) => e.stopPropagation()}
                      onInput={(e) => setRenameVal((e.target as HTMLInputElement).value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(g.cwd, renameVal);
                        else if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => commitRename(g.cwd, renameVal)}
                    />
                  ) : (
                    <>
                      <span class="picon">
                        <Icon size={13}>
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </Icon>
                      </span>
                      <span class="pname">{name}</span>
                    </>
                  )}
                  <span class={"pcount" + (g.sessions.length === 0 ? " zero" : "")}>{g.sessions.length}</span>
                  <div class="pact">
                    <button
                      class="pactbtn"
                      title="更多操作"
                      aria-label="更多操作"
                      aria-haspopup="menu"
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjMenu(projMenu === g.cwd ? null : g.cwd);
                      }}
                    >
                      <Icon size={13}>
                        <circle cx="5" cy="12" r="1.4" />
                        <circle cx="12" cy="12" r="1.4" />
                        <circle cx="19" cy="12" r="1.4" />
                      </Icon>
                    </button>
                    <button
                      class="pactbtn"
                      title="在此工作区新建会话"
                      aria-label="在此工作区新建会话"
                      onClick={(e) => {
                        e.stopPropagation();
                        createInWorkspace(g.cwd);
                      }}
                    >
                      <Icon size={13}>
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        <path d="M12 7v6M9 10h6" />
                      </Icon>
                    </button>
                  </div>
                  {projMenu === g.cwd && (
                    <div class="pmenu" role="menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        role="menuitem"
                        onClick={() => {
                          if (g.cwd) void copyPath(g.cwd);
                          else setProjMenu(null);
                        }}
                      >
                        <Icon size={13}>
                          <rect x="9" y="9" width="12" height="12" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </Icon>
                        复制路径
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setProjMenu(null);
                          setRenameVal(name);
                          setRenaming(g.cwd);
                        }}
                      >
                        <Icon size={13}>
                          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
                        </Icon>
                        重命名
                      </button>
                      <button
                        role="menuitem"
                        class="danger"
                        title="删除该项目下的全部会话（不可恢复；工作区保留）"
                        onClick={() => {
                          if (clearArmed === g.cwd) {
                            clearProjectSessions(g.cwd, g.sessions.map((s) => s.sessionId));
                          } else {
                            setClearArmed(g.cwd);
                          }
                        }}
                      >
                        <Icon size={13}>
                          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </Icon>
                        {clearArmed === g.cwd ? `确认清空 ${g.sessions.length} 个会话？` : "清空该项目会话"}
                      </button>
                      <button
                        role="menuitem"
                        class="danger"
                        title="从侧栏移除此工作区及其会话的显示（不删除文件与会话历史）"
                        onClick={() => removeWorkspace(g.cwd)}
                      >
                        <Icon size={13}>
                          <path d="M18 6L6 18M6 6l12 12" />
                        </Icon>
                        移除工作区
                      </button>
                    </div>
                  )}
                </div>
                {open &&
                  g.sessions.map((s: SessionSummary) => {
                    const preview = s.preview.trim();
                    const time = s.updatedAt ? relTime(s.updatedAt) : "—";
                    return (
                      <div key={s.sessionId} class={"srow" + (s.sessionId === state.currentId ? " active" : "")}>
                        <button class="sopen" onClick={() => void openSession(s.sessionId)}>
                          <span class="l1">{preview || `空会话 ${s.sessionId.slice(0, 8)}`}</span>
                          <span class="l2">{preview ? `${time} · ${s.sessionId.slice(0, 8)}` : time}</span>
                        </button>
                        <button class="sdel" title="删除此会话（不可恢复）" aria-label="删除此会话" onClick={() => deleteSession(s.sessionId)}>
                          <Icon size={12}>
                            <path d="M18 6L6 18M6 6l12 12" />
                          </Icon>
                        </button>
                      </div>
                    );
                  })}
                {open && g.sessions.length === 0 && <div class="pempty">暂无会话，点击右侧 + 号开始</div>}
              </div>
            );
          })}
          {projMenu && <div class="pmenu-mask" onClick={() => setProjMenu(null)} />}
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
                <div class="dockleft">
                  <select
                    class="permsel"
                    title="权限模式：plan=只读调研，default=默认审批，yolo=全自动"
                    value={currentView?.permissionMode ?? permMode}
                    onChange={(e) => changePermMode((e.target as HTMLSelectElement).value)}
                  >
                    <option value="plan">计划模式</option>
                    <option value="default">默认审批</option>
                    <option value="yolo">全自动</option>
                  </select>
                  <span class="dockhint">
                    {pendingId ? "1 拒绝 · 2 允许 · 3 总是允许" : "Enter 发送 · Shift+Enter 换行"}
                  </span>
                </div>
                <div class="dockright">
                  {providersList.length > 0 && (
                    <div class="pillwrap">
                      <button
                        class={"pill" + (dockMenu === "prov" ? " on" : "")}
                        title="模型供应商（新会话生效）"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDockMenu(dockMenu === "prov" ? null : "prov");
                        }}
                      >
                        {providerDisplayName}
                        <span class="pillcaret">▾</span>
                      </button>
                      {dockMenu === "prov" && (
                        <div class="pillmenu" onClick={(e) => e.stopPropagation()}>
                          {providersList.map((p) => (
                            <div key={p.name}>
                              <button
                                class={"pillitem" + (p.name === providerDisplayName ? " on" : "")}
                                title={p.current ? "settings.json 当前默认供应商" : `切换到 ${p.name}（${p.modelCount} 个模型）`}
                                onClick={() => {
                                  if (keyNeededFor(p.name)) {
                                    setSelectedProvider(p.name);
                                    provRef.current = p.name;
                                    setProvKeyInput("");
                                  } else {
                                    void selectProvider(p.name);
                                    setDockMenu(null);
                                  }
                                }}
                              >
                                <span>{p.name}{p.current ? " ·默认" : ""}</span>
                                <span class="pilltag">{p.modelCount}</span>
                              </button>
                              {keyNeededFor(p.name) && selectedProvider === p.name && (
                                <div class="pkeyrow">
                                  <input
                                    class="pkey"
                                    placeholder="粘贴该供应商的 API Key"
                                    spellcheck={false}
                                    value={provKeyInput}
                                    onInput={(e) => setProvKeyInput((e.target as HTMLInputElement).value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") saveProvKey(p.name, provKeyInput);
                                    }}
                                  />
                                  <button class="pkeysave" onClick={() => saveProvKey(p.name, provKeyInput)}>
                                    保存
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {models.length > 0 && (
                    <div class="pillwrap">
                      <button
                        class={"pill" + (dockMenu === "model" ? " on" : "")}
                        title="选择模型"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDockMenu(dockMenu === "model" ? null : "model");
                        }}
                      >
                        {modelDisplayName}
                        <span class="pillcaret">▾</span>
                      </button>
                      {dockMenu === "model" && (
                        <div class="pillmenu" onClick={(e) => e.stopPropagation()}>
                          {models.map((m) => (
                            <button
                              key={m.id}
                              class={"pillitem" + (m.id === activeModelId ? " on" : "")}
                              onClick={() => {
                                setDockMenu(null);
                                applyRuntime({ model: m.id });
                              }}
                            >
                              {m.displayName}
                              {m.supportsReasoning && <span class="pilltag">思考</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {thinkingAvailable && (
                    <div class="pillwrap">
                      <button
                        class={"pill" + (dockMenu === "think" ? " on" : "")}
                        title="思考强度"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDockMenu(dockMenu === "think" ? null : "think");
                        }}
                      >
                        <span class="pillbrain">🧠</span>
                        {thinkLabel}
                        <span class="pillcaret">▾</span>
                      </button>
                      {dockMenu === "think" && (
                        <div class="pillmenu" onClick={(e) => e.stopPropagation()}>
                          {THINKING_LEVELS.map((lv) => (
                            <button
                              key={lv.value}
                              class={"pillitem" + (thinking === lv.value ? " on" : "")}
                              onClick={() => {
                                setDockMenu(null);
                                applyRuntime({ thinking: lv.value });
                              }}
                            >
                              {lv.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
            </div>
            {dockMenu && <div class="pmenu-mask" onClick={() => setDockMenu(null)} />}
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
