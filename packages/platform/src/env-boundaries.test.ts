import { describe, expect, it } from "vitest";
import { environmentBoundaryBlockers, evaluateEnvironmentBoundaries } from "./env-boundaries";

describe("WP-05 environment boundaries", () => {
  it("requires DATABASE_URL", () => {
    const blockers = environmentBoundaryBlockers({});
    expect(blockers.some((b) => b.code === "PRODUCT_DB_MISSING")).toBe(true);
  });

  it("blocks identical product and corpus URLs", () => {
    const findings = evaluateEnvironmentBoundaries({
      DATABASE_URL: "postgresql://u:p@db/product",
      CORPUS_DATABASE_URL: "postgresql://u:p@db/product",
    });
    expect(findings.some((f) => f.code === "PRODUCT_CORPUS_URL_COLLISION")).toBe(true);
  });

  it("blocks Neon corpus flag without CORPUS_DATABASE_URL", () => {
    const findings = evaluateEnvironmentBoundaries({
      DATABASE_URL: "postgresql://u:p@db/product",
      FEATURE_NEON_CORPUS_RESEARCH: "1",
    });
    expect(findings.some((f) => f.code === "NEON_CORPUS_FLAG_WITHOUT_URL")).toBe(true);
  });

  it("blocks localhost product DB in production", () => {
    const findings = evaluateEnvironmentBoundaries({
      APP_ENV: "production",
      DATABASE_URL: "postgresql://nyayagrid:nyayagrid@127.0.0.1:5433/nyayagrid",
      AUTH_PROVIDER: "clerk",
      MALWARE_SCANNER: "clamav",
    });
    expect(findings.some((f) => f.code === "PRODUCT_DB_LOCALHOST_IN_DEPLOYED_ENV")).toBe(true);
  });

  it("allows separated URLs with Neon flag off (WP-03E deferred)", () => {
    const findings = evaluateEnvironmentBoundaries({
      APP_ENV: "development",
      DATABASE_URL: "postgresql://u:p@localhost:5433/nyayagrid",
      CORPUS_DATABASE_URL: "postgresql://ro:x@neon.example/neondb",
      FEATURE_NEON_CORPUS_RESEARCH: "0",
    });
    expect(
      environmentBoundaryBlockers({
        APP_ENV: "development",
        DATABASE_URL: "postgresql://u:p@localhost:5433/nyayagrid",
        CORPUS_DATABASE_URL: "postgresql://ro:x@neon.example/neondb",
        FEATURE_NEON_CORPUS_RESEARCH: "0",
      }),
    ).toHaveLength(0);
    expect(findings.some((f) => f.severity === "blocker")).toBe(false);
  });

  it("never embeds connection strings in messages", () => {
    const findings = evaluateEnvironmentBoundaries({
      APP_ENV: "staging",
      DATABASE_URL: "postgresql://secret_user:secret_pass@db.example/nyayagrid",
      AUTH_PROVIDER: "clerk",
      MALWARE_SCANNER: "clamav",
    });
    for (const f of findings) {
      expect(f.message).not.toMatch(/secret_pass|secret_user/);
    }
  });
});
