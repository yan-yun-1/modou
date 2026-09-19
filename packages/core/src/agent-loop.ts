import { tool as aiTool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { LubanEvent } from "./events.js";
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
}

type ToolCallEvent = Extract<LubanEvent, { type: "tool_call" }>;

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

  constructor(deps: AgentLoopDeps) {
    this.#deps = deps;
  }

  async *run(input: string, sessionId: string): AsyncGenerator<LubanEvent> {
    const { store, model, capabilities, tools, systemPrompt, signal } = this.#deps;
    const at = Date.now;

    const persist = async (event: LubanEvent): Promise<LubanEvent> => {
      await store.append(sessionId, event);
      return event;
    };

    const existing = await store.read(sessionId);
    const messages: ModelMessage[] = rebuildState(existing).messages;

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
    for (;;) {
      let madeToolCall = false;

      for await (const event of streamTurn({
        model,
        messages,
        capabilities,
        system: systemPrompt,
        tools: Object.keys(toolSet).length > 0 ? toolSet : undefined,
        signal,
      })) {
        switch (event.type) {
          case "text_delta":
            // 实时增量只给 UI，不落盘
            yield event;
            break;
          case "assistant_message":
            messages.push({
              role: "assistant",
              content: [{ type: "text", text: event.text }],
            });
            yield await persist(event);
            break;
          case "usage":
            yield await persist(event);
            break;
          case "tool_call":
            madeToolCall = true;
            messages.push({
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: event.id,
                  toolName: event.name,
                  input: event.args,
                },
              ],
            });
            yield await persist(event);
            yield* this.#handleToolCall(event, sessionId, messages, persist, at);
            break;
          default:
            break;
        }
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
    persist: (event: LubanEvent) => Promise<LubanEvent>,
    at: () => number,
  ): AsyncGenerator<LubanEvent> {
    const { tools, permissions, approve, cwd, signal } = this.#deps;
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

    const decision = permissions.decide({ name: event.name, kind: tool.kind, args: event.args });

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
      yield await persist({
        type: "approval_request",
        id: event.id,
        name: event.name,
        args: event.args,
        reason,
        at: at(),
      });
      const answer = await approve({
        id: event.id,
        name: event.name,
        args: event.args,
        reason,
      });
      yield await persist({
        type: "approval_result",
        id: event.id,
        granted: answer.granted,
        remembered: answer.remembered,
        at: at(),
      });
      if (!answer.granted) {
        yield await persist({
          type: "tool_result",
          id: event.id,
          output: "用户拒绝执行此操作",
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

    let output: string;
    let truncated = false;
    try {
      const result = await tools.validateAndRun(event.name, event.args, {
        cwd,
        signal: signal ?? new AbortController().signal,
      });
      output = result.output;
      truncated = result.truncated ?? false;
    } catch (error) {
      output = `工具执行失败：${(error as Error).message}`;
      yield await persist({ type: "error", message: output, fatal: false, at: at() });
    }
    yield await persist({
      type: "tool_result",
      id: event.id,
      output,
      truncated,
      at: at(),
    });
    messages.push(toolResultMessage(event.id, event.name, output));
  }
}
