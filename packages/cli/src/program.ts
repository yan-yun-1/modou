import { homedir } from "node:os";
import { resolve } from "node:path";
import { Command } from "commander";
import { VERSION } from "@modou-dev/core";
import { runModelCommand, runProviderCommand } from "./model-command.js";
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
    .description("重新选择当前供应商下的模型（写入 settings.json，重启后生效）")
    .action(async () => {
      await runModelCommand(homedir());
    });

  program
    .command("serve")
    .description("启动 HTTP+SSE 会话服务（多端复用，PRD F18；esc/接口见 docs/plan-m4.md）")
    .option("--port <n>", "监听端口", "4711")
    .option("--host <h>", "监听地址", "127.0.0.1")
    .action(async (options: { port: string; host: string }) => {
      const { ModouServer } = await import("@modou-dev/server");
      const server = new ModouServer({ port: Number(options.port), host: options.host });
      const { port, host } = await server.start();
      process.stdout.write(`[modou] serve 已启动：http://${host}:${port}（POST /sessions 创建会话，GET /sessions/:id/events 订阅 SSE）
`);
      const shutdown = async () => {
        await server.close();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());
    });

  program
    .command("acp")
    .description("以 ACP agent 模式运行（stdio JSON-RPC，供 Zed/JetBrains 接入，PRD F19）")
    .action(async () => {
      const { runAcpAgent } = await import("@modou-dev/sdk");
      runAcpAgent({});
    });

  program
    .command("provider")
    .description("切换模型供应商（含 API Key 与模型选择，写入 settings.json）")
    .action(async () => {
      await runProviderCommand(homedir());
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
