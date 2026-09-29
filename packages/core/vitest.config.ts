import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // bash/checkpoint 等真实子进程用例在 turbo 并发负载下偶超 5s 默认值（抖动源）
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
