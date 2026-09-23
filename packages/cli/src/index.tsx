#!/usr/bin/env node
import { homedir } from "node:os";
import { Box, render } from "ink";
import { GitCheckpointer, SessionStore } from "@modou-dev/core";
import { ModouApp } from "./app.js";
import { ApprovalBridge } from "./approval-bridge.js";
import { runModelCommand } from "./model-command.js";
import { Onboarding } from "./onboarding.js";
import { loadSettings, loadModelOverrides, migrateLegacyDir, type Settings } from "./settings.js";
import { runPrintMode } from "./print-mode.js";
import { createLoopFromSettings } from "./loop-factory.js";
import { buildProgram } from "./program.js";
import { printLogo, shouldPrintLogo } from "./logo.js";
import { VERSION } from "@modou-dev/core";

interface CliOptions {
  print?: string;
  continue?: boolean;
  logo?: boolean; // commander 的 --no-logo 映射：未传=true，传了=false
}

async function main(options: CliOptions): Promise<void> {
  // 更名迁移（M3 R0）：旧 ~/.luban → ~/.modou，失败静默（不影响启动）
  await migrateLegacyDir(homedir());
  if (options.print) {
    if (shouldPrintLogo(!options.logo)) {
      printLogo();
      process.stderr.write(`  墨斗 v${VERSION}

`);
    }
    await runPrintCommand(options.print);
    return;
  }
  await runInteractive(options.continue ?? false, {
    showLogo: shouldPrintLogo(!options.logo),
  });
}

/** 无头模式：modou -p "任务" */
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
  process.stderr.write(`[modou] 成本 ${result.costUsd.toFixed(6)} USD\n`);
  process.exitCode = result.exitCode;
}

async function requireSettings(): Promise<Settings> {
  const settings = await loadSettings(homedir());
  if (!settings) {
    process.stderr.write(
      "[modou] 尚未配置：先运行 `modou` 完成首次引导，或在 ~/.modou/settings.json 手动配置。\n",
    );
    process.exit(1);
  }
  return settings;
}

/** 交互模式：必要时先跑引导，然后进入 TUI；--continue 恢复最近会话 */
async function runInteractive(
  useContinue: boolean,
  options?: { showLogo?: boolean },
): Promise<void> {
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
      process.stderr.write("[modou] 没有可恢复的历史会话，将开始新会话。\n");
    }
  }

  const approvals = new ApprovalBridge();
  const checkpointer = new GitCheckpointer(process.cwd());

  // T10：TUI 先行——App 立即渲染（loop=null 装配态），MCP/repo map 后台装配完成后传入 bundle
  let instance: ReturnType<typeof render> | null = null;
  const onModelSwitch = () => {
    instance?.unmount();
    void (async () => {
      await runModelCommand(home);
      await runInteractive(false);
    })();
  };

  const promise = createLoopFromSettings({
    settings,
    cwd: process.cwd(),
    modelOverrides: await loadModelOverrides(home),
    approvals,
    checkpointer,
    store,
    sessionId: resumeId,
  });

  const app = (
    <ModouApp
      loop={null}
      sessionId="boot"
      store={store}
      approvals={approvals}
      budgetUsd={settings.budgetUsd}
      modelId={settings.modelId}
      permissionMode={settings.permissionMode}
      onModelSwitch={onModelSwitch}
      onAssemble={promise}
      showLogo={options?.showLogo ?? false}
    />
  );
  instance = render(app);
  void promise;
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
            process.stderr.write(`[modou] ${message}\n`);
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
