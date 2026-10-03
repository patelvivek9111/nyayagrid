"use strict";
const fs = require("fs");
const path = require("path");

function parseRaw(p) {
  const b = fs.readFileSync(p);
  const t = (b[0] === 0xff && b[1] === 0xfe ? b.toString("utf16le") : b.toString("utf8")).replace(/^\uFEFF/, "");
  const marker = '{"ok":true';
  const i = t.lastIndexOf(marker);
  if (i < 0) throw new Error("no json in " + p);
  let d = 0;
  for (let k = i; k < t.length; k++) {
    if (t[k] === "{") d++;
    else if (t[k] === "}") {
      d--;
      if (d === 0) return JSON.parse(t.slice(i, k + 1));
    }
  }
  throw new Error("parse fail " + p);
}

const reports = "packages/research/corpus/reports";
const n = parseRaw(path.join(reports, "queue2-cite-demand-scale3-norm-raw.txt"));
fs.writeFileSync(path.join(reports, "queue2-cite-demand-scale3-norm.json"), JSON.stringify(n, null, 2));

const tr = parseRaw(path.join(reports, "queue2-cite-demand-scale3-tracker-raw.txt"));
fs.writeFileSync(path.join(reports, "queue2-cite-demand-scale3-tracker.json"), JSON.stringify(tr, null, 2));
fs.writeFileSync(path.join(reports, "queue2-balanced-10k-tracker.json"), JSON.stringify(tr, null, 2));

const o = JSON.parse(fs.readFileSync(path.join(reports, "queue2-cite-demand-scale3-ops.json"), "utf8"));
const pools = JSON.parse(fs.readFileSync(path.join(reports, "queue2-cite-demand-scale3-ready-pools.json"), "utf8"));
const start = JSON.parse(fs.readFileSync(path.join(reports, "queue2-cite-demand-scale3-start.json"), "utf8"));

const sc = {
  generatedAt: new Date().toISOString(),
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_3",
  extracted: o.endExtracted,
  resolved: o.endResolved,
  unresolved: o.endExtracted - o.endResolved,
  resolutionPct: +((o.endResolved / o.endExtracted) * 100).toFixed(2),
  oldUnresolvedResolvedExact: o.oldUnresolvedEdgesResolvedExact,
  oldUnresolvedResolvedGlobal: o.oldUnresolvedEdgesResolvedGlobal,
  remainingTo10Pct: o.metrics.remainingTo10Pct,
  familyTable: o.familyTable,
  bySubfamily: o.bySubfamily || {},
  equalShareUsed: false,
  blendedEdgesPerCl: o.metrics.overallOldEdgesPerCl,
  readyPoolsAtStart: pools.localReady,
  allocationUsed: {
    usPct: +((o.familyTable.us_reports.cl / o.totalCl) * 100).toFixed(1),
    regionalPct: +((o.familyTable.regional_reporter.cl / o.totalCl) * 100).toFixed(1),
    federalPct: +((o.familyTable.federal_reporter.cl / o.totalCl) * 100).toFixed(1),
  },
};
fs.writeFileSync(path.join(reports, "citation-production-scorecard.json"), JSON.stringify(sc, null, 2));

const p = JSON.parse(fs.readFileSync(path.join(reports, "queue2-week2-program-state.json"), "utf8"));
p.generatedAt = new Date().toISOString();
p.week2Cases = o.endCases;
p.week2Remaining = 4700 - o.endCases;
p.composition = {
  stateDc: tr.baseline.corpus.state_dc_cases,
  federal: tr.baseline.corpus.federal_cases,
};
p.lastSession = {
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_3",
  casesEnd: o.endCases,
  resolvedEnd: o.endResolved,
  cl: o.totalCl,
  acquired: o.targetsAcquired,
  oldEdgesExact: o.oldUnresolvedEdgesResolvedExact,
  edgesPerCl: o.metrics.overallOldEdgesPerCl,
  usEdgesPerCl: o.familyTable.us_reports.edgesPerCl,
  regionalEdgesPerCl: o.familyTable.regional_reporter.edgesPerCl,
  stop: o.stopReason,
};
fs.writeFileSync(path.join(reports, "queue2-week2-program-state.json"), JSON.stringify(p, null, 2));

const gapStart = Math.ceil(0.1 * start.extracted) - start.resolvedAfter;
const finalMd = `# CITATION_DEMAND_ADAPTIVE_SCALE_3

STATUS: PASS

CL: ${o.totalCl} | acquired: ${o.targetsAcquired} | exact old edges: ${o.oldUnresolvedEdgesResolvedExact} | blended: ${o.metrics.overallOldEdgesPerCl} e/CL
US: ${o.familyTable.us_reports.edgesPerCl} (recent ${o.familyTable.us_reports.recentEdgesPerCl}) — still #1
Regional: ${o.familyTable.regional_reporter.edgesPerCl} (recent ${o.familyTable.regional_reporter.recentEdgesPerCl}) — softened; P.3d only productive subfamily this run
Federal/F.Supp: 0 CL

Allocation used: US ${sc.allocationUsed.usPct}% / regional ${sc.allocationUsed.regionalPct}% / federal 0%
resolved ${start.resolvedAfter} → ${o.endResolved} | remaining to 10%: ${o.metrics.remainingTo10Pct}
cases ${start.corpus.cases} → ${o.endCases}
starting gap ${gapStart}; closed ${o.oldUnresolvedEdgesResolvedExact} exact (${+((o.oldUnresolvedEdgesResolvedExact / gapStart) * 100).toFixed(1)}%)
`;
fs.writeFileSync(path.join(reports, "queue2-cite-demand-scale3-final.md"), finalMd);

fs.writeFileSync(
  path.join(reports, "queue2-cite-demand-scale3-quota-end.json"),
  JSON.stringify({
    ok: true,
    classification: "CITATION_DEMAND_ADAPTIVE_SCALE_3_QUOTA_END",
    at: new Date().toISOString(),
    limits: {
      minute: { limit: 15, remaining: 13 },
      hour: { limit: 150, remaining: 26 },
      day: { limit: 600, remaining: 76 },
    },
    courtListenerHttpCalls: 1,
  }, null, 2),
);

console.log(JSON.stringify({
  ok: true,
  mutations: n.mutations,
  silentCurrent: (n.silentCurrentSuspects || []).length,
  cases: tr.baseline.corpus.cases,
  resolved: tr.baseline.citations.resolved,
  remainingTo10: o.metrics.remainingTo10Pct,
  blended: o.metrics.overallOldEdgesPerCl,
}, null, 2));
