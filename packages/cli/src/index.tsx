#!/usr/bin/env node
import { homedir } from "node:os";
import { Box } from "ink";
import { GitCheckpointer, SessionStore } from "@luban/core";
import { LubanApp } from "./app.js";
import { ApprovalBridge } from "./approval-bridge.js";
import { runModelCommand } from "./model-command.js";
import { Onboarding } from "./onboarding.js";
import { loadSettings, loadModelOverrides, type Settings } from "./settings.js";
import { runPrintMode } from "./print-mode.js";
import { createLoopFromSettings } from "./loop-factory.js";
import { render } from "ink";
import { buildProgram } from "./program.js";

interface CliOptions {
  print?: string;
  continue?: boolean;
}

async function main(options: CliOptions): Promise<void> {
  if (options.print) {
    await runPrintCommand(options.print);
    return;
  }
  await runInteractive(options.continue ?? false);
}

/** 无头模式：luban -p "任务" */
async function runPrintCommand(prompt: string): Promise<void> {
  const settings = await requireSettings();
  const result = await runPrintMode({
    settings,
    modelOverrides: await loadModelOverrides(homedir()),
    cwd: process.cwd(),
    prompt,
  });
  if (result.output) {
    process.stdout.write(`${result.output}\n`);
  }
  process.stderr.write(`[luban] 成本 ${result.costUsd.toFixed(6)} USD\n`);
  process.exitCode = result.exitCode;
}

async function requireSettings(): Promise<Settings> {
  const settings = await loadSettings(homedir());
  if (!settings) {
    process.stderr.write(
      "[luban] 尚未配置：先运行 `luban` 完成首次引导，或在 ~/.luban/settings.json 手动配置。\n",
    );
    process.exit(1);
  }
  return settings;
}

/** 交互模式：必要时先跑引导，然后进入 TUI；--continue 恢复最近会话 */
async function runInteractive(useContinue: boolean): Promise<void> {
  const home = homedir();
  let settings = await loadSettings(home);
  if (!settings) {
    settings = await runOnboarding(home);
  }

  const store = new SessionStore();
  let resumeId: string | undefined;
  if (useContinue) {
    const ids = await store.list();
    resumeId = ids.at(-1);
    if (!resumeId) {
      process.stderr.write("[luban] 没有可恢复的历史会话，将开始新会话。\n");
    }
  }

  const approvals = new ApprovalBridge();
  const checkpointer = new GitCheckpointer(process.cwd());
  const bundle = await createLoopFromSettings({
    settings,
    cwd: process.cwd(),
    modelOverrides: await loadModelOverrides(home),
    approvals,
    checkpointer,
    store,
    sessionId: resumeId,
  });

  const instance = render(
    // exitOnCtrlC=false：Ctrl+C 语义由 App 内部处理（任务中断/双击退出）
    <LubanApp
      loop={bundle.loop}
      sessionId={bundle.sessionId}
      store={bundle.store}
      mcpStatus={bundle.mcpStatus}
      approvals={bundle.approvals}
      checkpointer={bundle.checkpointer}
      budgetUsd={settings.budgetUsd}
      onUsageChange={(usage) => bundle.updateSpent(usage.costUsd)}
      onModelSwitch={() => {
        instance.unmount();
        void (async () => {
          await runModelCommand(home);
          await runInteractive(false);
        })();
      }}
    />,
  );
  await instance.waitUntilExit();
}

async function runOnboarding(home: string): Promise<Settings> {
  return new Promise((resolve) => {
    const instance = render(
      <Box>
        <Onboarding
          home={home}
          onDone={(doneSettings) => {
            instance.unmount();
            resolve(doneSettings);
          }}
          onError={(message) => {
            instance.unmount();
            process.stderr.write(`[luban] ${message}\n`);
            process.exit(1);
          }}
        />
      </Box>,
    );
  });
}

const program = buildProgram();
program.action(() => main(program.opts<CliOptions>()));
program.parseAsync();
