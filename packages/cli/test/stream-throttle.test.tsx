import { useCallback, useEffect, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { Text } from "ink";
import { renderInk, settle } from "./ink-test-utils.js";

/** 可编程的节流组件复刻：与 app.tsx 同构的 ref 缓冲 + 60ms flush 逻辑 */
function ThrottleProbe({ deltas }: { deltas: string[] }) {
  const [rendered, setRendered] = useState("");
  const buffer = useRef("");
  const renderCount = useRef(0);

  const flush = useCallback(() => {
    if (buffer.current !== "") {
      const b = buffer.current;
      buffer.current = "";
      renderCount.current += 1;
      setRendered((prev) => prev + b);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(flush, 60);
    return () => clearInterval(id);
  }, [flush]);

  // 模拟 delta 到达（一次性全部写入缓冲，不触发 setState）
  useEffect(() => {
    for (const d of deltas) {
      buffer.current += d;
    }
  }, [deltas]);

  return (
    <Text>
      renders:{renderCount.current}|{rendered}
    </Text>
  );
}

describe("streaming throttle（T6）", () => {
  it("coalesces many deltas into few renders (60ms window)", async () => {
    const deltas = Array.from({ length: 100 }, (_, i) => `t${i}`);
    const harness = renderInk(<ThrottleProbe deltas={deltas} />);
    // 100 个 delta 落缓冲后，200ms 内最多 flush 4 次（60ms 窗口）
    await new Promise((r) => setTimeout(r, 200));
    await settle();
    const frame = harness.frame;
    const renders = Number(/renders:(\d+)/.exec(frame)?.[1] ?? "99");
    expect(renders).toBeLessThanOrEqual(4);
    // 内容不丢：全部 delta 最终都渲染出来
    expect(frame).toContain("t0");
    expect(frame).toContain("t99");
    harness.unmount();
  }, 10_000);
});
