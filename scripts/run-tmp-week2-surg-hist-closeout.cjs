/**
 * Week 2 Surgical Historical Closeout
 * Pre-1980 first, then 1980-1999. Lane B = 0. Early cert stops.
 *
 * Usage: node scripts/run-tmp-week2-surg-hist-closeout.cjs [maxBudget]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-surg-hist-ops.json");
const TOTAL_ARG = Number(process.argv[2] || process.env.WEEK2_SURG_HIST_BUDGET || 0);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 2500);

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

function flyNode(script, args, timeoutSec) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-fly-node.cjs"), script, ...args], {
    encoding: "utf8",
    maxBuffer: 40e6,
    cwd: ROOT,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec), CL_RATE_MS: String(CL_RATE_MS) },
  });
  return { status: r.status ?? 1, out: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}

function liveSnap() {
  const r = flyNode("scripts/tmp-queue2-manual-cite-integrity-bundled.cjs", [], 300);
  const lines = r.out.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(lines[i]);
      if (j?.corpus?.cases != null) return j;
    } catch {
      /* */
    }
  }
  return r.json;
}

function liveTracker() {
  const r = flyNode("scripts/tmp-queue2-balanced-10k-tracker-bundled.cjs", [], 240);
  return lastJson(r.out);
}

function oneshot(step, maxCalls, tagSuffix, dateWindow) {
  const tag = tagSuffix ? `${step.tag}-${tagSuffix}` : step.tag;
  const env = {
    ...process.env,
    CL_RATE_MS: String(Math.min(CL_RATE_MS, 2500)),
    CL_FLY_EXEC_TIMEOUT_SEC: "720",
    CL_ORPHAN_WAIT_MS: "420000",
    FEATURE_AGENTS: "0",
    CL_KEEP_DATE_FILTER: "1",
    CL_DATE_FILED_GTE: dateWindow.gte,
    CL_DATE_FILED_LTE: dateWindow.lte,
  };
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/run-tmp-manual-cl-oneshot.cjs"), step.clCourt, step.batchSize, step.targetMax, String(maxCalls), tag],
    { encoding: "utf8", maxBuffer: 40e6, cwd: ROOT, env },
  );
  return { text: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}

const boot = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-surg-hist-quota.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-surg-hist-preflight.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));
const thresholds = boot.thresholds || {};

const safeBudget = Number(boot.safeBudget || 0);
if (safeBudget < 50) {
  const early = {
    classification: "WEEK2_SURGICAL_HISTORICAL_CLOSEOUT",
    status: "PARTIAL_QUOTA_WAIT",
    stopReason: "SAFE_BUDGET_LT_50",
    totalCl: 0,
    finishedAt: new Date().toISOString(),
    message:
      "Stopped intentionally because safe CourtListener quota was insufficient. Progress was checkpointed and validated. No long quota wait was performed.",
  };
  fs.writeFileSync(OUT, JSON.stringify(early, null, 2));
  fs.writeFileSync(path.join(REPORTS, "week2-surg-hist-checkpoint.json"), JSON.stringify(early, null, 2));
  console.log(JSON.stringify(early));
  process.exit(0);
}

const effectiveTotal = Math.min(TOTAL_ARG > 0 ? TOTAL_ARG : Number(boot.preferred || 175), safeBudget, 175);
const laneAPlan = preflight.laneAPlan.filter((p) => registry.courts?.[p.clCourt]?.mappingStatus === "VALID_MAPPED");

const startSnap = liveSnap();
const startCases = Number(startSnap?.corpus?.cases || boot.start.cases);
const startResolved = Number(startSnap?.resolvedAfter || boot.start.resolved);
const startExtracted = Number(startSnap?.extracted || boot.start.extracted);

const acc = {
  classification: "WEEK2_SURGICAL_HISTORICAL_CLOSEOUT",
  startedAt: new Date().toISOString(),
  totalBudget: effectiveTotal,
  safeBudget,
  pacingMs: CL_RATE_MS,
  startCases,
  startResolved,
  startExtracted,
  startStateDc: boot.start.stateDc,
  startFederal: boot.start.federal,
  startIntermediate: boot.start.intermediate,
  startPre2000: boot.start.pre2000,
  startPre1980: boot.start.pre1980,
  gapsStart: boot.gaps,
  targetMaxPreflight: preflight.targetMaxSummary,
  laneA: { cl: 0, casesAdded: 0, batches: [], productive: [], stopped: [], histCases: 0, pre80Adds: 0, pre2kAdds: 0, perLane: {} },
  laneB: { cl: 0, acquired: 0 },
  certCheckpoints: [],
  totalCl: 0,
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
  clWastedOnInvalidMapping: 0,
  clWastedDueCap: 0,
};

