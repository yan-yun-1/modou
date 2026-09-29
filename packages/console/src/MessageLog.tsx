import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { fadeUp } from "./motion.js";
import type { RenderItem, SessionView } from "./state.js";


function copyRef(viewId: string, ann: string): void {
  const ref = `${viewId.slice(0, 8).toUpperCase()} · ${ann}`;
  try {
    if (navigator.clipboard) void navigator.clipboard.writeText(ref);
  } catch { /* 剪贴板不可用忽略 */ }
}

export function DiffBlock({ diff }: { diff: string }): JSX.Element {
  const rows = diff.split("\n");
  return (
    <pre class="diff">
      {rows.map((line, i) => {
        const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
        return cls === "ctx" ? (
          <span key={i} class="ctx">{line + "\n"}</span>
        ) : (
          <span key={i} class={cls}>{line + "\n"}</span>
        );
      })}
    </pre>
  );
}

export function ToolItem({ item, ann }: { item: RenderItem; ann: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const pending = item.status === "pending";
  const rows: [string, string][] = [];
  if (item.args && typeof item.args === "object") {
    for (const [k, v] of Object.entries(item.args as Record<string, unknown>)) {
      rows.push([k, typeof v === "string" ? v : JSON.stringify(v)]);
    }
  }
  return (
    <div class="card dbl">
      <header>
        <span class="num">{ann}</span>
        <span class="tool">{item.name ?? "tool"}</span>
        <span class="desc">{pending ? "执行中" : "已执行"}</span>
        <span class={"stamp" + (pending ? " run" : " ok")}>{pending ? "RUN" : "验讫"}</span>
      </header>
      <div class="params">
        {rows.map(([k, v]) => (
          <div class="prow" key={k}>
            <span class="k">{k}</span>
            <span class="v">{v}</span>
          </div>
        ))}
      </div>
      {!pending && item.output !== undefined && (
        <div class="codewrap">
          <div class="lnos" aria-hidden="true">
            {item.output.split("\n").map((_, i) => (
              <span key={i}>
                {String(i + 1).padStart(2, "0")}
                <br />
              </span>
            ))}
          </div>
          <pre class="code">{item.output}</pre>
        </div>
      )}
      {!pending && (
        <button
          class="ann"
          style="margin:0 18px 14px"
          onClick={() => {
            copyRef(item.id ?? ann, ann);
            setCopied(true);
            setTimeout(() => setCopied(false), 900);
          }}
        >
          {copied ? "COPIED" : "COPY OUTPUT"}
        </button>
      )}
    </div>
  );
}

export function ApprovalItem({
  item,
  disabled,
  onAnswer,
}: {
  item: RenderItem;
  disabled: boolean;
  onAnswer: (requestId: string, granted: boolean, remembered: boolean) => void;
}): JSX.Element {
  const [sealed, setSealed] = useState<null | { txt: string; red: boolean }>(null);
  const status = item.status === "granted" ? "granted" : item.status === "denied" ? "denied" : null;
  const answered = status !== null || sealed !== null;
  const redDenied = status === "denied" || sealed?.red === true;

  const answer = (granted: boolean, remembered: boolean, label: string) => {
    setSealed({ txt: label, red: !granted });
    onAnswer(item.id ?? "", granted, remembered);
  };

  return (
    <div class={"approve" + (answered ? " voided" : "")}>
      <header>
        <b>签章处</b>
        <span class="en">APPROVAL</span>
        <span class="chg">{item.id?.slice(0, 12)}</span>
        {status === "denied" && <span class="void">驳 回</span>}
      </header>
      <div class="params">
        {item.output && (
          <div class="prow">
            <span class="k">事由</span>
            <span class="v" style="font-family:var(--f-zh)">{item.output}</span>
          </div>
        )}
        {item.diff && (
          <div class="prow">
            <span class="k">行数增减</span>
            <span class="v num">
              {item.diff.split("\n").filter((l) => l.startsWith("+")).length} 增 /{" "}
              {item.diff.split("\n").filter((l) => l.startsWith("-")).length} 删
            </span>
          </div>
        )}
      </div>
      {item.diff && <DiffBlock diff={item.diff} />}
      {answered ? (
        <div class="seals">
          <span class="hint">{status === "granted" ? "✓ 已签章 · 回执已发送 · 图纸已铺晒" : "✕ 已驳回 · 变更单作废"}</span>
        </div>
      ) : (
        <div class="seals">
          <button class="sealbtn" disabled={disabled} onClick={() => answer(true, true, "已签章")}>
            批准全部
          </button>
          <button class="sealbtn dbl2" disabled={disabled} onClick={() => answer(true, false, "已签章")}>
            批准
          </button>
          <button class="sealbtn reject" disabled={disabled} onClick={() => answer(false, false, "驳回")}>
            驳回
          </button>
          <span class="hint">三选一 · 批准后自动铺晒归档</span>
        </div>
      )}
      {sealed && <span class={"stamped" + (sealed.red ? " red" : "")}>{sealed.txt}</span>}
    </div>
  );
}

export function MessageList({
  view,
  sessionId,
  onAnswer,
}: {
  view: SessionView;
  sessionId: string;
  onAnswer: (requestId: string, granted: boolean, remembered: boolean) => void;
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const itemCount = view.items.length + (view.streaming?.length ?? 0);
  const lastCount = useRef(view.items.length);
  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
    if (view.items.length !== lastCount.current) {
      lastCount.current = view.items.length;
      const last = boxRef.current?.lastElementChild;
      if (last) fadeUp(last);
    }
  }, [itemCount, view.items.length]);

  return (
    <div class="flow" ref={boxRef}>
      {view.replay && <div class="replay-badge">⟲ 只读回放 · SERVER 重启后的归档图纸</div>}
      {view.items.map((item, idx) => {
        const ann = `A-${String(idx + 1).padStart(2, "0")}`;
        if (item.kind === "user")
          return (
            <section class="msg usr" key={idx}>
              <div class="gut"><span class="ann">{ann}</span></div>
              <div class="rule" />
              <div class="bd">
                <div class="uframe">
                  <span class="tag">USR</span>
                  <p>{item.text}</p>
                </div>
              </div>
            </section>
          );
        if (item.kind === "assistant")
          return (
            <section class="msg agt" key={idx}>
              <div class="gut"><span class="ann">{ann}</span></div>
              <div class="rule" />
              <div class="bd"><p>{item.text}</p></div>
            </section>
          );
        if (item.kind === "error")
          return (
            <section class="msg error" key={idx}>
              <div class="gut"><span class="ann">{ann}</span></div>
              <div class="rule" />
              <div class="bd"><p>{item.text}</p></div>
            </section>
          );
        if (item.kind === "tool") return <ToolItem item={item} ann={ann} />;
        if (item.kind === "approval")
          return (
            <section class="msg agt" key={idx}>
              <div class="gut"><span class="ann">{ann}</span></div>
              <div class="rule" />
              <div class="bd">
                <ApprovalItem item={item} disabled={view.replay} onAnswer={onAnswer} />
              </div>
            </section>
          );
        return null;
      })}
      {view.streaming !== null && (
        <section class="msg agt streaming">
          <div class="gut"><span class="ann">{`A-${String(view.items.length + 1).padStart(2, "0")}`}</span></div>
          <div class="rule" />
          <div class="bd"><p>{view.streaming}</p></div>
        </section>
      )}
    </div>
  );
}
