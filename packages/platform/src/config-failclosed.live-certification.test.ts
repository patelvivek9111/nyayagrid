/**
 * Phase 3 — production-like config fail-closed (no CourtListener, no shared schema).
 * Gated with RUN_DB_TESTS=1 or PHASE3_OPS_LIVE=1 for ops live window.
 */
import { describe, expect, it } from "vitest";
import { collectProductionConfigProblems, getAppEnv } from "./config";

const runLive = process.env.RUN_DB_TESTS === "1" || process.env.PHASE3_OPS_LIVE === "1";

describe.runIf(runLive)("Phase 3 config fail-closed live cert", () => {
  it("production-like missing DATABASE_URL is reported; never prints secret values", () => {
    const problems = collectProductionConfigProblems({
      APP_ENV: "production",
      NODE_ENV: "production",
      AUTH_PROVIDER: "clerk",
      AI_PROVIDER: "openai",
      // DATABASE_URL intentionally omitted
    } as NodeJS.ProcessEnv);
    const joined = problems.join(" | ");
    expect(problems.length).toBeGreaterThan(0);
    expect(joined).toMatch(/DATABASE_URL|database/i);
    expect(joined).not.toMatch(/sk-|postgresql:\/\/|nyayagridsecret|Bearer /i);
    expect(getAppEnv({ APP_ENV: "production", NODE_ENV: "production" })).toBe("production");
  });

  it("production AI mock is rejected without echoing secrets", () => {
    const problems = collectProductionConfigProblems({
      APP_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@localhost:5433/nyayagrid",
      AI_PROVIDER: "mock",
      EMBEDDING_PROVIDER: "mock",
      AUTH_PROVIDER: "clerk",
      CLERK_SECRET_KEY: "sk_test_SHOULD_NOT_APPEAR",
      OPENAI_API_KEY: "sk-SHOULD_NOT_APPEAR",
    } as NodeJS.ProcessEnv);
    const joined = problems.join(" | ");
    expect(joined).toMatch(/AI_PROVIDER|mock/i);
    expect(joined).not.toContain("postgresql://user:pass@");
    expect(joined).not.toContain("sk_test_SHOULD_NOT_APPEAR");
    expect(joined).not.toContain("sk-SHOULD_NOT_APPEAR");
  });

  it("INNGEST_DISABLED is unsafe in production-like config", () => {
    const problems = collectProductionConfigProblems({
      APP_ENV: "production",
      INNGEST_DISABLED: "1",
      DATABASE_URL: "postgresql://localhost/nyayagrid",
      AUTH_PROVIDER: "clerk",
    } as NodeJS.ProcessEnv);
    expect(problems.join(" ")).toMatch(/INNGEST/i);
  });
});
