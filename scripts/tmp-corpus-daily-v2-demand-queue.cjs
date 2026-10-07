#!/usr/bin/env node
/**
 * Build high-value CASE_TARGET_ABSENT demand queue from live unresolved edges.
 * Zero CourtListener. Read-only census + write queue artifact only.
 *
 * Lanes (priority order):
 *  1 high-demand missing authorities
 *  2 controlling authority gaps (SCOTUS / circuits / state supreme)
 *  3 weak jurisdictions (CA3 / EDPA / PA appellate emphasis, not exclusive)
 *  5 benchmark / practice-relevant (warrant/suppression seed list)
 *  6 historically important high-demand
 *  7 broader useful depth
 */
"use strict";
const postgres = require("postgres");
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/corpus-daily-v2-demand-queue.json",
);

const REPORTER_FAMILY = [
  { re: /^(\d{1,4})\s+U\.?\s*S\.?\s+(\d{1,4})$/i, family: "us_reports", sub: "U.S.", fmt: (v, p) => `${v} U.S. ${p}`, lane2: true, controlling: "scotus" },
  { re: /^(\d{1,4})\s+F\.?\s*4th\s+(\d{1,4})$/i, family: "federal_reporter", sub: "F.4th", fmt: (v, p) => `${v} F.4th ${p}`, lane2: true, controlling: "circuit" },
  { re: /^(\d{1,4})\s+F\.?\s*3d\s+(\d{1,4})$/i, family: "federal_reporter", sub: "F.3d", fmt: (v, p) => `${v} F.3d ${p}`, lane2: true, controlling: "circuit" },
  { re: /^(\d{1,4})\s+F\.?\s*2d\s+(\d{1,4})$/i, family: "federal_reporter", sub: "F.2d", fmt: (v, p) => `${v} F.2d ${p}`, lane2: true, controlling: "circuit", historical: true },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*3d\s+(\d{1,4})$/i, family: "federal_supplement", sub: "F.Supp.3d", fmt: (v, p) => `${v} F.Supp.3d ${p}`, lane2: false, controlling: "district" },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*2d\s+(\d{1,4})$/i, family: "federal_supplement", sub: "F.Supp.2d", fmt: (v, p) => `${v} F.Supp.2d ${p}`, lane2: false, controlling: "district" },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s+(\d{1,4})$/i, family: "federal_supplement", sub: "F.Supp.", fmt: (v, p) => `${v} F.Supp. ${p}`, lane2: false, controlling: "district" },
  { re: /^(\d{1,4})\s+A\.?\s*3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "A.3d", fmt: (v, p) => `${v} A.3d ${p}`, lane2: true, controlling: "state_high", weakPa: true },
  { re: /^(\d{1,4})\s+A\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "A.2d", fmt: (v, p) => `${v} A.2d ${p}`, lane2: true, controlling: "state_high", weakPa: true, historical: true },
  { re: /^(\d{1,4})\s+P\.?\s*3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "P.3d", fmt: (v, p) => `${v} P.3d ${p}`, lane2: true, controlling: "state_high" },
  { re: /^(\d{1,4})\s+P\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "P.2d", fmt: (v, p) => `${v} P.2d ${p}`, lane2: true, controlling: "state_high", historical: true },
  { re: /^(\d{1,4})\s+S\.?\s*E\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "S.E.2d", fmt: (v, p) => `${v} S.E.2d ${p}`, lane2: true, controlling: "state_high" },
  { re: /^(\d{1,4})\s+S\.?\s*W\.?\s*3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "S.W.3d", fmt: (v, p) => `${v} S.W.3d ${p}`, lane2: true, controlling: "state_high" },
  { re: /^(\d{1,4})\s+S\.?\s*W\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "S.W.2d", fmt: (v, p) => `${v} S.W.2d ${p}`, lane2: true, controlling: "state_high", historical: true },
  { re: /^(\d{1,4})\s+N\.?\s*E\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "N.E.2d", fmt: (v, p) => `${v} N.E.2d ${p}`, lane2: true, controlling: "state_high" },
  { re: /^(\d{1,4})\s+N\.?\s*W\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "N.W.2d", fmt: (v, p) => `${v} N.W.2d ${p}`, lane2: true, controlling: "state_high" },
  { re: /^(\d{1,4})\s+So\.?\s*3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "So.3d", fmt: (v, p) => `${v} So.3d ${p}`, lane2: true, controlling: "state_high" },
  { re: /^(\d{1,4})\s+So\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "So.2d", fmt: (v, p) => `${v} So.2d ${p}`, lane2: true, controlling: "state_high", historical: true },
];

