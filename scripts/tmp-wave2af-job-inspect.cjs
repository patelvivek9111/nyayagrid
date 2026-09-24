/**
 * Wave 2AF — inspect corpus_ingest_jobs for depth courts. ZERO CL HTTP.
 */
"use strict";
const postgres = require("postgres");

const COURTS = ["la", "dc", "nev", "tenn", "mont"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const jobs = await sql`
      select cl_court, court_id, status, target_max, batch_size,
             items_imported, items_skipped, items_fetched, items_discovered,
             items_failed, items_quarantined, api_calls,
             cursor, left(coalesce(next_page_url,''), 180) as next_page_prefix,
             last_error, updated_at, completed_at
      from corpus_ingest_jobs
      where source = 'courtlistener' and cl_court = any(${COURTS})
      order by cl_court
    `;
    const laYears = await sql`
      select extract(year from decision_date)::int as y, count(*)::int as n
      from legal_authorities
      where authority_state = 'LA' and authority_type = 'case' and decision_date is not null
      group by 1 order by 1
    `;
    const dcYears = await sql`
      select extract(year from decision_date)::int as y, count(*)::int as n
      from legal_authorities
      where authority_state = 'DC' and authority_type = 'case' and decision_date is not null
      group by 1 order by 1
    `;
    const counts = await sql`
      select authority_state as j,
             count(*)::int as authorities,
             count(*) filter (where authority_type = 'case')::int as cases,
             min(extract(year from decision_date)::int) filter (where authority_type = 'case') as y0,
             max(extract(year from decision_date)::int) filter (where authority_type = 'case') as y1
      from legal_authorities
      where authority_state in ('LA','DC','NV','TN','MT')
      group by 1 order by 1
    `;
    console.log(JSON.stringify({ ok: true, courtListenerHttpCalls: 0, jobs, counts, laYears, dcYears, featureAgents: "0" }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
