#!/usr/bin/env node
/**
 * Overnight Wave A — live DB corpus maps.
 * ZERO CourtListener. ZERO mutations.
 * Emits tracker + federal depth + year buckets + district + intermediate + integrity.
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

const DISTRICT_COURTS = [
  "nysd","cacd","ilnd","txsd","dcd","njd","paed","mad","flsd","txnd","cand","waed",
];

/** Locally verified intermediate mappings (ingest/session evidence; no live CL). */
const INTERMEDIATE_MAP = [
  { jurisdiction: "NY", clCourtId: "nyappdiv", status: "VERIFIED" },
  { jurisdiction: "CA", clCourtId: "calctapp", status: "VERIFIED" },
  { jurisdiction: "PA", clCourtId: "pasuperct", status: "VERIFIED" },
  { jurisdiction: "FL", clCourtId: "fladistctapp", status: "VERIFIED" },
  { jurisdiction: "IL", clCourtId: "illappct", status: "VERIFIED" },
  { jurisdiction: "MA", clCourtId: "massappct", status: "VERIFIED" },
  { jurisdiction: "TX", clCourtId: "texapp", status: "VERIFIED" },
  { jurisdiction: "AZ", clCourtId: "arizctapp", status: "VERIFIED" },
  { jurisdiction: "CT", clCourtId: "connappct", status: "VERIFIED" },
  { jurisdiction: "NM", clCourtId: "nmctapp", status: "VERIFIED" },
  { jurisdiction: "IN", clCourtId: "indctapp", status: "VERIFIED" },
  { jurisdiction: "WI", clCourtId: "wisctapp", status: "VERIFIED" },
  { jurisdiction: "UT", clCourtId: "utahctapp", status: "VERIFIED" },
  { jurisdiction: "PA", clCourtId: "pacommwlth", status: "NEEDS_VERIFICATION_TOMORROW" },
  { jurisdiction: "NJ", clCourtId: "njsuperct", status: "NEEDS_VERIFICATION_TOMORROW" },
  { jurisdiction: "VA", clCourtId: "vacapp", status: "NEEDS_VERIFICATION_TOMORROW" },
];

const YEAR_BUCKETS = [
  { key: "pre1950", lo: null, hi: 1949 },
  { key: "y1950_1969", lo: 1950, hi: 1969 },
  { key: "y1970_1979", lo: 1970, hi: 1979 },
  { key: "y1980_1989", lo: 1980, hi: 1989 },
  { key: "y1990_1999", lo: 1990, hi: 1999 },
  { key: "y2000_2009", lo: 2000, hi: 2009 },
  { key: "y2010_2019", lo: 2010, hi: 2019 },
  { key: "y2020_present", lo: 2020, hi: 9999 },
];

function yearBucketExpr(alias = "") {
  const y = alias ? `${alias}.` : "";
  return `
    count(*) filter (where ${y}decision_date is not null and extract(year from ${y}decision_date)::int < 1950)::int as pre1950,
    count(*) filter (where ${y}decision_date is not null and extract(year from ${y}decision_date)::int between 1950 and 1969)::int as y1950_1969,
    count(*) filter (where ${y}decision_date is not null and extract(year from ${y}decision_date)::int between 1970 and 1979)::int as y1970_1979,
    count(*) filter (where ${y}decision_date is not null and extract(year from ${y}decision_date)::int between 1980 and 1989)::int as y1980_1989,
    count(*) filter (where ${y}decision_date is not null and extract(year from ${y}decision_date)::int between 1990 and 1999)::int as y1990_1999,
    count(*) filter (where ${y}decision_date is not null and extract(year from ${y}decision_date)::int between 2000 and 2009)::int as y2000_2009,
    count(*) filter (where ${y}decision_date is not null and extract(year from ${y}decision_date)::int between 2010 and 2019)::int as y2010_2019,
    count(*) filter (where ${y}decision_date is not null and extract(year from ${y}decision_date)::int >= 2020)::int as y2020_present
  `;
}

