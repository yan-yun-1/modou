import {
  tool as aiTool,
  type LanguageModel,
  type ModelMessage,
  type ToolCallPart,
  type ToolSet,
} from "ai";
import type { Checkpointer } from "./checkpoints.js";
import { compactMessages, needsCompaction } from "./context/compaction.js";
import type { ModouEvent } from "./events.js";
import type { ModelCapabilities } from "./models/catalog.js";
import { streamTurn } from "./models/stream.js";
import type { PermissionEngine, PermissionRule } from "./permissions.js";
import { rebuildState } from "./session.js";
import type { SessionStore } from "./session-store.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolKind } from "./tools/types.js";

export interface ApprovalRequest {
  id: string;
  name: string;
  args: unknown;
  reason: string;
  /** write/edit 审批时附带的 unified diff（可选） */
  diff?: string;
}

export interface ApprovalAnswer {
  granted: boolean;
  remembered: boolean;
}

export interface AgentLoopDeps {
  model: LanguageModel;
  capabilities: ModelCapabilities;
  tools: ToolRegistry;
  store: SessionStore;
  permissions: PermissionEngine;
  approve: (req: ApprovalRequest) => Promise<ApprovalAnswer>;
  systemPrompt: string;
  cwd: string;
  signal?: AbortSignal;
  maxSteps?: number;
  isOverBudget?: () => boolean;
  /** 可选回滚点：write 类工具执行前自动快照（git 影子引用实现见 checkpoints.ts） */
  checkpointer?: Checkpointer;
  /** M4 D1（PRD F14）：工具生命周期钩子（对所有子代理同样生效） */
  hooks?: AgentHooks;
  /** M4 E1：无头模式标记——审批被自动拒绝时，拒绝文案附带 always-allow 配置建议 */
  headless?: boolean;
}

/** 工具生命周期钩子（F14） */
export interface AgentHooks {
  /**
   * PreToolUse：权限判定之前调用。返回 decision 可短路权限流程（allow 跳过审批、
   * deny 阻断执行），返回 args 可改写工具入参；返回 void 走正常权限流程。
   */
  preToolUse?: (ctx: { name: string; kind: ToolKind; args: unknown }) => Promise<
    { decision?: "allow" | "deny" | "ask"; args?: unknown; reason?: string } | void
  >;
  /** PostToolUse：工具执行之后调用。返回 string 则附加到工具输出（失败时 error 非空） */
  postToolUse?: (ctx: { name: string; args: unknown; output: string; error?: string }) => Promise<string | void>;
}

type ToolCallEvent = Extract<ModouEvent, { type: "tool_call" }>;

function toolResultMessage(id: string, name: string, output: string): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName: name,
        output: { type: "text", value: output },
      },
    ],
  };
}

function ruleFromArgs(kind: ToolKind, args: unknown): PermissionRule | null {
  if (kind === "execute") {
    const c = (args as { command?: unknown } | null)?.command;
    return typeof c === "string" && c.length > 0 ? { type: "execute-prefix", value: c } : null;
  }
  if (kind === "write") {
    const p = (args as { path?: unknown } | null)?.path;
    return typeof p === "string" && p.length > 0 ? { type: "write-path", value: p } : null;
  }
  return null;
}

/**
 * 事件驱动的单线程主循环：事件先持久化再交给前端（事件先于展示）。
 * 会话可恢复——每次 run 从 JSONL 重建消息历史。
 */
export class AgentLoop {
  #deps: AgentLoopDeps;
  /** 当前流轮次已产出的文本（tool_call 到达时与之合并为一条 assistant 消息） */
  #pendingText: string | undefined;

  constructor(deps: AgentLoopDeps) {
    this.#deps = deps;
  }