// Known practice/benchmark-relevant citations (warrant/suppression/criminal procedure depth).
const BENCHMARK_SEEDS = new Set(
  [
    "468 U.S. 897", // Leon
    "392 U.S. 1", // Terry
    "367 U.S. 643", // Mapp
    "388 U.S. 218", // Warden v. Hayden
    "395 U.S. 752", // Chimel
    "412 U.S. 218", // Cupp
    "428 U.S. 465", // Stone
    "429 U.S. 98", // South Dakota v. Opperman
    "442 U.S. 200", // Dunaway
    "445 U.S. 573", // Payton
    "453 U.S. 454", // Robbins
    "460 U.S. 276", // Illinois v. Gates
    "462 U.S. 213", // Illinois v. Lafayette
    "466 U.S. 109", // Segura
    "468 U.S. 981", // United States v. Karo
    "480 U.S. 709", // Griffin
    "486 U.S. 35", // California v. Greenwood
    "490 U.S. 386", // Graham
    "496 U.S. 128", // Alabama v. White
    "499 U.S. 621", // California v. Hodari
    "500 U.S. 44", // California v. Acevedo
    "514 U.S. 927", // Wilson v. Arkansas
    "517 U.S. 690", // Ornelas
    "526 U.S. 295", // Wyoming v. Houghton
    "529 U.S. 266", // Florida v. J.L.
    "531 U.S. 32", // Indianapolis v. Edmond
    "533 U.S. 27", // Kyllo
    "540 U.S. 419", // Maryland v. Pringle
    "543 U.S. 146", // Devenpeck
    "547 U.S. 398", // Brigham City
    "547 U.S. 586", // Georgia v. Randolph
    "555 U.S. 135", // Herring
    "557 U.S. 433", // Safford
    "562 U.S. 443", // Davis
    "565 U.S. 400", // Messerschmidt
    "569 U.S. 1", // Florida v. Jardines
    "569 U.S. 141", // Missouri v. McNeely
    "572 U.S. 433", // Riley
    "573 U.S. 373", // deny same-method
    "576 U.S. 257", // Rodriguez
    "579 U.S. 438", // Birchfield
    "582 U.S. 356", // Collins
    "588 U.S. 267", // Mitchell
    "592 U.S. 1", // Lange
    "124 F.4th 218",
    "180 F.4th 512",
    "125 F.4th 428",
    "126 F.4th 215",
    "13 F.3d 711",
    "133 F.4th 852",
    "75 F.Supp.2d 411",
    "248 F.Supp.2d 393",
    "390 F.Supp.2d 471",
  ].map((c) => compactKey(c)),
);

const DENY = new Set(["573us373"]);

function compactKey(c) {
  return String(c || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "");
}

function parseCite(raw) {
  const s = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const spec of REPORTER_FAMILY) {
    const m = s.match(spec.re);
    if (!m) continue;
    const volume = Number(m[1]);
    const page = Number(m[2]);
    if (!volume || !page) continue;
    return {
      citation: spec.fmt(volume, page),
      family: spec.family,
      subfamily: spec.sub,
      volume,
      page,
      lane2: Boolean(spec.lane2),
      controlling: spec.controlling || null,
      historical: Boolean(spec.historical),
      weakPa: Boolean(spec.weakPa),
    };
  }
  return null;
}

function assignLane(parsed, edgeDemand, sourceCourts) {
  const key = compactKey(parsed.citation);
  const weakForum =
    parsed.weakPa ||
    sourceCourts.some((c) => /us-ca-3|us-d-paed|st-pa/i.test(String(c || "")));
  const benchmark = BENCHMARK_SEEDS.has(key);
  const highDemand = edgeDemand >= 8;
  const controlling = parsed.lane2 && edgeDemand >= 3;
  const historical = parsed.historical && edgeDemand >= 5;

  if (highDemand) return { lane: 1, reason: `LANE1_high_demand_edges=${edgeDemand}` };
  if (controlling && parsed.controlling === "scotus")
    return { lane: 2, reason: `LANE2_scotus_edges=${edgeDemand}` };
  if (controlling)
    return { lane: 2, reason: `LANE2_controlling_${parsed.controlling}_edges=${edgeDemand}` };
  if (weakForum && edgeDemand >= 2)
    return { lane: 3, reason: `LANE3_weak_forum_edges=${edgeDemand}` };
  if (benchmark) return { lane: 5, reason: `LANE5_benchmark_practice_edges=${edgeDemand}` };
  if (historical) return { lane: 6, reason: `LANE6_historical_high_demand_edges=${edgeDemand}` };
  if (edgeDemand >= 3) return { lane: 7, reason: `LANE7_broader_depth_edges=${edgeDemand}` };
  return { lane: 7, reason: `LANE7_low_demand_edges=${edgeDemand}` };
}

