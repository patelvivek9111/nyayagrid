import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@nyayagrid/intelligence": path.resolve(__dirname, "../../packages/intelligence/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
