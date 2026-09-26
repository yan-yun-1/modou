import * as esbuild from "esbuild";

// M5 D1：扩展宿主（cjs, external vscode）与 webview（iife, browser）双入口打包
await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node24",
  external: ["vscode"],
  sourcemap: false,
  logLevel: "info",
});

await esbuild.build({
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outfile: "dist/webview/main.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "info",
});
