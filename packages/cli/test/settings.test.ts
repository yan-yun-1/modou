import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadSettings,
  resolveApiKey,
  saveSettings,
  settingsFile,
  type Settings,
} from "../src/settings.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "luban-home-"));
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
    await mkdir(join(home, ".luban"), { recursive: true });
    await writeFile(settingsFile(home), '{"provider":"nope"}', "utf8");
    await expect(loadSettings(home)).rejects.toThrow(/settings\.json/);
  });

  it("rejects corrupted JSON with a readable error", async () => {
    await mkdir(join(home, ".luban"), { recursive: true });
    await writeFile(settingsFile(home), "{broken", "utf8");
    await expect(loadSettings(home)).rejects.toThrow(/settings\.json/);
  });

  it("resolveApiKey prefers the explicit key over the environment", () => {
    expect(resolveApiKey({ ...valid, apiKey: "explicit" }, { LUBAN_API_KEY: "env" })).toBe(
      "explicit",
    );
    expect(resolveApiKey({ ...valid, apiKey: undefined }, { LUBAN_API_KEY: "env" })).toBe("env");
    expect(resolveApiKey({ ...valid, apiKey: undefined }, {})).toBeUndefined();
  });

  it("adds a default permissionMode when missing", async () => {
    await saveSettings({ ...valid, permissionMode: undefined as never }, home);
    const loaded = await loadSettings(home);
    expect(loaded?.permissionMode).toBe("default");
  });
});
