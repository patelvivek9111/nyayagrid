/**
 * WP-05 — product vs legal-corpus database isolation evaluator.
 *
 * Pure functions only. Does not connect to Neon. Does not mutate privileges.
 * Staging currently shares one Neon project/branch/database for product + corpus —
 * that overlap is a production release blocker until physically separated.
 */

export type IsolationEnv = Record<string, string | undefined>;

export type IsolationFinding = {
  code: string;
  severity: "blocker" | "warning" | "info";
  message: string;
};

export type IsolationReport = {
  ok: boolean;
  sharedPhysicalDatabase: boolean;
  findings: IsolationFinding[];
};

/** Tables owned by the licensed legal corpus (must never be product-migrate targets). */
export const LEGAL_CORPUS_TABLES = [
  "legal_authorities",
  "legal_authority_chunks",
  "legal_authority_versions",
  "legal_authority_citations",
] as const;

/** Representative product application tables (tenant-scoped). */
export const PRODUCT_CORE_TABLES = [
  "organizations",
  "matters",
  "documents",
  "criminal_cases",
  "audit_events",
] as const;

function read(env: IsolationEnv, key: string): string {
  return String(env[key] ?? "").trim();
}

function parsePostgresUrl(url: string): { host: string; port: string; database: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return null;
    return {
      host: parsed.hostname.toLowerCase(),
      port: parsed.port === "" ? "5432" : parsed.port,
      database: (parsed.pathname.replace(/^\//, "").split("?")[0] ?? "").toLowerCase(),
    };
  } catch {
    return null;
  }
}

function samePhysicalTarget(
  a: { host: string; port: string; database: string },
  b: { host: string; port: string; database: string },
): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

/**
 * Evaluate whether product and corpus connection strings are physically separate.
 * When CORPUS_DATABASE_URL is unset, staging/production is treated as unresolved
 * shared-risk if DATABASE_URL is a remote host (operator must declare separation).
 */
export function evaluateProductCorpusIsolation(env: IsolationEnv = process.env): IsolationReport {
  const findings: IsolationFinding[] = [];
  const databaseUrl = read(env, "DATABASE_URL");
  const corpusUrl = read(env, "CORPUS_DATABASE_URL");
  const appEnv = read(env, "APP_ENV").toLowerCase();
  const deployed = appEnv === "staging" || appEnv === "production";
  const forceSharedDeclared = ["1", "true", "yes"].includes(
    read(env, "PRODUCT_CORPUS_SHARED_DB_ACK").toLowerCase(),
  );

  if (!databaseUrl) {
    findings.push({
      code: "PRODUCT_DATABASE_URL_MISSING",
      severity: "blocker",
      message: "DATABASE_URL is required to evaluate isolation.",
    });
    return { ok: false, sharedPhysicalDatabase: false, findings };
  }

  const product = parsePostgresUrl(databaseUrl);
  if (!product) {
    findings.push({
      code: "PRODUCT_DATABASE_URL_INVALID",
      severity: "blocker",
      message: "DATABASE_URL must be a valid postgres URL.",
    });
    return { ok: false, sharedPhysicalDatabase: false, findings };
  }

  let sharedPhysicalDatabase = false;

  if (!corpusUrl) {
    if (deployed) {
      sharedPhysicalDatabase = true;
      findings.push({
        code: "CORPUS_DATABASE_URL_UNDECLARED",
        severity: forceSharedDeclared ? "warning" : "blocker",
        message:
          "CORPUS_DATABASE_URL is unset while APP_ENV is staging/production. Staging evidence shows product and legal corpus share the same Neon project/branch/database. Declare a separate corpus URL or set PRODUCT_CORPUS_SHARED_DB_ACK=1 only to acknowledge the open release blocker (does not clear production readiness).",
      });
    } else {
      findings.push({
        code: "CORPUS_DATABASE_URL_OPTIONAL_LOCAL",
        severity: "info",
        message: "CORPUS_DATABASE_URL unset in non-deployed env — local isolation not asserted.",
      });
    }
  } else {
    const corpus = parsePostgresUrl(corpusUrl);
    if (!corpus) {
      findings.push({
        code: "CORPUS_DATABASE_URL_INVALID",
        severity: "blocker",
        message: "CORPUS_DATABASE_URL must be a valid postgres URL.",
      });
    } else if (samePhysicalTarget(product, corpus)) {
      sharedPhysicalDatabase = true;
      findings.push({
        code: "PRODUCT_CORPUS_SAME_PHYSICAL_DATABASE",
        severity: "blocker",
        message:
          "DATABASE_URL and CORPUS_DATABASE_URL resolve to the same host/port/database. Product and legal corpus are not physically isolated.",
      });
    } else {
      findings.push({
        code: "PRODUCT_CORPUS_PHYSICALLY_SEPARATE",
        severity: "info",
        message: "DATABASE_URL and CORPUS_DATABASE_URL resolve to different physical targets.",
      });
    }
  }

  if (["1", "true", "yes", "on"].includes(read(env, "FEATURE_NEON_CORPUS_RESEARCH").toLowerCase())) {
    if (sharedPhysicalDatabase) {
      findings.push({
        code: "CORPUS_RESEARCH_ON_SHARED_DB",
        severity: "blocker",
        message:
          "FEATURE_NEON_CORPUS_RESEARCH is enabled while product/corpus share a physical database — keep the flag OFF until isolation is complete.",
      });
    }
  }

  const blockers = findings.filter((f) => f.severity === "blocker");
  return {
    ok: blockers.length === 0,
    sharedPhysicalDatabase,
    findings,
  };
}

/** SQL privilege assertions for disposable local DBs only (never run destructive grants on Neon). */
export function buildLocalIsolationPrivilegeSql(params: {
  productRole: string;
  corpusRole: string;
  researchRole: string;
}): string {
  const { productRole, corpusRole, researchRole } = params;
  const corpusTables = LEGAL_CORPUS_TABLES.map((t) => `"${t}"`).join(", ");
  const productTables = PRODUCT_CORE_TABLES.map((t) => `"${t}"`).join(", ");
  return `
-- Disposable local isolation rehearsal only. Do not apply to Neon without approval.
REVOKE ALL ON TABLE ${corpusTables} FROM ${productRole};
GRANT SELECT ON TABLE ${corpusTables} TO ${researchRole};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE ${corpusTables} FROM ${researchRole};
REVOKE ALL ON TABLE ${productTables} FROM ${corpusRole};
REVOKE ALL ON TABLE ${productTables} FROM ${researchRole};
`.trim();
}
