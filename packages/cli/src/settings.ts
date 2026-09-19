import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const providerNames = [
  "anthropic",
  "openai",
  "glm",
  "deepseek",
  "qwen",
  "kimi",
  "openrouter",
  "ollama",
] as const;

export const settingsSchema = z.object({
  provider: z.enum(providerNames),
  modelId: z.string().min(1),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  permissionMode: z.enum(["plan", "default", "yolo"]).default("default"),
  budgetUsd: z.number().positive().optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type ProviderName = (typeof providerNames)[number];

export function settingsDir(home: string = homedir()): string {
  return join(home, ".luban");
}

export function settingsFile(home: string = homedir()): string {
  return join(settingsDir(home), "settings.json");
}

/** 读取全局设置；文件不存在返回 null（触发首次引导），内容非法则给出可读错误。 */
export async function loadSettings(home: string = homedir()): Promise<Settings | null> {
  let raw: string;
  try {
    raw = await readFile(settingsFile(home), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `settings.json 不是合法 JSON：${settingsFile(home)}（${(error as Error).message}）`,
      {
        cause: error,
      },
    );
  }
  const result = settingsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`settings.json 配置无效：${issues}（文件：${settingsFile(home)}）`);
  }
  return result.data;
}

export async function saveSettings(settings: Settings, home: string = homedir()): Promise<void> {
  const dir = settingsDir(home);
  await mkdir(dir, { recursive: true });
  const file = settingsFile(home);
  await writeFile(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  try {
    await chmod(file, 0o600);
  } catch {
    // Windows 不支持 POSIX 权限位，忽略
  }
}

/** API key 解析：显式配置优先，其次环境变量 LUBAN_API_KEY。 */
export function resolveApiKey(
  settings: Settings,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return settings.apiKey ?? env.LUBAN_API_KEY;
}