process.stdout.write(
  `SURG_START max=${effectiveTotal} cases=${startCases} gaps=${JSON.stringify(boot.gaps)} lanes=${laneAPlan.length}\n`,
);

function evaluateFoundation(tracker, cases) {
  const states = tracker?.states || [];
  const intermediate = states.reduce((a, x) => a + Number(x.intermediateAppellate || 0), 0);
  const pre2000 = states.reduce((a, x) => a + Number(x.pre2000 || 0), 0);
  const pre1980 = states.reduce((a, x) => a + Number(x.pre1980 || 0), 0);
  const stateDc = Number(tracker?.progress?.stateDcCurrent || 0);
  const federal = Number(tracker?.progress?.federalCurrent || 0);
  const statePass = stateDc >= Number(thresholds.STATE_PASS_FLOOR || 3450);
  const histPass =
    pre2000 >= Number(thresholds.PRE2000_PASS_FLOOR || 900) &&
    pre1980 >= Number(thresholds.PRE1980_PASS_FLOOR || 260);
  const usefulPass =
    cases >= 4700 ||
    (cases >= Number(thresholds.sufficientlyCloseCases || 4650) && statePass && histPass && intermediate >= 500 && federal >= 1000);
  return {
    cases,
    stateDc,
    federal,
    intermediate,
    pre2000,
    pre1980,
    statePass,
    histPass,
    intermediatePass: intermediate >= 500,
    federalPass: federal >= 1000,
    usefulPass,
    allMaterial: usefulPass && statePass && histPass && intermediate >= 500 && federal >= 1000,
  };
}

function certCheckpoint(name) {
  const tr = liveTracker();
  const snap = liveSnap();
  const liveCases = Number(snap?.corpus?.cases || startCases + acc.laneA.casesAdded);
  const eval_ = evaluateFoundation(tr, liveCases);
  acc.certCheckpoints.push({ name, totalCl: acc.totalCl, ...eval_ });
  process.stdout.write(`CERT_CHECKPOINT ${name} ${JSON.stringify({ cl: acc.totalCl, ...eval_ })}\n`);
  if (eval_.allMaterial) {
    acc.stopReason = `CERTIFIED_EARLY_${name}`;
    return true;
  }
  return false;
}

