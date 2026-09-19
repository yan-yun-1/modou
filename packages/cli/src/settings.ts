import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { modelCapabilitiesSchema, type ModelCapabilities } from "@luban/core";

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
  /** MCP servers（契约增补：plan-m2 N3） */
  mcpServers: z
    .record(
      z.string().min(1),
      z.union([
        z.object({
          command: z.string().min(1),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
        }),
        z.object({
          url: z.string().min(1),
          headers: z.record(z.string(), z.string()).optional(),
        }),
      ]),
    )
    .optional(),
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

export function modelOverridesFile(home: string = homedir()): string {
  return join(settingsDir(home), "models.json");
}

const overridesFileSchema = z.union([
  z.array(modelCapabilitiesSchema),
  z.object({ models: z.array(modelCapabilitiesSchema) }).transform((wrapper) => wrapper.models),
]);

/**
 * 读取 ~/.luban/models.json 的自定义模型能力声明（backlog #10）。
 * 支持两种形态：裸数组 [{...}] 或 { "models": [{...}] }。
 * 文件不存在返回空数组；内容非法抛出含文件路径的可读错误。
 */
export async function loadModelOverrides(home: string = homedir()): Promise<ModelCapabilities[]> {
  let raw: string;
  try {
    raw = await readFile(modelOverridesFile(home), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `models.json 不是合法 JSON：${modelOverridesFile(home)}（${(error as Error).message}）`,
      { cause: error },
    );
  }
  const result = overridesFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`models.json 配置无效：${issues}（文件：${modelOverridesFile(home)}）`);
  }
  return result.data;
}
