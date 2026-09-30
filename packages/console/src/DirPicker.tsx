import { useCallback, useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import { client } from "./client.js";

// Phase F3（plan-web）：目录选择弹层——最近目录单击即建（快路径）/
// 面包屑浏览器两步确认 / 手动路径 Enter 即建；400/403 内联回显；Esc/遮罩关闭。

export interface DirPickResult {
  ok: boolean;
  error?: string;
}

export interface DirPickerProps {
  /** 创建会话（App 注入 createAt）；成功返回 {ok:true}（App 关闭弹层），失败返回错误文案内联显示 */
  onPick: (cwd: string) => Promise<DirPickResult>;
  onClose: () => void;
}

interface DirEntry {
  name: string;
  path: string;
}

function splitSegs(p: string): { win: boolean; segs: string[] } {
  const win = /^[A-Za-z]:/.test(p);
  return { win, segs: p.split(/[\\/]+/).filter(Boolean) };
}

/** 面包屑分段：路径逐级累积（Windows "C:\" 起步，POSIX "/" 起步） */
function crumbs(p: string | null): { label: string; path: string }[] {
  if (!p) return [];
  const { win, segs } = splitSegs(p);
  const sep = win ? "\\" : "/";
  const head = win ? segs[0] + sep : sep;
  const out = [{ label: head, path: head }];
  let acc = head;
  for (const seg of segs.slice(win ? 1 : 0)) {
    acc = acc.endsWith(sep) ? acc + seg : acc + sep + seg;
    out.push({ label: seg, path: acc });
  }
  return out;
}

/** chips 用短路径：末段 + 省略号前缀（空态目录 chip 复用） */
export function shortPath(p: string): string {
  const { win, segs } = splitSegs(p);
  const sep = win ? "\\" : "/";
  return segs.length > 1 ? `…${sep}${segs[segs.length - 1]}` : p;
}

function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function DirPicker({ onPick, onClose }: DirPickerProps): JSX.Element {
  const [cur, setCur] = useState<string | null>(null);
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickBusy, setPickBusy] = useState(false);
  // 原生对话框弹在 serve 所在机器：仅浏览器与 serve 同机（localhost）时提供入口
  const [nativeAvailable] = useState(() => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname));

  const browse = useCallback(async (p?: string) => {
    setErr("");
    const r = await client.listDirs(p);
    if (r.status !== 200) {
      setErr(r.error ?? `浏览失败（${r.status}）`);
      return;
    }
    setCur(r.path);
    setDirs(r.dirs);
  }, []);

  useEffect(() => {
    void (async () => {
      const { serveCwd, recents: rs } = await client.getCwdRecents();
      setRecents(rs);
      await browse(rs[0] ?? serveCwd ?? undefined);
    })();
  }, [browse]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tryCreate = useCallback(
    async (p: string) => {
      if (busy || !p.trim()) return;
      setErr("");
      setBusy(true);
      const result = await onPick(p.trim());
      setBusy(false);
      // 成功 → App 已切到新会话，关闭弹层；失败 → 错误文案留在弹层内联
      if (result.ok) {
        onClose();
        return;
      }
      if (result.error) setErr(result.error);
    },
    [busy, onPick, onClose],
  );

  /** Phase F6：系统目录选择对话框——serve 弹原生框，选中即建会话；取消静默返回 */
  const nativePick = useCallback(async () => {
    if (pickBusy) return;
    setErr("");
    setPickBusy(true);
    const r = await client.pickDirNative();
    setPickBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    if (r.canceled || !r.path) return;
    await tryCreate(r.path);
  }, [pickBusy, tryCreate]);

  return (
    <div
      class="dp-mask"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div class="dp" role="dialog" aria-modal="true" aria-label="选择项目目录" onClick={(e) => e.stopPropagation()}>
        <div class="dp-head">
          <span class="dp-title">选择项目目录</span>
          <button class="dp-x" title="关闭（Esc）" onClick={onClose}>
            ✕
          </button>
        </div>
        {recents.length > 0 && (
          <div class="dp-recents">
            <span class="dp-lab">最近</span>
            {recents.map((r) => (
              <button key={r} class="dp-chip" title={r} onClick={() => void tryCreate(r)}>
                {shortPath(r)}
              </button>
            ))}
          </div>
        )}
        <div class="dp-crumb">
          {crumbs(cur).map((c, i) => (
            <button key={c.path} class={"dp-crumbseg" + (i === crumbs(cur).length - 1 ? " tail" : "")} onClick={() => void browse(c.path)}>
              {c.label}
            </button>
          ))}
        </div>
        <div class="dp-list">
          {dirs.length === 0 && <div class="dp-empty">（无子目录）</div>}
          {dirs.map((d) => (
            <button key={d.path} class="dp-row" onClick={() => void browse(d.path)}>
              <FolderIcon />
              <span class="dp-rowname">{d.name}</span>
            </button>
          ))}
        </div>
        {err && (
          <div class="dp-err" role="alert">
            {err}
          </div>
        )}
        <div class="dp-foot">
          {nativeAvailable && (
            <button class="dp-native" title="弹出系统目录选择对话框（serve 与浏览器同机时可用）" disabled={pickBusy || busy} onClick={() => void nativePick()}>
              {pickBusy ? "等待对话框…" : "系统对话框"}
            </button>
          )}
          <input
            class="dp-input"
            placeholder="或输入绝对路径，Enter 确认"
            spellcheck={false}
            value={manual}
            onInput={(e) => setManual((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manual.trim()) void tryCreate(manual.trim());
            }}
          />
          <button class="dp-go" disabled={busy || !cur} onClick={() => cur && void tryCreate(cur)}>
            在此新建
          </button>
        </div>
      </div>
    </div>
  );
}
