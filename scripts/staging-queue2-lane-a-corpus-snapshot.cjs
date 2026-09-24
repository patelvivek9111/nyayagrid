/**
 * Read-only Queue #2 Lane A corpus snapshot for manifest rebuild.
 * ZERO CourtListener HTTP. ZERO mutations.
 *
 * Usage on staging: node scripts/staging-queue2-lane-a-corpus-snapshot.cjs
 */
"use strict";

const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", mutations: 0, courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const perJur = await sql`
      select
        coalesce(nullif(btrim(authority_state), ''), 'US') as j,
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'case' and source_provider = 'courtlistener')::int as cl_cases,
        count(*) filter (where authority_type = 'case' and court_level in ('state_high','scotus'))::int as high_court,
        count(*) filter (where authority_type = 'case' and court_level in ('state_appellate','circuit'))::int as intermediate,
        min(extract(year from decision_date)::int) filter (where authority_type = 'case') as oldest,
        max(extract(year from decision_date)::int) filter (where authority_type = 'case') as newest,
        count(distinct court_id) filter (where authority_type = 'case')::int as unique_courts
      from legal_authorities
      group by 1
      order by 1
    `;

    const citeDemand = await sql`
      select
        coalesce(nullif(btrim(a.authority_state), ''), 'US') as j,
        count(*)::int as target_absent
      from legal_authority_citations e
      join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
        and e.normalized_citation is not null
        and length(e.normalized_citation) > 4
      group by 1
    `;
    const demandByJ = Object.fromEntries(citeDemand.map((r) => [r.j, Number(r.target_absent)]));

    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases,
             count(*) filter (where authority_type='statute')::int as statutes,
             count(*) filter (where authority_type='regulation')::int as regulations,
             count(*) filter (where authority_type='rule')::int as rules
      from legal_authorities
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;
    const [dupSrc] = await sql`
      select count(*)::int as n from (
        select source_provider, source_external_id from legal_authorities
        where source_external_id is not null
        group by 1, 2 having count(*) > 1
      ) d
    `;
    const [ark] = await sql`
      select count(*)::int as cases
      from legal_authorities
      where authority_state = 'AR' and authority_type = 'case'
    `;

    console.log(
      JSON.stringify({
        ok: true,
        mutations: 0,
        courtListenerHttpCalls: 0,
        featureAgents: process.env.FEATURE_AGENTS || "0",
        generatedAt: new Date().toISOString(),
        corpus,
        orphans: orphans.n,
        duplicateSourceIds: dupSrc.n,
        arkCases: ark.cases,
        jurisdictions: perJur.map((r) => ({
          j: r.j,
          authorities: r.authorities,
          cases: r.cases,
          clCases: r.cl_cases,
          highCourt: r.high_court,
          intermediate: r.intermediate,
          oldest: r.oldest,
          newest: r.newest,
          uniqueCourts: r.unique_courts,
          citationTargetAbsent: demandByJ[r.j] || 0,
        })),
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400), mutations: 0, courtListenerHttpCalls: 0 }));
  process.exit(1);
});
