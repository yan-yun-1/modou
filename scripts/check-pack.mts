/**
 * M5 A1（dogfood-m3 #5）：发布物校验——防止 workspace: 协议泄漏事故重演。
 *
 * 事故背景（2026-09-26）：@modou-dev/sdk、server@0.5.0-alpha 的依赖字段含 pnpm 专用的
 * `workspace:*` 协议就发了 npm，第三方 `npm install` 直接报 EUNSUPPORTEDPROTOCOL，
 * 被迫重发 0.5.0-alpha.1。npm publish 不会做任何替换，pnpm publish/pack 才会。
 *
 * 原理：pnpm pack 与 pnpm publish 走同一套 manifest 变换（workspace: 替换），
 * 因此 pack 出 tarball、解出 package/package.json 扫描依赖字段，即可代表真实发布物。
 *
 * 用法：pnpm check:pack [包目录...]（缺省校验 packages/ 下全部包）
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 消费者会实际安装的依赖字段；devDependencies 不会装给消费者，workspace: 在其中无害 */
export const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/** 扫描 manifest 依赖字段中的 workspace: 协议，返回 "字段.包名: 版本范围" 列表 */
export function collectWorkspaceRefs(pkg: Record<string, unknown>): string[] {
  const refs: string[] = [];
  for (const field of DEP_FIELDS) {
    const deps = pkg[field] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        refs.push(`${field}.${name}: ${range}`);
      }
    }
  }
  return refs;
}

/**
 * 从 tarball 提取 package/package.json。
 * 依赖系统 tar（Windows 10+ 自带 bsdtar，macOS/Linux 内置），不引第三方解包依赖。
 * 用相对路径 + cwd 规避 GNU tar 把 "C:/..." 当远程主机名的问题（bsdtar 无此问题，两者兼容）。
 */
export function readPackagedManifest(tgz: string): Record<string, unknown> {
  const res = spawnSync("tar", ["-xzOf", basename(tgz), "package/package.json"], {
    cwd: dirname(tgz),
    encoding: "utf8",
  });
  if (res.status !== 0 || !res.stdout) {
    throw new Error(`tar 解包失败（${tgz}）：${res.stderr}`);
  }
  return JSON.parse(res.stdout) as Record<string, unknown>;
}

/** pack 指定包并扫描发布物 manifest，返回 workspace: 引用列表（空数组=通过） */
export async function packAndScan(pkgDir: string): Promise<string[]> {
  const tmp = await mkdtemp(join(tmpdir(), "check-pack-"));
  try {
    // pnpm 在 Windows 上是 .cmd，必须经 shell 解析；shell 模式下用单命令字符串避免转义歧义
    const res = spawnSync(`pnpm pack --json --pack-destination "${tmp}"`, {
      cwd: pkgDir,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (res.status !== 0) {
      throw new Error(`pnpm pack 失败（${pkgDir}）：${res.stderr}`);
    }
    // pnpm pack --json 输出单个 JSON 对象（filename 为绝对路径）；兼容 npm 风格的数组
    const parsed = JSON.parse(res.stdout.slice(res.stdout.indexOf("{"))) as
      | { filename: string }
      | { filename: string }[];
    const entry = Array.isArray(parsed) ? parsed[0]! : parsed;
    const tgz = join(tmp, basename(entry.filename));
    return collectWorkspaceRefs(readPackagedManifest(tgz));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).map((d) => resolve(d));
  const dirs = args.length > 0 ? args : (await readdir("packages", { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => join("packages", e.name));

  let failed = false;
  for (const dir of dirs) {
    const refs = await packAndScan(dir);
    if (refs.length > 0) {
      failed = true;
      console.error(`✗ ${dir} 发布物含 workspace: 协议（第三方将无法安装）：`);
      for (const ref of refs) console.error(`    ${ref}`);
    } else {
      console.log(`✓ ${dir}`);
    }
  }
  if (failed) process.exit(1);
}

// 被 vitest 导入时不执行 main
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
