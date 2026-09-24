import type { UsageTotals } from "@modou-dev/core";

export type CommandResult =
  | { action: "none" }
  | { action: "exit" }
  | { action: "message"; text: string }
  | { action: "checkpoints" }
  | { action: "rollback"; n: number }
  | { action: "sessions" }
  | { action: "resume"; id: string }
  | { action: "model" }
  | { action: "provider" }
  | { action: "thinking"; level?: "off" | "low" | "medium" | "high" }
  | { action: "permission"; level?: "plan" | "default" | "yolo" }
  | { action: "mcp" }
  | { action: "init" }
  | { action: "skills" }
  | { action: "plan"; task: string };

/** 斜杠命令清单（InputCard 补全与提示行共用）；顺序即提示行展示顺序 */
export const SLASH_COMMANDS: { name: string; hint: string }[] = [
  { name: "/plan", hint: "只读调研并产出实施计划" },
  { name: "/init", hint: "生成 AGENTS.md 模板" },
  { name: "/skills", hint: "查看能力包" },
  { name: "/mcp", hint: "MCP server 状态" },
  { name: "/cost", hint: "用量与成本" },
  { name: "/checkpoints", hint: "回滚点列表" },
  { name: "/rollback", hint: "恢复回滚点" },
  { name: "/sessions", hint: "历史会话" },
  { name: "/resume", hint: "恢复会话" },
  { name: "/model", hint: "切换模型（当前供应商）" },
  { name: "/provider", hint: "切换模型供应商" },
  { name: "/thinking", hint: "思考强度选择" },
  { name: "/permission", hint: "权限模式 plan/default/yolo" },
  { name: "/exit", hint: "退出" },
  { name: "/help", hint: "帮助" },
];

/** 输入前缀匹配的命令（用于补全提示）；prefix 为空时返回全部 */
export function matchSlashCommands(prefix: string): { name: string; hint: string }[] {
  const p = prefix.trim().toLowerCase();
  if (p === "") {
    return SLASH_COMMANDS;
  }
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(p));
}

/**
 * 解析斜杠命令。返回 action:
 * - none: 普通输入，交给模型
 * - message: 本地回复，不调用模型
 * - checkpoints / rollback: 回滚点操作（由 App 执行）
 * - exit: 退出会话
 */
export function parseCommand(input: string, usage: UsageTotals): CommandResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { action: "none" };
  }
  const [commandRaw, ...args] = trimmed.slice(1).trim().split(/\s+/);
  const command = commandRaw!.toLowerCase();
  const arg = args.join(" ");
  switch (command) {
    case "exit":
    case "quit":
      return { action: "exit" };
    case "cost":
      return {
        action: "message",
        text: `本会话用量：输入 ${usage.inputTokens} tok，输出 ${usage.outputTokens} tok，缓存读 ${usage.cacheReadTokens} tok，成本 ${usage.costUsd.toFixed(6)} USD`,
      };
    case "checkpoints":
      return { action: "checkpoints" };
    case "sessions":
      return { action: "sessions" };
    case "resume": {
      const id = args.join(" ").trim();
      if (!id) {
        return {
          action: "message",
          text: "用法：/resume <会话id>。先用 /sessions 查看可用会话。",
        };
      }
      return { action: "resume", id };
    }
    case "model":
      return { action: "model" };
    case "provider":
      return { action: "provider" };
    case "thinking": {
      const level = arg.toLowerCase();
      if (level === "") {
        return { action: "thinking" };
      }
      if (level !== "off" && level !== "low" && level !== "medium" && level !== "high") {
        return {
          action: "message",
          text: "用法：/thinking off|low|medium|high。off 关闭思考，low/medium/high 按供应商映射。",
        };
      }
      return { action: "thinking", level };
    }
    case "permission": {
      const level = arg.toLowerCase();
      if (level === "") {
        return { action: "permission" };
      }
      if (level !== "plan" && level !== "default" && level !== "yolo") {
        return {
          action: "message",
          text: "用法：/permission plan|default|yolo。plan=只读调研，default=默认审批，yolo=全自动。",
        };
      }
      return { action: "permission", level };
    }
    case "mcp":
      return { action: "mcp" };
    case "init":
      return { action: "init" };
    case "skills":
      return { action: "skills" };
    case "plan": {
      const task = args.join(" ").trim();
      if (!task) {
        return {
          action: "message",
          text: "用法：/plan <任务描述>。agent 会只读调研并产出实施计划，确认后再执行。",
        };
      }
      return { action: "plan", task };
    }
    case "rollback": {
      const n = Number(arg);
      if (!arg || !Number.isInteger(n) || n < 1) {
        return {
          action: "message",
          text: "用法：/rollback <编号>。先用 /checkpoints 查看可用回滚点。",
        };
      }
      return { action: "rollback", n };
    }
    case "help":
      return {
        action: "message",
        text: "可用命令：/cost（用量与成本）、/checkpoints（回滚点列表）、/rollback <n>（恢复）、/sessions（会话列表）、/resume <id>（恢复会话）、/model（切换模型）、/provider（切换供应商）、/thinking（思考强度）、/permission（权限模式）、/exit（退出）。",
      };
    default:
      return {
        action: "message",
        text: `未知命令 "${input.trim()}"。可用命令：/cost、/checkpoints、/rollback <n>、/sessions、/resume <id>、/model、/provider、/thinking、/permission、/exit、/help`,
      };
  }
}
