/**
 * Week 2 Final Closeout — bootstrap from one quota + start + tracker.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const TARGET_MAX_CL = 275;

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

const q = parse(path.join(REPORTS, "week2-final-closeout-quota-raw.txt"));
const s = parse(path.join(REPORTS, "week2-final-closeout-start-raw.txt"), '{"ok":true,"courtListenerHttpCalls"');
const tr = parse(
  path.join(REPORTS, "week2-final-closeout-tracker-raw.txt"),
  '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"',
);
if (!q || !s || !tr) {
  console.log(JSON.stringify({ ok: false, q: !!q, s: !!s, tr: !!tr }));
  process.exit(2);
}

const registry = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));
const hourRem = Number(q.limits.hour.remaining);
const dayRem = Number(q.limits.day.remaining);
const minLim = Number(q.limits.minute.limit);
const safeHour = Math.max(0, hourRem - HOUR_FLOOR);
const safeDay = Math.max(0, dayRem - DAY_FLOOR);
const safeBudget = Math.min(safeHour, safeDay, TARGET_MAX_CL);
const preferred = Math.min(270, safeBudget);
const closeoutMode = safeBudget >= 225;
const reducedMode = safeBudget >= 100 && safeBudget < 225;
const live12 = Math.ceil(s.extracted * 0.125);

const states = tr.states || [];
const byJ = Object.fromEntries(states.map((x) => [x.jurisdiction, x]));
const intermediateStart = states.reduce((a, x) => a + Number(x.intermediateAppellate || 0), 0);
const pre2000Start = states.reduce((a, x) => a + Number(x.pre2000 || 0), 0);
const pre1980Start = states.reduce((a, x) => a + Number(x.pre1980 || 0), 0);

const boot = {
  ok: true,
  classification: "WEEK2_FINAL_CLOSEOUT_BOOTSTRAP",
  generatedAt: new Date().toISOString(),
  membership: q.membership,
  limits: q.limits,
  hourFloor: HOUR_FLOOR,
  dayFloor: DAY_FLOOR,
  safeHourBudget: safeHour,
  safeDayBudget: safeDay,
  safeBudget,
  preferred,
  closeoutMode,
  reducedMode,
  pacingMs: minLim <= 15 ? 5000 : 4000,
  laneAShare: 0.9,
  laneBShare: 0.1,
  reservedLaneBCl: Math.max(24, Math.round(preferred * 0.1)),
  start: {
    cases: s.corpus.cases,
    extracted: s.extracted,
    resolved: s.resolvedAfter,
    unresolved: s.targetAbsent,
    stateDc: tr.progress.stateDcCurrent,
    federal: tr.progress.federalCurrent,
    intermediate: intermediateStart,
    pre2000: pre2000Start,
    pre1980: pre1980Start,
    resolutionPct: Number(((s.resolvedAfter / s.extracted) * 100).toFixed(2)),
    live12_5Target: live12,
    liveGap12_5: Math.max(0, live12 - s.resolvedAfter),
    week2Gap: Math.max(0, 4700 - s.corpus.cases),
    duplicates: s.duplicateSourceIds,
    orphans: s.orphans,
    missingEmbeddings: s.chunks?.missing_embeddings,
  },
  courtListenerHttpCalls: 1,
};
fs.writeFileSync(path.join(REPORTS, "week2-final-closeout-quota.json"), JSON.stringify(boot, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-final-closeout-start.json"), JSON.stringify({ ok: true, ...boot.start }, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-final-closeout-tracker.json"), JSON.stringify(tr, null, 2));
fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tr, null, 2));

const courts = registry.courts || {};
const skip = new Set(["md", "mich"]); // known stop
const proven = ["wisctapp", "indctapp", "utahctapp", "kyctapp", "wash", "la", "arizctapp", "nmctapp"];
const plan = [];

function score(st, courtLevel) {
  const deficit = Number(st.deficit || 0);
  const intermediate = courtLevel?.includes("appellate") ? 40 : st.intermediateLayerGap ? 10 : 0;
  const hist = Number(st.pre2000 || 0) < 20 ? 30 : Number(st.pre1980 || 0) < 5 ? 20 : 5;
  return deficit + intermediate + hist;
}

function addCourt(clCourt, histCalls, openCalls) {
  if (skip.has(clCourt)) return;
  const c = courts[clCourt];
  if (!c || c.mappingStatus !== "VALID_MAPPED") return;
  if (plan.some((p) => p.clCourt === clCourt)) return;
  const st = byJ[c.jurisdiction] || {};
  const deficit = Number(st.deficit || 0);
  if (deficit < 15) return;
  const prior = Number.isFinite(Number(c.priorItemsImported)) ? Math.min(Number(c.priorItemsImported) + 40, 180) : 80;
  const targetMax = Math.min(280, Math.max(prior + 120, 240));
  plan.push({
    jurisdiction: c.jurisdiction,
    clCourt,
    courtLevel: c.courtLevel,
    batchSize: "8",
    targetMax: String(targetMax),
    histCalls: String(histCalls),
    openCalls: String(openCalls),
    histGte: "1970-01-01",
    histLte: "1999-12-31",
    tag: `w2fc-${clCourt}`,
    deficit,
    pre2000: Number(st.pre2000 || 0),
    pre1980: Number(st.pre1980 || 0),
    intermediateLayerGap: Boolean(st.intermediateLayerGap),
    priorityScore: score(st, c.courtLevel),
    itemsImportedEstimate: prior,
    remainingCapacity: Math.max(0, targetMax - prior),
  });
}

for (const id of proven) addCourt(id, 32, 24);
const provenPlan = [...plan];
for (const id of ["connappct", "calctapp", "pasuperct", "illappct", "massappct"]) addCourt(id, 20, 0);
// Proven continue winners first (already validated yield), then higher-score hist explorers.
const explorers = plan.filter((p) => !proven.includes(p.clCourt)).sort((a, b) => b.priorityScore - a.priorityScore);
plan.length = 0;
plan.push(...provenPlan.sort((a, b) => b.priorityScore - a.priorityScore), ...explorers);

const preflight = {
  classification: "WEEK2_FINAL_CLOSEOUT_PREFLIGHT",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
  skippedKnownBad: [...skip],
  mappingSummary: {
    VALID_MAPPED: Object.values(courts).filter((c) => c.mappingStatus === "VALID_MAPPED").length,
    INVALID_MAPPING: Object.values(courts).filter((c) => c.mappingStatus === "INVALID_MAPPING").length,
    UNKNOWN_MAPPING: Object.values(courts).filter((c) => c.mappingStatus === "UNKNOWN_MAPPING").length,
    clSpent: 0,
  },
  targetMaxSummary: {
    cappedBefore: plan.filter((p) => p.remainingCapacity <= 0).length,
    fixed: plan.filter((p) => p.remainingCapacity > 0).length,
    clWasted: 0,
  },
  laneAPlan: plan.filter((p) => p.remainingCapacity > 0).slice(0, 10),
};
fs.writeFileSync(path.join(REPORTS, "week2-final-closeout-preflight.json"), JSON.stringify(preflight, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      safeBudget,
      preferred,
      closeoutMode,
      reservedLaneBCl: boot.reservedLaneBCl,
      start: boot.start,
      laneAPlan: preflight.laneAPlan.map(
        (p) => `${p.clCourt}@${p.targetMax}(hist${p.histCalls}+open${p.openCalls}) score=${p.priorityScore}`,
      ),
    },
    null,
    2,
  ),
);
process.exit(safeBudget < 50 ? 3 : 0);
