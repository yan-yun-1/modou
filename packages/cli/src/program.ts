import { homedir } from "node:os";
import { Command } from "commander";
import { VERSION } from "@luban/core";
import { runModelCommand } from "./model-command.js";

export function buildProgram(): Command {
  const program = new Command()
    .name("luban")
    .description("鲁班 Luban —— 开源 Agent 编程引擎（headless 核心 + 终端 CLI）")
    .version(VERSION)
    .option("--continue", "恢复最近一次会话");

  program
    .command("model")
    .description("重新选择模型提供商与模型（写入 settings.json，重启后生效）")
    .action(async () => {
      await runModelCommand(homedir());
    });

  return program;
}
