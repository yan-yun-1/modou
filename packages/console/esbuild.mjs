import * as esbuild from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// plan-web B1：console 构建双职责——
// ① esbuild 打包（iife + preact jsx automatic）
// ② 产物复制进 server 包 webui/（发布形态随 @modou-dev/server tarball 分发）

const here = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  outfile: "dist/assets/index.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  sourcemap: false,
  minify: true,
  logLevel: "info",
});

mkdirSync(join(here, "dist"), { recursive: true });
copyFileSync(join(here, "index.html"), join(here, "dist", "index.html"));

// 开发态解析：packages/console/dist → packages/server/webui
const serverWebui = join(here, "..", "server", "webui");
rmSync(serverWebui, { recursive: true, force: true });
cpSync(join(here, "dist"), serverWebui, { recursive: true });
console.log(`[console] dist copied → ${serverWebui}`);
