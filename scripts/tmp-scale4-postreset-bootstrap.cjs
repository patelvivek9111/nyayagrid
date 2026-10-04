"use strict";
const fs = require("fs");

function parseRaw(p) {
  const b = fs.readFileSync(p);
  const t = (b[0] === 0xff && b[1] === 0xfe ? b.toString("utf16le") : b.toString("utf8")).replace(/^\uFEFF/, "");
  const line = t.trim().split(/\r?\n/).find((l) => l.includes('"ok"')) || t.trim();
  if (line.startsWith("{")) {
    try { return JSON.parse(line); } catch { /* fall through */ }
  }
  const i = t.lastIndexOf('{"ok":true');
  if (i < 0) throw new Error("no json " + p);
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

const quota = parseRaw("packages/research/corpus/reports/queue2-cite-demand-scale4-postreset-quota-raw.txt");
const start = parseRaw("packages/research/corpus/reports/queue2-cite-demand-scale4-postreset-start-raw.txt");
const ops = JSON.parse(fs.readFileSync("packages/research/corpus/reports/queue2-cite-demand-scale4-ops.json", "utf8"));
const blockA = JSON.parse(fs.readFileSync("packages/research/corpus/reports/queue2-cite-demand-scale4-block-a.json", "utf8"));

const hourRem = Number(quota.limits.hour.remaining);
const dayRem = Number(quota.limits.day.remaining);
const minRem = Number(quota.limits.minute.remaining);
const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const desiredAdd = 125;
const safeAdd = Math.min(desiredAdd, Math.max(0, hourRem - HOUR_FLOOR), Math.max(0, dayRem - DAY_FLOOR));
const priorCl = Number(ops.totalCl || 0);
const targetBudget = priorCl + safeAdd;

const dbMatch =
  Number(start.corpus?.cases) === Number(ops.endCases) &&
  Number(start.resolvedAfter) === Number(ops.endResolved) &&
  Number(start.extracted) === Number(ops.endExtracted) &&
  priorCl === Number(blockA.totalCl) &&
  Number(ops.targetsAcquired) === Number(blockA.acquired);

const liveTen = Math.ceil(0.1 * start.extracted);
const liveGap = liveTen - start.resolvedAfter;

const out = {
  ok: true,
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_POSTRESET_BOOTSTRAP",
  generatedAt: new Date().toISOString(),
  dbMatch,
  membership: quota.membership || null,
  limits: quota.limits,
  hourFloor: HOUR_FLOOR,
  dayFloor: DAY_FLOOR,
  priorCl,
  desiredAdd,
  safeAdd,
  targetBudget,
  pacingMs: 5000,
  start: {
    cases: start.corpus?.cases,
    extracted: start.extracted,
    resolved: start.resolvedAfter,
    unresolved: start.targetAbsent,
    resolutionPct: +((start.resolvedAfter / start.extracted) * 100).toFixed(2),
    liveTenPercentTarget: liveTen,
    liveRemainingTo10: liveGap,
    duplicates: start.duplicateSourceIds,
    orphans: start.orphans,
    missingEmbeddings: start.chunks?.missing_embeddings,
  },
};
fs.writeFileSync(
  "packages/research/corpus/reports/queue2-cite-demand-scale4-postreset-quota.json",
  JSON.stringify(out, null, 2),
);
fs.writeFileSync(
  "packages/research/corpus/reports/queue2-cite-demand-scale4-postreset-start.json",
  JSON.stringify({ ...start, liveTenPercentTarget: liveTen, liveRemainingTo10: liveGap, dbMatch }, null, 2),
);
console.log(JSON.stringify(out, null, 2));
if (!dbMatch) process.exit(2);
if (safeAdd < 20) process.exit(3);
