import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { terminalStyle } from "../terminal-capability.js";

const FRAME_MS = 120;

export interface BusyLineProps {
  /** 最近一次工具调用摘要；无（纯文本轮）传 undefined → 显示"思考中…" */
  action?: string;
  /** busy 起始时间戳（Date.now()） */
  startedAt: number;
  /** 已完成工具调用步数 */
  steps: number;
  /** 测试注入口：覆盖显示耗时（秒），不传则按 startedAt 实时计算 */
  elapsedSeconds?: number;
}

/** 忙碌行：`✻ 摘要… (esc 中断 · 12.3s · 第 n 步)`——agent 干活时的常驻状态行 */
export function BusyLine({ action, startedAt, steps, elapsedSeconds }: BusyLineProps) {
  const FRAMES = terminalStyle().glyphs.spinner;
  const [frame, setFrame] = useState(0);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const spinner = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, FRAME_MS);
    // 计时刷新 1s 粒度足够（显示 0.1s 精度用插值——渲染 tick 1s 节流）
    const ticker = setInterval(() => {
      forceTick((n) => n + 1);
    }, 100);
    return () => {
      clearInterval(spinner);
      clearInterval(ticker);
    };
  }, []);

  const seconds = elapsedSeconds ?? Math.max(0, (Date.now() - startedAt) / 1000);
  const secondsLabel = seconds.toFixed(1);
  const stepLabel = steps > 0 ? ` · 第 ${steps} 步` : "";

  return (
    <Box>
      <Text color="magenta">{FRAMES[frame]}</Text>
      <Text> {action ?? "思考中…"}</Text>
      <Text color={terminalStyle().style.dim}>
        {" (esc 中断 · "}
        {secondsLabel}s{stepLabel}
        {")"}
      </Text>
    </Box>
  );
}
