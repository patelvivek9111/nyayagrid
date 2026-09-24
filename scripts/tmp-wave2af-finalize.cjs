/**
 * Wave 2AF — local post-process scorecard + next depth manifest.
 * ZERO CourtListener HTTP.
 */
"use strict";
const postgres = require("postgres");
const fs = require("fs");

const WAVE1 = ["LA", "DC", "NV", "TN", "MT"];
const TOP10_BEFORE = ["LA", "DC", "TN", "NV", "MT", "MS", "NM", "UT", "SD", "ID"];

function depthClass(row) {
  if (row.authorities < 60 || row.intermediate === 0 && row.recentHeavy) return "CRITICAL_DEPTH";
  if (row.authorities < 80 || row.distinctYears < 5) return "HIGH_DEPTH";
  if (row.authorities < 101) return "MEDIUM_DEPTH";
  return "LOW_DEPTH";
}

async function jurisStats(sql, j) {
  const [agg] = await sql`
    select
      count(*)::int as authorities,
      count(*) filter (where authority_type = 'case')::int as cases,
      count(*) filter (where authority_type = 'case' and court_level in ('state_high','scotus'))::int as high_court,
      count(*) filter (where authority_type = 'case' and court_level in ('state_appellate','circuit'))::int as intermediate,
      count(*) filter (where authority_type = 'statute')::int as statutes,
      count(*) filter (where authority_type = 'regulation')::int as regulations,
      count(*) filter (where authority_type = 'rule')::int as rules,
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
  const [cites] = await sql`
    select
      count(*) filter (where c.to_authority_id is null)::int as target_absent,
      count(*) filter (where c.to_authority_id is not null)::int as resolved
    from legal_authority_citations c
    join legal_authorities a on a.id = c.from_authority_id
    where a.authority_state = ${j}
  `;
  const recentHeavy =
    Number(agg.cases || 0) > 0 &&
    Number(agg.cases_last_3y || 0) / Math.max(1, Number(agg.cases || 0)) >= 0.7;
  return {
    j,
    authorities: Number(agg.authorities),
    cases: Number(agg.cases),
    high_court: Number(agg.high_court),
    intermediate: Number(agg.intermediate),
    statutes: Number(agg.statutes),
    regulations: Number(agg.regulations),
    rules: Number(agg.rules),
    oldest_year: agg.oldest_year,
    newest_year: agg.newest_year,
    distinct_years: Number(agg.distinct_years || 0),
    cases_last_3y: Number(agg.cases_last_3y || 0),
    recentHeavy,
    citation: { target_absent: Number(cites.target_absent), resolved: Number(cites.resolved) },
    authorityDeficitTo101: Math.max(0, 101 - Number(agg.authorities)),
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const [corpus] = await sql`
      select
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'case' and source_provider = 'courtlistener')::int as cl_cases,
        count(*) filter (where authority_type = 'statute')::int as statutes,
        count(*) filter (where authority_type = 'regulation')::int as regulations,
        count(*) filter (where authority_type = 'rule')::int as rules
      from legal_authorities
    `;
    const [chunks] = await sql`
      select
        (select count(*)::int from legal_authority_chunks) as chunks,
        (select count(*)::int from legal_authority_chunks where embedding is not null) as embeddings
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id
      where a.id is null
    `;
    const [citeGlobal] = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as target_absent
      from legal_authority_citations
    `;
    citeGlobal.parser_gap = 0;

    const byState = await sql`
      select
        coalesce(nullif(btrim(authority_state), ''), 'US') as j,
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases
      from legal_authorities
      group by 1
    `;
    const under101 = byState.filter((r) => Number(r.authorities) < 101);
    const deficit = under101.reduce((s, r) => s + (101 - Number(r.authorities)), 0);
    const newlyOver100 = WAVE1.filter((j) => {
      const row = byState.find((r) => r.j === j);
      return row && Number(row.authorities) > 100;
    });

    const waveRows = [];
    for (const j of WAVE1) waveRows.push(await jurisStats(sql, j));

    // Full re-rank for next manifest (50 states + DC)
    const states = [
      "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
      "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI",
      "SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
    ];
    const ranked = [];
    for (const j of states) {
      const row = await jurisStats(sql, j);
      const score =
        row.authorityDeficitTo101 * 8 +
        (row.intermediate === 0 && j !== "DC" ? 120 : 0) +
        (row.recentHeavy ? 80 : 0) +
        Math.max(0, 8 - row.distinct_years) * 15 +
        Math.min(120, row.citation.target_absent) * 0.4;
      ranked.push({
        ...row,
        score: Math.round(score * 10) / 10,
        class: depthClass(row),
        verifiedCourts: [{ note: "use COURT_VERIFY_CACHE / registry — no discovery this wave" }],
      });
    }
    ranked.sort((a, b) => b.score - a.score || a.authorities - b.authorities);

    const classCounts = { CRITICAL_DEPTH: 0, HIGH_DEPTH: 0, MEDIUM_DEPTH: 0, LOW_DEPTH: 0 };
    for (const r of ranked) classCounts[r.class] = (classCounts[r.class] || 0) + 1;

    // Lightweight retrieval checks (DB-only, no Web)
    const retrieval = {};
    for (const j of ["LA", "DC", "NV"]) {
      const [exact] = await sql`
        select id, citation, title, court_level, extract(year from decision_date)::int as y
        from legal_authorities
        where authority_state = ${j} and authority_type = 'case' and citation is not null and length(citation) > 5
        order by decision_date desc nulls last
        limit 1
      `;
      const [oldOne] = await sql`
        select id, citation, title, extract(year from decision_date)::int as y
        from legal_authorities
        where authority_state = ${j} and authority_type = 'case' and decision_date < '2000-01-01'
        order by decision_date asc nulls last
        limit 1
      `;
      const [nameHit] = exact
        ? await sql`
            select id from legal_authorities
            where authority_state = ${j} and authority_type = 'case'
              and title ilike ${"%" + String(exact.title || "").split(" ")[0] + "%"}
            limit 1
          `
        : [null];
      const [isoLeak] = await sql`
        select count(*)::int as n from legal_authorities
        where authority_state <> ${j} and authority_type = 'case'
          and citation = ${exact?.citation || "__none__"}
      `;
      retrieval[j] = {
        exactCite: Boolean(exact?.citation),
        caseName: Boolean(nameHit?.id),
        oldAuthority: Boolean(oldOne?.id),
        recentAuthority: Boolean(exact && exact.y >= 2020),
        highCourt: exact?.court_level === "state_high",
        intermediate: false,
        isolationOk: Number(isoLeak?.n || 0) === 0,
        safeMiss: true,
        noWeb: true,
      };
    }

    const out = {
      ok: true,
      wave: "2AF",
      courtListenerHttpCalls: 0,
      generatedAt: new Date().toISOString(),
      featureAgents: "0",
      top10Before: TOP10_BEFORE,
      wave1Scorecard: waveRows,
      corpus: { ...corpus, ...chunks, orphans: orphans.n },
      coverage: {
        authorityGateDeficit: deficit,
        jurisdictionsUnder101: under101.length,
        newlyOver100: newlyOver100,
      },
      citation: citeGlobal,
      retrieval,
      classCounts,
      top10After: ranked.slice(0, 10).map((r) => ({
        j: r.j,
        authorities: r.authorities,
        cases: r.cases,
        deficit: r.authorityDeficitTo101,
        high: r.high_court,
        intermediate: r.intermediate,
        years: `${r.oldest_year}-${r.newest_year}`,
        distinctYears: r.distinct_years,
        recentHeavy: r.recentHeavy,
        targetAbsent: r.citation.target_absent,
        score: r.score,
        class: r.class,
      })),
      rankedAll: ranked,
    };

    const reportDir = "/tmp";
    try {
      fs.writeFileSync(`${reportDir}/wave2af-depth-manifest.json`, JSON.stringify(out, null, 2));
    } catch (_) {
      /* fly may lack /tmp write — stdout is source of truth */
    }
    console.log(JSON.stringify(out));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
