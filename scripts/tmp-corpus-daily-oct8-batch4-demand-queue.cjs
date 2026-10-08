#!/usr/bin/env node
/**
 * Oct 8 Batch 2 READY queue after circuit refinement.
 * Priority: CA3 → other circuits → EDPA F.Supp → federal reporter → PA appellate.
 * No SCOTUS.
 */
"use strict";
const postgres = require("postgres");
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "packages/research/corpus/reports/corpus-daily-oct8-batch4-demand-queue.json");

const REPORTERS = [
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*3d\s+(\d{1,4})$/i, family: "federal_supplement", sub: "F.Supp.3d", fmt: (v, p) => `${v} F.Supp.3d ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*2d\s+(\d{1,4})$/i, family: "federal_supplement", sub: "F.Supp.2d", fmt: (v, p) => `${v} F.Supp.2d ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s+(\d{1,4})$/i, family: "federal_supplement", sub: "F.Supp.", fmt: (v, p) => `${v} F.Supp. ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*4th\s+(\d{1,4})$/i, family: "federal_reporter", sub: "F.4th", fmt: (v, p) => `${v} F.4th ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*3d\s+(\d{1,4})$/i, family: "federal_reporter", sub: "F.3d", fmt: (v, p) => `${v} F.3d ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*2d\s+(\d{1,4})$/i, family: "federal_reporter", sub: "F.2d", fmt: (v, p) => `${v} F.2d ${p}` },
  { re: /^(\d{1,4})\s+A\.?\s*3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "A.3d", fmt: (v, p) => `${v} A.3d ${p}` },
  { re: /^(\d{1,4})\s+A\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "A.2d", fmt: (v, p) => `${v} A.2d ${p}` },
];

function compactKey(c) {
  return String(c || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "");
}
function normalizeCite(raw) {
  return String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bF\.?\s*Supp\.?\s*3d\b/gi, "F.Supp.3d")
    .replace(/\bF\.?\s*Supp\.?\s*2d\b/gi, "F.Supp.2d")
    .replace(/\bF\.?\s*Supp\.?(?!\s*[23]d)(?=\s*\d)/gi, "F.Supp.")
    .replace(/\bF\.Supp\.(\d+)/gi, "F.Supp. $1")
    .trim();
}
function parseCite(raw) {
  const s = normalizeCite(raw);
  if (/^\d{1,3}\s+U\.?\s*S\.?\s+\d{1,4}$/i.test(s) && !/supp/i.test(s)) return null;
  for (const spec of REPORTERS) {
    const m = s.match(spec.re);
    if (!m) continue;
    return { citation: spec.fmt(Number(m[1]), Number(m[2])), family: spec.family, subfamily: spec.sub };
  }
  return null;
}

function assignLane(parsed, edgeDemand, sourceCourts, refinedCa3Cites) {
  const courts = (sourceCourts || []).map((c) => String(c || "").toLowerCase());
  const fromCa3 = courts.some((c) => c === "us-ca-3" || /ca-3/.test(c));
  const fromEdpa = courts.some((c) => /paed|edpa|us-d-paed/.test(c));
  const fromPa = courts.some((c) => /st-pa|paed|pamd|pawd/.test(c));
  const isRefinedCa3Target = refinedCa3Cites.has(compactKey(parsed.citation));

  // LANE 1: Third Circuit high-demand
  if (parsed.family === "federal_reporter" && (fromCa3 || isRefinedCa3Target) && edgeDemand >= 2) {
    return { lane: 1, laneName: "third_circuit", reason: `LANE1_ca3_edges=${edgeDemand}${isRefinedCa3Target ? "_refinedCa3Neighbor" : ""}` };
  }
  // LANE 2: EDPA / PA federal district
  if (parsed.family === "federal_supplement" && (fromEdpa || (fromPa && edgeDemand >= 2))) {
    return { lane: 2, laneName: "edpa", reason: `LANE2_edpa_fsupp_edges=${edgeDemand}` };
  }
  // LANE 3: other high-demand F.2d/3d/4th
  if (parsed.family === "federal_reporter" && edgeDemand >= 3) {
    return { lane: 3, laneName: "other_circuits", reason: `LANE3_federal_circuit_edges=${edgeDemand}` };
  }
  if (parsed.family === "federal_reporter" && edgeDemand >= 2) {
    return { lane: 3, laneName: "federal_reporter", reason: `LANE3_federal_reporter_edges=${edgeDemand}` };
  }
  // LANE 4: PA appellate only if clearly high-value
  if (parsed.family === "regional_reporter" && /^A\./i.test(parsed.subfamily) && edgeDemand >= 4 && fromPa) {
    return { lane: 4, laneName: "pa_appellate", reason: `LANE4_pa_appellate_edges=${edgeDemand}` };
  }
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const rows = await sql`
      select
        coalesce(nullif(btrim(e.normalized_citation), ''), nullif(btrim(e.raw_citation), '')) as cite,
        count(*)::int as edge_demand,
        count(distinct e.from_authority_id)::int as source_case_count,
        array_agg(distinct a.court_id) filter (where a.court_id is not null) as source_courts
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
        and coalesce(nullif(btrim(e.normalized_citation), ''), nullif(btrim(e.raw_citation), '')) is not null
      group by 1
      having count(*) >= 2
      order by edge_demand desc
      limit 15000
    `;
    const present = await sql`
      select distinct coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(citation), '')) as cite
      from legal_authorities where authority_type='case'
    `;
    const ca3 = await sql`
      select coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(citation), '')) as cite
      from legal_authorities
      where authority_type='case' and court_id='us-ca-3'
    `;
    await sql.unsafe("COMMIT");

    const presentKeys = new Set(present.map((r) => compactKey(r.cite)));
    const refinedCa3Cites = new Set(ca3.map((r) => compactKey(r.cite)));
    const skipped = { present: 0, unparsed: 0, scotus: 0, noLane: 0 };
    const candidates = [];

    for (const row of rows) {
      const raw = String(row.cite || "");
      if (/^\d{1,3}\s+U\.?\s*S\.?\s+\d{1,4}$/i.test(normalizeCite(raw)) && !/supp/i.test(raw)) {
        skipped.scotus += 1;
        continue;
      }
      const parsed = parseCite(raw);
      if (!parsed) {
        skipped.unparsed += 1;
        continue;
      }
      if (presentKeys.has(compactKey(parsed.citation))) {
        skipped.present += 1;
        continue;
      }
      const sourceCourts = Array.isArray(row.source_courts) ? row.source_courts.filter(Boolean) : [];
      const laneInfo = assignLane(parsed, Number(row.edge_demand), sourceCourts, refinedCa3Cites);
      if (!laneInfo) {
        skipped.noLane += 1;
        continue;
      }
      let score = Number(row.edge_demand) * 12 + Number(row.source_case_count) * 3;
      score += { 1: 300, 2: 240, 3: 180, 4: 80 }[laneInfo.lane] || 0;
      if (sourceCourts.some((c) => String(c).includes("us-ca-3"))) score += 25;
      candidates.push({
        citation: parsed.citation,
        family: parsed.family,
        subfamily: parsed.subfamily,
        edgeDemand: Number(row.edge_demand),
        sourceCaseCount: Number(row.source_case_count),
        sourceCourts,
        lane: laneInfo.lane,
        laneName: laneInfo.laneName,
        reason: laneInfo.reason,
        valueScore: score,
        status: "READY_CL",
      });
    }

    candidates.sort((a, b) => a.lane - b.lane || b.valueScore - a.valueScore || b.edgeDemand - a.edgeDemand);
    const caps = { third_circuit: 80, edpa: 40, other_circuits: 70, federal_reporter: 60, pa_appellate: 15 };
    const taken = {};
    const selected = [];
    for (const c of candidates) {
      const n = taken[c.laneName] || 0;
      if (n >= (caps[c.laneName] || 20)) continue;
      taken[c.laneName] = n + 1;
      selected.push({ ...c, rank: selected.length + 1 });
    }
    const byLane = {};
    for (const c of selected) byLane[c.laneName] = (byLane[c.laneName] || 0) + 1;

    const out = {
      ok: true,
      classification: "CORPUS_DAILY_OCT8_BATCH4_DEMAND_QUEUE",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      policy: "NO_SCOTUS_CA3_EDPA_FEDERAL_BATCH4",
      skipped,
      totals: { selected: selected.length, byLane },
      top20: selected.slice(0, 20),
      targets: selected,
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ ok: true, selected: selected.length, byLane, top10: selected.slice(0, 10).map((t) => ({ citation: t.citation, lane: t.laneName, edgeDemand: t.edgeDemand })) }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 800) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
