#!/usr/bin/env node
/**
 * Copy product schema+data into nyayagrid_product_staging via docker pg_dump/psql.
 * Excludes corpus tables. Strips product→corpus FK constraints in the dump text
 * (destination soft-ref). Never modifies source. Never logs connection strings.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { CORPUS_TABLES, redact, toDirect } from "./wp05-product-db-cutover.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(
  __dirname,
  "../../packages/research/corpus/reports/wp05-product-copy-verification.json",
);

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const destUrl = process.env.PRODUCT_DATABASE_URL;
if (!sourceUrl || !destUrl) {
  console.error(JSON.stringify({ error: "SOURCE_DATABASE_URL and PRODUCT_DATABASE_URL required" }));
  process.exit(1);
}

const src = toDirect(sourceUrl);
const dst = toDirect(destUrl);
const startedAt = new Date().toISOString();

function docker(args, opts = {}) {
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    ...opts,
  });
  return r;
}

const excludeArgs = CORPUS_TABLES.map((t) => `--exclude-table=public.${t}`).join(" ");
const dumpCmd = `pg_dump "$SOURCE_URL" --no-owner --no-acl --format=plain ${excludeArgs}`;

console.error(JSON.stringify({ phase: "pg_dump", excludes: CORPUS_TABLES.length }));
const dump = docker(
  ["run", "--rm", "-e", `SOURCE_URL=${src}`, "postgres:18-alpine", "sh", "-c", dumpCmd],
  { timeout: 600_000 },
);
if (dump.status !== 0) {
  console.error(
    JSON.stringify({
      error: "pg_dump_failed",
      detail: String(dump.stderr || dump.stdout || "").slice(0, 800),
    }),
  );
  process.exit(1);
}

let sqlText = dump.stdout;
const stripStats = { alterFkRemoved: 0 };
for (const table of CORPUS_TABLES) {
  const reAlter = new RegExp(
    `ALTER TABLE(?: ONLY)? [\\s\\S]*?FOREIGN KEY[\\s\\S]*?REFERENCES (?:public\\.)?["']?${table}["']?\\s*\\([^)]*\\)[\\s\\S]*?;`,
    "gi",
  );
  const before = sqlText.length;
  sqlText = sqlText.replace(reAlter, () => {
    stripStats.alterFkRemoved += 1;
    return "";
  });
  if (sqlText.length === before) {
    /* no-op */
  }
}

// Ensure extensions exist on destination before restore.
{
  const d = postgres(dst, { max: 1, ssl: "require", prepare: false });
  await d.unsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await d.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await d.end({ timeout: 5 });
}

console.error(JSON.stringify({ phase: "psql_restore", dumpChars: sqlText.length, stripStats }));
const restore = docker(
  [
    "run",
    "--rm",
    "-i",
    "-e",
    `DEST_URL=${dst}`,
    "postgres:18-alpine",
    "sh",
    "-c",
    'psql "$DEST_URL" -v ON_ERROR_STOP=1',
  ],
  { input: sqlText, timeout: 600_000 },
);
if (restore.status !== 0) {
  console.error(
    JSON.stringify({
      error: "psql_restore_failed",
      detail: String(restore.stderr || restore.stdout || "").slice(0, 1200),
    }),
  );
  process.exit(1);
}

// Verify
const srcSql = postgres(src, { max: 1, ssl: "require", prepare: false });
const dstSql = postgres(dst, { max: 1, ssl: "require", prepare: false });
await srcSql`SET default_transaction_read_only = on`;
await dstSql`SET default_transaction_read_only = on`;

const srcTables = (
  await srcSql`
  SELECT c.relname AS table_name FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`
).map((r) => r.table_name);
const dstTables = (
  await dstSql`
  SELECT c.relname AS table_name FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`
).map((r) => r.table_name);

const productSrc = srcTables.filter((t) => !CORPUS_TABLES.includes(t));
const corpusInDest = dstTables.filter((t) => CORPUS_TABLES.includes(t));
const missingProduct = productSrc.filter((t) => !dstTables.includes(t));

const countCompare = {};
let countsMatch = true;
for (const t of productSrc) {
  if (!dstTables.includes(t)) continue;
  const a = Number((await srcSql.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${t}`))[0].c);
  const b = Number((await dstSql.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${t}`))[0].c);
  countCompare[t] = { source: a, dest: b, match: a === b };
  if (a !== b) countsMatch = false;
}

const crossFkDest = await dstSql`
  SELECT tc.table_name AS from_table, ccu.table_name AS to_table, tc.constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
    AND ccu.table_name = ANY(${CORPUS_TABLES})`;

const corpusSrcCounts = {};
for (const t of [
  "legal_authorities",
  "legal_authority_citations",
  "legal_authority_chunks",
  "legal_authority_versions",
]) {
  corpusSrcCounts[t] = Number(
    (await srcSql.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${t}`))[0].c,
  );
}

await srcSql.end({ timeout: 5 });
await dstSql.end({ timeout: 5 });

const report = {
  classification: "NYAYAGRID_WP05_PRODUCT_COPY_VERIFICATION",
  startedAt,
  completedAt: new Date().toISOString(),
  neonCorpusWrites: 0,
  sourceModified: false,
  targets: { source: redact(src), destination: redact(dst) },
  stripStats,
  sourceProductTables: productSrc.length,
  destTables: dstTables.length,
  missingProductTables: missingProduct,
  corpusTablesInProductDb: corpusInDest,
  countsMatch,
  countCompareSample: Object.fromEntries(Object.entries(countCompare).slice(0, 20)),
  productCountMismatches: Object.entries(countCompare)
    .filter(([, v]) => !v.match)
    .map(([k, v]) => ({ table: k, ...v })),
  remainingProductToCorpusFksOnDest: crossFkDest,
  sourceCorpusCounts: corpusSrcCounts,
  result:
    missingProduct.length === 0 &&
    corpusInDest.length === 0 &&
    countsMatch &&
    crossFkDest.length === 0
      ? "PASS"
      : "FAIL",
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === "PASS" ? 0 : 2);
