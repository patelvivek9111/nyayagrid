import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
    // Integration suites share one Postgres database and a global (non-org-scoped) legal
    // authority corpus. Running files sequentially keeps each suite's beforeAll/afterAll
    // fixture setup and teardown from racing another file's assertions against that shared state.
    fileParallelism: false,
  },
});
