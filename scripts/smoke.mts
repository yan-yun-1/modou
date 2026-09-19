/**
 * 真实端到端冒烟：LUBAN_SMOKE=1 pnpm smoke
 * 默认读 ~/.luban/settings.json 的模型配置（当前为 GLM glm-4.5-air）；
 * SMOKE_PROVIDER / SMOKE_MODEL / SMOKE_API_KEY 环境变量可覆盖。
 * 目录外模型需在 ~/.luban/models.json 提供能力声明。
 */
import { homedir } from "node:os";
import { runPrintMode } from "../packages/cli/src/print-mode.js";
import {
  loadModelOverrides,
  loadSettings,
  type ProviderName,
  type Settings,
} from "../packages/cli/src/settings.js";

const enabled = process.env.LUBAN_SMOKE === "1";
if (!enabled) {
  console.log("跳过冒烟测试（设置 LUBAN_SMOKE=1 启用）");
  process.exit(0);
}

const userSettings = await loadSettings(homedir());
const provider = (process.env.SMOKE_PROVIDER ?? userSettings?.provider ?? "ollama") as ProviderName;
const modelId = process.env.SMOKE_MODEL ?? userSettings?.modelId ?? "llama3.2:1b";
const settings: Settings = {
  provider,
  modelId,
  apiKey: process.env.SMOKE_API_KEY ?? userSettings?.apiKey,
  permissionMode: "default",
};
const modelOverrides = await loadModelOverrides(homedir());

console.log(`[smoke] provider=${provider} model=${modelId}`);
console.log("[smoke] 任务：读取 package.json 并用一句话总结这个项目是做什么的");

const started = Date.now();
const result = await runPrintMode({
  settings,
  modelOverrides,
  cwd: process.cwd(),
  prompt: "读取 package.json 并用一句话总结这个项目是做什么的。",
});
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(
  `[smoke] 耗时 ${seconds}s，成本 ${result.costUsd.toFixed(6)} USD，exit=${result.exitCode}`,
);
console.log("[smoke] 输出：");
console.log(result.output || "（空）");
process.exit(result.exitCode === 0 && result.output.length > 0 ? 0 : 1);
