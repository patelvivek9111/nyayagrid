"use strict";
const fs = require("node:fs");
const path = require("node:path");

const REPORTS = path.join(__dirname, "..", "packages/research/corpus/reports");

function read(p) {
  const b = fs.readFileSync(p);
  if (b[0] === 0xff && b[1] === 0xfe) return b.toString("utf16le");
  if (b.includes(0) && b[1] === 0) return b.toString("utf16le");
  return b.toString("utf8");
}

function parse(p, needle) {
  const t = read(p);
  const i = needle ? t.lastIndexOf(needle) : t.lastIndexOf('{"ok":true');
  if (i < 0) {
    console.log("FAIL_PARSE", path.basename(p), t.slice(-300));
    return null;
  }
  let d = 0;
  for (let k = i; k < t.length; k++) {
    if (t[k] === "{") d++;
    else if (t[k] === "}") {
      d--;
      if (d === 0) return JSON.parse(t.slice(i, k + 1));
    }
  }
  return null;
}

const q = parse(path.join(REPORTS, "week2-hybrid-closeout-run2-quota-raw.txt"));
const s = parse(path.join(REPORTS, "week2-hybrid-closeout-run2-start-raw.txt"));
const tr = parse(
  path.join(REPORTS, "week2-hybrid-closeout-run2-tracker-raw.txt"),
  '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"',
);
if (!q || !s || !tr) process.exit(2);

const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const hourRem = Number(q.limits.hour.remaining);
const dayRem = Number(q.limits.day.remaining);
const minLim = Number(q.limits.minute.limit);
const safe = Math.min(100, Math.max(0, hourRem - HOUR_FLOOR), Math.max(0, dayRem - DAY_FLOOR));
const live12 = Math.ceil(s.extracted * 0.125);

const boot = {
  ok: true,
  classification: "WEEK2_HYBRID_CLOSEOUT_RUN2_BOOTSTRAP",
  generatedAt: new Date().toISOString(),
  membership: q.membership,
  limits: q.limits,
  hourFloor: HOUR_FLOOR,
  dayFloor: DAY_FLOOR,
  preferred: 100,
  safeBudget: safe,
  pacingMs: minLim <= 15 ? 5000 : 4000,
  laneAShare: 0.7,
  laneBShare: 0.3,
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

fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-quota.json"), JSON.stringify(boot, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-start.json"), JSON.stringify({ ok: true, ...boot.start }, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-tracker.json"), JSON.stringify(tr, null, 2));
fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tr, null, 2));

console.log(
  JSON.stringify(
    {
      safe,
      tier: q.membership?.level,
      minute: q.limits.minute,
      hour: q.limits.hour,
      day: { limit: q.limits.day.limit, remaining: dayRem, reset: q.limits.day.reset_at },
      start: boot.start,
    },
    null,
    2,
  ),
);
process.exit(safe < 20 ? 3 : 0);
