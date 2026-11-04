#!/bin/sh
set -e
mkdir -p /tmp/nm
tar -xf /tmp/postgres.tar -C /tmp/nm
node <<'NODE'
const postgres = require("/tmp/nm/postgres");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
(async () => {
  const sql = postgres(url, { max: 1, ssl: "require", prepare: false });
  await sql`SET default_transaction_read_only = on`;
  const host = new URL(url).hostname;
  const database = new URL(url).pathname.replace(/^\//, "").split("?")[0];
  const tables = [
    "legal_authorities",
    "legal_authority_chunks",
    "legal_authority_versions",
    "legal_authority_citations",
    "organizations",
    "matters",
    "documents",
    "criminal_cases",
    "audit_events",
  ];
  const counts = {};
  for (const table of tables) {
    const exists = await sql.unsafe(`SELECT to_regclass('public.${table}') AS reg`);
    if (!exists[0] || exists[0].reg == null) {
      counts[table] = { present: false, count: null };
      continue;
    }
    const rows = await sql.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${table}`);
    counts[table] = { present: true, count: Number(rows[0].c) };
  }
  const exts = await sql`SELECT extname FROM pg_extension ORDER BY 1`;
  await sql.end({ timeout: 5 });
  console.log(JSON.stringify({
    classification: "NYAYAGRID_WP05_STAGING_DB_INVENTORY",
    at: new Date().toISOString(),
    readOnly: true,
    neonCorpusWrites: 0,
    target: { host, database },
    extensions: exts.map((r) => r.extname),
    counts,
    isolationNote: "Corpus and product tables coexist on this database — physical isolation OPEN.",
  }));
})().catch((err) => {
  console.error(JSON.stringify({ result: "ERROR", error: String(err.message || err).slice(0, 400) }));
  process.exit(1);
});
NODE
