/**
 * Staging SQL snapshot for Wave 2C before/after (no CL).
 */
const postgres = require("postgres");

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });
  const counts = await sql`
    select
      count(*)::int as total,
      count(*) filter (where source_provider = 'us-primary-corpus')::int as curated,
      count(*) filter (where source_provider = 'courtlistener')::int as cl,
      count(*) filter (where authority_type = 'statute')::int as statutes,
      count(*) filter (where authority_type = 'regulation')::int as regulations,
      count(*) filter (where authority_type = 'rule')::int as rules,
      count(*) filter (where authority_type = 'case')::int as cases,
      count(*) filter (where currentness_status::text = 'current_as_of_source_date')::int as current_as_of,
      count(*) filter (where last_checked_at is not null)::int as last_checked,
      count(*) filter (where normalized_citation is not null and btrim(normalized_citation) <> '')::int as normalized
    from legal_authorities
  `;
  const cites = await sql`
    select
      count(*)::int as extracted,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
  `;
  const feature = await sql`
    select coalesce(
      (select value from app_settings where key = 'FEATURE_AGENTS' limit 1),
      (select current_setting('app.feature_agents', true))
    ) as feature_agents
  `.catch(() => [{ feature_agents: "env_only" }]);
  console.log(JSON.stringify({ ok: true, counts: counts[0], cites: cites[0], feature }, null, 2));
  await sql.end({ timeout: 2 });
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e) }));
  process.exit(1);
});
