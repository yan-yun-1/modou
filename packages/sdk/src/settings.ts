import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  modelCapabilitiesSchema,
  permissionRuleSchema,
  type ModelCapabilities,
  type PermissionRule,
} from "@modou-dev/core";

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
  /** always-allow 白名单（M4 A3）：PermissionEngine.remember 后持久化，装配时读回 */
  permissionRules: z.array(permissionRuleSchema).optional(),
  /** 生命周期钩子（M4 D2 / PRD F14）：shell 命令，stdin 收 JSON 事件，stdout 出 JSON 决策 */
  hooks: z
    .object({
      preToolUse: z.string().min(1).optional(),
      postToolUse: z.string().min(1).optional(),
    })
    .optional(),
  /** 项目目录覆盖（契约增补 2，plan-m3 A2）：默认 process.cwd()；不存在时报错回退 */
  cwd: z.string().min(1).optional(),
  /** 思考强度（X）：off 关闭推理，low/medium/high 按供应商映射；缺省=跟随模型默认 */
  thinking: z.enum(["off", "low", "medium", "high"]).optional(),
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
export type ThinkingLevel = NonNullable<Settings["thinking"]>;

export function settingsDir(home: string = homedir()): string {
  return join(home, ".modou");
}

export function settingsFile(home: string = homedir()): string {
  return join(settingsDir(home), "settings.json");
}

/**
 * 更名迁移（M3 R0）：旧 ~/.luban 存在且 ~/.modou 不存在时，把旧目录整体复制到新目录
 * （复制而非改名，旧目录保留作回退）。任何一步失败都静默回退——迁移失败不能阻断启动。
 */
export async function migrateLegacyDir(home: string = homedir()): Promise<boolean> {
  const legacy = join(home, ".luban");
  const current = settingsDir(home);
  if (!existsSync(legacy) || existsSync(current)) {
    return false;
  }
  try {
    await mkdir(current, { recursive: true });
    const entries = await readdir(legacy, { withFileTypes: true });
    for (const entry of entries) {
      const from = join(legacy, entry.name);
      const to = join(current, entry.name);
      if (entry.isDirectory()) {
        await copyLegacyDir(from, to);
      } else {
        await copyFile(from, to);
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function copyLegacyDir(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const childFrom = join(from, entry.name);
    const childTo = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyLegacyDir(childFrom, childTo);
    } else {
      await copyFile(childFrom, childTo);
    }
  }
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

/**
 * API key 解析：显式配置优先，其次环境变量 MODOU_API_KEY（兼容旧名 LUBAN_API_KEY 一个版本周期）。
 */
export function resolveApiKey(
  settings: Settings,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return settings.apiKey ?? env.MODOU_API_KEY ?? env.LUBAN_API_KEY;
}

/**
 * A2（plan-m3）：解析实际工作目录——settings.cwd 优先，其次 fallback。
 * 配置的目录不存在时返回回退值与警告（调用方负责展示），不阻断启动。
 */
export function resolveCwd(
  settings: Settings,
  fallback: string = process.cwd(),
): { cwd: string; warning?: string } {
  if (!settings.cwd) {
    return { cwd: fallback };
  }
  if (!existsSync(settings.cwd)) {
    return {
      cwd: fallback,
      warning: `settings.cwd 不存在，已回退到 ${fallback}：${settings.cwd}`,
    };
  }
  return { cwd: settings.cwd };
}

/**
 * M4 A3：把一条 always-allow 规则持久化到 settings.json（去重）。
 * 由 loop-factory 在 PermissionEngine.onRemember 回调里调用。
 */
export async function savePermissionRule(rule: PermissionRule, home: string = homedir()): Promise<void> {
  const existing = await loadSettings(home);
  const base: Settings = existing ?? { provider: "glm", modelId: "glm-4.6", permissionMode: "default" };
  const rules = base.permissionRules ?? [];
  const duplicate = rules.some((r) => r.type === rule.type && r.value === rule.value);
  if (duplicate) {
    return;
  }
  await saveSettings({ ...base, permissionRules: [...rules, rule] }, home);
}

export function modelOverridesFile(home: string = homedir()): string {
  return join(settingsDir(home), "models.json");
}

const overridesFileSchema = z.union([
  z.array(modelCapabilitiesSchema),
  z.object({ models: z.array(modelCapabilitiesSchema) }).transform((wrapper) => wrapper.models),
]);

/**
 * 读取 ~/.modou/models.json 的自定义模型能力声明（backlog #10）。
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
