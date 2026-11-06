/**
 * WP-06B staging PRODUCT database preflight (read-only).
 *
 * Emits structured gates (all required before shared staging migrate):
 *   DATABASE_IDENTITY_VERIFIED
 *   MIGRATION_HISTORY_RECONCILED
 *   SCHEMA_COMPATIBLE
 *   BACKUP_RESTORE_VERIFIED
 *   STAGING_MIGRATION_AUTHORIZED
 *
 * A preflight result is NOT authorization. STAGING_MIGRATION_AUTHORIZED becomes true
 * only when the other four gates pass AND STAGING_MIGRATE_OPERATOR_APPROVAL=1 is set
 * by an operator outside this script.
 *
 * Safety: SELECT/catalog only; never prints DATABASE_URL; refuses Neon/neondb SQL
 * without explicit product attestation env gates.
 */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { assertMigrateIdentity } from "./lib-migrate-identity.mjs";

const REQUIRED_GRAPH_CONSTRAINTS = [
  "prosecution_graph_nodes_organization_id_fkey",
  "prosecution_graph_nodes_criminal_case_id_fkey",
  "prosecution_graph_nodes_kind_chk",
  "prosecution_graph_nodes_case_org_fk",
  "prosecution_graph_edges_from_node_id_fkey",
  "prosecution_graph_edges_to_node_id_fkey",
  "prosecution_graph_edges_from_case_fk",
  "prosecution_graph_edges_to_case_fk",
  "prosecution_graph_edges_from_org_fk",
  "prosecution_graph_edges_to_org_fk",
  "prosecution_graph_edges_case_org_fk",
];

const REQUIRED_WHEN = {
  "0025": "1788300000000",
  "0026": "1788400000000",
  "0027": "1788500000000",
  "0028": "1788600000000",
  "0029": "1788700000000",
  "0030": "1788800000000",
  "0031": "1788900000000",
  "0032": "1789000000000",
  "0033": "1789100000000",
};