function score(parsed, edgeDemand, sourceCaseCount, lane) {
  let s = edgeDemand * 10 + sourceCaseCount * 2;
  if (lane === 1) s += 200;
  if (lane === 2) s += 160;
  if (lane === 3) s += 120;
  if (lane === 5) s += 100;
  if (lane === 6) s += 80;
  if (parsed.controlling === "scotus") s += 50;
  if (parsed.controlling === "circuit") s += 30;
  if (parsed.controlling === "state_high") s += 20;
  if (BENCHMARK_SEEDS.has(compactKey(parsed.citation))) s += 40;
  // Prefer modern federal reporter slightly for practice relevance after SCOTUS
  if (parsed.subfamily === "F.4th") s += 8;
  if (parsed.subfamily === "F.3d") s += 5;
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
      having count(*) >= 2
      order by edge_demand desc
      limit 12000
    `;

    const present = await sql`
      select distinct coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(citation), '')) as cite
      from legal_authorities
      where authority_type = 'case'
        and coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(citation), '')) is not null
    `;
    await sql.unsafe("COMMIT");

    const presentKeys = new Set(present.map((r) => compactKey(r.cite)));
    const skipped = { present: 0, unparsed: 0, deny: 0, lowValue: 0 };
    const candidates = [];

    for (const row of rows) {
      const parsed = parseCite(row.cite);
      if (!parsed) {
        skipped.unparsed += 1;
        continue;
      }
      const key = compactKey(parsed.citation);
      if (presentKeys.has(key)) {
        skipped.present += 1;
        continue;
      }
      if (DENY.has(key)) {
        skipped.deny += 1;
        continue;
      }
      const sourceCourts = Array.isArray(row.source_courts) ? row.source_courts.filter(Boolean) : [];
      const laneInfo = assignLane(parsed, Number(row.edge_demand), sourceCourts);
      // Do not random-fill: require lane 1–6 or lane7 with demand >= 3
      if (laneInfo.lane === 7 && Number(row.edge_demand) < 3) {
        skipped.lowValue += 1;
        continue;
      }
      const valueScore = score(parsed, Number(row.edge_demand), Number(row.source_case_count), laneInfo.lane);
      candidates.push({
        citation: parsed.citation,
        family: parsed.family,
        subfamily: parsed.subfamily,
        volume: parsed.volume,
        page: parsed.page,
        edgeDemand: Number(row.edge_demand),
        sourceCaseCount: Number(row.source_case_count),
        sourceCourts,
        lane: laneInfo.lane,
        reason: laneInfo.reason,
        controlling: parsed.controlling,
        historical: parsed.historical,
        benchmarkRelevant: BENCHMARK_SEEDS.has(key),
        expectedClCost: parsed.family === "us_reports" ? 3 : 3,
        valueScore,
        status: "READY_CL",
      });
    }

    candidates.sort((a, b) => a.lane - b.lane || b.valueScore - a.valueScore || b.edgeDemand - a.edgeDemand);

    // Jurisdiction balance: soft-cap single reporter family so one easy series can't consume the day.
    const familyCap = {
      us_reports: 350,
      federal_reporter: 280,
      regional_reporter: 220,
      federal_supplement: 80,
    };
    const familyTaken = {};
    const selected = [];
    for (const c of candidates) {
      const taken = familyTaken[c.family] || 0;
      const cap = familyCap[c.family] || 100;
      if (taken >= cap) continue;
      familyTaken[c.family] = taken + 1;
      selected.push({ ...c, rank: selected.length + 1 });
    }

    const byLane = {};
    for (const c of selected) {
      byLane[c.lane] = (byLane[c.lane] || 0) + 1;
    }
    const byFamily = {};
    for (const c of selected) {
      byFamily[c.family] = (byFamily[c.family] || 0) + 1;
    }

    const out = {
      ok: true,
      classification: "CORPUS_DAILY_V2_DEMAND_QUEUE",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      mutations: 0,
      skipped,
      totals: {
        candidatesScanned: rows.length,
        selected: selected.length,
        byLane,
        byFamily,
        totalEdgeDemand: selected.reduce((n, c) => n + c.edgeDemand, 0),
      },
      top20: selected.slice(0, 20),
      targets: selected,
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(
      JSON.stringify(
        {
          ok: true,
          selected: selected.length,
          byLane,
          byFamily,
          top10: selected.slice(0, 10).map((t) => ({
            citation: t.citation,
            lane: t.lane,
            edgeDemand: t.edgeDemand,
            reason: t.reason,
            valueScore: t.valueScore,
          })),
          artifact: OUT,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 800) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
