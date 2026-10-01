import { useCallback, useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import { client } from "./client.js";

// 目录选择弹层。F10 重构（plan-web 反馈）：
// - 面包屑导航（> 分隔，逐段可点）+ 左侧 ⬆ 返回上一级
// - 子目录行：单击高亮选中 / 双击进入下一级 / 行内「选择」钮直接选定
// - 底部：输入或粘贴绝对路径（自适应撑满）+「选择此文件夹」主按钮（取输入值 > 选中行 > 当前目录）
// - 原生选择器降级为底部文字链接：先关闭本弹层再调用系统对话框，避免双弹窗叠加

export interface DirPickResult {
  ok: boolean;
  error?: string;
}

export interface DirPickerProps {
  /** 创建会话（App 注入 createAt）；成功返回 {ok:true}（弹层关闭），失败返回错误文案内联显示 */
  onPick: (cwd: string) => Promise<DirPickResult>;
  onClose: () => void;
  /** F10：原生选择器在弹层已关闭后创建失败时，经此上报到全局通知 */
  onError?: (msg: string) => void;
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

export function DirPicker({ onPick, onClose, onError }: DirPickerProps): JSX.Element {
  const [cur, setCur] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // 原生对话框弹在 serve 所在机器：仅浏览器与 serve 同机（localhost）时提供入口
  const [nativeAvailable] = useState(() => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname));

  const browse = useCallback(async (p?: string) => {
    setErr("");
    setSelected(null);
    const r = await client.listDirs(p);
    if (r.status !== 200) {
      setErr(r.error ?? `浏览失败（${r.status}）`);
      return;
    }
    setCur(r.path);
    setParent(r.parent);
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
      // 成功 → 关闭弹层；失败 → 错误文案留在弹层内联
      if (result.ok) {
        onClose();
        return;
      }
      if (result.error) setErr(result.error);
    },
    [busy, onPick, onClose],
  );

  /** F10：主按钮/输入框 Enter——输入值 > 选中行 > 当前浏览目录 */
  const confirm = useCallback(() => {
    const target = manual.trim() || selected || cur;
    if (target) void tryCreate(target);
  }, [manual, selected, cur, tryCreate]);

  /** F10：原生选择器——先关闭本弹层再调用（消除双弹窗）；选完直接建会话，取消静默 */
  const nativePick = useCallback(async () => {
    onClose();
    const r = await client.pickDirNative();
    if (r.error) {
      onError?.(r.error);
      return;
    }
    if (r.canceled || !r.path) return;
    const result = await onPick(r.path);
    if (!result.ok && result.error) onError?.(result.error);
  }, [onClose, onPick, onError]);

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
        <div class="dp-nav">
          <button class="dp-up" title="返回上一级" aria-label="返回上一级" disabled={!parent} onClick={() => parent && void browse(parent)}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
          <div class="dp-crumb">
            {crumbs(cur).map((c, i) => (
              <span key={c.path} class="dp-crumbseg">
                {i > 0 && <span class="dp-sep">&gt;</span>}
                <button class={i === crumbs(cur).length - 1 ? "tail" : ""} onClick={() => void browse(c.path)}>
                  {c.label}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div class="dp-list">
          {dirs.length === 0 && <div class="dp-empty">（无子目录）</div>}
          {dirs.map((d) => (
            <div
              key={d.path}
              class={"dp-row" + (selected === d.path ? " sel" : "")}
              title={d.path}
              onClick={() => setSelected(d.path)}
              onDblClick={() => void browse(d.path)}
            >
              <FolderIcon />
              <span class="dp-rowname">{d.name}</span>
              <button
                class="dp-pick"
                title={`选择 ${d.name} 作为项目目录`}
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void tryCreate(d.path);
                }}
              >
                选择
              </button>
            </div>
          ))}
        </div>
        {err && (
          <div class="dp-err" role="alert">
            {err}
          </div>
        )}
        <div class="dp-foot">
          <input
            class="dp-input"
            placeholder="输入或粘贴绝对路径"
            spellcheck={false}
            value={manual}
            onInput={(e) => setManual((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
            }}
          />
          <button class="dp-go" title="选择此文件夹作为项目目录" disabled={busy} onClick={confirm}>
            选择此文件夹
          </button>
        </div>
        {nativeAvailable && (
          <div class="dp-nativelink">
            <button class="dp-nlink" onClick={() => void nativePick()}>
              浏览本地文件夹（系统原生）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
