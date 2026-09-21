import {
  AgentLoop,
  McpConnection,
  PermissionEngine,
  SessionStore,
  createBuiltinTools,
  createLanguageModel,
  buildSystemPrompt,
  formatAgreements,
  loadAgreements,
  buildRepoMap,
  createExploreTool,
  formatSkillsPrompt,
  loadSkills,
  mcpToolsFromConnection,
  resolveCapabilities,
  type Checkpointer,
  type LanguageModel,
  type ModelCapabilities,
  type ToolRegistry,
} from "@modou/core";
import { randomUUID } from "node:crypto";
import { resolveApiKey, resolveCwd, type Settings } from "./settings.js";
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
  /** MCP servers 连接状态 */
  mcpStatus: McpStatus[];
  /** 关闭全部 MCP 连接（结束会话时调用，否则 server 子进程会让进程挂起不退出） */
  closeMcp: () => Promise<void>;
  /** 预算钩子的写入口：把本会话累计成本喂给 isOverBudget */
  updateSpent: (costUsd: number) => void;
  isOverBudget: () => boolean;
}

export interface McpStatus {
  name: string;
  connected: boolean;
  tools: number;
  error?: string;
}

/**
 * cli 内唯一的 loop 装配点：settings → capabilities → model → tools → permissions → loop。
 * 交互、无头、/model 切换共用；core 不感知 settings.json。
 */
export async function createLoopFromSettings(options: CreateLoopOptions): Promise<LoopBundle> {
  const { settings, modelOverrides = [], onCostUpdate } = options;
  // A2（plan-m3）：settings.cwd 优先于调用方 cwd；目录不存在回退并给出警告
  const resolved = resolveCwd(settings, options.cwd);
  const cwd = resolved.cwd;
  if (resolved.warning) {
    process.stderr.write(`[modou] ${resolved.warning}
`);
  }
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

  // MCP servers（plan-m2 N3）：连接并把工具注册进同一 registry；单个失败不阻断启动
  const mcpStatus: McpStatus[] = [];
  const mcpConnections: McpConnection[] = [];
  for (const [name, config] of Object.entries(settings.mcpServers ?? {})) {
    try {
      const connection = new McpConnection(name, config);
      await connection.connect();
      const mcpTools = await mcpToolsFromConnection(connection);
      for (const tool of mcpTools) {
        tools.register(tool);
      }
      mcpConnections.push(connection);
      mcpStatus.push({ name, connected: true, tools: mcpTools.length });
    } catch (error) {
      mcpStatus.push({
        name,
        connected: false,
        tools: 0,
        error: (error as Error).message,
      });
    }
  }

  // explore 子代理工具需要 model/capabilities，在系统提示词组装前注册（plan-m2 P2）
  tools.register(createExploreTool({ model, capabilities, cwd, store }));

  // 上下文装配（plan-m1 K1/K3 + plan-m3 D2）：基础提示词 + AGENTS.md 约定 + repo map + Skills 清单
  const [agreementSections, repoMap, skills] = await Promise.all([
    loadAgreements({ cwd, home: options.home }).catch(() => []),
    buildRepoMap({ cwd }).catch(() => ""),
    loadSkills({ cwd, home: options.home }).catch(() => []),
  ]);
  const systemPrompt = [
    buildSystemPrompt({ cwd, platform: process.platform, tools: tools.names() }),
    formatAgreements(agreementSections),
    repoMap,
    formatSkillsPrompt(skills),
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
    mcpStatus,
    approvals: options.approvals,
    checkpointer: options.checkpointer,
    closeMcp: async () => {
      for (const connection of mcpConnections) {
        await connection.close().catch(() => {});
      }
    },
    updateSpent: (costUsd: number) => {
      spent = costUsd;
      onCostUpdate?.(costUsd);
    },
    isOverBudget: () => settings.budgetUsd !== undefined && spent > settings.budgetUsd,
  };
}
