import {
  AgentLoop,
  PermissionEngine,
  SessionStore,
  createBuiltinTools,
  createLanguageModel,
  buildSystemPrompt,
  resolveCapabilities,
  type LanguageModel,
  type ModelCapabilities,
  type ToolRegistry,
} from "@luban/core";
import { randomUUID } from "node:crypto";
import { resolveApiKey, type Settings } from "./settings.js";
import { ApprovalBridge } from "./approval-bridge.js";

export interface CreateLoopOptions {
  settings: Settings;
  cwd: string;
  /** models.json 自定义模型能力（目录外模型必需） */
  modelOverrides?: ModelCapabilities[];
  /** 注入已有 store（测试用）；默认新建默认目录的 store */
  store?: SessionStore;
  /** 交互模式提供审批桥；缺省时审批自动拒绝（无头语义） */
  approvals?: ApprovalBridge;
  /** 指定会话 id（测试/resume 用）；默认生成 */
  sessionId?: string;
  /** 测试注入口：绕过真实 provider */
  model?: LanguageModel;
  /** 测试注入口：自定义工具集 */
  tools?: ToolRegistry;
  /** 会话累计成本回调（App 的 onUsageChange / 无头模式的事件消费都会调用） */
  onCostUpdate?: (costUsd: number) => void;
}

export interface LoopBundle {
  loop: AgentLoop;
  sessionId: string;
  store: SessionStore;
  /** 仅交互模式存在 */
  approvals?: ApprovalBridge;
  /** 预算钩子的写入口：把本会话累计成本喂给 isOverBudget */
  updateSpent: (costUsd: number) => void;
  isOverBudget: () => boolean;
}

/**
 * cli 内唯一的 loop 装配点：settings → capabilities → model → tools → permissions → loop。
 * 交互、无头、/model 切换共用；core 不感知 settings.json。
 */
export async function createLoopFromSettings(options: CreateLoopOptions): Promise<LoopBundle> {
  const { settings, cwd, modelOverrides = [], onCostUpdate } = options;
  const capabilities = resolveCapabilities(settings.provider, settings.modelId, modelOverrides);
  const model =
    options.model ??
    createLanguageModel({
      provider: settings.provider,
      modelId: settings.modelId,
      apiKey: resolveApiKey(settings),
      baseURL: settings.baseURL,
    });
  const tools = options.tools ?? createBuiltinTools();
  const store = options.store ?? new SessionStore();
  let spent = 0;

  const sessionId =
    options.sessionId ?? `session-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  await store.create(sessionId);

  const loop = new AgentLoop({
    model,
    capabilities,
    tools,
    store,
    permissions: new PermissionEngine({ mode: settings.permissionMode ?? "default" }),
    approve: (req) =>
      options.approvals
        ? options.approvals.request(req)
        : Promise.resolve({ granted: false, remembered: false }),
    systemPrompt: buildSystemPrompt({
      cwd,
      platform: process.platform,
      tools: tools.names(),
    }),
    cwd,
    isOverBudget: () => settings.budgetUsd !== undefined && spent > settings.budgetUsd,
  });

  return {
    loop,
    sessionId,
    store,
    approvals: options.approvals,
    updateSpent: (costUsd: number) => {
      spent = costUsd;
      onCostUpdate?.(costUsd);
    },
    isOverBudget: () => settings.budgetUsd !== undefined && spent > settings.budgetUsd,
  };
}
