import type { UsageTotals } from "@luban/core";

export type CommandResult =
  | { action: "none" }
  | { action: "exit" }
  | { action: "message"; text: string }
  | { action: "checkpoints" }
  | { action: "rollback"; n: number }
  | { action: "sessions" }
  | { action: "resume"; id: string }
  | { action: "model" }
  | { action: "mcp" }
  | { action: "plan"; task: string };

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
    case "mcp":
      return { action: "mcp" };
    case "plan": {
      const task = args.join(" ").trim();
      if (!task) {
        return { action: "message", text: "用法：/plan <任务描述>。agent 会只读调研并产出实施计划，确认后再执行。" };
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
        text: "可用命令：/cost（用量与成本）、/checkpoints（回滚点列表）、/rollback <n>（恢复）、/sessions（会话列表）、/resume <id>（恢复会话）、/model（切换模型）、/exit（退出）。",
      };
    default:
      return {
        action: "message",
        text: `未知命令 "${input.trim()}"。可用命令：/cost、/checkpoints、/rollback <n>、/sessions、/resume <id>、/model、/exit、/help`,
      };
  }
}