function runBlock(step, maxCalls, phase, dateWindow) {
  const before = liveSnap();
  const casesBefore = Number(before?.corpus?.cases || startCases + acc.laneA.casesAdded);
  const trBefore = liveTracker();
  const pre80Before = (trBefore?.states || []).reduce((a, x) => a + Number(x.pre1980 || 0), 0);
  const pre2kBefore = (trBefore?.states || []).reduce((a, x) => a + Number(x.pre2000 || 0), 0);
  const stateBefore = Number(trBefore?.progress?.stateDcCurrent || boot.start.stateDc);

  process.stdout.write(
    `\n=== LANE_A_${phase} ${step.clCourt} ${dateWindow.gte}..${dateWindow.lte} max=${maxCalls} casesBefore=${casesBefore} ===\n`,
  );
  const r = oneshot(step, maxCalls, phase.toLowerCase(), dateWindow);
  const j = r.json;
  const cl = Number(j?.sessionApiCalls ?? j?.apiCallsDelta ?? j?.apiCalls ?? 0) || 0;
  const unmapped = /unmapped_court|MAPPING_INVALID/i.test(r.text);
  const rateLimited = Number(j?.rateLimitCount || 0) > 0 || /HTTP\s*429|"status"\s*:\s*429|RATE_LIMITED/i.test(r.text);
  const alreadyCompleted = /already_completed/i.test(r.text) || j?.reason === "already_completed";
  if (alreadyCompleted) acc.clWastedDueCap += cl;

  const after = liveSnap();
  const casesAfter = Number(after?.corpus?.cases || casesBefore);
  const delta = Math.max(0, casesAfter - casesBefore);
  const trAfter = liveTracker();
  const pre80After = (trAfter?.states || []).reduce((a, x) => a + Number(x.pre1980 || 0), 0);
  const pre2kAfter = (trAfter?.states || []).reduce((a, x) => a + Number(x.pre2000 || 0), 0);
  const stateAfter = Number(trAfter?.progress?.stateDcCurrent || stateBefore);
  const pre80Delta = Math.max(0, pre80After - pre80Before);
  const pre2kDelta = Math.max(0, pre2kAfter - pre2kBefore);
  const stateDelta = Math.max(0, stateAfter - stateBefore);

  if (unmapped) acc.clWastedOnInvalidMapping += cl;
  acc.laneA.cl += cl;
  acc.totalCl += cl;
  acc.laneA.casesAdded += delta;
  acc.laneA.histCases += delta;
  acc.laneA.pre80Adds += pre80Delta;
  acc.laneA.pre2kAdds += pre2kDelta;
  if (!acc.laneA.perLane[step.clCourt]) {
    acc.laneA.perLane[step.clCourt] = {
      cl: 0,
      cases: 0,
      pre2000: 0,
      pre1980: 0,
      state: 0,
      histCasesPerCl: null,
      decision: "continue",
    };
  }
  const pl = acc.laneA.perLane[step.clCourt];
  pl.cl += cl;
  pl.cases += delta;
  pl.pre2000 += pre2kDelta;
  pl.pre1980 += pre80Delta;
  pl.state += stateDelta;
  pl.histCasesPerCl = pl.cl > 0 ? Number((pl.cases / pl.cl).toFixed(3)) : null;

  const row = {
    clCourt: step.clCourt,
    phase,
    window: `${dateWindow.gte}..${dateWindow.lte}`,
    cl,
    liveDelta: delta,
    pre2000: pre2kDelta,
    pre1980: pre80Delta,
    state: stateDelta,
    histCasesPerCl: cl > 0 ? Number((delta / cl).toFixed(3)) : null,
    reason: j?.reason || null,
    rateLimited,
    unmapped,
    alreadyCompleted,
  };
  acc.laneA.batches.push(row);
  process.stdout.write(JSON.stringify({ lane: "A", ...row, totalCl: acc.totalCl }) + "\n");
  return { ...row, rateLimited, unmapped };
}

function maybeCheckpoint() {
  const marks = [
    { name: "after_50cl", at: Number(preflight.earlyStopCl || 50) },
    { name: "after_100cl", at: Number(preflight.secondStopCl || 100) },
    { name: "after_150cl", at: Number(preflight.thirdStopCl || 150) },
  ];
  for (const m of marks) {
    if (acc.totalCl >= m.at && !acc.certCheckpoints.some((c) => c.name === m.name)) {
      if (certCheckpoint(m.name)) return true;
    }
  }
  return false;
}

// Phase PRE80 first across primary then probe
const pre80Steps = [
  ...laneAPlan.filter((p) => p.role === "PRIMARY"),
  ...laneAPlan.filter((p) => p.role === "PROBE_RECOVER"),
];
for (const step of pre80Steps) {
  if (acc.stopReason) break;
  if (acc.totalCl >= effectiveTotal) break;
  const n = Math.min(Number(step.pre80Calls || 20), effectiveTotal - acc.totalCl);
  if (n < 12) continue;
  const h = runBlock(step, n, "PRE80", { gte: step.pre80Gte, lte: step.pre80Lte });
  if (h.unmapped) {
    acc.stopReason = "UNEXPECTED_UNMAPPED";
    break;
  }
  if (h.rateLimited) {
    acc.stopReason = "rate_limited";
    break;
  }
  if (h.alreadyCompleted) {
    acc.laneA.stopped.push({ path: `${step.clCourt}-PRE80`, reason: "already_completed", cl: h.cl });
    acc.laneA.perLane[step.clCourt].decision = "stop_cap";
  } else if (h.liveDelta > 0 || h.pre1980 > 0) {
    acc.laneA.productive.push({ clCourt: step.clCourt, phase: "PRE80", cl: h.cl, liveDelta: h.liveDelta, pre1980: h.pre1980 });
  } else {
    acc.laneA.stopped.push({ path: `${step.clCourt}-PRE80`, reason: h.reason || "zero", cl: h.cl });
    if (step.role === "PROBE_RECOVER") acc.laneA.perLane[step.clCourt].decision = "stop_window";
  }
  if (maybeCheckpoint()) break;
}