  async *run(
    input: string,
    sessionId: string,
    options?: { permissions?: PermissionEngine; signal?: AbortSignal },
  ): AsyncGenerator<ModouEvent> {
    const { store, model, capabilities, tools, systemPrompt } = this.#deps;
    const effectivePermissions = options?.permissions ?? this.#deps.permissions;
    const effectiveSignal = options?.signal ?? this.#deps.signal;
    const at = Date.now;

    const persist = async (event: ModouEvent): Promise<ModouEvent> => {
      await store.append(sessionId, event);
      return event;
    };

    const existing = await store.read(sessionId);
    let messages: ModelMessage[] = rebuildState(existing).messages;

    if (!existing.some((event) => event.type === "session_started")) {
      yield await persist({
        type: "session_started",
        sessionId,
        model: capabilities.id,
        at: at(),
      });
    }

    yield await persist({ type: "user_message", text: input, at: at() });
    messages.push({ role: "user", content: input });

    const toolSet: ToolSet = {};
    for (const t of tools.list()) {
      toolSet[t.name] = aiTool({ description: t.description, inputSchema: t.schema });
    }

    // 多步循环：每步一次模型调用；模型不再调用工具即任务完成
    const maxSteps = this.#deps.maxSteps ?? 30;
    let step = 0;
    for (;;) {
      if (this.#deps.isOverBudget?.()) {
        yield await persist({
          type: "error",
          message: "预算已用尽，本任务暂停。可提高预算后继续。",
          fatal: false,
          at: at(),
        });
        break;
      }
      if (step >= maxSteps) {
        yield await persist({
          type: "error",
          message: `已达单任务最大步数（${maxSteps} 步），任务暂停。可让模型继续。`,
          fatal: false,
          at: at(),
        });
        break;
      }
      // 上下文压缩（plan-m1 K2）：接近窗口上限时摘要重建历史；失败降级为继续
      if (needsCompaction(messages, capabilities.contextWindow)) {
        try {
          const result = await compactMessages({ messages, model, capabilities });
          messages = result.messages;
          yield await persist({
            type: "compaction",
            summary: result.summary,
            originalMessageCount: result.originalCount,
            at: at(),
          });
          // 摘要调用的成本单独计量（Q3）
          yield await persist({
            type: "usage",
            inputTokens: result.meteredUsage.inputTokens,
            outputTokens: result.meteredUsage.outputTokens,
            cacheReadTokens: result.meteredUsage.cacheReadTokens,
            cacheWriteTokens: result.meteredUsage.cacheWriteTokens,
            costUsd: result.meteredUsage.costUsd,
            at: at(),
          });
        } catch (error) {
          yield await persist({
            type: "error",
            message: `上下文压缩失败（跳过压缩继续）：${(error as Error).message}`,
            fatal: false,
            at: at(),
          });
        }
      }
      step++;
      let madeToolCall = false;

      // 流式异常（网络断、provider 5xx、流内 error 片段）不冒泡：
      // 落盘 fatal error 事件后正常结束 run，会话可继续（下轮 run 重建历史）。
      try {
        for await (const event of streamTurn({
          model,
          messages,
          capabilities,
          system: systemPrompt,
          tools: Object.keys(toolSet).length > 0 ? toolSet : undefined,
          signal: effectiveSignal,
        })) {
          switch (event.type) {
            case "text_delta":
              // 实时增量只给 UI，不落盘
              yield event;
              break;
            case "assistant_message":
              this.#pendingText = event.text;
              yield await persist(event);
              break;
            case "usage":
              yield await persist(event);
              break;
            case "tool_call": {
              madeToolCall = true;
              // 同轮 text + tool-call 合并为一条 assistant 消息（provider 语义）：
              // 拆成两条会让 GLM 等模型在 tool-result 轮复述开场白后空转早停（M3 根因）。
              const parts: (ToolCallPart | { type: "text"; text: string })[] = [];
              if (this.#pendingText) {
                parts.push({ type: "text", text: this.#pendingText });
                this.#pendingText = undefined;
              }
              parts.push({
                type: "tool-call",
                toolCallId: event.id,
                toolName: event.name,
                input: event.args,
              });
              messages.push({ role: "assistant", content: parts });
              yield await persist(event);
              yield* this.#handleToolCall(
                event,
                sessionId,
                messages,
                persist,
                at,
                effectivePermissions,
                effectiveSignal,
              );
              break;
            }
            default:
              break;
          }
        }
        // 有文本无工具调用的轮次：文本单独成消息
        if (this.#pendingText) {
          messages.push({
            role: "assistant",
            content: [{ type: "text", text: this.#pendingText }],
          });
          this.#pendingText = undefined;
        }
      } catch (error) {
        // 用户主动中止与 provider 故障区分开（plan-m2 Q2）
        const message = effectiveSignal?.aborted
          ? "任务已中断"
          : `模型调用失败：${(error as Error).message}`;
        yield await persist({
          type: "error",
          message,
          fatal: true,
          at: at(),
        });
        break;
      }

      if (!madeToolCall) {
        break;
      }
    }
  }

  /**
   * 处理一次工具调用：权限判定 → （需要时）人工审批 → 执行 → 结果回注模型。
   * 未知工具与校验失败不中断会话，作为工具结果回注让模型自行修复。
   */
  async *#handleToolCall(
    event: ToolCallEvent,
    sessionId: string,
    messages: ModelMessage[],
    persist: (event: ModouEvent) => Promise<ModouEvent>,
    at: () => number,
    permissions: PermissionEngine,
    signal?: AbortSignal,
  ): AsyncGenerator<ModouEvent> {
    const { tools, approve, cwd } = this.#deps;
    const tool = tools.get(event.name);

    if (!tool) {
      const message = `未知工具 "${event.name}"`;
      yield await persist({ type: "error", message, fatal: false, at: at() });
      yield await persist({
        type: "tool_result",
        id: event.id,
        output: message,
        truncated: false,
        at: at(),
      });
      messages.push(toolResultMessage(event.id, event.name, message));
      return;
    }

    // F14 PreToolUse：可改写入参 / 短路权限流程
    let hookDecision: "allow" | "ask" | undefined;
    let hookArgs: unknown = event.args;
    const preHook = this.#deps.hooks?.preToolUse;
    if (preHook) {
      const hookResult = await preHook({ name: event.name, kind: tool.kind, args: event.args });
      if (hookResult?.args !== undefined) {
        hookArgs = hookResult.args;
      }
      if (hookResult?.decision === "deny") {
        const denial = `Hook 拒绝：${hookResult.reason ?? "PreToolUse 钩子否决"}`;
        yield await persist({
          type: "tool_result",
          id: event.id,
          output: denial,
          truncated: false,
          at: at(),
        });
        messages.push(toolResultMessage(event.id, event.name, denial));
        return;
      }
      if (hookResult?.decision === "allow" || hookResult?.decision === "ask") {
        hookDecision = hookResult.decision;
      }
    }

    let decision = permissions.decide({ name: event.name, kind: tool.kind, args: hookArgs });
    if (hookDecision) {
      // 钩子显式决策覆盖引擎判定（deny 已在上方短路）
      decision = hookDecision;
    }

    if (decision === "deny") {
      const denial = `权限拒绝：plan 模式为只读，禁止${tool.kind === "execute" ? "执行命令" : "写入文件"}`;
      yield await persist({
        type: "tool_result",
        id: event.id,
        output: denial,
        truncated: false,
        at: at(),
      });
      messages.push(toolResultMessage(event.id, event.name, denial));
      return;
    }

    if (decision === "ask") {
      const reason = tool.kind === "execute" ? "执行命令需要审批" : "写入文件需要审批";
      // write/edit 实现了 preview 时，把 unified diff 附到审批请求上供人工审阅
      const diff = tool.preview
        ? await tool
            .preview(hookArgs, {
              cwd,
              signal: signal ?? new AbortController().signal,
              sessionId,
            })
            .catch(() => null)
        : null;
      yield await persist({
        type: "approval_request",
        id: event.id,
        name: event.name,
        args: event.args,
        reason,
        diff: diff ?? undefined,
        at: at(),
      });
      const answer = await approve({
        id: event.id,
        name: event.name,
        args: event.args,
        reason,
        diff: diff ?? undefined,
      });
      yield await persist({
        type: "approval_result",
        id: event.id,
        granted: answer.granted,
        remembered: answer.remembered,
        at: at(),
      });
      if (!answer.granted) {
        // M4 E1（dogfood#1）：无头模式（未接审批桥）时给出可操作的配置建议
        const denialText =
          this.#deps.headless === true
            ? "操作被自动拒绝（无头模式无审批入口）。如需自动化：在 settings.json 配置 \"permissionMode\": \"yolo\"，或添加 permissionRules 白名单（如 {\"type\":\"execute-prefix\",\"value\":\"npm test\"}）。"
            : "用户拒绝执行此操作";
        yield await persist({
          type: "tool_result",
          id: event.id,
          output: denialText,
          truncated: false,
          at: at(),
        });
        messages.push(toolResultMessage(event.id, event.name, "用户拒绝执行此操作"));
        return;
      }
      if (answer.remembered) {
        const rule = ruleFromArgs(tool.kind, event.args);
        if (rule) {
          permissions.remember(rule);
        }
      }
    }

    // 写入类工具执行前自动创建回滚点（plan-m1 J2）
    let checkpointNote = "";
    if (tool.kind === "write" && this.#deps.checkpointer?.available) {
      const snap = await this.#deps.checkpointer.snapshot(sessionId).catch(() => null);
      if (snap) {
        checkpointNote = `\n[已创建回滚点 #${snap}（/rollback ${snap} 可恢复）]`;
      }
    }

    let output: string;
    let truncated = false;
    let toolError: string | undefined;
    try {
      const result = await tools.validateAndRun(event.name, hookArgs, {
        cwd,
        signal: signal ?? new AbortController().signal,
        sessionId,
      });
      output = result.output;
      truncated = result.truncated ?? false;
    } catch (error) {
      toolError = (error as Error).message;
      output = `工具执行失败：${toolError}`;
      yield await persist({ type: "error", message: output, fatal: false, at: at() });
    }
    // F14 PostToolUse：可附加输出（成功与失败路径都触发）
    const postHook = this.#deps.hooks?.postToolUse;
    if (postHook) {
      const extra = await postHook({ name: event.name, args: hookArgs, output, error: toolError });
      if (typeof extra === "string" && extra !== "") {
        output = `${output}\n${extra}`;
      }
    }
    output += checkpointNote;
    yield await persist({
      type: "tool_result",
      id: event.id,
      output,
      truncated,
      at: at(),
    });
    messages.push(toolResultMessage(event.id, event.name, output));

    // 子代理工具（契约增补 3）：摘要落盘为独立事件，供审计与 UI 展示
    if (tool.subagentName) {
      yield await persist({
        type: "subagent",
        name: tool.subagentName,
        summary: output.slice(0, 500),
        at: at(),
      });
    }
  }
}
