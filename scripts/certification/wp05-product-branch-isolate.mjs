#!/usr/bin/env node
/**
 * Destination-only isolation on a Neon product branch (source production branch untouched).
 * 1) Drop product→corpus FKs (soft-ref)
 * 2) Drop empty-or-present corpus tables on PRODUCT branch only
 * 3) Verify product counts vs source and corpus intact on source
 */
import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CORPUS_TABLES, SOFT_REF_FK_DROPS, redact } from "./wp05-product-db-cutover.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(
  __dirname,
  "../../packages/research/corpus/reports/wp05-product-branch-isolation.json",
);

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const productUrl = process.env.PRODUCT_DATABASE_URL;
if (!sourceUrl || !productUrl) {
  console.error(JSON.stringify({ error: "SOURCE_DATABASE_URL and PRODUCT_DATABASE_URL required" }));
  process.exit(1);
}

const startedAt = new Date().toISOString();
const product = postgres(productUrl.replace("-pooler", ""), {
  max: 1,
  ssl: "require",
  prepare: false,
});
const source = postgres(sourceUrl.replace("-pooler", ""), {
  max: 1,
  ssl: "require",
  prepare: false,
});

await source`SET default_transaction_read_only = on`;

// Soft-ref on product branch only
for (const stmt of SOFT_REF_FK_DROPS) {
  await product.unsafe(stmt);
}

const droppedCorpus = [];
for (const table of CORPUS_TABLES) {
  const exists = await product`SELECT to_regclass(${"public." + table}) AS reg`;
  if (!exists[0]?.reg) continue;
  await product.unsafe(`DROP TABLE IF EXISTS public.${table} CASCADE`);
  droppedCorpus.push(table);
}

// Also drop other corpus-ish tables that start with legal_authority_ if any remain
const leftover = await product`
  SELECT c.relname AS table_name
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
    AND (c.relname LIKE 'legal_authority%' OR c.relname LIKE 'corpus_%')
  ORDER BY 1`;
for (const row of leftover) {
  await product.unsafe(`DROP TABLE IF EXISTS public.${row.table_name} CASCADE`);
  droppedCorpus.push(row.table_name);
}

const srcTables = (
  await source`
  SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`
).map((r) => r.t);
const prodTables = (
  await product`
  SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`
).map((r) => r.t);

const productExpected = srcTables.filter((t) => !CORPUS_TABLES.includes(t) && !t.startsWith("legal_authority") && !t.startsWith("corpus_"));
const countCompare = {};
let countsMatch = true;
for (const t of productExpected) {
  if (!prodTables.includes(t)) {
    countCompare[t] = { source: null, dest: null, match: false, missingOnDest: true };
    countsMatch = false;
    continue;
  }
  const a = Number((await source.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${t}`))[0].c);
  const b = Number((await product.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${t}`))[0].c);
  countCompare[t] = { source: a, dest: b, match: a === b };
  if (a !== b) countsMatch = false;
}

const corpusOnProduct = prodTables.filter(
  (t) => CORPUS_TABLES.includes(t) || t.startsWith("legal_authority") || t.startsWith("corpus_"),
);
const corpusSrc = {};
for (const t of [
  "legal_authorities",
  "legal_authority_citations",
  "legal_authority_chunks",
  "legal_authority_versions",
]) {
  corpusSrc[t] = Number((await source.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${t}`))[0].c);
}

const remainingCrossFks = await product`
  SELECT tc.table_name AS from_table, ccu.table_name AS to_table, tc.constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
    AND (ccu.table_name LIKE 'legal_authority%' OR ccu.table_name LIKE 'corpus_%')`;

await product.end({ timeout: 5 });
await source.end({ timeout: 5 });

const report = {
  classification: "NYAYAGRID_WP05_PRODUCT_BRANCH_ISOLATION",
  startedAt,
  completedAt: new Date().toISOString(),
  neonCorpusWrites: 0,
  sourceBranchUntouched: true,
  targets: { source: redact(sourceUrl), product: redact(productUrl) },
  droppedCorpusTablesOnProductBranch: [...new Set(droppedCorpus)],
  sourceProductTables: productExpected.length,
  destProductTables: prodTables.length,
  corpusTablesInProductDb: corpusOnProduct,
  remainingCrossFks,
  countsMatch,
  mismatches: Object.entries(countCompare)
    .filter(([, v]) => !v.match)
    .map(([table, v]) => ({ table, ...v })),
  sampleCounts: Object.fromEntries(
    ["organizations", "matters", "documents", "audit_events", "users"].map((t) => [
      t,
      countCompare[t] || null,
    ]),
  ),
  sourceCorpusCounts: corpusSrc,
  result:
    countsMatch &&
    corpusOnProduct.length === 0 &&
    remainingCrossFks.length === 0 &&
    corpusSrc.legal_authorities === 35863
      ? "PASS"
      : "FAIL",
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === "PASS" ? 0 : 2);