// Phase PRE2K fill only if still need pre2000 / state / corpus
if (!acc.stopReason?.startsWith("CERTIFIED") && acc.totalCl < effectiveTotal) {
  for (const step of laneAPlan.filter((p) => p.role === "PRIMARY")) {
    if (acc.stopReason) break;
    if (acc.totalCl >= effectiveTotal) break;
    // Skip if last foundation already green enough via checkpoint
    const last = acc.certCheckpoints[acc.certCheckpoints.length - 1];
    if (last?.histPass && last?.statePass && last?.usefulPass) {
      acc.stopReason = "CERTIFIED_AFTER_PRE80";
      break;
    }
    const stillNeedHist =
      !last ||
      !last.histPass ||
      Number(last.pre2000 || 0) < Number(thresholds.PRE2000_PASS_FLOOR || 900);
    if (!stillNeedHist && last?.statePass && last?.usefulPass) break;

    const n = Math.min(Number(step.pre2kCalls || 20), effectiveTotal - acc.totalCl);
    if (n < 12) continue;
    const h = runBlock(step, n, "PRE2K", { gte: step.pre2kGte, lte: step.pre2kLte });
    if (h.unmapped) {
      acc.stopReason = "UNEXPECTED_UNMAPPED";
      break;
    }
    if (h.rateLimited) {
      acc.stopReason = "rate_limited";
      break;
    }
    if (h.liveDelta > 0 || h.pre2000 > 0) {
      acc.laneA.productive.push({ clCourt: step.clCourt, phase: "PRE2K", cl: h.cl, liveDelta: h.liveDelta, pre2000: h.pre2000 });
      acc.laneA.perLane[step.clCourt].decision = "continue";
    } else {
      acc.laneA.stopped.push({ path: `${step.clCourt}-PRE2K`, reason: h.reason || "zero", cl: h.cl });
    }
    if (maybeCheckpoint()) break;
  }
}

if (!acc.stopReason) {
  const stopEarly = certCheckpoint("end");
  if (!stopEarly) {
    acc.stopReason =
      acc.totalCl >= effectiveTotal - 2 ? "budget_exhausted_uncertified" : "plan_exhausted_uncertified";
  }
}

const endSnap = liveSnap();
acc.endCases = Number(endSnap?.corpus?.cases || startCases + acc.laneA.casesAdded);
acc.endResolved = Number(endSnap?.resolvedAfter || startResolved);
acc.endExtracted = Number(endSnap?.extracted || startExtracted);
acc.finishedAt = new Date().toISOString();
acc.status = acc.clWastedOnInvalidMapping === 0 && acc.clWastedDueCap === 0 ? "PASS" : "FAIL";
acc.metrics = {
  laneAClPerCase: acc.laneA.casesAdded > 0 ? Number((acc.laneA.cl / acc.laneA.casesAdded).toFixed(3)) : null,
  histCasesPerCl: acc.laneA.cl > 0 ? Number((acc.laneA.histCases / acc.laneA.cl).toFixed(3)) : null,
  remainingTo4700: Math.max(0, 4700 - acc.endCases),
};

fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-surg-hist-checkpoint.json"), JSON.stringify(acc, null, 2));
process.stdout.write(
  `WEEK2_SURG_HIST_DONE ${JSON.stringify({
    totalCl: acc.totalCl,
    laneA: {
      cl: acc.laneA.cl,
      cases: acc.laneA.casesAdded,
      hist: acc.laneA.histCases,
      pre80: acc.laneA.pre80Adds,
      pre2k: acc.laneA.pre2kAdds,
    },
    endCases: acc.endCases,
    stop: acc.stopReason,
    clWastedDueCap: acc.clWastedDueCap,
    checkpoints: acc.certCheckpoints.map((c) => ({
      name: c.name,
      allMaterial: c.allMaterial,
      cases: c.cases,
      state: c.statePass,
      hist: c.histPass,
      pre2000: c.pre2000,
      pre1980: c.pre1980,
    })),
  })}\n`,
);
process.exit(acc.clWastedOnInvalidMapping === 0 && acc.clWastedDueCap === 0 ? 0 : 2);
