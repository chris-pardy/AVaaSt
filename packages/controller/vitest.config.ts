import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@avaast/gateway": resolve(__dirname, "../gateway/src/index.ts"),
      "@avaast/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
