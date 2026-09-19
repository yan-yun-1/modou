import { Box } from "ink";
import { homedir } from "node:os";
import { render } from "ink";
import { Onboarding } from "./onboarding.js";
import { loadSettings, type Settings } from "./settings.js";

/**
 * `luban model`：重新选择模型并写回 settings.json。
 * 复用 Onboarding 组件；既有配置作为 base 合并（权限模式与预算保留）。
 * 生效时机：新配置在下一次启动 luban 时生效（当前会话不热切换）。
 */
export async function runModelCommand(home: string = homedir()): Promise<void> {
  const existing = await loadSettings(home);
  const settings = await new Promise<Settings>((resolve, reject) => {
    const instance = render(
      <Box>
        <Onboarding
          home={home}
          base={existing ?? undefined}
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
  process.stdout.write(
    `[luban] 已保存：${settings.provider} / ${settings.modelId}。重启 luban 后生效。\n`,
  );
}
