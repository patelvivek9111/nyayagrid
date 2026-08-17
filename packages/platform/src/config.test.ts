import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  collectConfigWarnings,
  collectProductionConfigProblems,
  getAppEnv,
  isDevelopment,
  isProductionLike,
  isTestEnv,
  resolveAppEnvDetailed,
  summarizeConfig,
  validateConfigForEnv,
  validateProductionConfig,
  type EnvSource,
} from "./config";

/** Every production requirement satisfied — the baseline every "flip one thing off" test mutates. */
const SAFE_PRODUCTION_ENV: EnvSource = {
  APP_ENV: "production",
  AUTH_PROVIDER: "clerk",
  CLERK_SECRET_KEY: "sk_live_test",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_test",
  CLERK_WEBHOOK_SECRET: "whsec_test",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "sk-openai-test",
  EMBEDDING_PROVIDER: "openai",
  MALWARE_SCANNER: "clamav",
  CLAMAV_HOST: "clamav.internal",
  STORAGE_PROVIDER: "s3",
  OCR_PROVIDER: "none",
  EMAIL_PROVIDER: "smtp",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  EMAIL_FROM: "noreply@example.com",
  BILLING_PROVIDER: "database",
  RATE_LIMIT_PROVIDER: "redis",
  REDIS_URL: "redis://127.0.0.1:6379",
  DATABASE_URL: "postgresql://user:pass@host:5432/db",
  S3_BUCKET: "nyayagrid-prod-documents",
};

describe("resolveAppEnvDetailed / getAppEnv", () => {
  it("defaults to development when nothing is set", () => {
    expect(resolveAppEnvDetailed({})).toEqual({ appEnv: "development", source: "default" });
  });

  it("prefers APP_ENV over NODE_ENV", () => {
    expect(getAppEnv({ APP_ENV: "staging", NODE_ENV: "production" })).toBe("staging");
  });

  it("infers production from NODE_ENV but marks the source as inferred", () => {
    expect(resolveAppEnvDetailed({ NODE_ENV: "production" })).toEqual({
      appEnv: "production",
      source: "NODE_ENV",
    });
  });

  it("infers test from NODE_ENV=test", () => {
    expect(getAppEnv({ NODE_ENV: "test" })).toBe("test");
  });

  it("rejects an unrecognized APP_ENV value", () => {
    expect(() => resolveAppEnvDetailed({ APP_ENV: "prod" })).toThrow(ConfigurationError);
  });

  it("isProductionLike / isDevelopment / isTestEnv agree with the resolved environment", () => {
    expect(isProductionLike({ APP_ENV: "staging" })).toBe(true);
    expect(isProductionLike({ APP_ENV: "production" })).toBe(true);
    expect(isProductionLike({ APP_ENV: "development" })).toBe(false);
    expect(isDevelopment({})).toBe(true);
    expect(isTestEnv({ NODE_ENV: "test" })).toBe(true);
  });
});

