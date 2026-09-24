/**
 * Wave 2AG — DB depth snapshot for MT + CRITICAL_DEPTH queue. ZERO CL HTTP.
 */
"use strict";
const postgres = require("postgres");

const TARGETS = ["MT", "IA", "ME", "MS", "AR", "SD", "ID", "WY", "NE", "AL", "KY"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const rows = [];
    for (const j of TARGETS) {
      const [agg] = await sql`
        select
          count(*)::int as authorities,
          count(*) filter (where authority_type = 'case')::int as cases,
          count(*) filter (where authority_type = 'case' and court_level in ('state_high','scotus'))::int as high_court,
          count(*) filter (where authority_type = 'case' and court_level in ('state_appellate','circuit'))::int as intermediate,
          min(extract(year from decision_date)::int) filter (where authority_type = 'case') as y0,
          max(extract(year from decision_date)::int) filter (where authority_type = 'case') as y1,
          count(distinct extract(year from decision_date)::int) filter (where authority_type = 'case' and decision_date is not null) as distinct_years
        from legal_authorities where authority_state = ${j}
      `;
      rows.push({ j, ...agg });
    }
    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases,
             count(*) filter (where authority_type='statute')::int as statutes,
             count(*) filter (where authority_type='regulation')::int as regulations,
             count(*) filter (where authority_type='rule')::int as rules
      from legal_authorities
    `;
    const [chunks] = await sql`
      select count(*)::int as chunks,
             count(*) filter (where embedding is not null)::int as embeddings
      from legal_authority_chunks
    `;
    const [cites] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as target_absent
      from legal_authority_citations
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;
    console.log(JSON.stringify({ ok: true, courtListenerHttpCalls: 0, rows, corpus, chunks, cites, orphans: orphans.n, featureAgents: "0" }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
