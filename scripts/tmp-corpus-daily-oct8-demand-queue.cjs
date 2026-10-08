#!/usr/bin/env node
/**
 * Oct 8 READY queue: EDPA/F.Supp first, then CA3, federal reporter, PA appellate.
 * Zero CourtListener. No SCOTUS/US Reports.
 */
"use strict";
const postgres = require("postgres");
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "packages/research/corpus/reports/corpus-daily-oct8-demand-queue.json");

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

const PRACTICE = new Set(
  [
    "75 F.Supp.2d 411",
    "248 F.Supp.2d 393",
    "390 F.Supp.2d 471",
    "124 F.4th 218",
    "180 F.4th 512",
    "125 F.4th 428",
    "13 F.3d 711",
    "133 F.4th 852",
  ].map(compactKey),
);

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
    return {
      citation: spec.fmt(Number(m[1]), Number(m[2])),
      family: spec.family,
      subfamily: spec.sub,
      volume: Number(m[1]),
      page: Number(m[2]),
    };
  }
  return null;
}

function assignLane(parsed, edgeDemand, sourceCourts, sourceCaseCount) {
  const courts = (sourceCourts || []).map((c) => String(c || "").toLowerCase());
  const fromEdpa = courts.some((c) => /paed|edpa|us-d-paed/.test(c));
  const fromCa3 = courts.some((c) => c === "us-ca-3" || /ca-3/.test(c));
  const fromPa = courts.some((c) => /st-pa|pa-high|pa-super|paed|pamd|pawd/.test(c));
  const practice = PRACTICE.has(compactKey(parsed.citation));

  if (parsed.family === "federal_supplement") {
    // Require EDPA/PA-forum source or practice seed — do not park unrelated F.Supp here
    if (fromEdpa || practice || (fromPa && edgeDemand >= 2)) {
      return {
        lane: 1,
        laneName: "edpa",
        reason: `LANE1_edpa_fsupp_edges=${edgeDemand}_sources=${sourceCaseCount}${fromEdpa ? "_fromEdpa" : ""}${practice ? "_practice" : ""}`,
      };
    }
  }
  if (parsed.family === "federal_reporter" && fromCa3 && edgeDemand >= 2) {
    return {
      lane: 2,
      laneName: "third_circuit",
      reason: `LANE2_ca3_edges=${edgeDemand}_sources=${sourceCaseCount}`,
    };
  }
  if (parsed.family === "federal_reporter" && edgeDemand >= 3) {
    return {
      lane: 3,
      laneName: "federal_reporter",
      reason: `LANE3_federal_reporter_edges=${edgeDemand}_sources=${sourceCaseCount}`,
    };
  }
  if (parsed.family === "federal_reporter" && practice && edgeDemand >= 2) {
    return {
      lane: 3,
      laneName: "federal_reporter",
      reason: `LANE3_federal_practice_edges=${edgeDemand}`,
    };
  }
  if (parsed.family === "regional_reporter" && /^A\./i.test(parsed.subfamily) && edgeDemand >= 4 && fromPa) {
    return {
      lane: 4,
      laneName: "pa_appellate",
      reason: `LANE4_pa_appellate_edges=${edgeDemand}`,
    };
  }
  return null;
}

function score(parsed, edgeDemand, sourceCaseCount, lane, sourceCourts) {
  let s = edgeDemand * 12 + sourceCaseCount * 3;
  s += { 1: 320, 2: 240, 3: 140, 4: 100 }[lane] || 0;
  if (PRACTICE.has(compactKey(parsed.citation))) s += 60;
  const courts = (sourceCourts || []).map((c) => String(c || "").toLowerCase());
  if (courts.some((c) => /paed/.test(c))) s += 40;
  if (courts.some((c) => c === "us-ca-3")) s += 20;
  if (parsed.subfamily === "F.Supp.2d" || parsed.subfamily === "F.Supp.3d") s += 15;
  return s;
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
      having count(*) >= 1
      order by edge_demand desc
      limit 20000
    `;
    const present = await sql`
      select distinct coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(citation), '')) as cite
      from legal_authorities
      where authority_type='case'
        and coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(citation), '')) is not null
    `;
    await sql.unsafe("COMMIT");

    const presentKeys = new Set(present.map((r) => compactKey(r.cite)));
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
      // Lane1 allows demand>=1 for practice/EDPA; others need lane assign thresholds
      const sourceCourts = Array.isArray(row.source_courts) ? row.source_courts.filter(Boolean) : [];
      const laneInfo = assignLane(parsed, Number(row.edge_demand), sourceCourts, Number(row.source_case_count));
      if (!laneInfo) {
        skipped.noLane += 1;
        continue;
      }
      // Minimum usefulness: EDPA lane demand>=1 with practice/EDPA source OR demand>=2; others already gated
      if (laneInfo.lane === 1 && Number(row.edge_demand) < 1) {
        skipped.noLane += 1;
        continue;
      }
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
        benchmarkRelevant: PRACTICE.has(compactKey(parsed.citation)),
        expectedClCost: 3,
        valueScore: score(parsed, Number(row.edge_demand), Number(row.source_case_count), laneInfo.lane, sourceCourts),
        status: "READY_CL",
      });
    }

    // Inject known practice EDPA F.Supp targets if still absent (prior cluster_citation_mismatch blockers)
    for (const seed of [
      "75 F.Supp.2d 411",
      "248 F.Supp.2d 393",
      "390 F.Supp.2d 471",
    ]) {
      if (presentKeys.has(compactKey(seed))) continue;
      if (candidates.some((c) => compactKey(c.citation) === compactKey(seed))) continue;
      const parsed = parseCite(seed);
      if (!parsed) continue;
      candidates.push({
        citation: parsed.citation,
        family: parsed.family,
        subfamily: parsed.subfamily,
        edgeDemand: 2,
        sourceCaseCount: 2,
        sourceCourts: ["us-d-paed"],
        lane: 1,
        laneName: "edpa",
        reason: "LANE1_edpa_practice_seed_prior_mismatch_repair",
        benchmarkRelevant: true,
        expectedClCost: 3,
        valueScore: 999,
        status: "READY_CL",
      });
    }

    candidates.sort((a, b) => a.lane - b.lane || b.valueScore - a.valueScore || b.edgeDemand - a.edgeDemand);

    const caps = { edpa: 60, third_circuit: 70, federal_reporter: 80, pa_appellate: 20 };
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
      classification: "CORPUS_DAILY_OCT8_DEMAND_QUEUE",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      policy: "NO_SCOTUS_EDPA_FIRST",
      fsuppNormalization: "collapse F. Supp. / F.Supp. / Federal Supplement variants",
      skipped,
      totals: { selected: selected.length, byLane, totalEdgeDemand: selected.reduce((n, c) => n + c.edgeDemand, 0) },
      top20: selected.slice(0, 20),
      targets: selected,
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(
      JSON.stringify({
        ok: true,
        selected: selected.length,
        byLane,
        edpaTop: selected.filter((t) => t.laneName === "edpa").slice(0, 12),
        artifact: OUT,
      }),
    );
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 800) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
