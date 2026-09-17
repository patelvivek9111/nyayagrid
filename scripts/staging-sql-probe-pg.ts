import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_database_url" }));
    process.exit(2);
  }
  const sql = postgres(url, { ssl: "require", max: 1 });
  try {
    const cols = await sql`
      select column_name from information_schema.columns
      where table_name = 'legal_authorities'
        and column_name in ('currentness_status', 'last_checked_at')
      order by 1
    `;
    const cnt = await sql`
      select
        count(*) filter (where source_provider = 'us-primary-corpus')::int as real,
        count(*)::int as total,
        count(*) filter (where authority_type = 'case' and source_provider = 'us-primary-corpus')::int as cases,
        count(*) filter (where authority_type = 'statute' and source_provider = 'us-primary-corpus')::int as statutes,
        count(*) filter (where authority_type = 'regulation' and source_provider = 'us-primary-corpus')::int as regulations,
        count(*) filter (where authority_type = 'rule' and source_provider = 'us-primary-corpus')::int as rules
      from legal_authorities
    `;
    console.log(
      JSON.stringify({
        ok: true,
        cols: cols.map((r) => r.column_name),
        counts: cnt[0],
        featureAgents: process.env.FEATURE_AGENTS ?? null,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message ?? e).slice(0, 300) }));
  process.exit(1);
});
