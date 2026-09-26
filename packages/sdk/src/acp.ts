import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  type Agent,
  type AgentSideConnection as AgentSideConnectionType,
} from "@zed-industries/agent-client-protocol";
import { createSession, type ModouSession } from "./session.js";
import { loadModelOverrides } from "./settings.js";
import type { LanguageModel, PermissionRule } from "@modou-dev/core";


/**
 * M4 C（PRD F19）：ACP agent 适配——通过 stdio JSON-RPC 接入 Zed / JetBrains 等 ACP 编辑器。
 * 协议：Agent Client Protocol（agentclientprotocol.com）。
 *
 * 方法映射：
 * - initialize            → 能力宣告（不支持 loadSession）
 * - session/new           → createSession（使用编辑器给出的 cwd）
 * - session/prompt        → session.run 事件流 → session/update 通知
 * - 审批                  → approval_request → conn.requestPermission → answerById
 * - session/cancel        → abort 当前轮
 */

interface AcpSessionEntry {
  session: ModouSession;
  abort: AbortController;
  /** 当前轮是否有 pending 审批（approval_request id） */
  pendingApprovalId?: string;
}

export interface AcpAgentOptions {
  /** settings 读取目录；缺省用户主目录 */
  home?: string;
  /** 测试注入口：绕过真实 provider */
  model?: unknown;
}

/** 工具名 → ACP 工具类别（read/write/execute/other） */
function acpToolKind(name: string): "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "other" {
  if (name === "read" || name === "grep" || name === "glob") {
    return "read";
  }
  if (name === "edit" || name === "write") {
    return "edit";
  }
  if (name === "bash") {
    return "execute";
  }
  return "other";
}

/** 回环自测用 stub 模型（MODOU_ACP_MODEL_STUB=1 时启用）；真实 Zed 运行走 settings 的 provider。
 * MODOU_ACP_STUB_TOOL=1 时首轮额外发一次 write 工具调用，供审批回环测试。 */
function stubModel(): LanguageModel {
  let calls = 0;
  return {
    specificationVersion: "v2",
    provider: "stub",
    modelId: "stub",
    doStream: async () => {
      calls += 1;
      const withTool = process.env.MODOU_ACP_STUB_TOOL === "1" && calls === 1;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "1" });
            controller.enqueue({
              type: "text-delta",
              id: "1",
              delta: withTool ? "好的，我来创建文件。" : "你好，这是墨斗 ACP stub 回复。",
            });
            controller.enqueue({ type: "text-end", id: "1" });
            if (withTool) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "call_stub_e2e",
                toolName: "write",
                input: JSON.stringify({ path: "acp-e2e.txt", text: "hi" }),
              });
            }
            controller.enqueue({
              type: "finish",
              finishReason: withTool ? "tool-calls" : "stop",
              usage: { inputTokens: 10, outputTokens: 5 },
            });
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModel;
}

export function createAcpAgentHandler(
  connection: AgentSideConnectionType,
  options: AcpAgentOptions = {},
): Agent {
  const sessions = new Map<string, AcpSessionEntry>();

  return {
    async initialize(params) {
      return {
        protocolVersion: params.protocolVersion,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { embeddedContext: true },
        },
        authMethods: [],
      };
    },

    async authenticate() {
      // 无需独立认证：settings.json 已持有 API Key
    },

    async newSession(params) {
      const session = await createSession({
        cwd: params.cwd,
        home: options.home,
        // models.json 自定义能力（glm-4.5-air 等目录外模型）
        modelOverrides: await loadModelOverrides(options.home),
        ...(options.model
          ? { model: options.model as never }
          : process.env.MODOU_ACP_MODEL_STUB === "1"
            ? { model: stubModel() }
            : {}),
      });
      const abort = new AbortController();
      sessions.set(session.sessionId, { session, abort });
      return {
        sessionId: session.sessionId,
        modes: {
          currentModeId: "standard",
          availableModes: [
            { id: "plan", name: "plan — 只读调研", description: "禁止写入/执行" },
            { id: "standard", name: "standard — 默认", description: "写文件/执行命令前询问" },
            { id: "yolo", name: "yolo — 全自动", description: "不再询问" },
          ],
        },
      };
    },

    async prompt(params) {
      const entry = sessions.get(params.sessionId);
      if (!entry) {
        throw new Error(`unknown session: ${params.sessionId}`);
      }
      const { session, abort } = entry;
      const sessionId = params.sessionId;
      // ContentBlock[] → 文本（M4 仅支持文本块）
      const input = params.prompt
        .map((block) => (block.type === "text" ? block.text : ""))
        .filter(Boolean)
        .join("\n");

      let stopReason: "end_turn" | "cancelled" = "end_turn";
      try {
        for await (const event of session.run(input, { signal: abort.signal })) {
          switch (event.type) {
            case "text_delta":
              await connection.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: event.delta },
                },
              });
              break;
            case "tool_call":
              await connection.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId: event.id,
                  kind: acpToolKind(event.name),
                  title: `${event.name} ${JSON.stringify(event.args).slice(0, 120)}`,
                  status: "pending",
                },
              });
              break;
            case "tool_result":
              await connection.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: event.id,
                  status: "completed",
                  content: [{ type: "content", content: { type: "text", text: event.output } }],
                },
              });
              break;
            case "approval_request": {
              // ACP：向编辑器请求许可 → 用户选择 → 回填 bridge
              entry.pendingApprovalId = event.id;
              const response = await connection.requestPermission({
                sessionId,
                toolCall: {
                  toolCallId: event.id,
                  kind: acpToolKind(event.name),
                  title: `${event.name}（${event.reason}）`,
                  status: "pending",
                },
                options: [
                  { optionId: "allow", name: "允许", kind: "allow_once" },
                  { optionId: "deny", name: "拒绝", kind: "reject_once" },
                ],
              });
              const granted =
                response.outcome.outcome === "selected" && response.outcome.optionId === "allow";
              session.approvals.answerById(event.id, { granted, remembered: false });
              entry.pendingApprovalId = undefined;
              break;
            }
            case "error":
              if (event.fatal) {
                stopReason = "end_turn";
              }
              break;
            default:
              break;
          }
        }
      } catch (error) {
        if ((error as Error).name === "AbortError" || abort.signal.aborted) {
          stopReason = "cancelled";
        } else {
          throw error;
        }
      }
      return { stopReason };
    },

    async cancel(params) {
      sessions.get(params.sessionId)?.abort.abort();
    },
  };
}

/**
 * 以 ACP agent 模式运行（stdio JSON-RPC）。`modou acp` 入口调用后阻塞至连接结束。
 */
export function runAcpAgent(options: AcpAgentOptions = {}): void {
  const connection = new AgentSideConnection(
    (conn) => createAcpAgentHandler(conn, options),
    ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
  );
  void connection;
}

/** 导出供测试使用：规则/会话表类型 */
export type { PermissionRule };
