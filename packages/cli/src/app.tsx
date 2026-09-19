import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import type { LubanEvent, UsageTotals, ApprovalRequest } from "@luban/core";
import { ApprovalBridge } from "./approval-bridge.js";
import { parseCommand } from "./commands.js";
import { CostBar } from "./components/CostBar.js";
import { InputBox } from "./components/InputBox.js";
import { ApprovalPrompt } from "./components/ApprovalPrompt.js";
import { MessageList, type DisplayItem } from "./components/MessageList.js";

export interface LoopLike {
  run(input: string, sessionId: string): AsyncIterable<LubanEvent>;
}

export interface LubanAppProps {
  loop: LoopLike;
  sessionId: string;
  /** 审批桥：由入口层创建并接到 AgentLoop 的 approve 上 */
  approvals?: ApprovalBridge;
  budgetUsd?: number;
  onExit?: () => void;
  /** 用量变化回调（入口层用于预算钩子） */
  onUsageChange?: (usage: UsageTotals) => void;
}

const ZERO_USAGE: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

function summarizeArgs(args: unknown): string {
  const raw = JSON.stringify(args) ?? "";
  return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
}

function summarizeOutput(output: string): string {
  return output.length > 120 ? `${output.slice(0, 120)}…` : output;
}

export function LubanApp({
  loop,
  sessionId,
  approvals,
  budgetUsd,
  onExit,
  onUsageChange,
}: LubanAppProps) {
  const { exit } = useApp();
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageTotals>(ZERO_USAGE);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const loopRef = useRef(loop);
  const running = useRef(false);
  const onUsageChangeRef = useRef(onUsageChange);
  onUsageChangeRef.current = onUsageChange;

  // 审批桥订阅：桥上有待审批请求时展示审批 UI
  useEffect(() => {
    if (!approvals) {
      return;
    }
    const unsubscribe = approvals.subscribe((req) => setPendingApproval(req));
    return () => {
      unsubscribe();
    };
  }, [approvals]);

  const applyEvent = useCallback((event: LubanEvent) => {
    switch (event.type) {
      case "user_message":
        setItems((prev) => [...prev, { kind: "user", text: event.text }]);
        break;
      case "text_delta":
        setStreaming((prev) => prev + event.delta);
        break;
      case "assistant_message":
        setStreaming("");
        setItems((prev) => [...prev, { kind: "assistant", text: event.text }]);
        break;
      case "tool_call":
        setItems((prev) => [
          ...prev,
          { kind: "tool", text: `${event.name} ${summarizeArgs(event.args)}` },
        ]);
        break;
      case "tool_result":
        setItems((prev) => [...prev, { kind: "tool", text: `↳ ${summarizeOutput(event.output)}` }]);
        break;
      case "approval_request":
        setItems((prev) => [...prev, { kind: "approval", text: event.reason }]);
        break;
      case "approval_result":
        setItems((prev) => [
          ...prev,
          { kind: "approval", text: event.granted ? "已批准" : "已拒绝" },
        ]);
        break;
      case "usage":
        setUsage((prev) => {
          const next = {
            inputTokens: prev.inputTokens + event.inputTokens,
            outputTokens: prev.outputTokens + event.outputTokens,
            cacheReadTokens: prev.cacheReadTokens + event.cacheReadTokens,
            cacheWriteTokens: prev.cacheWriteTokens + event.cacheWriteTokens,
            costUsd: prev.costUsd + event.costUsd,
          };
          onUsageChangeRef.current?.(next);
          return next;
        });
        break;
      case "error":
        setItems((prev) => [...prev, { kind: "error", text: event.message }]);
        break;
      default:
        break;
    }
  }, []);

  const runTask = useCallback(
    async (input: string) => {
      if (running.current) {
        return;
      }
      running.current = true;
      setBusy(true);
      try {
        for await (const event of loopRef.current.run(input, sessionId)) {
          applyEvent(event);
        }
      } catch (error) {
        setItems((prev) => [
          ...prev,
          { kind: "error", text: `会话异常：${(error as Error).message}` },
        ]);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [applyEvent, sessionId],
  );

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      const command = parseCommand(trimmed, usage);
      if (command.action === "exit") {
        onExit?.();
        exit();
        return;
      }
      if (command.action === "message") {
        setItems((prev) => [...prev, { kind: "assistant", text: command.text }]);
        return;
      }
      void runTask(trimmed);
    },
    [exit, onExit, runTask, usage],
  );

  return (
    <Box flexDirection="column" gap={1}>
      <MessageList items={items} />
      {streaming ? <Text>{streaming}</Text> : null}
      {pendingApproval ? (
        <ApprovalPrompt
          request={pendingApproval}
          onAnswer={(answer) => approvals?.answer(answer)}
        />
      ) : null}
      <CostBar usage={usage} budgetUsd={budgetUsd} />
      <InputBox busy={busy} onSubmit={handleSubmit} />
    </Box>
  );
}
