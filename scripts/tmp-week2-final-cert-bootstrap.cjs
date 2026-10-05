/**
 * Week 2 Final Certification — bootstrap + state/historical sufficiency audit (0 CL beyond quota probe).
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const TARGET_MAX_CL = 275;
const PLANNING_PER_STATE = 150;
const STATE_PASS_FLOOR = 3450;
const PRE2000_PASS_FLOOR = 900;
const PRE1980_PASS_FLOOR = 260;
const HIST_JURIS_MIN_PRE2000 = 15;
const HIST_JURIS_MIN_PRE1980 = 3;

function read(p) {
  const b = fs.readFileSync(p);
  if (b[0] === 0xff && b[1] === 0xfe) return b.toString("utf16le");
  if (b.includes(0) && b[1] === 0) return b.toString("utf16le");
  return b.toString("utf8");
}
function parse(p, needle) {
  const t = read(p);
  const markers = needle
    ? [needle]
    : ['{"ok":true,"classification":"QUEUE2_SESSION2_QUOTA_PROBE"', '{"ok":true,"courtListenerHttpCalls"', '{"ok":true'];
  for (const m of markers) {
    const i = t.lastIndexOf(m);
    if (i < 0) continue;
    let d = 0;
    for (let k = i; k < t.length; k++) {
      if (t[k] === "{") d++;
      else if (t[k] === "}") {
        d--;
        if (d === 0) {
          try {
            return JSON.parse(t.slice(i, k + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

const q = parse(path.join(REPORTS, "week2-final-cert-quota-raw.txt"));
const s = parse(path.join(REPORTS, "week2-final-cert-start-raw.txt"), '{"ok":true,"courtListenerHttpCalls"');
const tr = parse(path.join(REPORTS, "week2-final-cert-tracker-raw.txt"), '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"');
if (!q || !s || !tr) {
  console.log(JSON.stringify({ ok: false, q: !!q, s: !!s, tr: !!tr }));
  process.exit(2);
}

const registry = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));
const hourRem = Number(q.limits.hour.remaining);
const dayRem = Number(q.limits.day.remaining);
const safeBudget = Math.min(Math.max(0, hourRem - HOUR_FLOOR), Math.max(0, dayRem - DAY_FLOOR), TARGET_MAX_CL);
const preferred = Math.min(225, safeBudget); // certification: prefer not maxing unless needed
const states = tr.states || [];
const intermediate = states.reduce((a, x) => a + Number(x.intermediateAppellate || 0), 0);
const pre2000 = states.reduce((a, x) => a + Number(x.pre2000 || 0), 0);
const pre1980 = states.reduce((a, x) => a + Number(x.pre1980 || 0), 0);

const invalidMaps = Object.values(registry.courts || {})
  .filter((c) => c.mappingStatus === "INVALID_MAPPING" || c.mappingStatus === "UNKNOWN_MAPPING")
  .map((c) => ({ clCourtId: c.clCourtId, status: c.mappingStatus, jurisdiction: c.jurisdiction }));

const stateGaps = states
  .map((st) => {
    const deficit = Number(st.deficit || Math.max(0, PLANNING_PER_STATE - Number(st.cases || 0)));
    let availability = "ACQUIRABLE_NOW";
    if (st.intermediateLayerGap) {
      const inv = invalidMaps.find((m) => m.jurisdiction === st.jurisdiction);
      if (inv) availability = "INVALID_MAPPING";
      else if (["DE"].includes(st.jurisdiction)) availability = "STRUCTURAL_NO_INTERMEDIATE_COURT";
      else availability = "SOURCE_LIMITED_OR_HIGH_ONLY";
    }
    const criticality =
      deficit >= 80 && Number(st.cases || 0) < 60
        ? "MATERIAL_WEEK2"
        : deficit >= 40
          ? "POSSIBLY_MATERIAL"
          : "LONG_TAIL_NONCRITICAL";
    return {
      jurisdiction: st.jurisdiction,
      cases: st.cases,
      highCourt: st.highCourt,
      intermediateAppellate: st.intermediateAppellate,
      deficit,
      pre2000: st.pre2000,
      pre1980: st.pre1980,
      intermediateLayerGap: st.intermediateLayerGap,
      availability,
      criticality,
      blocksWeek3: criticality === "MATERIAL_WEEK2" && availability === "ACQUIRABLE_NOW",
    };
  })
  .sort((a, b) => b.deficit - a.deficit);

const materialState = stateGaps.filter((g) => g.criticality === "MATERIAL_WEEK2");
const acquirableMaterialState = materialState.filter((g) => g.availability === "ACQUIRABLE_NOW");
const sourceLimitedState = stateGaps.filter((g) =>
  ["INVALID_MAPPING", "STRUCTURAL_NO_INTERMEDIATE_COURT", "SOURCE_LIMITED_OR_HIGH_ONLY"].includes(g.availability),
);

const histGaps = states
  .map((st) => {
    const thinPre2000 = Number(st.pre2000 || 0) < HIST_JURIS_MIN_PRE2000;
    const thinPre1980 = Number(st.pre1980 || 0) < HIST_JURIS_MIN_PRE1980;
    let criticality = "NONCRITICAL_LONG_TAIL";
    if (thinPre2000 && Number(st.cases || 0) >= 40) criticality = "MATERIAL_WEEK2";
    else if (thinPre1980 && thinPre2000) criticality = "MATERIAL_WEEK2";
    else if (thinPre2000 || thinPre1980) criticality = "SOURCE_LIMITED";
    return {
      jurisdiction: st.jurisdiction,
      cases: st.cases,
      pre2000: st.pre2000,
      pre1980: st.pre1980,
      thinPre2000,
      thinPre1980,
      criticality,
    };
  })
  .filter((g) => g.thinPre2000 || g.thinPre1980)
  .sort((a, b) => Number(a.pre2000) - Number(b.pre2000));

const materialHist = histGaps.filter((g) => g.criticality === "MATERIAL_WEEK2");
const pre2000Concentrated = (() => {
  const top = [...states].sort((a, b) => Number(b.pre2000) - Number(a.pre2000)).slice(0, 5);
  const topSum = top.reduce((a, x) => a + Number(x.pre2000 || 0), 0);
  return { top5Share: pre2000 > 0 ? Number((topSum / pre2000).toFixed(3)) : null, top5: top.map((x) => ({ j: x.jurisdiction, pre2000: x.pre2000 })) };
})();

const stateFoundationPre =
  Number(tr.progress.stateDcCurrent) >= STATE_PASS_FLOOR && acquirableMaterialState.length <= 3 ? "PASS" : "PARTIAL";
const histFoundationPre =
  pre2000 >= PRE2000_PASS_FLOOR && pre1980 >= PRE1980_PASS_FLOOR && materialHist.length <= 8 ? "PASS" : "PARTIAL";

const boot = {
  ok: true,
  classification: "WEEK2_FINAL_CERTIFICATION_BOOTSTRAP",
  generatedAt: new Date().toISOString(),
  membership: q.membership,
  limits: q.limits,
  hourFloor: HOUR_FLOOR,
  dayFloor: DAY_FLOOR,
  safeBudget,
  preferred,
  thresholds: {
    STATE_PASS_FLOOR,
    PRE2000_PASS_FLOOR,
    PRE1980_PASS_FLOOR,
    HIST_JURIS_MIN_PRE2000,
    HIST_JURIS_MIN_PRE1980,
    sufficientlyCloseCases: 4650,
  },
  start: {
    cases: s.corpus.cases,
    extracted: s.extracted,
    resolved: s.resolvedAfter,
    unresolved: s.targetAbsent,
    parserGap: s.parserGap,
    stateDc: tr.progress.stateDcCurrent,
    federal: tr.progress.federalCurrent,
    intermediate,
    pre2000,
    pre1980,
    duplicates: s.duplicateSourceIds,
    orphans: s.orphans,
    missingEmbeddings: s.chunks?.missing_embeddings,
  },
  sufficiencyPre: {
    stateFoundation: stateFoundationPre,
    historicalFoundation: histFoundationPre,
    intermediateFoundation: intermediate >= 500 ? "PASS" : "PARTIAL",
    federalFoundation: Number(tr.progress.federalCurrent) >= 1000 ? "PASS" : "FAIL",
    materialStateGaps: materialState.slice(0, 12),
    acquirableMaterialState: acquirableMaterialState.slice(0, 12),
    sourceLimitedStateCount: sourceLimitedState.length,
    materialHistoricalGaps: materialHist.slice(0, 15),
    pre2000Concentration: pre2000Concentrated,
  },
  courtListenerHttpCalls: 1,
};
fs.writeFileSync(path.join(REPORTS, "week2-final-cert-quota.json"), JSON.stringify(boot, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-final-cert-start.json"), JSON.stringify({ ok: true, ...boot.start }, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-final-cert-tracker.json"), JSON.stringify(tr, null, 2));
fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tr, null, 2));
fs.writeFileSync(
  path.join(REPORTS, "week2-final-cert-sufficiency-audit.json"),
  JSON.stringify(
    {
      classification: "WEEK2_FINAL_CERT_SUFFICIENCY_AUDIT",
      generatedAt: boot.generatedAt,
      courtListenerHttpCalls: 0,
      stateGaps: stateGaps.slice(0, 30),
      historicalGaps: histGaps.slice(0, 30),
      invalidMappings: invalidMaps,
      sufficiencyPre: boot.sufficiencyPre,
    },
    null,
    2,
  ),
);

const courts = registry.courts || {};
const skip = new Set(["md", "mich"]);
const proven = ["wash", "nmctapp", "arizctapp", "utahctapp", "wisctapp", "indctapp", "kyctapp", "la"];
const byJ = Object.fromEntries(states.map((x) => [x.jurisdiction, x]));
const plan = [];
function addCourt(clCourt, histCalls, openCalls) {
  if (skip.has(clCourt)) return;
  const c = courts[clCourt];
  if (!c || c.mappingStatus !== "VALID_MAPPED") return;
  if (plan.some((p) => p.clCourt === clCourt)) return;
  const st = byJ[c.jurisdiction] || {};
  const deficit = Number(st.deficit || 0);
  if (deficit < 10 && Number(st.pre2000 || 0) >= HIST_JURIS_MIN_PRE2000) return;
  const prior = 100;
  const targetMax = 280;
  plan.push({
    jurisdiction: c.jurisdiction,
    clCourt,
    courtLevel: c.courtLevel,
    batchSize: "8",
    targetMax: String(targetMax),
    histCalls: String(histCalls),
    openCalls: String(openCalls),
    histGte: "1960-01-01",
    histLte: "1999-12-31",
    tag: `w2cert-${clCourt}`,
    deficit,
    pre2000: Number(st.pre2000 || 0),
    pre1980: Number(st.pre1980 || 0),
    priority:
      (Number(st.pre2000 || 0) < HIST_JURIS_MIN_PRE2000 ? 50 : 0) +
      (Number(st.pre1980 || 0) < HIST_JURIS_MIN_PRE1980 ? 30 : 0) +
      Math.min(deficit, 100),
    remainingCapacity: targetMax - prior,
  });
}
for (const id of proven) addCourt(id, 36, 20);
plan.sort((a, b) => b.priority - a.priority);

const preflight = {
  classification: "WEEK2_FINAL_CERT_PREFLIGHT",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
  skippedKnownBad: [...skip],
  mappingSummary: { clSpent: 0 },
  targetMaxSummary: { cappedBefore: 0, fixed: plan.length, clWasted: 0 },
  laneAPlan: plan.slice(0, 8),
  earlyStopCl: 125,
  secondStopCl: 225,
};
fs.writeFileSync(path.join(REPORTS, "week2-final-cert-preflight.json"), JSON.stringify(preflight, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      safeBudget,
      preferred,
      start: boot.start,
      sufficiencyPre: {
        state: stateFoundationPre,
        historical: histFoundationPre,
        intermediate: boot.sufficiencyPre.intermediateFoundation,
        federal: boot.sufficiencyPre.federalFoundation,
        materialStateAcquirable: acquirableMaterialState.length,
        materialHist: materialHist.length,
      },
      laneAPlan: preflight.laneAPlan.map((p) => `${p.clCourt} hist${p.histCalls}+open${p.openCalls} p=${p.priority}`),
    },
    null,
    2,
  ),
);
process.exit(safeBudget < 50 ? 3 : 0);