function flagFederal(row) {
  const cases = Number(row.cases || 0);
  const pre2000 = Number(row.pre2000 || 0);
  const recent = Number(row.recent || 0);
  const flags = [];
  if (cases === 0 || cases < 8) flags.push("LOW_VOLUME");
  if (cases > 0 && pre2000 === 0) flags.push("HISTORICALLY_THIN");
  if (cases > 0 && recent / cases >= 0.7) flags.push("RECENT_HEAVY");
  if (cases >= 20 && pre2000 > 0 && recent / Math.max(cases, 1) < 0.7) flags.push("STRONG");
  if (!flags.length) flags.push(cases >= 12 ? "STRONG" : "LOW_VOLUME");
  return flags;
}

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
             count(*) filter (where embedding is null)::int as missing_embeddings,
             count(*) filter (where content is null or length(trim(content))=0)::int as empty_chunks,
             count(*) filter (where char_length(coalesce(content,'')) > 20000)::int as giant_chunks,
             count(*) filter (where char_length(coalesce(content,'')) > 0 and char_length(content) < 40)::int as tiny_chunks
      from legal_authority_chunks
    `;
    const [dupes] = await sql`
      select count(*)::int as n from (
        select 1 from legal_authorities where source_external_id is not null
        group by source_provider, source_external_id having count(*) > 1
      ) d
    `;
    const [dupAuthIds] = await sql`
      select count(*)::int as n from (
        select 1 from legal_authorities group by id having count(*) > 1
      ) d
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;
    const [orphanEmb] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      where c.embedding is not null
        and not exists (select 1 from legal_authorities a where a.id = c.authority_id)
    `;
    const [missingText] = await sql`
      select count(*)::int as n from legal_authorities a
      where a.authority_type = 'case'
        and not exists (
          select 1 from legal_authority_versions v
          where v.authority_id = a.id and v.content is not null and length(trim(v.content)) > 0
        )
        and not exists (
          select 1 from legal_authority_chunks c
          where c.authority_id = a.id and c.content is not null and length(trim(c.content)) > 0
        )
    `;
    const [invalidDates] = await sql`
      select
        count(*) filter (where decision_date > current_date + interval '1 day')::int as future_dates,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 1600)::int as absurd_old
      from legal_authorities where authority_type='case'
    `;
    const [cite] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [citeDupEdges] = await sql`
      select count(*)::int as n from (
        select 1 from legal_authority_citations
        group by from_authority_id, coalesce(normalized_citation, raw_citation), coalesce(to_authority_id::text,'')
        having count(*) > 1
      ) d
    `;
    const [citeBroken] = await sql`
      select count(*)::int as n from legal_authority_citations e
      where e.to_authority_id is not null
        and not exists (select 1 from legal_authorities a where a.id = e.to_authority_id)
    `;
    const [provenance] = await sql`
      select
        count(*) filter (where source_provider is null or length(trim(source_provider))=0)::int as missing_source_provider,
        count(*) filter (where source_external_id is null or length(trim(source_external_id))=0)::int as missing_source_id,
        count(*) filter (where court_id is null or length(trim(court_id))=0)::int as missing_court,
        count(*) filter (where authority_state is null)::int as missing_jurisdiction
      from legal_authorities where authority_type='case'
    `;
    const [classMismatch] = await sql`
      select count(*)::int as n from legal_authorities
      where authority_type='case'
        and (
          (authority_state='US' and court_level like 'state_%')
          or (authority_state is not null and authority_state <> 'US' and court_level in ('circuit','district','scotus'))
        )
    `;

    const stateRows = await sql`
      select
        authority_state as j,
        count(*)::int as cases,
        count(*) filter (where court_level = 'state_high')::int as high_court,
        count(*) filter (where court_level in ('state_appellate','circuit','appellate'))::int as intermediate,
        count(*) filter (where court_level not in ('state_high','state_appellate','circuit','appellate') or court_level is null)::int as other_appellate,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 2000)::int as pre_2000,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 1980)::int as pre_1980,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int >= 2015)::int as recent,
        min(extract(year from decision_date)::int) filter (where decision_date is not null) as earliest_year,
        max(extract(year from decision_date)::int) filter (where decision_date is not null) as latest_year,
        ${sql.unsafe(yearBucketExpr())}
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
        cases: 0, high_court: 0, intermediate: 0, other_appellate: 0,
        pre_2000: 0, pre_1980: 0, recent: 0, earliest_year: null, latest_year: null,
        pre1950: 0, y1950_1969: 0, y1970_1979: 0, y1980_1989: 0,
        y1990_1999: 0, y2000_2009: 0, y2010_2019: 0, y2020_present: 0,
      };
      const cases = Number(r.cases || 0);
      const high = Number(r.high_court || 0);
      const mid = Number(r.intermediate || 0);
      const other = Number(r.other_appellate || 0);
      const pre2000 = Number(r.pre_2000 || 0);
      const pre1980 = Number(r.pre_1980 || 0);
      const recent = Number(r.recent || 0);
      const deficit = Math.max(0, STATE_TARGET - cases);
      const midGap = HAS_INTERMEDIATE.has(j) && mid === 0 ? 1 : 0;
      const midDeficit = HAS_INTERMEDIATE.has(j) ? Math.max(0, 30 - mid) : 0;
      const histGap = pre2000 === 0 || (r.earliest_year != null && Number(r.earliest_year) >= 2000) ? 1 : 0;
      const histDeficit = Math.max(0, 20 - pre2000);
      const demand = Number(demandBy[j] || 0);
      const over = Math.max(0, cases - STATE_TARGET);
      const balancedPriority =
        deficit * 3 +
        midGap * 80 +
        midDeficit * 1.5 +
        histGap * 40 +
        histDeficit * 0.8 +
        (pre1980 === 0 && histGap ? 15 : 0) +
        Math.min(demand, 200) * 0.15 -
        over * 2;
      return {
        jurisdiction: j,
        cases,
        highCourt: high,
        intermediateAppellate: mid,
        otherAppellate: other,
        earliestYear: r.earliest_year,
        latestYear: r.latest_year,
        pre2000,
        pre1980,
        recent,
        planningTarget: STATE_TARGET,
        deficit,
        intermediateDeficit: midDeficit,
        historicalDeficit: histDeficit,
        intermediateLayerGap: midGap === 1,
        historicalGap: histGap === 1,
        citationDemand: demand,
        citationDemandOverlap: demand,
        balancedPriority: Number(balancedPriority.toFixed(2)),
        yearBuckets: {
          pre1950: Number(r.pre1950 || 0),
          y1950_1969: Number(r.y1950_1969 || 0),
          y1970_1979: Number(r.y1970_1979 || 0),
          y1980_1989: Number(r.y1980_1989 || 0),
          y1990_1999: Number(r.y1990_1999 || 0),
          y2000_2009: Number(r.y2000_2009 || 0),
          y2010_2019: Number(r.y2010_2019 || 0),
          y2020_present: Number(r.y2020_present || 0),
        },
      };
    }).sort((a, b) => b.balancedPriority - a.balancedPriority || b.deficit - a.deficit);

    const fedRows = await sql`
      select
        lower(coalesce(metadata->>'clCourt', court_id, 'unknown')) as bucket,
        count(*)::int as cases,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 2000)::int as pre_2000,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 1980)::int as pre_1980,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int >= 2015)::int as recent,
        min(extract(year from decision_date)::int) filter (where decision_date is not null) as earliest_year,
        max(extract(year from decision_date)::int) filter (where decision_date is not null) as latest_year,
        ${sql.unsafe(yearBucketExpr())}
      from legal_authorities
      where authority_type = 'case'
        and authority_state = 'US'
      group by 1
      order by cases desc
    `;

    const fedCiteDemand = await sql`
      select lower(coalesce(a.metadata->>'clCourt', a.court_id, 'unknown')) as bucket,
             count(*)::int as absent_edges
      from legal_authority_citations e
      join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
        and a.authority_type = 'case'
        and a.authority_state = 'US'
      group by 1
    `;
    const fedDemandBy = Object.fromEntries(fedCiteDemand.map((r) => [r.bucket, r.absent_edges]));

    function enrichFed(r) {
      const key = String(r.bucket || "unknown").toLowerCase();
      const cases = Number(r.cases || 0);
      const pre2000 = Number(r.pre_2000 || 0);
      const pre1980 = Number(r.pre_1980 || 0);
      const recent = Number(r.recent || 0);
      const demand = Number(fedDemandBy[key] || 0);
      const row = {
        bucket: key,
        label: CIRCUIT_CL[key] || key,
        cases,
        earliestYear: r.earliest_year,
        latestYear: r.latest_year,
        pre2000,
        pre1980,
        recent,
        citationDemandOverlap: demand,
        deficit: Math.max(0, 25 - cases),
        historicalWeakness: pre2000 === 0,
        yearBuckets: {
          pre1950: Number(r.pre1950 || 0),
          y1950_1969: Number(r.y1950_1969 || 0),
          y1970_1979: Number(r.y1970_1979 || 0),
          y1980_1989: Number(r.y1980_1989 || 0),
          y1990_1999: Number(r.y1990_1999 || 0),
          y2000_2009: Number(r.y2000_2009 || 0),
          y2010_2019: Number(r.y2010_2019 || 0),
          y2020_present: Number(r.y2020_present || 0),
        },
        flags: [],
      };
      row.flags = flagFederal(row);
      return row;
    }

    const federalBuckets = fedRows.map(enrichFed);
    const scotus = federalBuckets.find((b) => b.bucket === "scotus") || {
      bucket: "scotus", label: "SCOTUS", cases: 0, pre2000: 0, pre1980: 0, recent: 0,
      earliestYear: null, latestYear: null, citationDemandOverlap: 0, deficit: 25,
      historicalWeakness: true, flags: ["LOW_VOLUME", "HISTORICALLY_THIN"], yearBuckets: {},
    };
    const circuits = Object.keys(CIRCUIT_CL)
      .filter((k) => k !== "scotus")
      .map((k) => {
        const hit = federalBuckets.find((b) => b.bucket === k);
        return hit || enrichFed({
          bucket: k, cases: 0, pre_2000: 0, pre_1980: 0, recent: 0,
          earliest_year: null, latest_year: null,
          pre1950: 0, y1950_1969: 0, y1970_1979: 0, y1980_1989: 0,
          y1990_1999: 0, y2000_2009: 0, y2010_2019: 0, y2020_present: 0,
        });
      });

    const districtRows = await sql`
      select
        lower(coalesce(metadata->>'clCourt', court_id, 'unknown')) as bucket,
        count(*)::int as cases,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 2000)::int as pre_2000,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 1980)::int as pre_1980,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int >= 2015)::int as recent,
        min(extract(year from decision_date)::int) filter (where decision_date is not null) as earliest_year,
        max(extract(year from decision_date)::int) filter (where decision_date is not null) as latest_year,
        ${sql.unsafe(yearBucketExpr())}
      from legal_authorities
      where authority_type = 'case'
        and authority_state = 'US'
        and lower(coalesce(metadata->>'clCourt', court_id, '')) = any(${DISTRICT_COURTS})
      group by 1
    `;
    const districtBy = Object.fromEntries(districtRows.map((r) => [r.bucket, r]));
    const districts = DISTRICT_COURTS.map((id) => {
      const r = districtBy[id] || {
        cases: 0, pre_2000: 0, pre_1980: 0, recent: 0, earliest_year: null, latest_year: null,
        pre1950: 0, y1950_1969: 0, y1970_1979: 0, y1980_1989: 0,
        y1990_1999: 0, y2000_2009: 0, y2010_2019: 0, y2020_present: 0,
      };
      const cases = Number(r.cases || 0);
      const pre2000 = Number(r.pre_2000 || 0);
      const recent = Number(r.recent || 0);
      const historicalNeed = pre2000 === 0 || pre2000 < 5;
      const recentNeed = recent < 5;
      const desiredNext = Math.min(20, Math.max(8, 25 - cases));
      let dateWindow = "1990-01-01..1999-12-31";
      if (historicalNeed && recentNeed) dateWindow = "1985-01-01..1994-12-31";
      else if (recentNeed) dateWindow = "2010-01-01..2019-12-31";
      else if (historicalNeed) dateWindow = "1975-01-01..1989-12-31";
      else dateWindow = "1995-01-01..2004-12-31";
      const clPerCase = 2.1;
      return {
        court: id,
        mappingStatus: "VERIFIED",
        cases,
        earliestYear: r.earliest_year,
        latestYear: r.latest_year,
        pre2000,
        pre1980: Number(r.pre_1980 || 0),
        recent,
        yearBuckets: {
          pre1950: Number(r.pre1950 || 0),
          y1950_1969: Number(r.y1950_1969 || 0),
          y1970_1979: Number(r.y1970_1979 || 0),
          y1980_1989: Number(r.y1980_1989 || 0),
          y1990_1999: Number(r.y1990_1999 || 0),
          y2000_2009: Number(r.y2000_2009 || 0),
          y2010_2019: Number(r.y2010_2019 || 0),
          y2020_present: Number(r.y2020_present || 0),
        },
        historicalNeed,
        recentNeed,
        desiredNextBatch: desiredNext,
        proposedDateWindow: dateWindow,
        maxCases: desiredNext,
        estimatedClCost: Number((desiredNext * clPerCase).toFixed(1)),
        estimatedClPerCase: clPerCase,
        priority: Number((desiredNext * 2 + (historicalNeed ? 30 : 0) + (recentNeed ? 10 : 0) + Math.max(0, 20 - cases)).toFixed(2)),
        flags: flagFederal({ cases, pre2000, recent }),
      };
    }).sort((a, b) => b.priority - a.priority);

    const midCourtIds = INTERMEDIATE_MAP.filter((m) => m.status === "VERIFIED").map((m) => m.clCourtId);
    const midCounts = await sql`
      select
        lower(coalesce(metadata->>'clCourt', court_id, 'unknown')) as bucket,
        authority_state as j,
        count(*)::int as cases,
        count(*) filter (where decision_date is not null and extract(year from decision_date)::int < 2000)::int as pre_2000,
        min(extract(year from decision_date)::int) filter (where decision_date is not null) as earliest_year,
        max(extract(year from decision_date)::int) filter (where decision_date is not null) as latest_year
      from legal_authorities
      where authority_type = 'case'
        and lower(coalesce(metadata->>'clCourt', court_id, '')) = any(${midCourtIds})
      group by 1, 2
    `;
    const midByCourt = Object.fromEntries(midCounts.map((r) => [r.bucket, r]));

    const intermediates = INTERMEDIATE_MAP.map((m) => {
      const r = midByCourt[m.clCourtId] || { cases: 0, pre_2000: 0, earliest_year: null, latest_year: null, j: m.jurisdiction };
      const state = byState[m.jurisdiction] || { cases: 0, intermediate: 0 };
      const midCases = Number(r.cases || 0);
      const totalJ = Number(state.cases || 0);
      const deficitTo150 = Math.max(0, STATE_TARGET - totalJ);
      const histCoverage = Number(r.pre_2000 || 0);
      const nextBatch = m.status === "VERIFIED" ? Math.min(20, Math.max(6, deficitTo150 > 0 ? 12 : 8)) : 0;
      const dateWindow = histCoverage === 0 ? "1985-01-01..1999-12-31" : "2005-01-01..2015-12-31";
      return {
        jurisdiction: m.jurisdiction,
        clCourtId: m.clCourtId,
        mappingStatus: m.status,
        intermediateCases: midCases,
        totalJurisdictionCases: totalJ,
        deficitTo150,
        historicalCoverage: histCoverage,
        earliestYear: r.earliest_year,
        latestYear: r.latest_year,
        proposedNextBatchSize: nextBatch,
        proposedDateWindow: dateWindow,
        priority: m.status === "VERIFIED"
          ? Number((deficitTo150 * 2 + (midCases === 0 ? 100 : Math.max(0, 30 - midCases)) + (histCoverage === 0 ? 40 : 0)).toFixed(2))
          : 0,
      };
    }).sort((a, b) => b.priority - a.priority);

    const thinIntermediateStates = states
      .filter((s) => HAS_INTERMEDIATE.has(s.jurisdiction) && s.intermediateAppellate < 10)
      .map((s) => ({
        jurisdiction: s.jurisdiction,
        intermediate: s.intermediateAppellate,
        total: s.cases,
        status: intermediates.find((i) => i.jurisdiction === s.jurisdiction && i.mappingStatus === "VERIFIED")
          ? "MAPPED_THIN"
          : "NEEDS_VERIFICATION_TOMORROW",
      }));

    const typeDist = await sql`
      select authority_type, count(*)::int as n
      from legal_authorities
      group by 1
      order by n desc
    `;
    const levelDist = await sql`
      select coalesce(court_level,'unknown') as court_level, count(*)::int as n
      from legal_authorities where authority_type='case'
      group by 1 order by n desc
    `;
    const fedStateSplit = {
      federal: corpus.federal_cases,
      stateDc: corpus.state_dc_cases,
      federalPct: corpus.cases ? Number(((100 * corpus.federal_cases) / corpus.cases).toFixed(2)) : 0,
      statePct: corpus.cases ? Number(((100 * corpus.state_dc_cases) / corpus.cases).toFixed(2)) : 0,
    };

    const tracker = {
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
        chunks: {
          chunks: chunks.chunks,
          embeddings: chunks.embeddings,
          missing_embeddings: chunks.missing_embeddings,
        },
        duplicates: dupes.n,
        orphans: orphans.n,
        citations: {
          extracted: cite.extracted,
          resolved: cite.resolved,
          unresolved: cite.unresolved,
          targetAbsent: cite.unresolved,
          resolutionRatePct: cite.extracted
            ? Number(((100 * cite.resolved) / cite.extracted).toFixed(2))
            : 0,
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
        scotus,
        circuits,
        districtBuckets: districts.slice(0, 30),
        weakest: [...circuits, scotus].sort((a, b) => a.cases - b.cases).slice(0, 10),
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
        G3: [...circuits, scotus].sort((a, b) => a.cases - b.cases).slice(0, 15),
      },
    };

    const out = {
      ok: true,
      classification: "OVERNIGHT_ZERO_QUOTA_WAVE_A",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      mutations: 0,
      tracker,
      federalDepth: {
        scotus,
        circuits,
        districts: districts.map((d) => ({
          court: d.court,
          cases: d.cases,
          earliestYear: d.earliestYear,
          latestYear: d.latestYear,
          pre2000: d.pre2000,
          pre1980: d.pre1980,
          recent: d.recent,
          citationDemandOverlap: fedDemandBy[d.court] || 0,
          deficit: Math.max(0, 20 - d.cases),
          flags: d.flags,
          yearBuckets: d.yearBuckets,
        })),
        recentHeavy: [...circuits, scotus].filter((c) => c.flags.includes("RECENT_HEAVY")),
        historicallyThin: [...circuits, scotus].filter((c) => c.flags.includes("HISTORICALLY_THIN")),
        lowVolume: [...circuits, scotus].filter((c) => c.flags.includes("LOW_VOLUME")),
        strong: [...circuits, scotus].filter((c) => c.flags.includes("STRONG")),
      },
      districtManifest: {
        courts: districts,
        rankedAcquisitionPlan: districts.map((d, i) => ({
          rank: i + 1,
          court: d.court,
          currentCases: d.cases,
          desiredNextBatch: d.desiredNextBatch,
          recentNeed: d.recentNeed,
          historicalNeed: d.historicalNeed,
          proposedDateWindow: d.proposedDateWindow,
          maxCases: d.maxCases,
          estimatedClCost: d.estimatedClCost,
        })),
      },
      intermediateManifest: {
        verified: intermediates.filter((i) => i.mappingStatus === "VERIFIED"),
        needsVerification: intermediates.filter((i) => i.mappingStatus !== "VERIFIED"),
        thinOrZero: thinIntermediateStates,
        all: intermediates,
      },
      yearDistribution: {
        byState: states.map((s) => ({ jurisdiction: s.jurisdiction, ...s.yearBuckets, cases: s.cases })),
        byCircuit: circuits.map((c) => ({ court: c.bucket, ...c.yearBuckets, cases: c.cases })),
        scotus: { court: "scotus", ...scotus.yearBuckets, cases: scotus.cases },
        districts: districts.map((d) => ({ court: d.court, ...d.yearBuckets, cases: d.cases })),
        recentHeavyJurisdictions: states
          .filter((s) => s.cases > 0 && s.recent / s.cases >= 0.7)
          .map((s) => s.jurisdiction),
        historicalHoles: states.filter((s) => s.historicalGap).map((s) => s.jurisdiction),
      },
      retrievalDiversity: {
        byAuthorityType: typeDist,
        byCourtLevel: levelDist,
        federalStateSplit: fedStateSplit,
        chunkShape: {
          empty: chunks.empty_chunks,
          giant: chunks.giant_chunks,
          tiny: chunks.tiny_chunks,
          missingEmbeddings: chunks.missing_embeddings,
        },
        imbalances: [
          fedStateSplit.federalPct < 15 ? "FEDERAL_UNDERWEIGHT" : null,
          fedStateSplit.statePct > 90 ? "STATE_HEAVY" : null,
          districts.filter((d) => d.cases < 5).length >= 6 ? "SPARSE_DISTRICTS" : null,
          thinIntermediateStates.filter((t) => t.intermediate === 0).length > 10
            ? "SPARSE_INTERMEDIATE"
            : null,
        ].filter(Boolean),
      },
      integrity: {
        duplicateSourceIdentities: dupes.n,
        duplicateAuthorityIds: dupAuthIds.n,
        orphanChunks: orphans.n,
        orphanEmbeddings: orphanEmb.n,
        missingEmbeddings: chunks.missing_embeddings,
        missingAuthorityText: missingText.n,
        futureDates: invalidDates.future_dates,
        absurdOldDates: invalidDates.absurd_old,
        missingProvenance: provenance,
        federalStateClassMismatch: classMismatch.n,
        duplicateCitationEdges: citeDupEdges.n,
        brokenCitationTargets: citeBroken.n,
      },
    };

    console.log(JSON.stringify(out));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500) }));
  process.exit(1);
});