describe("collectProductionConfigProblems", () => {
  it("reports no problems for a fully hardened configuration", () => {
    expect(collectProductionConfigProblems(SAFE_PRODUCTION_ENV)).toEqual([]);
  });

  it("flags NODE_ENV=production without a declared APP_ENV", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      APP_ENV: undefined,
      NODE_ENV: "production",
    });
    expect(problems.some((p) => p.includes("APP_ENV is not set"))).toBe(true);
  });

  it("flags AUTH_PROVIDER=dev (the default)", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      AUTH_PROVIDER: undefined,
    });
    expect(problems.some((p) => p.includes("AUTH_PROVIDER resolves to dev"))).toBe(true);
  });

  it("flags AUTH_PROVIDER=clerk missing its keys", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      CLERK_SECRET_KEY: undefined,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: undefined,
    });
    expect(problems.some((p) => p.includes("CLERK_SECRET_KEY"))).toBe(true);
    expect(problems.some((p) => p.includes("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"))).toBe(true);
  });

  it("flags AI_PROVIDER=mock and a missing OPENAI_API_KEY", () => {
    expect(
      collectProductionConfigProblems({ ...SAFE_PRODUCTION_ENV, AI_PROVIDER: undefined }).some(
        (p) => p.includes("AI_PROVIDER resolves to mock"),
      ),
    ).toBe(true);
    expect(
      collectProductionConfigProblems({ ...SAFE_PRODUCTION_ENV, OPENAI_API_KEY: undefined }).some(
        (p) => p.includes("OPENAI_API_KEY"),
      ),
    ).toBe(true);
  });

  it("flags EMBEDDING_PROVIDER=mock", () => {
    // resolveEmbeddingProvider falls back to AI_PROVIDER when unset, so it must be overridden
    // explicitly here rather than just unset (AI_PROVIDER=openai would otherwise "fix" it too).
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      EMBEDDING_PROVIDER: "mock",
    });
    expect(problems.some((p) => p.includes("EMBEDDING_PROVIDER resolves to mock"))).toBe(true);
  });

  it("flags MALWARE_SCANNER=development (the default)", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      MALWARE_SCANNER: undefined,
    });
    expect(problems.some((p) => p.includes("MALWARE_SCANNER resolves to development"))).toBe(true);
  });

  it("flags STORAGE_PROVIDER=minio unless ALLOW_MINIO_IN_PRODUCTION is set", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      STORAGE_PROVIDER: "minio",
    });
    expect(problems.some((p) => p.includes("STORAGE_PROVIDER resolves to minio"))).toBe(true);

    const withOverride = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      STORAGE_PROVIDER: "minio",
      ALLOW_MINIO_IN_PRODUCTION: "1",
    });
    expect(withOverride.some((p) => p.includes("STORAGE_PROVIDER"))).toBe(false);
  });

  it("flags an OCR_PROVIDER that names an unimplemented adapter", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      OCR_PROVIDER: "tesseract",
    });
    expect(problems.some((p) => p.includes("OCR_PROVIDER=tesseract"))).toBe(true);
  });

  it("flags EMAIL_PROVIDER=console and incomplete smtp configuration", () => {
    expect(
      collectProductionConfigProblems({ ...SAFE_PRODUCTION_ENV, EMAIL_PROVIDER: undefined }).some(
        (p) => p.includes("EMAIL_PROVIDER resolves to console"),
      ),
    ).toBe(true);
    const missingSmtp = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      SMTP_HOST: undefined,
    });
    expect(missingSmtp.some((p) => p.includes("EMAIL_PROVIDER=smtp requires SMTP_HOST"))).toBe(
      true,
    );
  });

  it("flags BILLING_PROVIDER=development (the default)", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      BILLING_PROVIDER: undefined,
    });
    expect(problems.some((p) => p.includes("BILLING_PROVIDER resolves to development"))).toBe(true);
  });

  it("flags RATE_LIMIT_PROVIDER=memory (the default)", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      RATE_LIMIT_PROVIDER: undefined,
    });
    expect(problems.some((p) => p.includes("RATE_LIMIT_PROVIDER resolves to memory"))).toBe(true);
  });

  it("flags RATE_LIMIT_PROVIDER=redis without REDIS_URL or REDIS_HOST", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      REDIS_URL: undefined,
      REDIS_HOST: undefined,
    });
    expect(problems.some((p) => p.includes("RATE_LIMIT_PROVIDER=redis requires REDIS_URL"))).toBe(
      true,
    );
  });

  it("flags MALWARE_SCANNER=clamav without CLAMAV_HOST and fixture mode", () => {
    const missingHost = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      CLAMAV_HOST: undefined,
    });
    expect(missingHost.some((p) => p.includes("MALWARE_SCANNER=clamav requires CLAMAV_HOST"))).toBe(
      true,
    );
    const fixture = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      CLAMAV_FIXTURE: "1",
    });
    expect(fixture.some((p) => p.includes("CLAMAV_FIXTURE"))).toBe(true);
  });

  it("flags AUTH_PROVIDER=clerk without CLERK_WEBHOOK_SECRET", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      CLERK_WEBHOOK_SECRET: undefined,
    });
    expect(problems.some((p) => p.includes("CLERK_WEBHOOK_SECRET"))).toBe(true);
  });

  it("flags missing DATABASE_URL and S3_BUCKET", () => {
    const problems = collectProductionConfigProblems({
      ...SAFE_PRODUCTION_ENV,
      DATABASE_URL: undefined,
      S3_BUCKET: undefined,
    });
    expect(problems.some((p) => p.includes("DATABASE_URL is required"))).toBe(true);
    expect(problems.some((p) => p.includes("S3_BUCKET is required"))).toBe(true);
  });
});

describe("validateProductionConfig", () => {
  it("is a no-op outside production", () => {
    expect(() => validateProductionConfig({ APP_ENV: "development" })).not.toThrow();
    expect(() => validateProductionConfig({ APP_ENV: "staging" })).not.toThrow();
  });

  it("does not throw for a fully hardened production configuration", () => {
    expect(() => validateProductionConfig(SAFE_PRODUCTION_ENV)).not.toThrow();
  });

  it("throws ConfigurationError listing every unmet blocker for an unsafe production configuration", () => {
    let thrown: unknown;
    try {
      validateProductionConfig({ APP_ENV: "production" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConfigurationError);
    const configError = thrown as ConfigurationError;
    expect(configError.problems.length).toBeGreaterThan(0);
    expect(configError.message).toContain(configError.problems[0]!);
  });
});

describe("validateConfigForEnv", () => {
  it("throws for an unsafe production configuration", () => {
    expect(() => validateConfigForEnv({ APP_ENV: "production" })).toThrow(ConfigurationError);
  });

  it("returns cleanly for a hardened production configuration", () => {
    const result = validateConfigForEnv(SAFE_PRODUCTION_ENV);
    expect(result.problems).toEqual([]);
    expect(result.appEnv).toBe("production");
  });

  it("reports staging problems as advisory instead of throwing", () => {
    const result = validateConfigForEnv({ APP_ENV: "staging" });
    expect(result.appEnv).toBe("staging");
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("reports no problems for development/test (they are supposed to run the mock stand-ins)", () => {
    expect(validateConfigForEnv({ APP_ENV: "development" }).problems).toEqual([]);
    expect(validateConfigForEnv({ APP_ENV: "test" }).problems).toEqual([]);
  });
});

describe("collectConfigWarnings / summarizeConfig", () => {
  it("warns about development stand-ins only outside production/staging", () => {
    const warnings = collectConfigWarnings({ APP_ENV: "development" });
    expect(warnings.some((w) => w.includes("Development stand-ins active"))).toBe(true);
  });

  it("never names a secret, key or connection string", () => {
    const summary = summarizeConfig(SAFE_PRODUCTION_ENV);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("sk-openai-test");
    expect(serialized).not.toContain("postgresql://");
    expect(summary.databaseConfigured).toBe(true);
    expect(summary.storageBucketConfigured).toBe(true);
  });
});
