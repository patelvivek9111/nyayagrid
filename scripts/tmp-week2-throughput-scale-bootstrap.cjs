/**
 * Week 2 Throughput Scale — bootstrap from one quota + live snapshot + tracker.
 * Zero CL beyond the single quota probe already captured in raw files.
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

const q = parse(path.join(REPORTS, "week2-throughput-scale-quota-raw.txt"));
const s = parse(path.join(REPORTS, "week2-throughput-scale-start-raw.txt"), '{"ok":true,"courtListenerHttpCalls"');
const tr = parse(
  path.join(REPORTS, "week2-throughput-scale-tracker-raw.txt"),
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
const preferred = Math.min(260, safeBudget);
const throughputMode = safeBudget >= 200;
const reducedMode = safeBudget >= 100 && safeBudget < 200;
const live12 = Math.ceil(s.extracted * 0.125);

const laneAShare = 0.84;
const laneBShare = 0.16;

const boot = {
  ok: true,
  classification: "WEEK2_THROUGHPUT_SCALE_BOOTSTRAP",
  generatedAt: new Date().toISOString(),
  membership: q.membership,
  limits: q.limits,
  hourFloor: HOUR_FLOOR,
  dayFloor: DAY_FLOOR,
  targetMaxCl: TARGET_MAX_CL,
  safeHourBudget: safeHour,
  safeDayBudget: safeDay,
  safeBudget,
  preferred,
  throughputMode,
  reducedMode,
  pacingMs: minLim <= 15 ? 5000 : 4000,
  laneAShare,
  laneBShare,
  start: {
    cases: s.corpus.cases,
    extracted: s.extracted,
    resolved: s.resolvedAfter,
    unresolved: s.targetAbsent,
    stateDc: tr.progress.stateDcCurrent,
    federal: tr.progress.federalCurrent,
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

fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-quota.json"), JSON.stringify(boot, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-start.json"), JSON.stringify({ ok: true, ...boot.start }, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-tracker.json"), JSON.stringify(tr, null, 2));
fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tr, null, 2));

const byJ = Object.fromEntries((tr.states || []).map((x) => [x.jurisdiction, x]));
const courts = registry.courts || {};
const proven = ["wisctapp", "indctapp", "utahctapp", "kyctapp", "la", "wash", "md", "mich"];
const plan = [];

function addCourt(clCourt, scaleCalls, extendCalls) {
  const c = courts[clCourt];
  if (!c || c.mappingStatus !== "VALID_MAPPED") return;
  if (plan.some((p) => p.clCourt === clCourt)) return;
  const st = byJ[c.jurisdiction] || {};
  const deficit = Number(st.deficit || 0);
  if (deficit < 20 && !["wisctapp", "indctapp", "utahctapp", "kyctapp"].includes(clCourt)) return;
  const prior = Number.isFinite(Number(c.priorItemsImported)) ? Math.min(Number(c.priorItemsImported), 140) : 50;
  const targetMax = Math.min(260, Math.max(prior + 100, 200));
  plan.push({
    jurisdiction: c.jurisdiction,
    clCourt,
    courtLevel: c.courtLevel,
    batchSize: "8",
    targetMax: String(targetMax),
    scaleCalls: String(scaleCalls),
    extendCalls: String(extendCalls),
    tag: `w2ts-${clCourt}`,
    deficit,
    intermediateLayerGap: Boolean(st.intermediateLayerGap),
    itemsImportedEstimate: prior,
    remainingCapacity: Math.max(0, targetMax - prior),
  });
}

for (const id of proven) addCourt(id, 28, 22);
for (const id of ["arizctapp", "nmctapp", "connappct", "calctapp", "pasuperct", "illappct", "massappct"]) {
  addCourt(id, 12, 0); // micro-pilot only if reached
}

const preflight = {
  classification: "WEEK2_THROUGHPUT_SCALE_PREFLIGHT",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
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
fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-preflight.json"), JSON.stringify(preflight, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      safeBudget,
      preferred,
      throughputMode,
      reducedMode,
      tier: q.membership?.level,
      minute: q.limits.minute,
      hour: q.limits.hour,
      day: { limit: q.limits.day.limit, remaining: dayRem },
      start: boot.start,
      laneAPlan: preflight.laneAPlan.map((p) => `${p.clCourt}@${p.targetMax}(scale${p.scaleCalls}+ext${p.extendCalls})`),
    },
    null,
    2,
  ),
);
process.exit(safeBudget < 50 ? 3 : 0);
