/**
 * Staging DB probe — runs on Fly machine. Never prints DATABASE_URL.
 */
async function main() {
  // Prefer pg if present in standalone image; else use drizzle migrate's bundled deps via dynamic import fail soft.
  let Client;
  try {
    Client = require("pg").Client;
  } catch {
    console.log(JSON.stringify({ ok: false, reason: "pg_not_in_image" }));
    process.exit(2);
  }
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const cols = await c.query(
    `select column_name from information_schema.columns
     where table_name='legal_authorities'
       and column_name in ('currentness_status','last_checked_at')
     order by 1`,
  );
  const cnt = await c.query(
    `select
       count(*) filter (where source_provider='us-primary-corpus')::int as real,
       count(*)::int as total,
       count(*) filter (where authority_type='case' and source_provider='us-primary-corpus')::int as cases,
       count(*) filter (where authority_type='statute' and source_provider='us-primary-corpus')::int as statutes,
       count(*) filter (where authority_type='regulation' and source_provider='us-primary-corpus')::int as regulations,
       count(*) filter (where authority_type='rule' and source_provider='us-primary-corpus')::int as rules
     from legal_authorities`,
  );
  console.log(
    JSON.stringify({
      ok: true,
      cols: cols.rows.map((r) => r.column_name),
      counts: cnt.rows[0],
      featureAgents: process.env.FEATURE_AGENTS ?? null,
    }),
  );
  await c.end();
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e && e.message ? e.message : e).slice(0, 300) }));
  process.exit(1);
});
