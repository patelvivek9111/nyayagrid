#!/usr/bin/env node
/**
 * WP-05 managed PITR verification (READ-ONLY).
 *
 * Requires:
 *   PRODUCTION_DATABASE_URL  — original Neon production branch (read-only queries)
 *   PITR_DATABASE_URL        — isolated recovery branch connection
 * Optional:
 *   PITR_HISTORICAL_TIMESTAMP / PITR_PARENT_LSN — operator-supplied Neon metadata
 *   PITR_BRANCH_CREATED_AT   — ISO time the recovery branch was created
 *
 * Never writes. Never targets production for restore. Never invents LSN/timestamp.
 *
 * Usage:
 *   node scripts/certification/wp05-pitr-verify.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(
  __dirname,
  "../../packages/research/corpus/reports/wp05-pitr-verification.json",
);

const CORPUS_TABLES = [
  "legal_authorities",
  "legal_authority_chunks",
  "legal_authority_versions",
  "legal_authority_citations",
];

const PRODUCT_TABLES = ["organizations", "matters", "documents", "criminal_cases", "audit_events"];

function env(name) {
  return String(process.env[name] ?? "").trim();
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/${(u.pathname || "/").replace(/^\//, "")}`;
  } catch {
    return "(unparseable)";
  }
}

async function withClient(url, fn) {
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, {
    max: 1,
    ssl: "require",
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 20,
  });
  const client = {
    async query(text, params = []) {
      const rows = await sql.unsafe(text, params);
      return { rows: Array.from(rows) };
    },
  };
  try {
    await client.query("SET default_transaction_read_only = on");
    await client.query("SET statement_timeout = '120s'");
    return await fn(client);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function tableCounts(client, tables) {
  const out = {};
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error(`invalid table ${table}`);
    const exists = await client.query("SELECT to_regclass($1) AS reg", [`public.${table}`]);
    if (!exists.rows[0]?.reg) {
      out[table] = { present: false, count: null };
      continue;
    }
    const r = await client.query(`SELECT COUNT(*)::bigint AS c FROM public.${table}`);
    out[table] = { present: true, count: Number(r.rows[0].c) };
  }
  return out;
}

async function extensionList(client) {
  const r = await client.query(`SELECT extname FROM pg_extension ORDER BY extname`);
  return r.rows.map((row) => row.extname);
}

async function orphanCitationCheck(client) {
  const exists = await client.query(
    `SELECT to_regclass('public.legal_authority_citations') AS c,
            to_regclass('public.legal_authorities') AS a`,
  );
  if (!exists.rows[0]?.c || !exists.rows[0]?.a) {
    return { skipped: true, reason: "tables_missing" };
  }
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='legal_authority_citations'`,
  );
  const names = new Set(cols.rows.map((r) => r.column_name));
  const fkCol = names.has("authority_id")
    ? "authority_id"
    : names.has("from_authority_id")
      ? "from_authority_id"
      : null;
  if (!fkCol) return { skipped: true, reason: "fk_column_unknown" };
  const r = await client.query(
    `SELECT COUNT(*)::bigint AS orphans
     FROM public.legal_authority_citations c
     LEFT JOIN public.legal_authorities a ON a.id = c.${fkCol}
     WHERE a.id IS NULL`,
  );
  return { skipped: false, orphans: Number(r.rows[0].orphans), fkCol };
}

async function checksumSample(client, table) {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`invalid table ${table}`);
  const exists = await client.query("SELECT to_regclass($1) AS reg", [`public.${table}`]);
  if (!exists.rows[0]?.reg) return null;
  const idCol = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name='id'`,
    [table],
  );
  if (idCol.rows.length === 0) return null;
  const r = await client.query(
    `SELECT COUNT(*)::bigint AS n,
            COALESCE(md5(string_agg(id::text, ',' ORDER BY id)), 'empty') AS id_digest
     FROM (
       SELECT id FROM public.${table} ORDER BY id LIMIT 5000
     ) s`,
  );
  return { sampleSize: Number(r.rows[0].n), idDigest: r.rows[0].id_digest };
}

const startedAt = new Date().toISOString();
const prodUrl = env("PRODUCTION_DATABASE_URL") || env("DATABASE_URL");
const pitrUrl = env("PITR_DATABASE_URL");
const historicalTs = env("PITR_HISTORICAL_TIMESTAMP") || null;
const parentLsn = env("PITR_PARENT_LSN") || null;
const branchCreatedAt = env("PITR_BRANCH_CREATED_AT") || null;
const historyRetentionHours = Number(env("NEON_HISTORY_RETENTION_HOURS") || "6");

const report = {
  classification: "NYAYAGRID_WP05_MANAGED_PITR_VERIFICATION",
  startedAt,
  completedAt: null,
  readOnly: true,
  neonCorpusWrites: 0,
  productionOverwrite: false,
  originalBranchHint: env("PITR_ORIGINAL_BRANCH") || "production / br-delicate-cloud-au0md4t9",
  recoveryBranchHint:
    env("PITR_RECOVERY_BRANCH") || "wp05-pitr-rehearsal-20261104 / br-odd-haze-au3z053l",
  historicalRecoveryTimestamp: historicalTs,
  parentLsn,
  branchCreatedAt,
  historyRetentionHours,
  targets: {
    production: prodUrl ? redactUrl(prodUrl) : null,
    pitr: pitrUrl ? redactUrl(pitrUrl) : null,
  },
  checks: {},
  blockers: [],
  result: "NOT_RUN",
};

async function main() {
  if (!prodUrl) {
    report.blockers.push({
      code: "PRODUCTION_DATABASE_URL_MISSING",
      action:
        "Export a read-only PRODUCTION_DATABASE_URL (or DATABASE_URL) for the original Neon production branch.",
    });
  }
  if (!pitrUrl) {
    report.blockers.push({
      code: "PITR_DATABASE_URL_MISSING",
      action:
        "Export PITR_DATABASE_URL for the isolated recovery branch wp05-pitr-rehearsal-20261104 before it auto-deletes. Do not create billable compute without approval if expired.",
    });
  }
  if (!historicalTs && !parentLsn) {
    report.blockers.push({
      code: "HISTORICAL_CHECKPOINT_UNVERIFIED",
      action:
        "From Neon Console → branch wp05-pitr-rehearsal-20261104 → copy exact PITR timestamp or parent LSN into PITR_HISTORICAL_TIMESTAMP / PITR_PARENT_LSN. Do not invent values.",
    });
  }

  if (historicalTs && branchCreatedAt) {
    const hist = Date.parse(historicalTs);
    const created = Date.parse(branchCreatedAt);
    report.checks.recoveryPointBeforeCreation =
      Number.isFinite(hist) && Number.isFinite(created) ? hist < created : null;
    if (report.checks.recoveryPointBeforeCreation === false) {
      report.blockers.push({
        code: "RECOVERY_POINT_NOT_BEFORE_CREATION",
        action: "Historical timestamp must be earlier than branch creation time.",
      });
    }
  } else {
    report.checks.recoveryPointBeforeCreation = null;
  }

  if (prodUrl && pitrUrl) {
    const t0 = Date.now();
    report.checks.production = await withClient(prodUrl, async (client) => ({
      extensions: await extensionList(client),
      corpusCounts: await tableCounts(client, CORPUS_TABLES),
      productCounts: await tableCounts(client, PRODUCT_TABLES),
      orphanCitations: await orphanCitationCheck(client),
      authoritySample: await checksumSample(client, "legal_authorities"),
      citationSample: await checksumSample(client, "legal_authority_citations"),
    }));
    report.checks.pitr = await withClient(pitrUrl, async (client) => ({
      extensions: await extensionList(client),
      corpusCounts: await tableCounts(client, CORPUS_TABLES),
      productCounts: await tableCounts(client, PRODUCT_TABLES),
      orphanCitations: await orphanCitationCheck(client),
      authoritySample: await checksumSample(client, "legal_authorities"),
      citationSample: await checksumSample(client, "legal_authority_citations"),
    }));
    report.checks.measuredQueryMs = Date.now() - t0;

    const countCompare = {};
    for (const t of CORPUS_TABLES) {
      const a = report.checks.production.corpusCounts[t];
      const b = report.checks.pitr.corpusCounts[t];
      countCompare[t] = {
        production: a,
        pitr: b,
        match: a?.present && b?.present && a.count === b.count,
      };
    }
    report.checks.corpusCountCompare = countCompare;
    report.checks.sampleDigestMatch = {
      legal_authorities:
        report.checks.production.authoritySample?.idDigest ===
        report.checks.pitr.authoritySample?.idDigest,
      legal_authority_citations:
        report.checks.production.citationSample?.idDigest ===
        report.checks.pitr.citationSample?.idDigest,
    };
  }

  report.checks.rpoImplication = {
    targetManagedRpoMinutes: 5,
    neonHistoryRetentionHours: historyRetentionHours,
    satisfiesTargetWhenRetentionHours: historyRetentionHours >= 5 / 60,
    note: "Six-hour Neon history retention means restores older than ~6h are unavailable. Matches interim ops only if the incident is within the retention window; does not alone certify <=5m RPO without provider WAL evidence.",
  };

  const countsOk =
    report.checks.corpusCountCompare &&
    Object.values(report.checks.corpusCountCompare).every((c) => c.match);

  if (!historicalTs && !parentLsn) {
    report.result = countsOk ? "PARTIAL_COUNTS_ONLY_CHECKPOINT_MISSING" : "BLOCKED";
  } else if (report.blockers.length > 0) {
    report.result = "BLOCKED";
  } else if (countsOk) {
    report.result = "PASS_WITH_EVIDENCE";
  } else {
    report.result = "FAIL_COUNT_MISMATCH";
  }

  report.completedAt = new Date().toISOString();
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "PASS_WITH_EVIDENCE") process.exit(2);
}

main().catch((err) => {
  report.completedAt = new Date().toISOString();
  report.result = "ERROR";
  report.blockers.push({
    code: "PITR_SCRIPT_ERROR",
    action: String(err?.message ?? err).slice(0, 300),
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});
