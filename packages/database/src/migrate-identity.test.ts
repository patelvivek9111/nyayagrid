import { describe, expect, it } from "vitest";
import { assertMigrateIdentity, redactSecrets } from "./migrate-identity";

const LOCAL_URL = "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
const NEON_URL =
  "postgresql://nyaya_product_runtime_v3:secret@ep-lively-lake-auyeia5m-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const NEON_OTHER =
  "postgresql://nyaya_product_runtime_v3:secret@ep-other-endpoint-xxxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const CORPUS_URL =
  "postgresql://nyayagrid_corpus_readonly:secret@ep-corpus-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require";

describe("migrate identity gates", () => {
  it("allows local development without Neon attestation", () => {
    const r = assertMigrateIdentity({
      appEnv: "development",
      databaseUrl: LOCAL_URL,
      expectedDbName: null,
      expectedNeonEndpointId: null,
      expectedNeonProjectId: null,
      expectedNeonBranchId: null,
      corpusDatabaseUrl: null,
      allowNeondbProduct: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe("local");
      expect(r.dbName).toBe("nyayagrid");
      expect(r.requireTls).toBe(false);
    }
  });

  it("refuses missing APP_ENV", () => {
    const r = assertMigrateIdentity({
      appEnv: "",
      databaseUrl: LOCAL_URL,
      expectedDbName: null,
      expectedNeonEndpointId: null,
      expectedNeonProjectId: null,
      expectedNeonBranchId: null,
      corpusDatabaseUrl: null,
      allowNeondbProduct: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("APP_ENV_REQUIRED");
  });

  it("refuses staging localhost", () => {
    const r = assertMigrateIdentity({
      appEnv: "staging",
      databaseUrl: LOCAL_URL,
      expectedDbName: "nyayagrid",
      expectedNeonEndpointId: "ep-x",
      expectedNeonProjectId: "proj",
      expectedNeonBranchId: "br",
      corpusDatabaseUrl: null,
      allowNeondbProduct: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LOCALHOST_IN_SHARED_ENV");
  });

  it("refuses staging without expected db name", () => {
    const r = assertMigrateIdentity({
      appEnv: "staging",
      databaseUrl: NEON_URL,
      expectedDbName: null,
      expectedNeonEndpointId: "ep-lively-lake-auyeia5m-pooler",
      expectedNeonProjectId: "proj",
      expectedNeonBranchId: "br",
      corpusDatabaseUrl: null,
      allowNeondbProduct: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EXPECTED_MIGRATE_DB_NAME_REQUIRED");
  });

  it("refuses mismatched Neon endpoint", () => {
    const r = assertMigrateIdentity({
      appEnv: "staging",
      databaseUrl: NEON_URL,
      expectedDbName: "neondb",
      expectedNeonEndpointId: "ep-other-endpoint-xxxx-pooler",
      expectedNeonProjectId: "proj",
      expectedNeonBranchId: "br",
      corpusDatabaseUrl: null,
      allowNeondbProduct: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NEON_ENDPOINT_MISMATCH");
  });

  it("refuses neondb without explicit attestation", () => {
    const r = assertMigrateIdentity({
      appEnv: "staging",
      databaseUrl: NEON_URL,
      expectedDbName: "neondb",
      expectedNeonEndpointId: "ep-lively-lake-auyeia5m-pooler",
      expectedNeonProjectId: "proj",
      expectedNeonBranchId: "br",
      corpusDatabaseUrl: null,
      allowNeondbProduct: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NEONDB_REQUIRES_EXPLICIT_ATTESTATION");
  });

  it("refuses missing Neon project/branch identity", () => {
    const r = assertMigrateIdentity({
      appEnv: "production",
      databaseUrl: NEON_URL,
      expectedDbName: "neondb",
      expectedNeonEndpointId: "ep-lively-lake-auyeia5m-pooler",
      expectedNeonProjectId: null,
      expectedNeonBranchId: "br",
      corpusDatabaseUrl: null,
      allowNeondbProduct: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NEON_PROJECT_BRANCH_REQUIRED");
  });

  it("refuses wrong environment / unknown APP_ENV", () => {
    const r = assertMigrateIdentity({
      appEnv: "preview",
      databaseUrl: NEON_URL,
      expectedDbName: "neondb",
      expectedNeonEndpointId: "ep-lively-lake-auyeia5m-pooler",
      expectedNeonProjectId: "proj",
      expectedNeonBranchId: "br",
      corpusDatabaseUrl: null,
      allowNeondbProduct: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNKNOWN_APP_ENV");
  });

  it("refuses product URL equal to corpus target", () => {
    const r = assertMigrateIdentity({
      appEnv: "staging",
      databaseUrl: NEON_URL,
      expectedDbName: "neondb",
      expectedNeonEndpointId: "ep-lively-lake-auyeia5m-pooler",
      expectedNeonProjectId: "proj",
      expectedNeonBranchId: "br",
      corpusDatabaseUrl: NEON_URL,
      allowNeondbProduct: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PRODUCT_CORPUS_SAME_TARGET");
  });

  it("refuses corpus-shaped roles", () => {
    const r = assertMigrateIdentity({
      appEnv: "staging",
      databaseUrl: CORPUS_URL,
      expectedDbName: "neondb",
      expectedNeonEndpointId: "ep-corpus-xxxx",
      expectedNeonProjectId: "proj",
      expectedNeonBranchId: "br",
      corpusDatabaseUrl: null,
      allowNeondbProduct: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CORPUS_ROLE_REFUSED");
  });

  it("accepts fully attested staging Neon product target", () => {
    const r = assertMigrateIdentity({
      appEnv: "staging",
      databaseUrl: NEON_URL,
      expectedDbName: "neondb",
      expectedNeonEndpointId: "ep-lively-lake-auyeia5m-pooler",
      expectedNeonProjectId: "proj_attested",
      expectedNeonBranchId: "br_attested",
      corpusDatabaseUrl: CORPUS_URL,
      allowNeondbProduct: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.requireTls).toBe(true);
      expect(r.neonEndpointId).toBe("ep-lively-lake-auyeia5m-pooler");
    }
  });

  it("accepts pooler URL when expected endpoint omits -pooler suffix", () => {
    const r = assertMigrateIdentity({
      appEnv: "staging",
      databaseUrl: NEON_URL,
      expectedDbName: "neondb",
      expectedNeonEndpointId: "ep-lively-lake-auyeia5m",
      expectedNeonProjectId: "odd-moon-90379900",
      expectedNeonBranchId: "br-fancy-king-auaii21k",
      corpusDatabaseUrl: CORPUS_URL,
      allowNeondbProduct: true,
    });
    expect(r.ok).toBe(true);
  });

  it("refuses incorrect URL db name vs expected", () => {
    const r = assertMigrateIdentity({
      appEnv: "staging",
      databaseUrl: NEON_OTHER.replace("/neondb", "/otherdb"),
      expectedDbName: "neondb",
      expectedNeonEndpointId: "ep-other-endpoint-xxxx-pooler",
      expectedNeonProjectId: "proj",
      expectedNeonBranchId: "br",
      corpusDatabaseUrl: null,
      allowNeondbProduct: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DB_NAME_MISMATCH");
  });

  it("never echoes credentials in redaction helper", () => {
    const out = redactSecrets(`boom ${NEON_URL} done`);
    expect(out).not.toMatch(/secret/);
    expect(out).toContain("[redacted]");
  });
});
