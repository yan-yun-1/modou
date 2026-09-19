import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    server: {
      deps: {
        // ink 5 是 ESM-only（含 top-level await），CJS 的 ink-testing-library 在
        // Node 原生 require(esm) 下会报错；内联交给 vite 处理互操作
        inline: ["ink", "ink-testing-library", "ink-text-input"],
      },
    },
  },
});
