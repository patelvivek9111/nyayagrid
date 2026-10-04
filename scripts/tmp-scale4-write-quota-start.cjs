"use strict";
const fs = require("fs");

const q = {
  ok: true,
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_QUOTA",
  generatedAt: new Date().toISOString(),
  membership: { level: "CL Membership - Tier 2", is_active: true },
  limits: {
    minute: { limit: 15, usage: 0, remaining: 15, blocked: false },
    hour: { limit: 150, usage: 0, remaining: 150, blocked: false },
    day: {
      limit: 600,
      usage: 524,
      remaining: 76,
      reset_at: "2026-10-03T22:02:34.920900+00:00",
      blocked: false,
    },
  },
  hourFloor: 25,
  dayFloor: 50,
  preferred: 100,
  safeBudgetNow: 26,
  pacingMs: 5000,
  courtListenerHttpCalls: 1,
  dayResetAt: "2026-10-03T22:02:34.920900+00:00",
  note: "Day rem 76 supports only 26 CL under floor 50; full 100 after day reset",
};
fs.writeFileSync(
  "packages/research/corpus/reports/queue2-cite-demand-scale4-quota.json",
  JSON.stringify(q, null, 2),
);

const b = fs.readFileSync("packages/research/corpus/reports/queue2-cite-demand-scale4-start-raw.txt");
const t = (b[0] === 0xff && b[1] === 0xfe ? b.toString("utf16le") : b.toString("utf8")).replace(/^\uFEFF/, "");
const line = t
  .trim()
  .split(/\r?\n/)
  .find((l) => l.includes('"ok"')) || t.trim();
const start = JSON.parse(line);
const liveTen = Math.ceil(0.1 * start.extracted);
const liveGap = liveTen - start.resolvedAfter;
const snap = {
  ...start,
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_START",
  liveTenPercentTarget: liveTen,
  liveRemainingTo10: liveGap,
  startingGap: liveGap,
  resolutionPct: +((start.resolvedAfter / start.extracted) * 100).toFixed(2),
};
fs.writeFileSync(
  "packages/research/corpus/reports/queue2-cite-demand-scale4-start.json",
  JSON.stringify(snap, null, 2),
);

const s = fs.readFileSync("scripts/run-tmp-queue2-cite-demand-scale4.cjs", "utf8");
console.log(JSON.stringify({
  safe: 26,
  liveGap,
  cases: start.corpus.cases,
  resolved: start.resolvedAfter,
  extracted: start.extracted,
  runner: {
    usDom: s.includes("US-dominant"),
    live10: s.includes("liveTenPercentTarget"),
    fedOff: s.includes('federal_reporter") continue'),
    budget: s.includes("CITE_SCALE4_BUDGET"),
  },
}, null, 2));
