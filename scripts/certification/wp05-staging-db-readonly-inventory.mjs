#!/usr/bin/env node
/**
 * Read-only inventory against staging DATABASE_URL (via Fly SSH or local env).
 * Never writes. Never prints connection secrets.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(
  __dirname,
  "../../packages/research/corpus/reports/wp05-staging-db-inventory.json",
);

const CORPUS = [
  "legal_authorities",
  "legal_authority_chunks",
  "legal_authority_versions",
  "legal_authority_citations",
];
const PRODUCT = ["organizations", "matters", "documents", "criminal_cases", "audit_events"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const pg = await import("pg");
  const client = new pg.default.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SET default_transaction_read_only = on");
  const host = new URL(url).hostname;
  const db = new URL(url).pathname.replace(/^\//, "").split("?")[0];
  const counts = {};
  for (const table of [...CORPUS, ...PRODUCT]) {
    const exists = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${table}`]);
    if (!exists.rows[0]?.reg) {
      counts[table] = { present: false, count: null };
      continue;
    }
    const r = await client.query(`SELECT COUNT(*)::bigint AS c FROM public.${table}`);
    counts[table] = { present: true, count: Number(r.rows[0].c) };
  }
  const exts = await client.query(`SELECT extname FROM pg_extension ORDER BY 1`);
  await client.end();
  const report = {
    classification: "NYAYAGRID_WP05_STAGING_DB_INVENTORY",
    at: new Date().toISOString(),
    readOnly: true,
    neonCorpusWrites: 0,
    target: { host, database: db },
    extensions: exts.rows.map((r) => r.extname),
    counts,
    isolationNote:
      "Corpus and product tables coexist on this database — physical isolation OPEN.",
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ result: "ERROR", error: String(err.message || err).slice(0, 300) }));
  process.exit(1);
});
