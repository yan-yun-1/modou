import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadModelOverrides,
  loadSettings,
  migrateLegacyDir,
  modelOverridesFile,
  resolveApiKey,
  resolveCwd,
  saveSettings,
  settingsDir,
  settingsFile,
  type Settings,
} from "../src/settings.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "modou-home-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const valid: Settings = {
  provider: "anthropic",
  modelId: "claude-sonnet-4-5",
  apiKey: "sk-test",
  permissionMode: "default",
};

describe("settings", () => {
  it("returns null when no settings file exists", async () => {
    expect(await loadSettings(home)).toBeNull();
  });

  it("saves and loads settings round-trip", async () => {
    await saveSettings(valid, home);
    expect(await loadSettings(home)).toEqual(valid);
  });

  it("restricts the settings file to owner-only permissions", async () => {
    await saveSettings(valid, home);
    const info = await stat(settingsFile(home));
    // Windows 不支持 POSIX 权限位，只在非 Windows 断言
    if (process.platform !== "win32") {
      expect(info.mode & 0o777).toBe(0o600);
    }
  });

  it("rejects invalid settings with a readable error", async () => {
    await mkdir(join(home, ".modou"), { recursive: true });
    await writeFile(settingsFile(home), '{"provider":"nope"}', "utf8");
    await expect(loadSettings(home)).rejects.toThrow(/settings\.json/);
  });

  it("rejects corrupted JSON with a readable error", async () => {
    await mkdir(join(home, ".modou"), { recursive: true });
    await writeFile(settingsFile(home), "{broken", "utf8");
    await expect(loadSettings(home)).rejects.toThrow(/settings\.json/);
  });

  it("resolveApiKey prefers the explicit key over the environment", () => {
    expect(resolveApiKey({ ...valid, apiKey: "explicit" }, { MODOU_API_KEY: "env" })).toBe(
      "explicit",
    );
    expect(resolveApiKey({ ...valid, apiKey: undefined }, { MODOU_API_KEY: "env" })).toBe("env");
    expect(resolveApiKey({ ...valid, apiKey: undefined }, {})).toBeUndefined();
  });

  it("adds a default permissionMode when missing", async () => {
    await saveSettings({ ...valid, permissionMode: undefined as never }, home);
    const loaded = await loadSettings(home);
    expect(loaded?.permissionMode).toBe("default");
  });
});

describe("migrateLegacyDir（~/.luban → ~/.modou，M3 R0）", () => {
  it("copies the legacy directory when it exists and the new one does not", async () => {
    const legacy = join(home, ".luban");
    await mkdir(join(legacy, "sessions"), { recursive: true });
    await writeFile(
      join(legacy, "settings.json"),
      JSON.stringify({ provider: "glm", modelId: "glm-4.5-air" }),
      "utf8",
    );
    await writeFile(join(legacy, "sessions", "s1.jsonl"), '{"type":"user_message"}', "utf8");

    const migrated = await migrateLegacyDir(home);

    expect(migrated).toBe(true);
    const loaded = await loadSettings(home);
    expect(loaded?.provider).toBe("glm");
    expect(loaded?.modelId).toBe("glm-4.5-air");
    await expect(stat(join(settingsDir(home), "sessions", "s1.jsonl"))).resolves.toBeTruthy();
    // 旧目录保留不删
    await expect(stat(join(legacy, "settings.json"))).resolves.toBeTruthy();
  });

  it("does nothing when the legacy directory is absent", async () => {
    expect(await migrateLegacyDir(home)).toBe(false);
    expect(await migrateLegacyDir(home)).toBe(false); // 幂等：再次执行同样无事发生
  });

  it("does not overwrite an existing new directory", async () => {
    await mkdir(join(home, ".luban"), { recursive: true });
    await writeFile(join(home, ".luban", "settings.json"), '{"legacy":true}', "utf8");
    await saveSettings(valid, home); // 新目录已存在且有内容

    expect(await migrateLegacyDir(home)).toBe(false);
    expect(await loadSettings(home)).toEqual(valid);
  });
});

describe("resolveCwd（A2）", () => {
  it("falls back to the caller cwd when settings.cwd is absent", () => {
    expect(resolveCwd(valid, "/tmp/fallback")).toEqual({ cwd: "/tmp/fallback" });
  });

  it("prefers settings.cwd when it exists", async () => {
    expect(resolveCwd({ ...valid, cwd: home }, "/tmp/fallback")).toEqual({ cwd: home });
  });

  it("falls back with a warning when settings.cwd does not exist", () => {
    const result = resolveCwd({ ...valid, cwd: join(home, "nope") }, "/tmp/fallback");
    expect(result.cwd).toBe("/tmp/fallback");
    expect(result.warning).toContain("回退");
    expect(result.warning).toContain(join(home, "nope"));
  });
});

describe("loadModelOverrides", () => {
  it("returns an empty array when no models.json exists", async () => {
    expect(await loadModelOverrides(home)).toEqual([]);
  });

  it("loads a valid models.json array", async () => {
    await mkdir(join(home, ".modou"), { recursive: true });
    const entry = {
      id: "glm-4.5-air",
      provider: "glm",
      displayName: "GLM-4.5-Air",
      contextWindow: 128_000,
      maxOutputTokens: 96_000,
      supportsTools: true,
      supportsReasoning: true,
      pricing: {
        inputPerMtokUsd: 0.11,
        outputPerMtokUsd: 0.28,
        cacheReadPerMtokUsd: 0.011,
        cacheWritePerMtokUsd: 0,
      },
    };
    await writeFile(modelOverridesFile(home), JSON.stringify([entry]), "utf8");
    const overrides = await loadModelOverrides(home);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.id).toBe("glm-4.5-air");
  });

  it("accepts the { models: [...] } wrapper form too", async () => {
    await mkdir(join(home, ".modou"), { recursive: true });
    const entry = {
      id: "x",
      provider: "openai",
      displayName: "X",
      contextWindow: 8,
      maxOutputTokens: 4,
      supportsTools: false,
      supportsReasoning: false,
      pricing: {
        inputPerMtokUsd: 0,
        outputPerMtokUsd: 0,
        cacheReadPerMtokUsd: 0,
        cacheWritePerMtokUsd: 0,
      },
    };
    await writeFile(modelOverridesFile(home), JSON.stringify({ models: [entry] }), "utf8");
    expect(await loadModelOverrides(home)).toHaveLength(1);
  });

  it("rejects invalid entries with a readable error", async () => {
    await mkdir(join(home, ".modou"), { recursive: true });
    await writeFile(modelOverridesFile(home), '[{"id":"broken"}]', "utf8");
    await expect(loadModelOverrides(home)).rejects.toThrow(/models\.json/);
  });

  it("rejects corrupted JSON with a readable error", async () => {
    await mkdir(join(home, ".modou"), { recursive: true });
    await writeFile(modelOverridesFile(home), "{nope", "utf8");
    await expect(loadModelOverrides(home)).rejects.toThrow(/models\.json/);
  });
});
