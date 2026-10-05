/**
 * Surgical hist extension: more PRE80 on productive lanes until Week2 cert or budget.
 * Usage: node scripts/run-tmp-week2-surg-hist-extension.cjs [maxCl]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-surg-hist-extension-ops.json");
const MAX = Math.min(Number(process.argv[2] || 80), 100);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 2500);

const LANES = [
  { clCourt: "arizctapp", targetMax: "320", batchSize: "8", tag: "w2surgx-arizctapp", calls: 22 },
  { clCourt: "wisctapp", targetMax: "320", batchSize: "8", tag: "w2surgx-wisctapp", calls: 22 },
  { clCourt: "wash", targetMax: "320", batchSize: "8", tag: "w2surgx-wash", calls: 22 },
  { clCourt: "kyctapp", targetMax: "320", batchSize: "8", tag: "w2surgx-kyctapp", calls: 18 },
  { clCourt: "arizctapp", targetMax: "340", batchSize: "8", tag: "w2surgx2-arizctapp", calls: 20 },
  { clCourt: "wisctapp", targetMax: "340", batchSize: "8", tag: "w2surgx2-wisctapp", calls: 20 },
];

function lastJson(text) {
  const t = String(text || "");
  const idx = t.lastIndexOf('"items_imported"');
  if (idx > 0) {
    const start = t.lastIndexOf("{", idx);
    if (start >= 0) {
      let d = 0;
      for (let k = start; k < t.length; k++) {
        if (t[k] === "{") d++;
        else if (t[k] === "}") {
          d--;
          if (d === 0) {
            try {
              return JSON.parse(t.slice(start, k + 1));
            } catch {
              break;
            }
          }
        }
      }
    }
  }
  const lines = t.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* */
    }
  }
  return null;
}

function flyNode(script, timeoutSec) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-fly-node.cjs"), script], {
    encoding: "utf8",
    maxBuffer: 40e6,
    cwd: ROOT,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec) },
  });
  return lastJson(`${r.stdout || ""}\n${r.stderr || ""}`);
}

function liveSnap() {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-fly-node.cjs"), "scripts/tmp-queue2-manual-cite-integrity-bundled.cjs"], {
    encoding: "utf8",
    maxBuffer: 40e6,
    cwd: ROOT,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: "300" },
  });
  const lines = `${r.stdout || ""}\n${r.stderr || ""}`.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(lines[i]);
      if (j?.corpus?.cases != null) return j;
    } catch {
      /* */
    }
  }
  return null;
}

function liveTracker() {
  return flyNode("scripts/tmp-queue2-balanced-10k-tracker-bundled.cjs", 240);
}

function evaluate(tr, cases) {
  const states = tr?.states || [];
  const intermediate = states.reduce((a, x) => a + Number(x.intermediateAppellate || 0), 0);
  const pre2000 = states.reduce((a, x) => a + Number(x.pre2000 || 0), 0);
  const pre1980 = states.reduce((a, x) => a + Number(x.pre1980 || 0), 0);
  const stateDc = Number(tr?.progress?.stateDcCurrent || 0);
  const federal = Number(tr?.progress?.federalCurrent || 0);
  const statePass = stateDc >= 3450;
  const histPass = pre2000 >= 900 && pre1980 >= 260;
  const usefulPass = cases >= 4700 || (cases >= 4650 && statePass && histPass && intermediate >= 500 && federal >= 1000);
  return {
    cases,
    stateDc,
    federal,
    intermediate,
    pre2000,
    pre1980,
    statePass,
    histPass,
    usefulPass,
    allMaterial: usefulPass && statePass && histPass && intermediate >= 500 && federal >= 1000,
  };
}

function oneshot(step, maxCalls) {
  const env = {
    ...process.env,
    CL_RATE_MS: String(Math.min(CL_RATE_MS, 2500)),
    CL_FLY_EXEC_TIMEOUT_SEC: "720",
    CL_ORPHAN_WAIT_MS: "420000",
    FEATURE_AGENTS: "0",
    CL_KEEP_DATE_FILTER: "1",
    CL_DATE_FILED_GTE: "1900-01-01",
    CL_DATE_FILED_LTE: "1979-12-31",
  };
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/run-tmp-manual-cl-oneshot.cjs"), step.clCourt, step.batchSize, step.targetMax, String(maxCalls), step.tag],
    { encoding: "utf8", maxBuffer: 40e6, cwd: ROOT, env },
  );
  return { text: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}

const prior = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-surg-hist-ops.json"), "utf8"));
const startSnap = liveSnap();
const startTr = liveTracker();
const startCases = Number(startSnap?.corpus?.cases || 4634);
const startEval = evaluate(startTr, startCases);