function fingerprintHost(url) {
  try {
    const u = new URL(url);
    const neonEp = (u.hostname.match(/^(ep-[a-z0-9-]+)/i) || [])[1] || null;
    return {
      protocol: u.protocol.replace(":", ""),
      hostHash: createHash("sha256").update(u.hostname).digest("hex").slice(0, 16),
      port: u.port || null,
      dbName: u.pathname.replace(/^\//, "").split("?")[0] || null,
      role: decodeURIComponent(u.username || "") || null,
      isLocalhost: /localhost|127\.0\.0\.1/i.test(u.hostname),
      isNeon: /neon\.tech$/i.test(u.hostname),
      neonEndpointId: neonEp,
      neonEndpointHash: neonEp
        ? createHash("sha256").update(neonEp).digest("hex").slice(0, 12)
        : null,
      sslmodeDisable: /[?&]sslmode=disable\b/i.test(url),
    };
  } catch {
    return { parseError: true };
  }
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const appEnv = (process.env.APP_ENV ?? "").trim().toLowerCase() || "unknown";
  const expectedDb = process.env.EXPECTED_MIGRATE_DB_NAME?.trim() || null;
  const expectedEndpoint = process.env.EXPECTED_NEON_ENDPOINT_ID?.trim() || null;
  const expectedProject = process.env.EXPECTED_NEON_PROJECT_ID?.trim() || null;
  const expectedBranch = process.env.EXPECTED_NEON_BRANCH_ID?.trim() || null;
  const backupVerified = process.env.BACKUP_RESTORE_OPERATOR_VERIFIED === "1";
  const historyReconciledFlag = process.env.MIGRATION_HISTORY_RECONCILED === "1";
  const operatorApproval = process.env.STAGING_MIGRATE_OPERATOR_APPROVAL === "1";
  const allowNeonSql =
    process.env.ALLOW_NEON_PRODUCT_DB_PREFLIGHT === "1" &&
    Boolean(expectedDb) &&
    Boolean(expectedEndpoint) &&
    Boolean(expectedProject) &&
    Boolean(expectedBranch);

  const fp = url ? fingerprintHost(url) : { parseError: true };
  const gates = {
    DATABASE_IDENTITY_VERIFIED: false,
    MIGRATION_HISTORY_RECONCILED: false,
    SCHEMA_COMPATIBLE: false,
    BACKUP_RESTORE_VERIFIED: false,
    STAGING_MIGRATION_AUTHORIZED: false,
  };
  const blockers = [];
  const warnings = [];

  const report = {
    classification: "NYAYAGRID_WP06B_STAGING_PRODUCT_DB_PREFLIGHT",
    mode: "READ_ONLY",
    appEnv,
    connectionFingerprint: fp.parseError ? { parseError: true } : fp,
    gates,
    blockers,
    warnings,
    identityVerdict: "STAGING_PRODUCT_DB_IDENTITY_UNVERIFIED",
  };

  if (!url) blockers.push("DATABASE_URL_MISSING");
  if (fp.parseError) blockers.push("DATABASE_URL_UNPARSEABLE");

  // Non-SQL identity evidence
  if (!fp.parseError) {
    report.nonSqlIdentity = {
      dbName: fp.dbName,
      role: fp.role,
      isNeon: fp.isNeon,
      neonEndpointHash: fp.neonEndpointHash,
      hostHash: fp.hostHash,
      corpusEnvPresent: Boolean(process.env.CORPUS_DATABASE_URL),
      productRoleHint: Boolean(fp.role && /product/i.test(fp.role)),
      corpusRoleHint: Boolean(fp.role && /corpus/i.test(fp.role)),
    };
  }

  const identity = assertMigrateIdentity({
    appEnv: appEnv === "unknown" ? "" : appEnv,
    databaseUrl: url,
    expectedDbName: expectedDb,
    expectedNeonEndpointId: expectedEndpoint,
    expectedNeonProjectId: expectedProject,
    expectedNeonBranchId: expectedBranch,
    corpusDatabaseUrl: process.env.CORPUS_DATABASE_URL,
    allowNeondbProduct: process.env.MIGRATE_ALLOW_NEONDB_PRODUCT === "1",
  });

  if (identity.ok && expectedProject && expectedBranch && expectedEndpoint) {
    gates.DATABASE_IDENTITY_VERIFIED = true;
    report.identityVerdict = "DATABASE_IDENTITY_VERIFIED";
  } else {
    report.identityVerdict = "STAGING_PRODUCT_DB_IDENTITY_UNVERIFIED";
    if (!identity.ok) blockers.push(identity.code);
    else blockers.push("STAGING_PRODUCT_DB_IDENTITY_UNVERIFIED");
  }

  gates.BACKUP_RESTORE_VERIFIED = backupVerified;
  if (!backupVerified) blockers.push("BACKUP_RESTORE_NOT_OPERATOR_VERIFIED");

  gates.MIGRATION_HISTORY_RECONCILED = historyReconciledFlag;
  if (!historyReconciledFlag) {
    warnings.push("MIGRATION_HISTORY_RECONCILED_FLAG_UNSET");
    blockers.push("MIGRATION_HISTORY_NOT_OPERATOR_ATTESTED");
  }

  // Refuse SQL unless identity gate path allows Neon product attestation
  const mayQuery =
    gates.DATABASE_IDENTITY_VERIFIED &&
    (!fp.isNeon || allowNeonSql) &&
    !blockers.includes("CORPUS_ROLE_REFUSED");

  if (!mayQuery) {
    if (fp.isNeon || fp.dbName === "neondb") {
      blockers.push("NEON_SQL_REFUSED_UNTIL_IDENTITY_ATTESTED");
    }
    report.schemaProbe = "SKIPPED";
  } else {
    const requireTls = !fp.isLocalhost;
    const sql = postgres(url, {
      max: 1,
      ssl: requireTls ? "require" : false,
      prepare: fp.isNeon ? false : undefined,
    });
    try {
      const identityLive = await sql`
        select current_database() as db, current_user as usr
      `;
      report.liveIdentity = {
        database: identityLive[0].db,
        user: identityLive[0].usr,
      };
      if (expectedDb && identityLive[0].db !== expectedDb) {
        blockers.push("LIVE_DB_NAME_MISMATCH");
        gates.DATABASE_IDENTITY_VERIFIED = false;
        report.identityVerdict = "STAGING_PRODUCT_DB_IDENTITY_UNVERIFIED";
      }
      if (/corpus/i.test(String(identityLive[0].usr))) {
        blockers.push("LIVE_CORPUS_ROLE");
        gates.DATABASE_IDENTITY_VERIFIED = false;
      }

      const journalExists = await sql`select to_regclass('drizzle.__drizzle_migrations') as reg`;
      let createdAtValues = [];
      if (!journalExists[0].reg) {
        warnings.push("DRIZZLE_JOURNAL_MISSING");
      } else {
        const entries = await sql`
          select created_at from drizzle.__drizzle_migrations order by created_at
        `;
        createdAtValues = entries.map((e) => String(e.created_at));
      }
      report.journal = { count: createdAtValues.length, createdAtValues };
      const journalSet = new Set(createdAtValues);
      report.migrationCeiling = {
        requiredThrough: "0033",
        journaled: Object.fromEntries(
          Object.entries(REQUIRED_WHEN).map(([tag, when]) => [tag, journalSet.has(when)]),
        ),
        missingJournalTags: Object.entries(REQUIRED_WHEN)
          .filter(([, when]) => !journalSet.has(when))
          .map(([tag]) => tag),
      };

      // Collision millis present does not prove main vs deepening hashes — operator must attest.
      report.lineageCollisionRisk = {
        sharedWhenMillis: ["1788300000000", "1788400000000", "1788500000000", "1788600000000"],
        presentInJournal: [
          "1788300000000",
          "1788400000000",
          "1788500000000",
          "1788600000000",
        ].filter((w) => journalSet.has(w)),
        note: "Hash comparison / Deepening marker required for MIGRATION_HISTORY_RECONCILED",
      };

      const tables = await sql`
        select table_name from information_schema.tables
        where table_schema='public' and table_name in (
          'contacts','client_contacts','document_folders','time_entries','invoices',
          'prosecution_case_memories','prosecution_graph_nodes','prosecution_graph_edges'
        ) order by 1
      `;
      report.tablesPresent = tables.map((t) => t.table_name);

      async function hasCol(table, column) {
        const rows = await sql`
          select 1 from information_schema.columns
          where table_schema='public' and table_name=${table} and column_name=${column}
        `;
        return rows.length > 0;
      }

      const deepeningMarker = await hasCol("prosecution_discovery_items", "title");
      const graphReviewable = await hasCol("prosecution_graph_nodes", "node_kind");
      const graphStub = await hasCol("prosecution_graph_nodes", "node_type");

      const cons = await sql`
        select conname from pg_constraint where conname = any(${REQUIRED_GRAPH_CONSTRAINTS})
      `;
      const presentCons = new Set(cons.map((c) => c.conname));
      report.graphConstraints = {
        missing: REQUIRED_GRAPH_CONSTRAINTS.filter((c) => !presentCons.has(c)),
      };

      const schemaOk =
        report.tablesPresent.includes("contacts") &&
        report.tablesPresent.includes("document_folders") &&
        report.tablesPresent.includes("prosecution_case_memories") &&
        (await hasCol("time_entries", "billable")) &&
        graphReviewable &&
        report.graphConstraints.missing.length === 0 &&
        report.migrationCeiling.missingJournalTags.length === 0 &&
        !(graphStub && !graphReviewable);

      report.schemaSignals = {
        deepeningMarker,
        graphReviewable,
        graphStub,
        schemaOk,
      };

      gates.SCHEMA_COMPATIBLE = schemaOk;
      if (!schemaOk) blockers.push("SCHEMA_INCOMPATIBLE_OR_SHORT_OF_0033");

      // History reconciled only if operator flag set AND schema compatible (engineering evidence)
      if (historyReconciledFlag && schemaOk) {
        gates.MIGRATION_HISTORY_RECONCILED = true;
        // remove history blocker if previously added
        const idx = blockers.indexOf("MIGRATION_HISTORY_NOT_OPERATOR_ATTESTED");
        if (idx >= 0) blockers.splice(idx, 1);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  gates.STAGING_MIGRATION_AUTHORIZED =
    gates.DATABASE_IDENTITY_VERIFIED &&
    gates.MIGRATION_HISTORY_RECONCILED &&
    gates.SCHEMA_COMPATIBLE &&
    gates.BACKUP_RESTORE_VERIFIED &&
    operatorApproval;

  if (!operatorApproval) blockers.push("OPERATOR_APPROVAL_NOT_SET");
  if (gates.STAGING_MIGRATION_AUTHORIZED) {
    // Authorization flag is present — still not an instruction to migrate.
    warnings.push("PREFLIGHT_IS_NOT_EXECUTE_PERMISSION");
  }

  report.result = gates.STAGING_MIGRATION_AUTHORIZED
    ? "STAGING_MIGRATION_READY_FOR_OPERATOR_APPROVAL"
    : "STAGING_MIGRATION_PREFLIGHT_BLOCKED";

  // Deduplicate blockers
  report.blockers = [...new Set(blockers)];
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.result === "STAGING_MIGRATION_PREFLIGHT_BLOCKED" ? 2 : 0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(
    JSON.stringify({
      classification: "NYAYAGRID_WP06B_STAGING_PRODUCT_DB_PREFLIGHT",
      result: "STAGING_MIGRATION_PREFLIGHT_BLOCKED",
      error: msg.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[redacted]"),
    }),
  );
  process.exit(2);
});
