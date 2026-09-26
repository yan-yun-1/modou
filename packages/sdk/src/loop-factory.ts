import {
  AgentLoop,
  McpConnection,
  PermissionEngine,
  SessionStore,
  createBuiltinTools,
  createLanguageModel,
  createSandboxAdapter,
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
} from "@modou-dev/core";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolveApiKey, resolveCwd, savePermissionRule, type Settings } from "./settings.js";
import { thinkingToExtraBody } from "./provider-models.js";
import { ApprovalBridge } from "./approval-bridge.js";
import { createDefinitionTool, createLspIntegration, startLspHub } from "./lsp-assembly.js";
import type { AgentHooks } from "@modou-dev/core";

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
  /** 模型上下文窗口（token 数，StatusBar ctx% 用） */
  contextWindow: number;
  /** 预算钩子的写入口：把本会话累计成本喂给 isOverBudget */
  updateSpent: (costUsd: number) => void;
  isOverBudget: () => boolean;
  /** 热切换思考强度（改请求体引用，下一条消息立即生效）；/thinking 用 */
  setThinking: (level: "off" | "low" | "medium" | "high") => void;
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
/** 把 settings.hooks 的 shell 命令包装成 core 钩子（stdin JSON 事件 → stdout JSON 决策；出错 fail-open） */
function commandHook(command: string): (ctx: unknown) => Promise<Record<string, unknown> | void> {
  return (ctx) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (value: Record<string, unknown> | void) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      let child;
      try {
        child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        finish();
        return;
      }
      let out = "";
      const timer = setTimeout(() => {
        child.kill();
        finish();
      }, 15_000);
      child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
      child.on("error", () => {
        clearTimeout(timer);
        finish();
      });
      child.on("close", () => {
        clearTimeout(timer);
        try {
          const lastLine = out.trim().split("\n").at(-1) ?? "";
          finish(lastLine ? (JSON.parse(lastLine) as Record<string, unknown>) : undefined);
        } catch {
          finish();
        }
      });
      child.stdin?.write(JSON.stringify(ctx) + "\n");
      child.stdin?.end();
    });
}

function buildHooks(settings: Settings): AgentHooks | undefined {
  const preToolUse = settings.hooks?.preToolUse ? commandHook(settings.hooks.preToolUse) : undefined;
  const postToolUse = settings.hooks?.postToolUse
    ? async (ctx: { name: string; output: string }) => {
        const result = (await commandHook(settings.hooks!.postToolUse!)(ctx)) as
          | { output?: string }
          | void;
        return result?.output;
      }
    : undefined;
  if (!preToolUse && !postToolUse) {
    return undefined;
  }
  return {
    ...(preToolUse ? { preToolUse: preToolUse as AgentHooks["preToolUse"] } : {}),
    ...(postToolUse ? { postToolUse: postToolUse as AgentHooks["postToolUse"] } : {}),
  };
}

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
  // M5 B2（PRD 6.5）：settings.sandbox → 平台可用时启用 OS 沙箱（当前仅 macOS Seatbelt）
  const sandbox = createSandboxAdapter(settings.sandbox ?? "off");
  const sandboxAutoAllow = sandbox !== undefined && settings.sandboxAutoAllow === true;
  // 思考强度可变引用：setThinking 改 current，下一次模型请求立即生效（无需重启）
  const thinkingRef: { current: Record<string, unknown> | undefined } = {
    current: settings.thinking
      ? thinkingToExtraBody(settings.provider, settings.thinking)
      : undefined,
  };
  const setThinking = (level: "off" | "low" | "medium" | "high") => {
    thinkingRef.current = thinkingToExtraBody(settings.provider, level);
  };
  const model =
    options.model ??
    createLanguageModel({
      provider: settings.provider,
      modelId: settings.modelId,
      apiKey: resolveApiKey(settings),
      baseURL: settings.baseURL,
      // 思考强度（X）：映射为厂商私有请求体参数（glm/qwen/openrouter；其余忽略）。
      // 用可变引用持有，/thinking 改 current 即热切换，无需重启
      extraBodyRef: thinkingRef,
    });
  const tools = options.tools ?? createBuiltinTools({ sandbox });
  // M5 C3（PRD F16）：LSP 装配——hub 失败/无 server 时为 undefined，零影响
  const lspHub = await startLspHub(settings, cwd);
  if (lspHub) {
    tools.register(createDefinitionTool(lspHub));
  }
  const store = options.store ?? new SessionStore();
  let spent = 0;

  const sessionId =
    options.sessionId ?? `session-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  await store.create(sessionId);

  // MCP servers（plan-m2 N3；plan-tui T9 并行化）：全部 server 同时连接，
  // 单个失败不阻断启动（状态标 false）；结果顺序与配置顺序一致
  const mcpEntries = Object.entries(settings.mcpServers ?? {});
  const mcpResults = await Promise.all(
    mcpEntries.map(async ([name, config]) => {
      try {
        const connection = new McpConnection(name, config);
        await connection.connect();
        const mcpTools = await mcpToolsFromConnection(connection);
        return { name, connection, mcpTools, error: null as string | null };
      } catch (error) {
        return {
          name,
          connection: null as McpConnection | null,
          mcpTools: [],
          error: (error as Error).message,
        };
      }
    }),
  );
  const mcpStatus: McpStatus[] = [];
  const mcpConnections: McpConnection[] = [];
  for (const result of mcpResults) {
    if (result.connection && result.error === null) {
      for (const tool of result.mcpTools) {
        tools.register(tool);
      }
      mcpConnections.push(result.connection);
      mcpStatus.push({ name: result.name, connected: true, tools: result.mcpTools.length });
    } else {
      mcpStatus.push({
        name: result.name,
        connected: false,
        tools: 0,
        error: result.error ?? "unknown",
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
    // M4 D2：settings.hooks 的 shell 命令 → core 生命周期钩子
    hooks: buildHooks(settings),
    // M5 B2：沙箱实际生效时 execute 免弹窗（docs/sandbox-eval.md §五）
    sandboxAutoAllow,
    permissions: (() => {
      // M4 A3：读回持久化的 always-allow 白名单；remember 新增规则时落盘
      const engine = new PermissionEngine({
        mode: settings.permissionMode ?? "default",
        rules: settings.permissionRules ?? [],
      });
      if (options.home) {
        engine.onRemember = (rule) => {
          void savePermissionRule(rule, options.home).catch(() => {
            // 持久化失败不阻断任务（规则仍在内存生效）
          });
        };
      }
      return engine;
    })(),
    approve: (req) =>
      options.approvals
        ? options.approvals.request(req)
        : Promise.resolve({ granted: false, remembered: false }),
    headless: !options.approvals,
    systemPrompt,
    cwd,
    isOverBudget: () => settings.budgetUsd !== undefined && spent > settings.budgetUsd,
    checkpointer: options.checkpointer,
    lsp: lspHub ? createLspIntegration(lspHub) : undefined,
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
      await lspHub?.close().catch(() => {});
    },
    contextWindow: capabilities.contextWindow,
    updateSpent: (costUsd: number) => {
      spent = costUsd;
      onCostUpdate?.(costUsd);
    },
    isOverBudget: () => settings.budgetUsd !== undefined && spent > settings.budgetUsd,
    setThinking,
  };
}
