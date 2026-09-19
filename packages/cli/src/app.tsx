import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import type { Checkpointer, LubanEvent, UsageTotals, ApprovalRequest } from "@luban/core";
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
  /** 回滚点：由入口层创建（非 git 目录自动降级） */
  checkpointer?: Checkpointer;
  /** 会话存储：/sessions 与 /resume 需要 */
  store?: StoreLike;
  /** /model 触发：入口层结束当前会话并以新模型重开 */
  onModelSwitch?: () => void;
  budgetUsd?: number;
  onExit?: () => void;
  /** 用量变化回调（入口层用于预算钩子） */
  onUsageChange?: (usage: UsageTotals) => void;
}

export interface StoreLike {
  list(): Promise<string[]>;
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
  checkpointer,
  store,
  onModelSwitch,
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
  const [activeSessionId, setActiveSessionId] = useState(sessionId);
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
        for await (const event of loopRef.current.run(input, activeSessionId)) {
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
    [activeSessionId, applyEvent],
  );

  const handleSubmit = useCallback(
    async (value: string) => {
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
      if (command.action === "checkpoints") {
        if (!checkpointer?.available) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: "当前目录不是 git 仓库，回滚点不可用" },
          ]);
          return;
        }
        const list = await checkpointer.list(activeSessionId);
        setItems((prev) => [
          ...prev,
          {
            kind: "assistant",
            text:
              list.length === 0
                ? "暂无回滚点（agent 每次写文件前会自动创建）"
                : `可用回滚点：\n${list.map((c) => `  #${c.n}  ${c.time}`).join("\n")}\n用 /rollback <编号> 恢复`,
          },
        ]);
        return;
      }
      if (command.action === "rollback") {
        if (!checkpointer?.available) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: "当前目录不是 git 仓库，回滚点不可用" },
          ]);
          return;
        }
        const result = await checkpointer.restore(activeSessionId, command.n);
        setItems((prev) => [
          ...prev,
          { kind: result.ok ? "assistant" : "error", text: result.message },
        ]);
        return;
      }
      if (command.action === "sessions") {
        if (!store) {
          setItems((prev) => [...prev, { kind: "error", text: "会话存储不可用" }]);
          return;
        }
        const ids = (await store.list()).slice(-20);
        setItems((prev) => [
          ...prev,
          {
            kind: "assistant",
            text:
              ids.length === 0
                ? "暂无历史会话"
                : `历史会话（最近 ${ids.length} 个）：\n${ids.map((id) => `  ${id}`).join("\n")}\n用 /resume <id> 恢复`,
          },
        ]);
        return;
      }
      if (command.action === "resume") {
        if (!store) {
          setItems((prev) => [...prev, { kind: "error", text: "会话存储不可用" }]);
          return;
        }
        const exists = (await store.list()).includes(command.id);
        if (!exists) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: `会话 "${command.id}" 不存在，用 /sessions 查看列表` },
          ]);
          return;
        }
        setActiveSessionId(command.id);
        setItems((prev) => [
          ...prev,
          { kind: "assistant", text: `已切换到会话 ${command.id}（历史上下文已加载）` },
        ]);
        return;
      }
      if (command.action === "model") {
        onModelSwitch?.();
        return;
      }
      void runTask(trimmed);
    },
    [activeSessionId, checkpointer, exit, onExit, onModelSwitch, runTask, store, usage],
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
