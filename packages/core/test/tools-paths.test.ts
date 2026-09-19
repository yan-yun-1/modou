import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWithin, toDisplayPath } from "../src/tools/paths.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-paths-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolveWithin", () => {
  it("resolves relative paths to absolute under root", () => {
    expect(resolveWithin(dir, "src/a.ts")).toContain("src");
  });

  it("accepts paths already inside root given as absolute", () => {
    const abs = join(dir, "a.ts");
    expect(resolveWithin(dir, abs)).toBe(abs);
  });

  it("throws on traversal escaping the root", () => {
    expect(() => resolveWithin(dir, "../outside.txt")).toThrow(/越界/);
  });

  it("allows the root itself", () => {
    expect(resolveWithin(dir, ".")).toBe(dir);
  });
});

describe("toDisplayPath", () => {
  it("always produces forward-slash relative paths, even from absolute Windows paths", () => {
    const abs = join(dir, "src", "utils", "a.ts");
    expect(toDisplayPath(dir, abs)).toBe("src/utils/a.ts");
  });

  it("normalizes an already-relative path with backslashes", () => {
    expect(toDisplayPath(dir, "src\\a.ts")).toBe("src/a.ts");
  });
});
