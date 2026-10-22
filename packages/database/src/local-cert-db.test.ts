import { describe, expect, it } from "vitest";
import {
  assertLocalCertificationDatabaseUrl,
  isLocalCertificationDatabaseUrl,
} from "./local-cert-db";

describe("local certification DATABASE_URL guard", () => {
  it("allows GitHub CI and Docker-mapped local ports", () => {
    expect(
      isLocalCertificationDatabaseUrl("postgresql://nyayagrid:nyayagrid@localhost:5432/nyayagrid"),
    ).toBe(true);
    expect(
      isLocalCertificationDatabaseUrl("postgresql://nyayagrid:nyayagrid@127.0.0.1:5432/nyayagrid"),
    ).toBe(true);
    expect(
      isLocalCertificationDatabaseUrl("postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid"),
    ).toBe(true);
    expect(
      isLocalCertificationDatabaseUrl("postgresql://nyayagrid:nyayagrid@127.0.0.1:5433/nyayagrid"),
    ).toBe(true);
    expect(
      isLocalCertificationDatabaseUrl("postgresql://nyayagrid:nyayagrid@localhost/nyayagrid"),
    ).toBe(true);
  });

  it("rejects remote, staging, and wrong database names", () => {
    expect(
      isLocalCertificationDatabaseUrl(
        "postgresql://user:pass@ep-cool.aws.neon.tech:5432/nyayagrid?sslmode=require",
      ),
    ).toBe(false);
    expect(
      isLocalCertificationDatabaseUrl(
        "postgresql://nyayagrid:nyayagrid@staging.example.com:5432/nyayagrid",
      ),
    ).toBe(false);
    expect(
      isLocalCertificationDatabaseUrl("postgresql://nyayagrid:nyayagrid@localhost:5432/postgres"),
    ).toBe(false);
    expect(
      isLocalCertificationDatabaseUrl("postgresql://nyayagrid:nyayagrid@localhost:5434/nyayagrid"),
    ).toBe(false);
    expect(isLocalCertificationDatabaseUrl("")).toBe(false);
  });

  it("assertLocalCertificationDatabaseUrl throws for remote hosts", () => {
    expect(() =>
      assertLocalCertificationDatabaseUrl(
        "postgresql://u:p@ep-x.us-east-1.aws.neon.tech/nyayagrid",
      ),
    ).toThrow(/local certification database/i);
    expect(() =>
      assertLocalCertificationDatabaseUrl(
        "postgresql://nyayagrid:nyayagrid@localhost:5432/nyayagrid",
      ),
    ).not.toThrow();
  });
});
