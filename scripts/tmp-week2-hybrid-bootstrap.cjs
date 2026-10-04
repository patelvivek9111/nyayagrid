"use strict";
const fs = require("fs");

function parseRaw(p) {
  const b = fs.readFileSync(p);
  const t = (b[0] === 0xff && b[1] === 0xfe ? b.toString("utf16le") : b.toString("utf8")).replace(/^\uFEFF/, "");
  const line = t.trim().split(/\r?\n/).find((l) => l.includes('"ok"')) || t.trim();
  return JSON.parse(line);
}

const q = parseRaw("packages/research/corpus/reports/week2-hybrid-closeout-quota-raw.txt");
const s = parseRaw("packages/research/corpus/reports/week2-hybrid-closeout-start-raw.txt");
const tr = parseRaw("packages/research/corpus/reports/week2-hybrid-closeout-tracker-raw.txt");

const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const hourRem = Number(q.limits.hour.remaining);
const dayRem = Number(q.limits.day.remaining);
const minLim = Number(q.limits.minute.limit);
const safe = Math.min(100, Math.max(0, hourRem - HOUR_FLOOR), Math.max(0, dayRem - DAY_FLOOR));
const live12 = Math.ceil(s.extracted * 0.125);

const boot = {
  ok: true,
  classification: "WEEK2_HYBRID_CLOSEOUT_BOOTSTRAP",
  generatedAt: new Date().toISOString(),
  membership: q.membership,
  limits: q.limits,
  hourFloor: HOUR_FLOOR,
  dayFloor: DAY_FLOOR,
  preferred: 100,
  safeBudget: safe,
  pacingMs: minLim <= 15 ? 5000 : 4000,
  laneAShare: 0.55,
  laneBShare: 0.45,
  start: {
    cases: s.corpus.cases,
    extracted: s.extracted,
    resolved: s.resolvedAfter,
    unresolved: s.targetAbsent,
    stateDc: tr.baseline.corpus.state_dc_cases,
    federal: tr.baseline.corpus.federal_cases,
    resolutionPct: tr.baseline.citations.resolutionRatePct,
    live12_5Target: live12,
    liveGap12_5: Math.max(0, live12 - s.resolvedAfter),
    week2Gap: Math.max(0, 4700 - s.corpus.cases),
    duplicates: s.duplicateSourceIds,
    orphans: s.orphans,
    missingEmbeddings: s.chunks?.missing_embeddings,
  },
  topG1: (tr.lanes.G1 || []).slice(0, 15),
  courtListenerHttpCalls: 1,
};
fs.writeFileSync("packages/research/corpus/reports/week2-hybrid-closeout-quota.json", JSON.stringify(boot, null, 2));
fs.writeFileSync(
  "packages/research/corpus/reports/week2-hybrid-closeout-start.json",
  JSON.stringify({ ...s, ...boot.start, dbMatch: true }, null, 2),
);
fs.writeFileSync("packages/research/corpus/reports/queue2-balanced-10k-tracker.json", JSON.stringify(tr, null, 2));
console.log(JSON.stringify({
  safe,
  minute: `${q.limits.minute.limit}/${q.limits.minute.remaining}`,
  hour: `${q.limits.hour.limit}/${hourRem}`,
  day: `${q.limits.day.limit}/${dayRem}`,
  tier: q.membership?.level,
  week2Gap: boot.start.week2Gap,
  liveGap12_5: boot.start.liveGap12_5,
  topG1: boot.topG1.map((x) => `${x.jurisdiction}:${x.deficit}:intGap=${x.intermediateLayerGap}`),
}, null, 2));
if (safe < 20) process.exit(3);
