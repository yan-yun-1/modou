import type { UsageTotals } from "@luban/core";

export type CommandResult =
  { action: "none" } | { action: "exit" } | { action: "message"; text: string };

/**
 * 解析斜杠命令。返回 action:
 * - none: 普通输入，交给模型
 * - message: 本地回复，不调用模型
 * - exit: 退出会话
 */
export function parseCommand(input: string, usage: UsageTotals): CommandResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { action: "none" };
  }
  const command = trimmed.slice(1).trim().toLowerCase();
  switch (command) {
    case "exit":
    case "quit":
      return { action: "exit" };
    case "cost":
      return {
        action: "message",
        text: `本会话用量：输入 ${usage.inputTokens} tok，输出 ${usage.outputTokens} tok，缓存读 ${usage.cacheReadTokens} tok，成本 ${usage.costUsd.toFixed(6)} USD`,
      };
    case "help":
      return {
        action: "message",
        text: "可用命令：/cost（查看用量与成本）、/exit（退出）。权限模式与预算在 settings.json 配置。",
      };
    default:
      return {
        action: "message",
        text: `未知命令 "${input.trim()}"。可用命令：/cost、/exit、/help`,
      };
  }
}
