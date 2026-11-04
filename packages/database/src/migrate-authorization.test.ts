import { describe, expect, it } from "vitest";
import { assertMigrateAuthorized, evaluateMigrateAuthorization } from "./migrate-authorization";

const localUrl = "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
const stagingUrl =
  "postgresql://app:secret@ep-staging.example.neon.tech/nyayagrid_app?sslmode=require";
const corpusUrl = "postgresql://ro:secret@ep-corpus.example.neon.tech/neondb?sslmode=require";

describe("WP-05B migrate authorization", () => {
  it("fails closed when DATABASE_URL is missing", () => {
    const r = evaluateMigrateAuthorization({ APP_ENV: "development" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MIGRATE_DATABASE_URL_MISSING");
  });

  it("allows local development without ALLOW_DATABASE_MIGRATE", () => {
    const r = evaluateMigrateAuthorization({
      APP_ENV: "development",
      DATABASE_URL: localUrl,
    });
    expect(r).toEqual({ ok: true, mode: "local_development" });
  });

  it("refuses corpus URL collision in any environment", () => {
    const r = evaluateMigrateAuthorization({
      APP_ENV: "development",
      DATABASE_URL: corpusUrl,
      CORPUS_DATABASE_URL: corpusUrl,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MIGRATE_TARGET_IS_CORPUS");
  });

  it("refuses staging migrate without ALLOW_DATABASE_MIGRATE", () => {
    const r = evaluateMigrateAuthorization({
      APP_ENV: "staging",
      DATABASE_URL: stagingUrl,
      EXPECTED_MIGRATE_DB_HOST: "ep-staging.example.neon.tech",
      EXPECTED_MIGRATE_DB_NAME: "nyayagrid_app",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MIGRATE_NOT_AUTHORIZED");
  });

  it("refuses staging migrate when expected identity is missing", () => {
    const r = evaluateMigrateAuthorization({
      APP_ENV: "staging",
      DATABASE_URL: stagingUrl,
      ALLOW_DATABASE_MIGRATE: "1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MIGRATE_IDENTITY_UNDECLARED");
  });

  it("refuses wrong expected host", () => {
    const r = evaluateMigrateAuthorization({
      APP_ENV: "production",
      DATABASE_URL: stagingUrl,
      ALLOW_DATABASE_MIGRATE: "1",
      EXPECTED_MIGRATE_DB_HOST: "other.example.neon.tech",
      EXPECTED_MIGRATE_DB_NAME: "nyayagrid_app",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MIGRATE_HOST_MISMATCH");
  });

  it("refuses wrong expected database name", () => {
    const r = evaluateMigrateAuthorization({
      APP_ENV: "staging",
      DATABASE_URL: stagingUrl,
      ALLOW_DATABASE_MIGRATE: "1",
      EXPECTED_MIGRATE_DB_HOST: "ep-staging.example.neon.tech",
      EXPECTED_MIGRATE_DB_NAME: "neondb",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MIGRATE_DATABASE_NAME_MISMATCH");
  });

  it("refuses localhost DATABASE_URL in staging even with allow flag", () => {
    const r = evaluateMigrateAuthorization({
      APP_ENV: "staging",
      DATABASE_URL: localUrl,
      ALLOW_DATABASE_MIGRATE: "1",
      EXPECTED_MIGRATE_DB_HOST: "localhost",
      EXPECTED_MIGRATE_DB_NAME: "nyayagrid",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MIGRATE_LOCALHOST_IN_DEPLOYED_ENV");
  });

  it("allows correct staging configuration", () => {
    const r = evaluateMigrateAuthorization({
      APP_ENV: "staging",
      DATABASE_URL: stagingUrl,
      CORPUS_DATABASE_URL: corpusUrl,
      ALLOW_DATABASE_MIGRATE: "1",
      EXPECTED_MIGRATE_DB_HOST: "ep-staging.example.neon.tech",
      EXPECTED_MIGRATE_DB_NAME: "nyayagrid_app",
    });
    expect(r).toEqual({ ok: true, mode: "authorized_deployed" });
  });

  it("error messages never embed connection secrets", () => {
    try {
      assertMigrateAuthorized({
        APP_ENV: "staging",
        DATABASE_URL: stagingUrl,
        ALLOW_DATABASE_MIGRATE: "1",
        EXPECTED_MIGRATE_DB_HOST: "wrong.host",
        EXPECTED_MIGRATE_DB_NAME: "nyayagrid_app",
      });
      expect.unreachable("should throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toMatch(/secret|postgresql:\/\//i);
      expect(message).toMatch(/MIGRATE_HOST_MISMATCH/);
    }
  });

  it("refuses MIGRATE_LEGAL_CORPUS flag", () => {
    const r = evaluateMigrateAuthorization({
      APP_ENV: "development",
      DATABASE_URL: localUrl,
      MIGRATE_LEGAL_CORPUS: "1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MIGRATE_CORPUS_FLAG_FORBIDDEN");
  });
});