const acc = {
  classification: "WEEK2_SURGICAL_HISTORICAL_EXTENSION",
  startedAt: new Date().toISOString(),
  priorCl: Number(prior.totalCl || 0),
  maxCl: MAX,
  start: startEval,
  batches: [],
  totalCl: 0,
  casesAdded: 0,
  stopReason: null,
};

process.stdout.write(`SURG_EXT_START max=${MAX} ${JSON.stringify(startEval)}\n`);
if (startEval.allMaterial) {
  acc.stopReason = "ALREADY_CERTIFIED";
  acc.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
  console.log(JSON.stringify(acc));
  process.exit(0);
}

for (const step of LANES) {
  if (acc.stopReason) break;
  if (acc.totalCl >= MAX) break;
  const n = Math.min(step.calls, MAX - acc.totalCl);
  if (n < 10) break;
  const before = liveSnap();
  const casesBefore = Number(before?.corpus?.cases || startCases + acc.casesAdded);
  process.stdout.write(`\n=== EXT_PRE80 ${step.clCourt} max=${n} casesBefore=${casesBefore} ===\n`);
  const r = oneshot(step, n);
  const j = r.json;
  const cl = Number(j?.sessionApiCalls ?? j?.apiCallsDelta ?? j?.apiCalls ?? 0) || 0;
  const after = liveSnap();
  const casesAfter = Number(after?.corpus?.cases || casesBefore);
  const delta = Math.max(0, casesAfter - casesBefore);
  acc.totalCl += cl;
  acc.casesAdded += delta;
  const tr = liveTracker();
  const ev = evaluate(tr, casesAfter);
  const row = { clCourt: step.clCourt, cl, liveDelta: delta, ...ev, reason: j?.reason || null };
  acc.batches.push(row);
  process.stdout.write(JSON.stringify(row) + "\n");
  if (ev.allMaterial) {
    acc.stopReason = "CERTIFIED_EARLY_EXT";
    break;
  }
  if (delta === 0 && cl <= 2) {
    process.stdout.write(`SKIP_EXHAUSTED ${step.clCourt}\n`);
  }
}

if (!acc.stopReason) {
  const tr = liveTracker();
  const snap = liveSnap();
  const ev = evaluate(tr, Number(snap?.corpus?.cases || startCases + acc.casesAdded));
  acc.end = ev;
  acc.stopReason = ev.allMaterial ? "CERTIFIED_END" : "EXT_BUDGET_OR_PLAN";
} else {
  const tr = liveTracker();
  const snap = liveSnap();
  acc.end = evaluate(tr, Number(snap?.corpus?.cases || startCases + acc.casesAdded));
}

acc.finishedAt = new Date().toISOString();
acc.combinedCl = Number(prior.totalCl || 0) + acc.totalCl;
fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));

// Merge into main ops for finalize
prior.extension = acc;
prior.totalCl = acc.combinedCl;
prior.laneA.cl = Number(prior.laneA?.cl || 0) + acc.totalCl;
prior.laneA.casesAdded = Number(prior.laneA?.casesAdded || 0) + acc.casesAdded;
prior.laneA.histCases = Number(prior.laneA?.histCases || 0) + acc.casesAdded;
prior.endCases = acc.end?.cases;
prior.stopReason = acc.stopReason;
prior.finishedAt = acc.finishedAt;
for (const b of acc.batches) {
  prior.laneA.batches.push({
    clCourt: b.clCourt,
    phase: "PRE80_EXT",
    window: "1900-01-01..1979-12-31",
    cl: b.cl,
    liveDelta: b.liveDelta,
    reason: b.reason,
  });
  if (!prior.laneA.perLane[b.clCourt]) {
    prior.laneA.perLane[b.clCourt] = { cl: 0, cases: 0, pre2000: 0, pre1980: 0, state: 0, decision: "continue" };
  }
  prior.laneA.perLane[b.clCourt].cl += b.cl;
  prior.laneA.perLane[b.clCourt].cases += b.liveDelta;
}
fs.writeFileSync(path.join(REPORTS, "week2-surg-hist-ops.json"), JSON.stringify(prior, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-surg-hist-checkpoint.json"), JSON.stringify(prior, null, 2));

process.stdout.write(
  `SURG_EXT_DONE ${JSON.stringify({
    extCl: acc.totalCl,
    combinedCl: acc.combinedCl,
    casesAdded: acc.casesAdded,
    stop: acc.stopReason,
    end: acc.end,
  })}\n`,
);
process.exit(acc.end?.allMaterial ? 0 : 0);
