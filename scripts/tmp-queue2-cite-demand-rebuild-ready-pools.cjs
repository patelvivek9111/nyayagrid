#!/usr/bin/env node
/**
 * Rebuild citation-demand READY_CL pools from live unresolved edges.
 * Zero CourtListener. Zero AI.
 *
 * Usage: node tmp-queue2-cite-demand-rebuild-ready-pools.cjs [usLimit] [regionalLimit] [federalLimit]
 */
"use strict";
const postgres = require("postgres");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST = path.join(__dirname, "..", "packages/research/corpus/reports/citation-demand-acquisition-manifest.json");
const OUT = path.join(__dirname, "..", "packages/research/corpus/reports/queue2-cite-demand-scale2-ready-pools.json");

const REPORTER_FAMILY = [
  { re: /^(\d{1,4})\s+U\.?\s*S\.?\s+(\d{1,4})$/i, family: "us_reports", sub: "U.S.", fmt: (v, p) => `${v} U.S. ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*4th\s+(\d{1,4})$/i, family: "federal_reporter", sub: "F.4th", fmt: (v, p) => `${v} F.4th ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*3d\s+(\d{1,4})$/i, family: "federal_reporter", sub: "F.3d", fmt: (v, p) => `${v} F.3d ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*2d\s+(\d{1,4})$/i, family: "federal_reporter", sub: "F.2d", fmt: (v, p) => `${v} F.2d ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*3d\s+(\d{1,4})$/i, family: "federal_supplement", sub: "F.Supp.3d", fmt: (v, p) => `${v} F.Supp.3d ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*2d\s+(\d{1,4})$/i, family: "federal_supplement", sub: "F.Supp.2d", fmt: (v, p) => `${v} F.Supp.2d ${p}` },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s+(\d{1,4})$/i, family: "federal_supplement", sub: "F.Supp", fmt: (v, p) => `${v} F.Supp. ${p}` },
  { re: /^(\d{1,4})\s+P\.?\s*3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "P.3d", fmt: (v, p) => `${v} P.3d ${p}` },
  { re: /^(\d{1,4})\s+P3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "P.3d", fmt: (v, p) => `${v} P.3d ${p}` },
  { re: /^(\d{1,4})\s+P\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "P.2d", fmt: (v, p) => `${v} P.2d ${p}` },
  { re: /^(\d{1,4})\s+S\.?\s*E\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "S.E.2d", fmt: (v, p) => `${v} S.E.2d ${p}` },
  { re: /^(\d{1,4})\s+S\.?\s*W\.?\s*3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "S.W.3d", fmt: (v, p) => `${v} S.W.3d ${p}` },
  { re: /^(\d{1,4})\s+S\.?\s*W\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "S.W.2d", fmt: (v, p) => `${v} S.W.2d ${p}` },
  { re: /^(\d{1,4})\s+N\.?\s*E\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "N.E.2d", fmt: (v, p) => `${v} N.E.2d ${p}` },
  { re: /^(\d{1,4})\s+N\.?\s*W\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "N.W.2d", fmt: (v, p) => `${v} N.W.2d ${p}` },
  { re: /^(\d{1,4})\s+So\.?\s*3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "So.3d", fmt: (v, p) => `${v} So.3d ${p}` },
  { re: /^(\d{1,4})\s+So\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "So.2d", fmt: (v, p) => `${v} So.2d ${p}` },
  { re: /^(\d{1,4})\s+A\.?\s*3d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "A.3d", fmt: (v, p) => `${v} A.3d ${p}` },
  { re: /^(\d{1,4})\s+A\.?\s*2d\s+(\d{1,4})$/i, family: "regional_reporter", sub: "A.2d", fmt: (v, p) => `${v} A.2d ${p}` },
];

function parseCite(raw) {
  const s = String(raw || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  for (const spec of REPORTER_FAMILY) {
    const m = s.match(spec.re);
    if (!m) continue;
    const volume = Number(m[1]);
    const page = Number(m[2]);
    if (!volume || !page) continue;
    return { citation: spec.fmt(volume, page), family: spec.family, subfamily: spec.sub, volume, page };
  }
  return null;
}

function compactKey(c) {
  return String(c || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
}

async function main() {
  const usLimit = Math.min(Math.max(Number(process.argv[2] || 400), 50), 800);
  const regLimit = Math.min(Math.max(Number(process.argv[3] || 200), 30), 400);
  const fedLimit = Math.min(Math.max(Number(process.argv[4] || 100), 20), 300);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 40 });
  try {
    const rows = await sql`
      select
        coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(raw_citation), '')) as cite,
        count(*)::int as edge_demand
      from legal_authority_citations
      where to_authority_id is null
        and coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(raw_citation), '')) is not null
      group by 1
      having count(*) >= 2
      order by edge_demand desc
      limit 8000
    `;

    const present = await sql`
      select distinct coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(citation), '')) as cite
      from legal_authorities
      where authority_type = 'case'
        and coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(citation), '')) is not null
    `;
    const presentKeys = new Set(present.map((r) => compactKey(r.cite)));

    let manifest = { targets: [], generatedAt: null };
    if (fs.existsSync(MANIFEST)) {
      manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    }
    const priorByKey = new Map();
    for (const t of manifest.targets || []) {
      priorByKey.set(compactKey(t.citation || t.canonicalTargetKey), t);
    }

    const DENY_SAME_METHOD = new Set(["573us373"]);
    const pools = { us_reports: [], regional_reporter: [], federal_reporter: [], federal_supplement: [] };
    const skipped = { present: 0, unparsed: 0, prior_not_found: 0, acquired: 0, deny: 0 };

    for (const row of rows) {
      const parsed = parseCite(row.cite);
      if (!parsed) { skipped.unparsed += 1; continue; }
      const key = compactKey(parsed.citation);
      if (presentKeys.has(key)) { skipped.present += 1; continue; }
      if (DENY_SAME_METHOD.has(key)) { skipped.deny += 1; continue; }
      const prior = priorByKey.get(key);
      if (prior?.status === "ACQUIRED" || prior?.acquired) { skipped.acquired += 1; continue; }
      if (prior?.status === "NOT_FOUND_CL" || /not_found/i.test(String(prior?.failureReason || ""))) {
        skipped.prior_not_found += 1;
        continue;
      }
      if (prior?.status === "AMBIGUOUS" || prior?.status === "BLOCKED" || prior?.status === "DUPLICATE") continue;

      const target = {
        rank: 0,
        canonicalTargetKey: parsed.citation,
        citation: parsed.citation,
        citationFamily: parsed.family,
        subfamily: parsed.subfamily,
        edgeDemand: Number(row.edge_demand),
        cumulativeEdgeDemand: 0,
        authorityType: "case",
        sourceStrategy: "courtlistener",
        courtListenerEligible: true,
        localTargetPresent: false,
        status: "READY_CL",
        priorityReason: `liveEdgeDemand=${row.edge_demand}`,
        citationDemandScore: Number(row.edge_demand),
        coverageValue: parsed.family === "us_reports" ? 2 : 1,
        balanceValue: parsed.family === "regional_reporter" ? 1 : 0,
        expectedEdgesPerCl: null,
        expectedEdgesPerClConfidence: "UNKNOWN",
        identityConfidence: 1,
        refreshedAt: new Date().toISOString(),
        refreshSource: "live_unresolved_edges_scale2",
      };
      // preserve attempt history
      if (prior) {
        target.attemptCount = prior.attemptCount || 0;
        target.statusHistory = prior.statusHistory || [];
        target.actualCLRequests = prior.actualCLRequests || 0;
        target.lastAttemptedAt = prior.lastAttemptedAt || null;
      }
      if (!pools[parsed.family]) continue;
      pools[parsed.family].push(target);
    }

    // regional priority sort: P.3d, S.E.2d, P.2d first
    const regRank = (s) => ({ "P.3d": 4, "S.E.2d": 3, "P.2d": 2 }[s] || 1);
    for (const f of Object.keys(pools)) {
      pools[f].sort((a, b) => {
        if (f === "regional_reporter") {
          const d = regRank(b.subfamily) - regRank(a.subfamily);
          if (d) return d;
        }
        return b.edgeDemand - a.edgeDemand;
      });
    }

    const selected = [
      ...pools.us_reports.slice(0, usLimit),
      ...pools.regional_reporter.slice(0, regLimit),
      ...pools.federal_reporter.slice(0, fedLimit),
      // F.Supp recorded but not READY for acquisition this run
      ...pools.federal_supplement.slice(0, 50).map((t) => ({
        ...t,
        status: "PAUSED_FSUPP",
        courtListenerEligible: false,
        priorityReason: "paused_fsupp_nonproductive",
      })),
    ];

    // Keep historical non-READY outcomes that are terminal
    const terminal = (manifest.targets || []).filter((t) =>
      ["ACQUIRED", "NOT_FOUND_CL", "AMBIGUOUS", "BLOCKED", "DUPLICATE", "UNSUPPORTED", "ALREADY_PRESENT", "ALREADY_RESOLVED_LOCALLY"].includes(t.status)
      && !selected.some((s) => compactKey(s.citation) === compactKey(t.citation)),
    );

    let cum = 0;
    selected.forEach((t, i) => {
      t.rank = i + 1;
      cum += t.edgeDemand;
      t.cumulativeEdgeDemand = cum;
    });

    const nextManifest = {
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      refreshClassification: "CITATION_DEMAND_ADAPTIVE_SCALE_2_READY_REBUILD",
      targets: [...selected, ...terminal],
      poolCounts: {
        us_reports_ready: pools.us_reports.length,
        regional_ready: pools.regional_reporter.length,
        federal_ready: pools.federal_reporter.length,
        fsupp_candidates: pools.federal_supplement.length,
        selectedUs: Math.min(usLimit, pools.us_reports.length),
        selectedRegional: Math.min(regLimit, pools.regional_reporter.length),
        selectedFederal: Math.min(fedLimit, pools.federal_reporter.length),
        terminalPreserved: terminal.length,
      },
      skipped,
      familyPilotStatsVersion: manifest.familyPilotStatsVersion || null,
      calibrationBlock2: manifest.calibrationBlock2 || null,
      adaptiveScale1: manifest.adaptiveScale1 || null,
    };
    // NOTE: when run via Fly, local disk is ephemeral — emit selected targets on stdout
    // so the local orchestrator can persist the manifest.
    const summary = {
      ok: true,
      classification: "CITATION_DEMAND_SCALE2_READY_REBUILD",
      generatedAt: nextManifest.generatedAt,
      courtListenerHttpCalls: 0,
      aiCalls: 0,
      poolCounts: nextManifest.poolCounts,
      skipped,
      selectedTargets: selected,
      terminalTargets: terminal,
      topUs: pools.us_reports.slice(0, 10).map((t) => ({ c: t.citation, d: t.edgeDemand })),
      topRegional: pools.regional_reporter.slice(0, 10).map((t) => ({ c: t.citation, d: t.edgeDemand, s: t.subfamily })),
      topFederal: pools.federal_reporter.slice(0, 10).map((t) => ({ c: t.citation, d: t.edgeDemand, s: t.subfamily })),
      regionalSubfamilyCounts: pools.regional_reporter.reduce((a, t) => {
        a[t.subfamily] = (a[t.subfamily] || 0) + 1;
        return a;
      }, {}),
    };
    try {
      fs.writeFileSync(MANIFEST, JSON.stringify(nextManifest, null, 2));
      fs.writeFileSync(OUT, JSON.stringify({ ...summary, selectedTargets: undefined, terminalTargets: undefined }, null, 2));
    } catch { /* fly ephemeral ok */ }
    console.log(JSON.stringify(summary));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e?.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
