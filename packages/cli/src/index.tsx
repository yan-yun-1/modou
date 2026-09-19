#!/usr/bin/env node
import { homedir } from "node:os";
import { Box } from "ink";
import {
  AgentLoop,
  PermissionEngine,
  SessionStore,
  createBuiltinTools,
  createLanguageModel,
  buildSystemPrompt,
  resolveCapabilities,
} from "@luban/core";
import { LubanApp } from "./app.js";
import { ApprovalBridge } from "./approval-bridge.js";
import { Onboarding } from "./onboarding.js";
import { loadSettings, resolveApiKey, type Settings } from "./settings.js";
import { runPrintMode } from "./print-mode.js";
import { render } from "ink";
import { buildProgram } from "./program.js";

interface CliOptions {
  print?: string;
}

async function main(options: CliOptions): Promise<void> {
  if (options.print) {
    await runPrintCommand(options.print);
    return;
  }
  await runInteractive();
}

/** 无头模式：luban -p "任务" */
async function runPrintCommand(prompt: string): Promise<void> {
  const settings = await requireSettings();
  const result = await runPrintMode({
    settings,
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

/** 交互模式：必要时先跑引导，然后进入 TUI */
async function runInteractive(): Promise<void> {
  const home = homedir();
  let settings = await loadSettings(home);
  if (!settings) {
    settings = await runOnboarding(home);
  }

  const capabilities = resolveCapabilities(settings.provider, settings.modelId);
  const model = createLanguageModel({
    provider: settings.provider,
    modelId: settings.modelId,
    apiKey: resolveApiKey(settings),
    baseURL: settings.baseURL,
  });
  const tools = createBuiltinTools();
  const approvals = new ApprovalBridge();
  const store = new SessionStore();
  const sessionId = await store.create();
  let spent = 0;

  const loop = new AgentLoop({
    model,
    capabilities,
    tools,
    store,
    permissions: new PermissionEngine({ mode: settings.permissionMode ?? "default" }),
    approve: (req) => approvals.request(req),
    systemPrompt: buildSystemPrompt({
      cwd: process.cwd(),
      platform: process.platform,
      tools: tools.names(),
    }),
    cwd: process.cwd(),
    isOverBudget: () => settings.budgetUsd !== undefined && spent > settings.budgetUsd,
  });

  const instance = render(
    <LubanApp
      loop={loop}
      sessionId={sessionId}
      approvals={approvals}
      budgetUsd={settings.budgetUsd}
      onUsageChange={(usage) => {
        spent = usage.costUsd;
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
