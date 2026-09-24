import { Box } from "ink";
import { homedir } from "node:os";
import { render } from "ink";
import { Onboarding } from "./onboarding.js";
import { isKnownProvider } from "./provider-models.js";
import { loadSettings, type ProviderName, type Settings } from "./settings.js";

/**
 * `modou model` / 会话内 /model：重新选择**当前供应商下的模型**并写回 settings.json。
 * 复用 Onboarding 组件（initialProvider 跳过供应商选择，直接进 Key/模型列表步骤）；
 * 既有配置作为 base 合并（权限模式与预算保留）。
 * 生效时机：新配置在下一次启动 modou 时生效（当前会话不热切换）。
 */
export async function runModelCommand(home: string = homedir()): Promise<void> {
  const existing = await loadSettings(home);
  const provider = existing && isKnownProvider(existing.provider) ? existing.provider : undefined;
  if (!existing || !provider) {
    // 没有有效配置：走完整引导（供应商 → Key → 模型）
    return runFullOnboarding(home);
  }
  const settings = await renderOnboarding({
    home,
    base: existing,
    initialProvider: provider as ProviderName,
  });
  process.stdout.write(`[modou] 已保存：${settings.provider} / ${settings.modelId}。重启 modou 后生效。\n`);
}

/**
 * `modou provider` / 会话内 /provider：重新选择模型供应商（含 Key 与模型），全流程引导。
 */
export async function runProviderCommand(home: string = homedir()): Promise<void> {
  return runFullOnboarding(home);
}

async function runFullOnboarding(home: string): Promise<void> {
  const existing = await loadSettings(home);
  const settings = await renderOnboarding({ home, base: existing ?? undefined });
  process.stdout.write(
    `[modou] 已保存：${settings.provider} / ${settings.modelId}。重启 modou 后生效。\n`,
  );
}

function renderOnboarding(options: {
  home: string;
  base?: Settings;
  initialProvider?: Settings["provider"];
}): Promise<Settings> {
  const { home, base, initialProvider } = options;
  return new Promise<Settings>((resolve, reject) => {
    const instance = render(
      <Box>
        <Onboarding
          home={home}
          base={base}
          initialProvider={initialProvider}
          onDone={(done) => {
            instance.unmount();
            resolve(done);
          }}
          onError={(message) => {
            instance.unmount();
            reject(new Error(message));
          }}
        />
      </Box>,
    );
  });
}
