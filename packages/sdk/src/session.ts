import type {
  Checkpointer,
  LanguageModel,
  ModouEvent,
  ModelCapabilities,
  SessionStore,
} from "@modou-dev/core";
import { ApprovalBridge } from "./approval-bridge.js";
import { createLoopFromSettings, type McpStatus } from "./loop-factory.js";
import { loadSettings, type Settings } from "./settings.js";

/**
 * M4 A4（PRD F17 验收：SDK 可被第三方嵌入）。
 * createSession 把装配层收敛成一个调用：读设置 → 装配 loop/MCP/审批桥 →
 * 返回可迭代事件流的会话对象。约 10 行即可跑通一问一答 + 审批。
 */

export interface CreateSessionOptions {
  /** 模型/供应商/权限等设置；缺省读 ~/.modou/settings.json */
  settings?: Settings;
  /** settings 缺失时的读取目录；默认用户主目录 */
  home?: string;
  /** 项目目录；默认 process.cwd() */
  cwd?: string;
  /** models.json 自定义模型能力 */
  modelOverrides?: ModelCapabilities[];
  checkpointer?: Checkpointer;
  /** 测试/高级用法：绕过真实 provider */
  model?: LanguageModel;
}

export interface ModouSession {
  sessionId: string;
  contextWindow: number;
  mcpStatus: McpStatus[];
  /** 会话事件存储（server 历史回放用） */
  store: SessionStore;
  /** 审批桥：approval_request 事件到达后用 answerById(id, answer) 应答 */
  approvals: ApprovalBridge;
  /** 一次任务的事件流；同一会话请勿并发 run */
  run(input: string, options?: { signal?: AbortSignal }): AsyncGenerator<ModouEvent>;
  /** 进程退出前调用：关闭 MCP 连接，防止子进程挂起 */
  close(): Promise<void>;
}

export async function createSession(
  options: CreateSessionOptions = {},
): Promise<ModouSession> {
  const settings = options.settings ?? (await loadSettings(options.home));
  if (!settings) {
    throw new Error(
      "尚未配置：请先运行 modou 完成首次配置，或在 CreateSessionOptions.settings 传入设置。",
    );
  }
  const approvals = new ApprovalBridge();
  const bundle = await createLoopFromSettings({
    settings,
    cwd: options.cwd ?? process.cwd(),
    home: options.home,
    modelOverrides: options.modelOverrides,
    checkpointer: options.checkpointer,
    model: options.model,
    approvals,
  });
  return {
    sessionId: bundle.sessionId,
    contextWindow: bundle.contextWindow,
    mcpStatus: bundle.mcpStatus,
    store: bundle.store,
    approvals,
    run: (input, runOptions) => bundle.loop.run(input, bundle.sessionId, runOptions),
    close: () => bundle.closeMcp(),
  };
}
