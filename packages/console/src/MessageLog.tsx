import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import type { RenderItem, SessionView } from "./state.js";

/**
 * 重设计 v3 消息流：身份=对齐+底色（用户右对齐气泡 / 助手通栏），
 * 工具卡=一档底色差+限高输出（头行点击展开），审批卡=chip 标头+浅底按钮行。
 * 图标一律内联 SVG（16px / stroke 1.5）；✓✕▍ 为白名单字形。
 */

/** 相对时间；server 暂无 updatedAt（client.ts SessionSummary），调用侧以 undefined 归「—」 */
export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 消息 meta：角色 + 相对时间（首次渲染记到达时刻；回放历史无到达时刻，仅显示角色） */
function msgMeta(times: Map<number, number>, key: number, role: string, replay: boolean): JSX.Element {
  if (!replay) {
    if (!times.has(key)) times.set(key, Date.now());
    return <div class="meta">{`${role} · ${relTime(times.get(key)!)}`}</div>;
  }
  return <div class="meta">{role}</div>;
}

/** 内联 SVG 图标：24 viewBox 等比，默认 16px */
export function Icon({ children, size = 16 }: { children: ComponentChildren; size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function DiffBlock({ diff }: { diff: string }): JSX.Element {
  const rows = diff.split("\n");
  return (
    <pre class="diff">
      {rows.map((line, i) => {
        const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
        return (
          <span key={i} class={cls}>
            {line + "\n"}
          </span>
        );
      })}
    </pre>
  );
}

function ToolItem({ item }: { item: RenderItem }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pending = item.status === "pending";
  const rows: [string, string][] = [];
  if (item.args && typeof item.args === "object") {
    for (const [k, v] of Object.entries(item.args as Record<string, unknown>)) {
      rows.push([k, typeof v === "string" ? v : JSON.stringify(v)]);
    }
  }
  const copy = () => {
    if (item.output === undefined) return;
    try {
      if (navigator.clipboard) void navigator.clipboard.writeText(item.output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 剪贴板不可用忽略 */
    }
  };
  return (
    <div class={"card" + (open ? " open" : "")}>
      <button class="chead" disabled={pending} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span class={"cdot" + (pending ? " run" : "")} />
        <span class="ctool">{item.name ?? "tool"}</span>
        <span class="cdesc">{item.text}</span>
      </button>
      {!pending && item.output !== undefined && (
        <button class={"ccopy" + (copied ? " ok" : "")} title="复制输出" aria-label="复制输出" onClick={copy}>
          <Icon>
            {copied ? (
              <path d="M20 6L9 17l-5-5" />
            ) : (
              <>
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </>
            )}
          </Icon>
        </button>
      )}
      <div class="cbody">
        <div class="cinner">
          {rows.length > 0 && (
            <div class="params">
              {rows.map(([k, v]) => (
                <div class="prow" key={k}>
                  <span class="k">{k}</span>
                  <span class="v">{v}</span>
                </div>
              ))}
            </div>
          )}
          {!pending && item.output !== undefined && (
            <div class="cout">
              <div class="lnos" aria-hidden="true">
                {item.output.split("\n").map((_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              <pre>{item.output}</pre>
            </div>
          )}
        </div>
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
  const granted = item.status === "granted";
  const answered = granted || item.status === "denied";
  const adds = item.diff ? item.diff.split("\n").filter((l) => l.startsWith("+")).length : 0;
  const dels = item.diff ? item.diff.split("\n").filter((l) => l.startsWith("-")).length : 0;
  return (
    <div class={"approve" + (answered ? " answered" : "")}>
      <div class="ahead">
        <span class="achip">{answered ? (granted ? "已允许" : "已拒绝") : "待审批"}</span>
        {item.output && (
          <span class="areason" title={item.output}>
            {item.output}
          </span>
        )}
        {item.diff && <span class="astat">{`${adds} 增 ${dels} 删`}</span>}
        {item.id && <span class="aid">{item.id.slice(0, 8)}</span>}
      </div>
      {item.diff && <DiffBlock diff={item.diff} />}
      {answered ? (
        <div class="abtns">
          <span class="astate">{granted ? "✓ 已允许 · 回执已发送" : "✕ 已拒绝"}</span>
        </div>
      ) : (
        <div class="abtns">
          <button class="abtn primary" disabled={disabled} onClick={() => onAnswer(item.id ?? "", true, true)}>
            总是允许<kbd>3</kbd>
          </button>
          <button class="abtn secondary" disabled={disabled} onClick={() => onAnswer(item.id ?? "", true, false)}>
            允许<kbd>2</kbd>
          </button>
          <button class="abtn ghost" disabled={disabled} onClick={() => onAnswer(item.id ?? "", false, false)}>
            拒绝<kbd>1</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

export function MessageList({
  view,
  onAnswer,
  onReplay,
}: {
  view: SessionView;
  onAnswer: (requestId: string, granted: boolean, remembered: boolean) => void;
  onReplay?: () => void;
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(-1);
  const timesRef = useRef(new Map<number, number>());
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
    // 首帧/会话切换强制置底；其后贴底跟随（阈值 120px），上翻读历史不拽
    if (lastCount.current === -1 || distance < 120) box.scrollTo({ top: box.scrollHeight });
    lastCount.current = view.items.length;
  }, [view.items.length, view.streaming]);

  return (
    <div class="flow" ref={boxRef}>
      <div class="col">
        {view.replay && (
          <div class="badgerow">
            <span class="rbadge">只读回放 · 服务器重启后的归档</span>
            {onReplay && (
              <button class="rewbtn" onClick={onReplay} title="重新加载归档">
                <Icon>
                  <path d="M1 4v6h6" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </Icon>
                重新回放
              </button>
            )}
          </div>
        )}
        {view.items.length === 0 && view.streaming === null && <div class="emptyline">此会话还没有消息</div>}
        {view.items.map((item, idx) => {
          if (item.kind === "user")
            return (
              <section class="msg usr" key={idx}>
                <div class="meta">你</div>
                <div class="bubble">{item.text}</div>
              </section>
            );
          if (item.kind === "assistant")
            return (
              <section class="msg agt" key={idx}>
                <div class="meta">墨斗</div>
                <div class="bd">{item.text}</div>
              </section>
            );
          if (item.kind === "error")
            return (
              <section class="msg err" key={idx}>
                <div class="ebd">
                  <span class="etag">错误</span>
                  {item.text}
                </div>
              </section>
            );
          if (item.kind === "tool") return <ToolItem item={item} key={idx} />;
          if (item.kind === "approval")
            return <ApprovalItem item={item} disabled={view.replay} onAnswer={onAnswer} key={idx} />;
          return null;
        })}
        {view.streaming !== null && (
          <section class="msg agt">
            <div class="meta">墨斗</div>
            <div class="bd">
              {view.streaming}
              <span class="cursor" aria-hidden="true">
                ▍
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
