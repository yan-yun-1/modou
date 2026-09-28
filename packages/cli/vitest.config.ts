import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    // Ink 渲染帧与 npm/git 子进程类用例在高负载下偶超 5s 默认值（抖动源，2026-09-28）
    testTimeout: 15_000,
    hookTimeout: 15_000,
    server: {
      deps: {
        // ink 5 是 ESM-only（含 top-level await），CJS 的 ink-testing-library 在
        // Node 原生 require(esm) 下会报错；内联交给 vite 处理互操作
        inline: ["ink", "ink-testing-library", "ink-text-input"],
      },
    },
  },
});
