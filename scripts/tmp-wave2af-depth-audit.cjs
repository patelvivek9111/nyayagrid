/**
 * Wave 2AF — DB-only depth audit for LA/DC/TN/NV/MT/MS/NM/UT/SD/ID.
 * ZERO CourtListener HTTP.
 */
"use strict";
const postgres = require("postgres");

const TARGETS = ["LA", "DC", "TN", "NV", "MT", "MS", "NM", "UT", "SD", "ID"];

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
          count(*) filter (where authority_type = 'statute')::int as statutes,
          count(*) filter (where authority_type = 'regulation')::int as regulations,
          count(*) filter (where authority_type = 'rule')::int as rules,
          count(*) filter (where currentness_status::text = 'historical')::int as historical,
          count(*) filter (where currentness_status::text = 'current_as_of_source_date')::int as current_as_of,
          count(*) filter (where currentness_status is null or currentness_status::text = 'unknown')::int as unknown_currentness,
          min(extract(year from decision_date)::int) filter (where authority_type = 'case' and decision_date is not null) as oldest_year,
          max(extract(year from decision_date)::int) filter (where authority_type = 'case' and decision_date is not null) as newest_year,
          count(distinct extract(year from decision_date)::int) filter (where authority_type = 'case' and decision_date is not null) as distinct_years,
          count(*) filter (
            where authority_type = 'case' and decision_date is not null
              and extract(year from decision_date) >= extract(year from now()) - 3
          )::int as cases_last_3y
        from legal_authorities
        where authority_state = ${j}
      `;

      const courts = await sql`
        select court_id, court_level, count(*)::int as n,
               min(extract(year from decision_date)::int) as y0,
               max(extract(year from decision_date)::int) as y1
        from legal_authorities
        where authority_state = ${j} and authority_type = 'case'
        group by 1, 2
        order by n desc
      `;

      const [cites] = await sql`
        select
          count(*) filter (where c.to_authority_id is null)::int as target_absent,
          count(*) filter (where c.to_authority_id is not null)::int as resolved
        from legal_authority_citations c
        join legal_authorities a on a.id = c.from_authority_id
        where a.authority_state = ${j}
      `;

      const yearBuckets = await sql`
        select
          case
            when extract(year from decision_date) < 1980 then 'pre_1980'
            when extract(year from decision_date) < 2000 then '1980_1999'
            when extract(year from decision_date) < 2015 then '2000_2014'
            else '2015_plus'
          end as bucket,
          count(*)::int as n
        from legal_authorities
        where authority_state = ${j} and authority_type = 'case' and decision_date is not null
        group by 1
        order by 1
      `;

      const recentHeavy =
        Number(agg.cases || 0) > 0 &&
        Number(agg.cases_last_3y || 0) / Math.max(1, Number(agg.cases || 0)) >= 0.7;

      rows.push({
        j,
        ...agg,
        courts,
        citation: cites,
        yearBuckets,
        recentHeavy,
        authorityDeficitTo101: Math.max(0, 101 - Number(agg.authorities || 0)),
        missingIntermediateLayer: Number(agg.intermediate || 0) === 0 && j !== "DC",
        // DC Court of Appeals is the high court; no separate intermediate appellate layer
        dcNote: j === "DC" ? "DC Court of Appeals is highest court; no state-style intermediate layer" : null,
      });
    }

    console.log(
      JSON.stringify({
        ok: true,
        wave: "2AF",
        courtListenerHttpCalls: 0,
        generatedAt: new Date().toISOString(),
        featureAgents: process.env.FEATURE_AGENTS || "0",
        rows,
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
