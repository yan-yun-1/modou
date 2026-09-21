import { randomUUID } from "node:crypto";
import { AgentLoop } from "./agent-loop.js";
import { PermissionEngine } from "./permissions.js";
import { SessionStore } from "./session-store.js";
import { createReadonlyTools } from "./tools/index.js";
import type { LanguageModel } from "ai";
import type { ModelCapabilities } from "./models/catalog.js";

export interface SubagentOptions {
  parentSessionId: string;
  /** 子代理名称：explore / code-review 等，用于会话命名与事件 */
  name: string;
  task: string;
  model: LanguageModel;
  capabilities: ModelCapabilities;
  cwd: string;
  systemPrompt: string;
  /** 注入父级 store（子会话与主会话同一 JSONL 目录）；默认新建默认目录 store */
  store?: SessionStore;
  maxSteps?: number;
}

export interface SubagentResult {
  summary: string;
  costUsd: number;
  sessionId: string;
  /** 非 null 表示子代理因致命错误未完成，值为错误信息 */
  fatal: string | null;
}

/**
 * 子代理运行器（plan-m2 P1，契约增补 3）：
 * 独立 SessionStore 会话（sub-<parent>-<name>-<rand>）+ 只读工具集 + plan 权限模式，
 * 与主会话完全隔离；结果只以摘要回传，保护主上下文窗口。
 */
export async function runSubagent(options: SubagentOptions): Promise<SubagentResult> {
  const { model, capabilities, cwd, systemPrompt } = options;
  const store = options.store ?? new SessionStore();
  const sessionId = `sub-${options.parentSessionId}-${options.name}-${randomUUID().slice(0, 6)}`;
  await store.create(sessionId);

  const tools = createReadonlyTools();
  const permissions = new PermissionEngine({ mode: "plan" });

  const loop = new AgentLoop({
    model,
    capabilities,
    tools,
    store,
    permissions,
    approve: async () => ({ granted: false, remembered: false }),
    systemPrompt,
    cwd,
    maxSteps: options.maxSteps ?? 15,
  });

  let summary = "";
  let costUsd = 0;
  let fatal: string | null = null;

  for await (const event of loop.run(options.task, sessionId)) {
    if (event.type === "assistant_message") {
      summary = event.text;
    } else if (event.type === "usage") {
      costUsd += event.costUsd;
    } else if (event.type === "error" && event.fatal) {
      fatal = event.message;
    }
  }

  return { summary, costUsd, sessionId, fatal };
}
