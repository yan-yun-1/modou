import {
  AgentLoop,
  PermissionEngine,
  SessionStore,
  createBuiltinTools,
  createLanguageModel,
  buildSystemPrompt,
  formatAgreements,
  loadAgreements,
  buildRepoMap,
  resolveCapabilities,
  type Checkpointer,
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
  /** 回滚点（git 影子引用）；非 git 目录下 GitCheckpointer 自动降级 */
  checkpointer?: Checkpointer;
  /** 指定会话 id（测试/resume 用）；默认生成 */
  sessionId?: string;
  /** 测试注入口：绕过真实 provider */
  model?: LanguageModel;
  /** 测试注入口：自定义工具集 */
  tools?: ToolRegistry;
  /** 会话累计成本回调（App 的 onUsageChange / 无头模式的事件消费都会调用） */
  onCostUpdate?: (costUsd: number) => void;
  /** 全局 AGENTS.md 的查找目录；默认用户主目录。测试可注入临时目录 */
  home?: string;
}

export interface LoopBundle {
  loop: AgentLoop;
  sessionId: string;
  store: SessionStore;
  /** 组装完成的系统提示词（基础 + AGENTS.md 约定 + repo map） */
  systemPrompt: string;
  /** 仅交互模式存在 */
  approvals?: ApprovalBridge;
  checkpointer?: Checkpointer;
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

  // 上下文装配（plan-m1 K1/K3）：基础提示词 + AGENTS.md 约定 + repo map
  const [agreementSections, repoMap] = await Promise.all([
    loadAgreements({ cwd, home: options.home }).catch(() => []),
    buildRepoMap({ cwd }).catch(() => ""),
  ]);
  const systemPrompt = [
    buildSystemPrompt({ cwd, platform: process.platform, tools: tools.names() }),
    formatAgreements(agreementSections),
    repoMap,
  ]
    .filter((part) => part !== "")
    .join("\n\n");

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
    systemPrompt,
    cwd,
    isOverBudget: () => settings.budgetUsd !== undefined && spent > settings.budgetUsd,
    checkpointer: options.checkpointer,
  });

  return {
    loop,
    sessionId,
    store,
    systemPrompt,
    approvals: options.approvals,
    checkpointer: options.checkpointer,
    updateSpent: (costUsd: number) => {
      spent = costUsd;
      onCostUpdate?.(costUsd);
    },
    isOverBudget: () => settings.budgetUsd !== undefined && spent > settings.budgetUsd,
  };
}
