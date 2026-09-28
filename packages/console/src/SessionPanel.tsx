import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { SessionSummary } from "./client.js";

/**
 * plan-web 重设计 §2.2/§3：会话选择下拉面板。
 * 两行制（预览 + 相对时间 · id 前 8 位）、进行中/历史分组、输入过滤、↑↓/Enter/Esc 键盘导航。
 * 裸 id 回退规则见 DESIGN.md §3.3；时间位待 server 增 updatedAt（当前恒显示「—」）。
 */

const TRIGGER_PREVIEW_MAX = 24;

/** 相对时间：server 暂无 updatedAt，恒返回「—」（增字段后按 DESIGN.md §3.3 切换） */
function relativeTime(_updatedAt?: number): string {
  return "—";
}

function rowLines(session: SessionSummary): { line1: string; line2: string } {
  const preview = session.preview.trim();
  if (preview) {
    return { line1: preview, line2: `${relativeTime(session.updatedAt)} · ${session.sessionId.slice(0, 8)}` };
  }
  // 空会话：id 前缀升为第一行主体（裸 id 永不与预览混排）
  return { line1: `空会话 ${session.sessionId.slice(0, 8)}`, line2: relativeTime(session.updatedAt) };
}

export interface SessionPanelProps {
  sessions: SessionSummary[];
  currentId: string | null;
  onOpen: (sessionId: string) => void;
  onClose: () => void;
  /** 关闭活跃会话（DELETE；仅注册表内会话可关） */
  onCloseSession?: (sessionId: string) => void;
}

export function SessionPanel({ sessions, currentId, onOpen, onClose, onCloseSession }: SessionPanelProps): JSX.Element {
  const [filter, setFilter] = useState("");
  const [kbdIndex, setKbdIndex] = useState(0);
  const filterRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 过滤：preview 与 id 前缀双匹配
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => s.preview.toLowerCase().includes(q) || s.sessionId.toLowerCase().includes(q),
    );
  }, [sessions, filter]);

  const active = filtered.filter((s) => s.active);
  const history = filtered.filter((s) => !s.active);
  const flat = [...active, ...history];

  // 键盘：↑↓ 移动 / Enter 打开 / Esc 关闭；聚焦过滤框消费按键
  useEffect(() => {
    filterRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.target === filterRef.current) {
        return; // 输入中：↑↓ 交给光标
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setKbdIndex((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setKbdIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = flat[kbdIndex];
        if (target) onOpen(target.sessionId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, kbdIndex, onOpen, onClose]);

  // 点击外部关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const renderRow = (session: SessionSummary) => {
    const { line1, line2 } = rowLines(session);
    const index = flat.indexOf(session);
    const kbdActive = index === kbdIndex;
    const classes = ["row"];
    if (session.sessionId === currentId) classes.push("current");
    if (kbdActive) classes.push("kbd-active");
    return (
      <div
        key={session.sessionId}
        class={classes.join(" ")}
        role="button"
        tabIndex={-1}
        onClick={() => onOpen(session.sessionId)}
        onMouseEnter={() => setKbdIndex(index)}
      >
        <span class="line1">
          <span class="preview">{line1}</span>
          {session.active && <span class="dot" />}
        </span>
        <span class="line2">{line2}</span>
        {onCloseSession && (
          <button
            class="row-close"
            title={session.active ? "关闭此会话（释放配额）" : "删除此历史会话（不可恢复）"}
            onClick={(e) => {
              e.stopPropagation();
              onCloseSession(session.sessionId);
            }}
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  return (
    <div class="panel" ref={panelRef}>
      <input
        ref={filterRef}
        class="filter"
        placeholder="筛选会话…"
        value={filter}
        onInput={(e) => {
          setFilter((e.target as HTMLInputElement).value);
          setKbdIndex(0);
        }}
      />
      <div class="list">
        {flat.length === 0 && <div class="empty">没有匹配的会话</div>}
        {active.length > 0 && <div class="group-label">进行中</div>}
        {active.map(renderRow)}
        {history.length > 0 && <div class="group-label">历史</div>}
        {history.map(renderRow)}
      </div>
      <div class="kbd-bar">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
    </div>
  );
}

/** 顶栏触发器的文案：当前会话预览截 24 字，无会话显示占位 */
export function triggerLabel(currentPreview: string | null, fallbackId: string | null): string {
  const text = currentPreview?.trim() ?? "";
  if (text) return text.length > TRIGGER_PREVIEW_MAX ? text.slice(0, TRIGGER_PREVIEW_MAX) + "…" : text;
  if (fallbackId) return fallbackId.slice(0, 8);
  return "选择会话…";
}
