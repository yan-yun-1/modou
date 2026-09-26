import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectWorkspaceRefs, readPackagedManifest } from "../../../scripts/check-pack.mts";

// M5 A1（dogfood-m3 #5）：发布物校验测试。
// 事故样本：0.5.0-alpha 的 sdk/server 以 workspace:* 依赖发上 npm，第三方安装即报错。
// npm publish 不做任何 manifest 替换，故用 npm pack 复现泄漏路径；pnpm publish 的替换
// 行为由 A1 脚本主流程（packAndScan → pnpm pack）在真实发布前把关。

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pack-check-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeFixture(name: string, deps: Record<string, string>): Promise<string> {
  const pkgDir = join(dir, name);
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js", dependencies: deps }),
    "utf8",
  );
  await writeFile(join(pkgDir, "index.js"), "export {};\n", "utf8");
  return pkgDir;
}

/** npm pack（不做 workspace: 替换，与 npm publish 行为一致），返回解出的 manifest */
function npmPack(pkgDir: string): Record<string, unknown> {
  const dest = join(dir, "packed");
  mkdirSync(dest, { recursive: true });
  const res = spawnSync("npm", ["pack", "--json", "--pack-destination", dest], {
    cwd: pkgDir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  expect(res.status).toBe(0);
  const start = res.stdout.indexOf("[");
  const packed = JSON.parse(res.stdout.slice(start)) as { filename: string }[];
  return readPackagedManifest(join(dest, packed[0]!.filename));
}

describe("check-pack（A1 发布物校验）", () => {
  it("collectWorkspaceRefs 扫描三个安装态依赖字段、忽略 devDependencies", () => {
    const pkg = {
      dependencies: { "@modou-dev/core": "workspace:*", zod: "^4.6.5" },
      peerDependencies: { react: "workspace:^18" },
      optionalDependencies: { fsevents: "workspace:*" },
      devDependencies: { turbo: "workspace:*" },
    };
    expect(collectWorkspaceRefs(pkg)).toEqual([
      "dependencies.@modou-dev/core: workspace:*",
      "peerDependencies.react: workspace:^18",
      "optionalDependencies.fsevents: workspace:*",
    ]);
  });

  it("干净依赖返回空列表", () => {
    expect(collectWorkspaceRefs({ dependencies: { zod: "^4.6.5" } })).toEqual([]);
  });

  it("事故样本：npm publish 路径下 workspace:* 原样进入发布物（校验必须能拦下）", async () => {
    const pkgDir = await makeFixture("pack-check-bad", { "@modou-dev/core": "workspace:*" });
    const manifest = npmPack(pkgDir);
    expect(collectWorkspaceRefs(manifest)).toEqual(["dependencies.@modou-dev/core: workspace:*"]);
  });

  it("正常版本号的发布物无引用", async () => {
    const pkgDir = await makeFixture("pack-check-good", { "@modou-dev/core": "0.5.0-alpha" });
    const manifest = npmPack(pkgDir);
    expect(collectWorkspaceRefs(manifest)).toEqual([]);
  });
});
