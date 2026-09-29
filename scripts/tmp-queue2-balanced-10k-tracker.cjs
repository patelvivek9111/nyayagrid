#!/usr/bin/env node
/**
 * Live balanced 10k case corpus baseline + state/federal deficit maps.
 * ZERO CourtListener. ZERO mutations.
 */
"use strict";
const postgres = require("postgres");

const STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
];
const STATE_TARGET = 150;
const STATE_TOTAL_TARGET = 7650;
const FEDERAL_TARGET = 2350;
const CASE_TARGET = 10000;

/** States/DC with a real intermediate appellate layer (not just high court). */
const HAS_INTERMEDIATE = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","MD","MA","MI","MN","MS","MO","NE","NV","NJ","NM","NY",
  "NC","OH","OK","OR","PA","SC","TN","TX","UT","VA","WA","WI",
]);

const CIRCUIT_CL = {
  scotus: "SCOTUS",
  ca1: "1st Circuit",
  ca2: "2nd Circuit",
  ca3: "3rd Circuit",
  ca4: "4th Circuit",
  ca5: "5th Circuit",
  ca6: "6th Circuit",
  ca7: "7th Circuit",
  ca8: "8th Circuit",
  ca9: "9th Circuit",
  ca10: "10th Circuit",
  ca11: "11th Circuit",
  cadc: "D.C. Circuit",
  cafc: "Federal Circuit",
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const [corpus] = await sql`
      select
        count(*)::int as authorities,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(*) filter (where authority_type='case' and authority_state='US')::int as federal_cases,
        count(*) filter (where authority_type='case' and authority_state is not null and authority_state <> 'US')::int as state_dc_cases
      from legal_authorities
    `;
    const [chunks] = await sql`
      select count(*)::int as chunks,
             count(*) filter (where embedding is not null)::int as embeddings,
             count(*) filter (where embedding is null)::int as missing_embeddings
      from legal_authority_chunks
    `;
    const [dupes] = await sql`
      select count(*)::int as n from (
        select 1 from legal_authorities where source_external_id is not null
        group by source_provider, source_external_id having count(*) > 1
      ) d
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;
    const [cite] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;

    const stateRows = await sql`
      select
        authority_state as j,
        count(*)::int as cases,
        count(*) filter (where court_level in ('state_high','scotus') or court_level='high')::int as high_raw,
        count(*) filter (where court_level = 'state_high')::int as high_court,
        count(*) filter (where court_level in ('state_appellate','circuit','appellate'))::int as intermediate,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 2000)::int as pre_2000,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 1980)::int as pre_1980,
        min(extract(year from decision_date)::int) filter (where decision_date is not null) as earliest_year,
        max(extract(year from decision_date)::int) filter (where decision_date is not null) as latest_year
      from legal_authorities
      where authority_type = 'case'
        and authority_state = any(${STATE_CODES})
      group by 1
    `;
    const byState = Object.fromEntries(stateRows.map((r) => [r.j, r]));

    const citeDemand = await sql`
      select a.authority_state as j, count(*)::int as absent_edges
      from legal_authority_citations e
      join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
        and a.authority_state = any(${STATE_CODES})
      group by 1
    `;
    const demandBy = Object.fromEntries(citeDemand.map((r) => [r.j, r.absent_edges]));

    const states = STATE_CODES.map((j) => {
      const r = byState[j] || {
        cases: 0,
        high_court: 0,
        intermediate: 0,
        pre_2000: 0,
        pre_1980: 0,
        earliest_year: null,
        latest_year: null,
      };
      const cases = Number(r.cases || 0);
      const high = Number(r.high_court || 0);
      const mid = Number(r.intermediate || 0);
      const pre2000 = Number(r.pre_2000 || 0);
      const pre1980 = Number(r.pre_1980 || 0);
      const deficit = Math.max(0, STATE_TARGET - cases);
      const midGap = HAS_INTERMEDIATE.has(j) && mid === 0 ? 1 : 0;
      const histGap = pre2000 === 0 || (r.earliest_year != null && Number(r.earliest_year) >= 2000) ? 1 : 0;
      const demand = Number(demandBy[j] || 0);
      const over = Math.max(0, cases - STATE_TARGET);
      const balancedPriority =
        deficit * 3 +
        midGap * 80 +
        histGap * 40 +
        (pre1980 === 0 && histGap ? 15 : 0) +
        Math.min(demand, 200) * 0.15 -
        over * 2;
      return {
        jurisdiction: j,
        cases,
        highCourt: high,
        intermediateAppellate: mid,
        earliestYear: r.earliest_year,
        latestYear: r.latest_year,
        pre2000,
        pre1980,
        planningTarget: STATE_TARGET,
        deficit,
        intermediateLayerGap: midGap === 1,
        historicalGap: histGap === 1,
        citationDemand: demand,
        balancedPriority: Number(balancedPriority.toFixed(2)),
      };
    }).sort((a, b) => b.balancedPriority - a.balancedPriority || b.deficit - a.deficit);

    const fedRows = await sql`
      select
        coalesce(metadata->>'clCourt', court_id, 'unknown') as bucket,
        count(*)::int as cases,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 2000)::int as pre_2000,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 1980)::int as pre_1980,
        min(extract(year from decision_date)::int) filter (where decision_date is not null) as earliest_year,
        max(extract(year from decision_date)::int) filter (where decision_date is not null) as latest_year
      from legal_authorities
      where authority_type = 'case'
        and authority_state = 'US'
      group by 1
      order by cases desc
    `;

    const federalBuckets = fedRows.map((r) => {
      const key = String(r.bucket || "unknown").toLowerCase();
      const label = CIRCUIT_CL[key] || key;
      return {
        bucket: key,
        label,
        cases: r.cases,
        pre2000: r.pre_2000,
        pre1980: r.pre_1980,
        earliestYear: r.earliest_year,
        latestYear: r.latest_year,
        historicalWeakness: Number(r.pre_2000 || 0) === 0,
      };
    });

    const scotus = federalBuckets.find((b) => b.bucket === "scotus" || /scotus|supreme/i.test(b.label));
    const circuits = Object.keys(CIRCUIT_CL)
      .filter((k) => k !== "scotus")
      .map((k) => {
        const hit = federalBuckets.find((b) => b.bucket === k || b.bucket.includes(k));
        return hit || { bucket: k, label: CIRCUIT_CL[k], cases: 0, pre2000: 0, earliestYear: null, latestYear: null, historicalWeakness: true };
      });

    const districtish = federalBuckets.filter(
      (b) => !CIRCUIT_CL[b.bucket] && !/scotus|ca\d|cadc|cafc/i.test(b.bucket),
    );

    const out = {
      ok: true,
      classification: "QUEUE2_BALANCED_10K_TRACKER",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      mutations: 0,
      targets: {
        totalCases: CASE_TARGET,
        stateDc: STATE_TOTAL_TARGET,
        federal: FEDERAL_TARGET,
        perStatePlanning: STATE_TARGET,
      },
      baseline: {
        corpus,
        chunks,
        duplicates: dupes.n,
        orphans: orphans.n,
        citations: {
          ...cite,
          targetAbsent: cite.unresolved,
          resolutionRatePct: cite.extracted ? Number(((100 * cite.resolved) / cite.extracted).toFixed(2)) : 0,
        },
      },
      progress: {
        casesCurrent: corpus.cases,
        casesRemaining: Math.max(0, CASE_TARGET - corpus.cases),
        pctComplete: Number(((100 * corpus.cases) / CASE_TARGET).toFixed(2)),
        stateDcCurrent: corpus.state_dc_cases,
        stateDcRemaining: Math.max(0, STATE_TOTAL_TARGET - corpus.state_dc_cases),
        federalCurrent: corpus.federal_cases,
        federalRemaining: Math.max(0, FEDERAL_TARGET - corpus.federal_cases),
      },
      states,
      topUnderrepresented: states.slice(0, 10),
      topOverrepresented: [...states].sort((a, b) => b.cases - a.cases).slice(0, 10),
      federal: {
        total: corpus.federal_cases,
        scotus: scotus || { cases: 0 },
        circuits,
        districtBuckets: districtish.slice(0, 30),
        weakest: [...circuits, scotus].filter(Boolean).sort((a, b) => a.cases - b.cases).slice(0, 10),
      },
      lanes: {
        G1: states.filter((s) => s.deficit > 0).slice(0, 15).map((s) => ({
          jurisdiction: s.jurisdiction,
          deficit: s.deficit,
          intermediateLayerGap: s.intermediateLayerGap,
          priority: s.balancedPriority,
        })),
        G2: states
          .filter((s) => s.historicalGap)
          .sort((a, b) => b.balancedPriority - a.balancedPriority)
          .slice(0, 15)
          .map((s) => ({
            jurisdiction: s.jurisdiction,
            earliestYear: s.earliestYear,
            latestYear: s.latestYear,
            pre2000: s.pre2000,
            priority: s.balancedPriority,
          })),
        G3: [...circuits, scotus]
          .filter(Boolean)
          .sort((a, b) => a.cases - b.cases)
          .slice(0, 15),
      },
    };
    console.log(JSON.stringify(out));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400) }));
  process.exit(1);
});
