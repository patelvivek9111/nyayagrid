/**
 * Wave 2AD — DB truth for case<20 jurisdictions + existing court_ids.
 * ZERO CourtListener HTTP.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const deficit = await sql`
      select
        coalesce(nullif(btrim(authority_state), ''), 'US') as j,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'case' and court_level in ('state_high','scotus'))::int as high_court_cases,
        count(*) filter (where authority_type = 'case' and court_level in ('state_appellate','circuit'))::int as intermediate_appellate_cases
      from legal_authorities
      group by 1
      having count(*) filter (where authority_type = 'case') < 20
      order by cases asc, j asc
    `;
    const samples = await sql`
      select authority_state as j, court_id, court_level, court_name, source_provider, source_external_id, citation, title
      from legal_authorities
      where authority_type = 'case'
        and authority_state in (
          select coalesce(nullif(btrim(authority_state), ''), 'US')
          from legal_authorities
          group by 1
          having count(*) filter (where authority_type = 'case') < 20
        )
      order by authority_state, created_at nulls last
    `;
    const jobs = await sql`
      select cl_court, court_id, status, cursor, items_imported, target_max, updated_at
      from corpus_ingest_jobs
      where source = 'courtlistener'
      order by updated_at desc nulls last
    `;
    console.log(
      JSON.stringify({
        ok: true,
        courtListenerHttpCalls: 0,
        deficit,
        samples,
        jobs: jobs.slice(0, 40),
        featureAgents: process.env.FEATURE_AGENTS || "0",
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
