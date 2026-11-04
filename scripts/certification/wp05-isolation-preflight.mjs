#!/usr/bin/env node
/**
 * WP-05 Phase 1 — read-only product/corpus isolation preflight.
 * Never writes. Never prints credentials.
 */
import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(
  __dirname,
  "../../packages/research/corpus/reports/wp05-isolation-preflight.json",
);

/** Licensed / research corpus + corpus ops — NOT product legal_holds / legal_work_*. */
const CORPUS_EXACT = new Set([
  "legal_authorities",
  "legal_authority_chunks",
  "legal_authority_versions",
  "legal_authority_citations",
  "legal_authority_relationships",
  "corpus_ingest_jobs",
  "corpus_refresh_jobs",
  "corpus_source_health",
]);

function isCorpusTable(name) {
  return (
    CORPUS_EXACT.has(name) ||
    name.startsWith("legal_authority_") ||
    name.startsWith("corpus_")
  );
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(JSON.stringify({ result: "ERROR", error: "DATABASE_URL required" }));
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require", prepare: false, connect_timeout: 30 });
await sql`SET default_transaction_read_only = on`;

const host = new URL(url).hostname;
const database = new URL(url).pathname.replace(/^\//, "").split("?")[0];

const tables = await sql`
  SELECT c.relname AS table_name,
         pg_catalog.pg_get_userbyid(c.relowner) AS owner,
         n.nspname AS schema,
         c.relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  ORDER BY 1`;

const sequences = await sql`
  SELECT c.relname AS sequence_name, pg_catalog.pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='S'
  ORDER BY 1`;

const views = await sql`
  SELECT table_name FROM information_schema.views
  WHERE table_schema='public' ORDER BY 1`;

const extensions = await sql`SELECT extname, extversion FROM pg_extension ORDER BY 1`;

const triggers = await sql`
  SELECT event_object_table AS table_name, trigger_name, action_timing, event_manipulation
  FROM information_schema.triggers
  WHERE trigger_schema='public'
  ORDER BY 1,2`;

const functions = await sql`
  SELECT p.proname AS function_name, pg_catalog.pg_get_userbyid(p.proowner) AS owner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
  ORDER BY 1`;

const fks = await sql`
  SELECT
    tc.table_name AS from_table,
    kcu.column_name AS from_column,
    ccu.table_name AS to_table,
    ccu.column_name AS to_column,
    tc.constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'
  ORDER BY 1,3`;

const roles = await sql`
  SELECT r.rolname, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin
  FROM pg_roles r
  WHERE r.rolname NOT LIKE 'pg_%'
  ORDER BY 1`;

const corpusTables = tables.filter((t) => isCorpusTable(t.table_name)).map((t) => t.table_name);
const productTables = tables.filter((t) => !isCorpusTable(t.table_name)).map((t) => t.table_name);

const crossDomainFks = fks.filter((fk) => {
  const fromCorpus = isCorpusTable(fk.from_table);
  const toCorpus = isCorpusTable(fk.to_table);
  return fromCorpus !== toCorpus;
});

const corpusCounts = {};
for (const name of [
  "legal_authorities",
  "legal_authority_chunks",
  "legal_authority_versions",
  "legal_authority_citations",
]) {
  const exists = tables.some((t) => t.table_name === name);
  if (!exists) {
    corpusCounts[name] = null;
    continue;
  }
  const rows = await sql.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${name}`);
  corpusCounts[name] = Number(rows[0].c);
}

const productSampleCounts = {};
for (const name of [
  "organizations",
  "matters",
  "documents",
  "audit_events",
  "users",
  "memberships",
  "clients",
  "notes",
  "tasks",
  "deadlines",
]) {
  if (!productTables.includes(name)) continue;
  const rows = await sql.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${name}`);
  productSampleCounts[name] = Number(rows[0].c);
}

const blockers = [];
if (crossDomainFks.length > 0) {
  blockers.push({
    code: "CROSS_DOMAIN_FOREIGN_KEYS",
    count: crossDomainFks.length,
    action:
      "Stop cutover. Remove or redesign product↔corpus FKs before physical separation (do not disable constraints).",
    samples: crossDomainFks.slice(0, 25),
  });
}

const report = {
  classification: "NYAYAGRID_WP05_ISOLATION_PREFLIGHT",
  at: new Date().toISOString(),
  readOnly: true,
  neonCorpusWrites: 0,
  target: { host, database, branchHint: "br-delicate-cloud-au0md4t9" },
  extensions,
  tableCounts: {
    total: tables.length,
    product: productTables.length,
    corpus: corpusTables.length,
  },
  productTables,
  corpusTables,
  sequences: sequences.map((s) => s.sequence_name),
  views: views.map((v) => v.table_name),
  triggers,
  functions: functions.map((f) => f.function_name),
  roles,
  foreignKeyTotal: fks.length,
  crossDomainForeignKeys: crossDomainFks,
  corpusCounts,
  productSampleCounts,
  blockers,
  result: blockers.length === 0 ? "PREFLIGHT_PASS_READY_FOR_PROVISION" : "PREFLIGHT_BLOCKED",
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      result: report.result,
      totalTables: tables.length,
      productTables: productTables.length,
      corpusTables: corpusTables.length,
      crossDomainFkCount: crossDomainFks.length,
      corpusCounts,
      productSampleCounts,
      extensions: extensions.map((e) => e.extname),
      blockers: blockers.map((b) => ({ code: b.code, count: b.count })),
    },
    null,
    2,
  ),
);
await sql.end({ timeout: 5 });
process.exit(blockers.length === 0 ? 0 : 2);
