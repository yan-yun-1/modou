import { homedir } from "node:os";
import { resolve } from "node:path";
import { Command } from "commander";
import { VERSION } from "@modou-dev/core";
import { runModelCommand } from "./model-command.js";
import { initAgentsMd } from "./init.js";

export function buildProgram(): Command {
  const program = new Command()
    .name("modou")
    .description("墨斗 Modou —— 开源 Agent 编程引擎（headless 核心 + 终端 CLI）")
    .version(VERSION)
    .option("--continue", "恢复最近一次会话")
    .option("-p, --print <任务>", "无头模式：单任务执行后退出（CI/脚本可用）")
    .option("--no-logo", "不打印启动 Logo");

  program
    .command("model")
    .description("重新选择模型提供商与模型（写入 settings.json，重启后生效）")
    .action(async () => {
      await runModelCommand(homedir());
    });

  program
    .command("init")
    .description("在当前目录生成 AGENTS.md 模板（Agent 项目约定；已存在则不覆盖）")
    .argument("[dir]", "目标目录", ".")
    .action(async (dir: string) => {
      const result = await initAgentsMd(resolve(dir));
      process.stdout.write(`[modou] ${result.message}\n`);
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  return program;
}
