import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import {
  buildPlanTaskPrompt,
  PermissionEngine,
  type ApprovalRequest,
  type Checkpointer,
  type ModouEvent,
  type UsageTotals,
} from "@modou-dev/core";
import { ApprovalBridge } from "./approval-bridge.js";
import type { McpStatus } from "./loop-factory.js";
import { parseCommand } from "./commands.js";
import { initAgentsMd } from "./init.js";
import { loadSkills, VERSION } from "@modou-dev/core";
import { terminalStyle } from "./terminal-capability.js";
import { StatusBar } from "./components/StatusBar.js";
import { BusyLine } from "./components/BusyLine.js";
import { InputBox } from "./components/InputBox.js";
import { ApprovalPrompt } from "./components/ApprovalPrompt.js";
import { PlanConfirm } from "./components/PlanConfirm.js";
import { MessageItem, type DisplayItem } from "./components/MessageList.js";

export interface LoopLike {
  run(
    input: string,
    sessionId: string,
    options?: { permissions?: PermissionEngine; signal?: AbortSignal },
  ): AsyncIterable<ModouEvent>;
}

export interface ModouAppProps {
  /** 装配完成前为 null（T10）：欢迎行立即可见，提交被拦截 */
  loop: LoopLike | null;
  sessionId: string;
  /** T10：装配 promise——loop 为 null 时 App 内部等待并在完成时切换自身状态 */
  /** 交互模式：TUI 顶部渲染 ASCII Logo（Ink 管理重绘坐标，conhost 不再错位） */
  showLogo?: boolean;
  onAssemble?: Promise<{
    loop: LoopLike;
    sessionId: string;
    store: StoreLike;
    mcpStatus: McpStatus[];
    checkpointer?: Checkpointer;
    contextWindow: number;
    updateSpent: (costUsd: number) => void;
  }>;
  /** 审批桥：由入口层创建并接到 AgentLoop 的 approve 上 */
  approvals?: ApprovalBridge;
  /** 回滚点：由入口层创建（非 git 目录自动降级） */
  checkpointer?: Checkpointer;
  /** 会话存储：/sessions 与 /resume 需要 */
  store?: StoreLike | null;
  /** MCP servers 连接状态（入口层经工厂返回） */
  mcpStatus?: McpStatus[];
  /** /model 触发：入口层结束当前会话并以新模型重开 */
  onModelSwitch?: () => void;
  budgetUsd?: number;
  /** 状态栏展示：模型 ID 与权限模式 */
  modelId?: string;
  permissionMode?: string;
  /** 模型上下文窗口（token 数，ctx% 用） */
  contextWindow?: number;
  /** 工作目录（/init 生成 AGENTS.md 用；默认 process.cwd()） */
  cwd?: string;
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

/** Ink 版 Logo：作为 TUI 首帧内容由 Ink 管理重绘（避免 stderr 预打印导致 conhost 光标错位） */
function LogoBlock() {
  const lines: { text: string; color: string }[] = [
    { text: "  ███╗   ███╗ ██████╗", color: "blueBright" },
    { text: "  ████╗ ████║██╔═══██╗", color: "blueBright" },
    { text: "  ██╔████╔██║██║   ██║", color: "blueBright" },
    { text: "  ██║╚██╔╝██║██║   ██║", color: "blueBright" },
    { text: "  ██║ ╚═╝ ██║╚██████╔╝", color: "blueBright" },
    { text: "  ╚═╝     ╚═╝ ╚═════╝", color: "blueBright" },
    { text: "  ──────────────────────────────── 墨斗 · MODOU", color: "yellowBright" },
  ];
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i} color={line.color}>
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

function summarizeArgs(args: unknown): string {
  const raw = JSON.stringify(args) ?? "";
  return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
}

function summarizeOutput(output: string): string {
  return output.length > 120 ? `${output.slice(0, 120)}…` : output;
}

export function ModouApp({
  loop,
  sessionId,
  approvals,
  checkpointer,
  store,
  mcpStatus,
  onModelSwitch,
  budgetUsd,
  modelId = "…",
  permissionMode = "default",
  contextWindow,
  onAssemble,
  showLogo = false,
  cwd = process.cwd(),
  onExit,
  onUsageChange,
}: ModouAppProps) {
  const { exit } = useApp();
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageTotals>(ZERO_USAGE);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [activeSessionId, setActiveSessionId] = useState(sessionId);
  const [pendingPlan, setPendingPlan] = useState<{ task: string; plan: string } | null>(null);
  // T5：忙碌行数据——最近工具动作摘要 / 已完成步数 / busy 起始时间
  const [busyAction, setBusyAction] = useState<string | undefined>(undefined);
  const [busySteps, setBusySteps] = useState(0);
  const [busyStartedAt, setBusyStartedAt] = useState(0);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  // T10：App 内部接管装配——onAssemble 完成后覆盖 loop/sessionId/mcpStatus/contextWindow
  const [assembled, setAssembled] = useState<Awaited<
    NonNullable<ModouAppProps["onAssemble"]>
  > | null>(null);
  const effectiveLoop = assembled?.loop ?? loop;
  loopRef.current = effectiveLoop;
  const effectiveMcpStatus = assembled?.mcpStatus ?? mcpStatus;
  const effectiveCheckpointer = assembled?.checkpointer ?? checkpointer;
  const effectiveContextWindow = assembled?.contextWindow ?? contextWindow;
  const updateSpentRef = useRef(assembled?.updateSpent);
  updateSpentRef.current = assembled?.updateSpent;
  // 装配完成后同步会话 id（resume 场景 sessionId 由 bundle 带回）
  useEffect(() => {
    if (assembled) {
      setActiveSessionId(assembled.sessionId);
    }
  }, [assembled]);
  useEffect(() => {
    if (onAssemble) {
      onAssemble.then(setAssembled).catch((error: Error) => {
        setItems((prev) => [
          ...prev,
          { kind: "error", text: `装配失败：${(error as Error).message}` },
        ]);
      });
    }
  }, []);
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

  // T10：装配完成瞬间（loop 由 null → 可用）追加就绪条目
  const readyAnnounced = useRef(false);
  useEffect(() => {
    if (effectiveLoop && !readyAnnounced.current) {
      readyAnnounced.current = true;
      const mcpReady = (effectiveMcpStatus ?? []).filter((s) => s.connected).length;
      const note = mcpReady > 0 ? `✓ 上下文就绪（MCP ${mcpReady} server 已连接）` : "✓ 上下文就绪";
      setItems((prev) => [...prev, { kind: "tool", text: note }]);
    }
  }, [effectiveLoop, effectiveMcpStatus]);

  // T6 流式节流：text_delta 每 token 一次 setState 会拖垮渲染——
  // delta 先写 ref 缓冲，60ms interval 一次性 flush 到 state（每秒 ≤17 帧）
  const streamBufferRef = useRef("");
  const flushStreaming = useCallback(() => {
    if (streamBufferRef.current !== "") {
      const buffered = streamBufferRef.current;
      streamBufferRef.current = "";
      setStreaming((prev) => prev + buffered);
    }
  }, []);
  useEffect(() => {
    const id = setInterval(flushStreaming, 60);
    return () => clearInterval(id);
  }, [flushStreaming]);

  const applyEvent = useCallback((event: ModouEvent) => {
    switch (event.type) {
      case "user_message":
        setItems((prev) => [...prev, { kind: "user", text: event.text }]);
        break;
      case "text_delta":
        streamBufferRef.current += event.delta;
        break;
      case "assistant_message":
        // 完整文本到达：flush 残余缓冲后清空流式区（消息以 assistant_message 为准）
        streamBufferRef.current = "";
        setStreaming("");
        setItems((prev) => [...prev, { kind: "assistant", text: event.text }]);
        break;
      case "tool_call":
        setBusyAction(`${event.name} ${summarizeArgs(event.args)}`);
        setBusySteps((n) => n + 1);
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
          updateSpentRef.current?.(next.costUsd);
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

  // Ctrl+C 语义（plan-m2 Q2）：任务中=中断任务；空闲时 5 秒内两次=退出
  const taskAbortRef = useRef<AbortController | null>(null);
  const lastCtrlC = useRef(0);
  useInput((input, key) => {
    // T5：esc = 中断当前任务（忙碌行提示 esc 中断）
    if (key.escape && busy) {
      taskAbortRef.current?.abort();
      return;
    }
    if (!key.ctrl || input.toLowerCase() !== "c") {
      return;
    }
    if (busy) {
      taskAbortRef.current?.abort();
      return;
    }
    if (Date.now() - lastCtrlC.current < 5_000) {
      onExit?.();
      exit();
    } else {
      lastCtrlC.current = Date.now();
      setItems((prev) => [...prev, { kind: "error", text: "再按一次 Ctrl+C 退出（5 秒内）" }]);
    }
  });

  const runTask = useCallback(
    async (input: string, options?: { permissions?: PermissionEngine }) => {
      if (!effectiveLoop) {
        setItems((prev) => [...prev, { kind: "error", text: "上下文装配中，请稍候…" }]);
        return;
      }
      if (running.current) {
        return;
      }
      const currentLoop = loopRef.current;
      if (!currentLoop) {
        setItems((prev) => [...prev, { kind: "error", text: "上下文装配中，请稍候…" }]);
        return;
      }
      running.current = true;
      setBusy(true);
      setBusyAction(undefined);
      setBusySteps(0);
      setBusyStartedAt(Date.now());
      const controller = new AbortController();
      taskAbortRef.current = controller;
      try {
        for await (const event of currentLoop.run(input, activeSessionId, {
          ...options,
          signal: controller.signal,
        })) {
          applyEvent(event);
        }
      } catch (error) {
        setItems((prev) => [
          ...prev,
          { kind: "error", text: `会话异常：${(error as Error).message}` },
        ]);
      } finally {
        taskAbortRef.current = null;
        running.current = false;
        setBusy(false);
      }
    },
    [activeSessionId, applyEvent],
  );

  /** /plan 工作流（plan-m2 O1）：只读产出计划 → 确认 → 带计划执行 */
  const runPlan = useCallback(
    async (task: string) => {
      if (running.current) {
        return;
      }
      const currentLoop = loopRef.current;
      if (!currentLoop) {
        setItems((prev) => [...prev, { kind: "error", text: "上下文装配中，请稍候…" }]);
        return;
      }
      running.current = true;
      setBusy(true);
      try {
        let lastAssistant = "";
        for await (const event of currentLoop.run(buildPlanTaskPrompt(task), activeSessionId, {
          permissions: new PermissionEngine({ mode: "plan" }),
        })) {
          if (event.type === "assistant_message") {
            lastAssistant = event.text;
          }
          applyEvent(event);
        }
        if (!lastAssistant.trim()) {
          setItems((prev) => [...prev, { kind: "error", text: "计划模式未产出计划文本，请重试" }]);
          return;
        }
        setPendingPlan({ task, plan: lastAssistant.trim() });
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
      if (!effectiveLoop) {
        setItems((prev) => [...prev, { kind: "error", text: "上下文装配中，请稍候…" }]);
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
        if (!effectiveCheckpointer?.available) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: "当前目录不是 git 仓库，回滚点不可用" },
          ]);
          return;
        }
        const list = await effectiveCheckpointer.list(activeSessionId);
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
        if (!effectiveCheckpointer?.available) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: "当前目录不是 git 仓库，回滚点不可用" },
          ]);
          return;
        }
        const result = await effectiveCheckpointer.restore(activeSessionId, command.n);
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
      if (command.action === "mcp") {
        const servers = mcpStatus ?? [];
        setItems((prev) => [
          ...prev,
          {
            kind: "assistant",
            text:
              servers.length === 0
                ? "未配置 MCP server（settings.json 的 mcpServers 字段）"
                : `MCP servers：\n${servers
                    .map(
                      (s) =>
                        `  ${s.connected ? "✓" : "✗"} ${s.name}（${s.tools} 个工具${s.error ? `，错误：${s.error}` : ""}）`,
                    )
                    .join("\n")}`,
          },
        ]);
        return;
      }
      if (command.action === "skills") {
        const skills = await loadSkills({ cwd }).catch(() => []);
        setItems((prev) => [
          ...prev,
          {
            kind: "assistant",
            text:
              skills.length === 0
                ? "未发现 Skills（项目 .luban/skills/ 或 ~/.modou/skills/ 下放置 <name>/SKILL.md）"
                : `可用 Skills：\n${skills
                    .map(
                      (skill) =>
                        `  ${skill.name}（${skill.source === "project" ? "项目" : "全局"}）—— ${skill.description}`,
                    )
                    .join("\n")}`,
          },
        ]);
        return;
      }
      if (command.action === "init") {
        const result = await initAgentsMd(cwd);
        setItems((prev) => [
          ...prev,
          { kind: result.ok ? "assistant" : "error", text: result.message },
        ]);
        return;
      }
      if (command.action === "plan") {
        void runPlan(command.task);
        return;
      }
      void runTask(trimmed);
    },
    [
      activeSessionId,
      checkpointer,
      cwd,
      effectiveCheckpointer,
      effectiveLoop,
      exit,
      onExit,
      onModelSwitch,
      runPlan,
      runTask,
      store,
      usage,
    ],
  );

  // 注意：这里不能用 gap={1}。Ink 的 Static 会绕过主渲染树直接写 stdout，
  // 而 gap 会在 Static 之后的第一个子元素前插空行——两者叠加时
  // ink 布局会把该元素的显示区域上移一行，首行内容被截掉
  // （实测：补全面板选中行整行消失）。用显式空行代替 gap。
  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item, index) => (
          <Box key={index} flexDirection="column">
            <MessageItem item={item} />
          </Box>
        )}
      </Static>
      <Text> </Text>
      {showLogo ? <LogoBlock /> : null}
      <Text color={terminalStyle().style.dim}>
        墨斗 v{VERSION} · {modelId} · {permissionMode}
      </Text>
      <Text> </Text>
      {streaming ? <Text>{streaming}</Text> : null}
      {pendingApproval ? (
        <ApprovalPrompt
          request={pendingApproval}
          queueCount={approvals?.pendingCount ?? 1}
          onAnswer={(answer) => approvals?.answer(answer)}
        />
      ) : null}
      {pendingPlan ? (
        <PlanConfirm
          task={pendingPlan.task}
          plan={pendingPlan.plan}
          onApprove={() => {
            const { task, plan } = pendingPlan;
            setPendingPlan(null);
            setItems((prev) => [...prev, { kind: "assistant", text: "已确认计划，开始执行" }]);
            void runTask(`${task}\n\n[已确认的实施计划——请严格按以下步骤执行]\n${plan}`);
          }}
          onReject={() => {
            setPendingPlan(null);
            setItems((prev) => [...prev, { kind: "assistant", text: "已放弃执行该计划" }]);
          }}
        />
      ) : null}
      <StatusBar
        model={modelId}
        permissionMode={permissionMode}
        usage={usage}
        budgetUsd={budgetUsd}
        contextWindow={effectiveContextWindow}
        ctxUsedTokens={usage.inputTokens + usage.outputTokens + usage.cacheReadTokens}
      />
      {busy ? (
        <BusyLine action={busyAction} startedAt={busyStartedAt} steps={busySteps} />
      ) : (
        <InputBox
          busy={busy}
          onSubmit={handleSubmit}
          disabled={!effectiveLoop}
          placeholder={!effectiveLoop ? "正在装配上下文…" : undefined}
        />
      )}
    </Box>
  );
}
