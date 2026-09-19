import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRepoMap } from "../src/context/repo-map.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-repomap-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("buildRepoMap", () => {
  it("lists code files with extracted signatures", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "agent.ts"),
      "export class AgentLoop {\n  run() {}\n}\nexport function compact() {}\ninterface Options {}\n",
      "utf8",
    );
    await writeFile(
      join(dir, "src", "utils.py"),
      "def calculate_total(price):\n    return price\n\nclass Cart:\n    pass\n",
      "utf8",
    );
    const map = await buildRepoMap({ cwd: dir });
    expect(map).toContain("src/agent.ts");
    expect(map).toContain("AgentLoop");
    expect(map).toContain("compact");
    expect(map).toContain("src/utils.py");
    expect(map).toContain("calculate_total");
    expect(map).toContain("Cart");
  });

  it("ignores node_modules and non-code files", async () => {
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(dir, "node_modules", "pkg", "index.js"), "function hidden() {}", "utf8");
    await writeFile(join(dir, "readme.md"), "# readme", "utf8");
    const map = await buildRepoMap({ cwd: dir });
    expect(map).not.toContain("node_modules");
    expect(map).not.toContain("hidden");
    expect(map).not.toContain("readme.md");
  });

  it("respects the character budget and marks truncation", async () => {
    await mkdir(join(dir, "gen"), { recursive: true });
    for (let i = 0; i < 50; i++) {
      await writeFile(
        join(dir, "gen", `f${i}.ts`),
        `export function functionWithAVeryLongName${i}() {}\n`,
        "utf8",
      );
    }
    const map = await buildRepoMap({ cwd: dir, maxChars: 800 });
    expect(map.length).toBeLessThanOrEqual(900);
    expect(map).toContain("截断");
  });
});
