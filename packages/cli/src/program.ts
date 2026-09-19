import { Command } from "commander";
import { VERSION } from "@luban/core";

export function buildProgram(): Command {
  return new Command()
    .name("luban")
    .description("鲁班 Luban —— 开源 Agent 编程引擎（headless 核心 + 终端 CLI）")
    .version(VERSION);
}
