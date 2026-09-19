import { tool as aiTool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { LubanEvent } from "./events.js";
import type { ModelCapabilities } from "./models/catalog.js";
import { streamTurn } from "./models/stream.js";
import type { PermissionEngine } from "./permissions.js";
import { rebuildState } from "./session.js";
import type { SessionStore } from "./session-store.js";
import type { ToolRegistry } from "./tools/registry.js";

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
        default:
          // tool_call / approval_* 的处理在 E3 加入
          break;
      }
    }
  }
}
