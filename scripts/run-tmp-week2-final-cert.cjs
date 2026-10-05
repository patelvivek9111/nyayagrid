/**
 * Week 2 Final Certification + Bounded Closeout
 * Hist-first proven lanes, early certification stops, optional Lane B <=20 CL.
 *
 * Usage: node scripts/run-tmp-week2-final-cert.cjs [maxBudget]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-final-cert-ops.json");
const TOTAL_ARG = Number(process.argv[2] || process.env.WEEK2_FINAL_CERT_BUDGET || 0);
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
  const j = lastJson(r.out, '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"');
  return j;
}

function oneshot(step, maxCalls, tagSuffix, dateWindow) {
  const tag = tagSuffix ? `${step.tag}-${tagSuffix}` : step.tag;
  const env = {
    ...process.env,
    CL_RATE_MS: String(Math.min(CL_RATE_MS, 2500)),
    CL_FLY_EXEC_TIMEOUT_SEC: "720",
    CL_ORPHAN_WAIT_MS: "420000",
    FEATURE_AGENTS: "0",
  };
  if (dateWindow?.gte || dateWindow?.lte) {
    env.CL_KEEP_DATE_FILTER = "1";
    if (dateWindow.gte) env.CL_DATE_FILED_GTE = dateWindow.gte;
    if (dateWindow.lte) env.CL_DATE_FILED_LTE = dateWindow.lte;
  } else {
    delete env.CL_KEEP_DATE_FILTER;
    delete env.CL_DATE_FILED_GTE;
    delete env.CL_DATE_FILED_LTE;
  }
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/run-tmp-manual-cl-oneshot.cjs"), step.clCourt, step.batchSize, step.targetMax, String(maxCalls), tag],
    { encoding: "utf8", maxBuffer: 40e6, cwd: ROOT, env },
  );
  return { text: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}

const boot = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-final-cert-quota.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-final-cert-preflight.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));
const thresholds = boot.thresholds || {};

const safeBudget = Number(boot.safeBudget || 0);
if (safeBudget < 50) {
  const early = {
    classification: "WEEK2_FINAL_CERTIFICATION_AND_CLOSEOUT",
    status: "PARTIAL_QUOTA_WAIT",
    stopReason: "SAFE_BUDGET_LT_50",
    totalCl: 0,
    finishedAt: new Date().toISOString(),
    message:
      "Stopped intentionally because safe CourtListener quota was insufficient. Progress was checkpointed and validated. No long quota wait was performed.",
  };
  fs.writeFileSync(OUT, JSON.stringify(early, null, 2));
  fs.writeFileSync(path.join(REPORTS, "week2-final-cert-checkpoint.json"), JSON.stringify(early, null, 2));
  console.log(JSON.stringify(early));
  process.exit(0);
}

const effectiveTotal = Math.min(TOTAL_ARG > 0 ? TOTAL_ARG : Number(boot.preferred || 225), safeBudget, 275);
const laneAPlan = preflight.laneAPlan.filter(
  (p) => registry.courts?.[p.clCourt]?.mappingStatus === "VALID_MAPPED" && !["md", "mich"].includes(p.clCourt),
);

const startSnap = liveSnap();
const startCases = Number(startSnap?.corpus?.cases || boot.start.cases);
const startResolved = Number(startSnap?.resolvedAfter || boot.start.resolved);
const startExtracted = Number(startSnap?.extracted || boot.start.extracted);

const acc = {
  classification: "WEEK2_FINAL_CERTIFICATION_AND_CLOSEOUT",
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
  sufficiencyPre: boot.sufficiencyPre,
  laneA: { cl: 0, casesAdded: 0, batches: [], productive: [], stopped: [], oldEdgesResolved: 0, histCases: 0, perLane: {} },
  laneB: { cl: 0, attempted: 0, found: 0, acquired: 0, oldEdgesResolved: 0 },
  attribution: { laneAExactOld: 0, laneBExactOld: 0 },
  certCheckpoints: [],
  totalCl: 0,
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
  clWastedOnInvalidMapping: 0,
};

process.stdout.write(
  `CERT_START max=${effectiveTotal} cases=${startCases} resolved=${startResolved} lanes=${laneAPlan.length}\n`,
);

function evaluateFoundation(tracker, cases) {
  const states = tracker?.states || [];
  const intermediate = states.reduce((a, x) => a + Number(x.intermediateAppellate || 0), 0);
  const pre2000 = states.reduce((a, x) => a + Number(x.pre2000 || 0), 0);
  const pre1980 = states.reduce((a, x) => a + Number(x.pre1980 || 0), 0);
  const stateDc = Number(tracker?.progress?.stateDcCurrent || 0);
  const federal = Number(tracker?.progress?.federalCurrent || 0);
  const materialThinHist = states.filter(
    (st) => Number(st.pre2000 || 0) < Number(thresholds.HIST_JURIS_MIN_PRE2000 || 15) && Number(st.cases || 0) >= 40,
  ).length;
  const statePass = stateDc >= Number(thresholds.STATE_PASS_FLOOR || 3450);
  const histPass =
    pre2000 >= Number(thresholds.PRE2000_PASS_FLOOR || 900) &&
    pre1980 >= Number(thresholds.PRE1980_PASS_FLOOR || 260) &&
    materialThinHist <= 8;
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
    materialThinHist,
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
  const cases = startCases + acc.laneA.casesAdded + Number(acc.laneB.acquired || 0);
  // Prefer live corpus if available
  const snap = liveSnap();
  const liveCases = Number(snap?.corpus?.cases || cases);
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
  const resolvedBefore = Number(before?.resolvedAfter || startResolved + acc.laneA.oldEdgesResolved);
  process.stdout.write(
    `\n=== LANE_A_${phase} ${step.clCourt} window=${dateWindow ? "HIST" : "OPEN"} max=${maxCalls} casesBefore=${casesBefore} ===\n`,
  );
  const r = oneshot(step, maxCalls, phase.toLowerCase(), dateWindow);
  const j = r.json;
  const cl = Number(j?.sessionApiCalls ?? j?.apiCallsDelta ?? j?.apiCalls ?? 0) || 0;
  const unmapped = /unmapped_court|MAPPING_INVALID/i.test(r.text);
  const rateLimited = Number(j?.rateLimitCount || 0) > 0 || /HTTP\s*429|"status"\s*:\s*429|RATE_LIMITED/i.test(r.text);
  const after = liveSnap();
  const casesAfter = Number(after?.corpus?.cases || casesBefore);
  const resolvedAfter = Number(after?.resolvedAfter || resolvedBefore);
  const delta = Math.max(0, casesAfter - casesBefore);
  const edgeDelta = Math.max(0, resolvedAfter - resolvedBefore);
  if (unmapped) acc.clWastedOnInvalidMapping += cl;
  acc.laneA.cl += cl;
  acc.totalCl += cl;
  acc.laneA.casesAdded += delta;
  acc.laneA.oldEdgesResolved += edgeDelta;
  acc.attribution.laneAExactOld += edgeDelta;
  if (dateWindow) acc.laneA.histCases += delta;
  if (!acc.laneA.perLane[step.clCourt]) {
    acc.laneA.perLane[step.clCourt] = { cl: 0, cases: 0, edges: 0, histCases: 0, decision: "continue" };
  }
  acc.laneA.perLane[step.clCourt].cl += cl;
  acc.laneA.perLane[step.clCourt].cases += delta;
  acc.laneA.perLane[step.clCourt].edges += edgeDelta;
  if (dateWindow) acc.laneA.perLane[step.clCourt].histCases += delta;
  acc.laneA.batches.push({
    clCourt: step.clCourt,
    phase,
    window: dateWindow ? "HIST" : "OPEN",
    cl,
    liveDelta: delta,
    edgeDelta,
    reason: j?.reason || null,
    rateLimited,
    unmapped,
  });
  process.stdout.write(JSON.stringify({ lane: "A", phase, court: step.clCourt, cl, liveDelta: delta, totalCl: acc.totalCl }) + "\n");
  return { cl, delta, edgeDelta, rateLimited, unmapped, reason: j?.reason || null };
}

for (const step of laneAPlan) {
  if (acc.stopReason) break;
  if (acc.totalCl >= effectiveTotal) break;

  const histN = Math.min(Number(step.histCalls || 36), effectiveTotal - acc.totalCl);
  if (histN >= 12) {
    const h = runBlock(step, histN, "HIST", { gte: step.histGte, lte: step.histLte });
    if (h.unmapped) {
      acc.stopReason = "UNEXPECTED_UNMAPPED";
      break;
    }
    if (h.rateLimited) {
      acc.stopReason = "rate_limited";
      break;
    }
    if (h.delta > 0) {
      acc.laneA.productive.push({ clCourt: step.clCourt, phase: "HIST", cl: h.cl, liveDelta: h.delta });
    } else {
      acc.laneA.stopped.push({ path: `${step.clCourt}-HIST`, reason: h.reason || "zero", cl: h.cl });
    }
  }

  if (acc.totalCl >= Number(preflight.earlyStopCl || 125) && !acc.certCheckpoints.some((c) => c.name === "after_125cl")) {
    if (certCheckpoint("after_125cl")) break;
  }

  const openN = Math.min(Number(step.openCalls || 0), effectiveTotal - acc.totalCl);
  if (openN >= 12 && !acc.stopReason) {
    const o = runBlock(step, openN, "OPEN", null);
    if (o.unmapped) {
      acc.stopReason = "UNEXPECTED_UNMAPPED";
      break;
    }
    if (o.rateLimited) {
      acc.stopReason = "rate_limited";
      break;
    }
    if (o.delta > 0) {
      acc.laneA.productive.push({ clCourt: step.clCourt, phase: "OPEN", cl: o.cl, liveDelta: o.delta });
    } else {
      acc.laneA.stopped.push({ path: `${step.clCourt}-OPEN`, reason: o.reason || "zero", cl: o.cl });
      acc.laneA.perLane[step.clCourt].decision = "stop";
    }
  }

  if (acc.totalCl >= Number(preflight.secondStopCl || 225) && !acc.certCheckpoints.some((c) => c.name === "after_225cl")) {
    if (certCheckpoint("after_225cl")) break;
  }

  if (startCases + acc.laneA.casesAdded >= 4700) {
    if (certCheckpoint("crossed_4700")) break;
  }
}

process.stdout.write(`LANE_A_DONE cl=${acc.laneA.cl} cases=${acc.laneA.casesAdded} hist=${acc.laneA.histCases}\n`);

// Optional Lane B only if A under-used and not certified
if (!acc.stopReason?.startsWith("CERTIFIED") && acc.stopReason !== "UNEXPECTED_UNMAPPED" && acc.stopReason !== "rate_limited") {
  const leftover = effectiveTotal - acc.totalCl;
  const bBudget = Math.min(20, leftover);
  if (bBudget >= 8 && acc.laneA.casesAdded < 40) {
    process.stdout.write(`\n=== OPTIONAL LANE_B budget=${bBudget} ===\n`);
    flyNode("scripts/tmp-queue2-cite-demand-rebuild-ready-pools-bundled.cjs", [], 240);
    const laneBOps = path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.json");
    if (fs.existsSync(laneBOps)) {
      try {
        fs.renameSync(laneBOps, path.join(REPORTS, `week2-final-cert-lane-b-ops.before-${Date.now()}.json`));
      } catch {
        fs.unlinkSync(laneBOps);
      }
    }
    const b = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-week2-hybrid-lane-b-cite.cjs"), String(bBudget)], {
      encoding: "utf8",
      maxBuffer: 40e6,
      cwd: ROOT,
      env: { ...process.env, CL_RATE_MS: String(CL_RATE_MS), FEATURE_AGENTS: "0" },
    });
    process.stdout.write(b.stdout || "");
    if (fs.existsSync(laneBOps)) {
      const bOps = JSON.parse(fs.readFileSync(laneBOps, "utf8"));
      fs.writeFileSync(path.join(REPORTS, "week2-final-cert-lane-b-ops.json"), JSON.stringify(bOps, null, 2));
      acc.laneB.cl = Number(bOps.totalCl || 0);
      acc.laneB.attempted = Number(bOps.targetsAttempted || 0);
      acc.laneB.found = Number(bOps.targetsFound || 0);
      acc.laneB.acquired = Number(bOps.targetsAcquired || 0);
      acc.laneB.oldEdgesResolved = Number(bOps.byFamily?.us_reports?.oldEdgesResolved || 0);
      acc.attribution.laneBExactOld = acc.laneB.oldEdgesResolved;
      acc.totalCl += acc.laneB.cl;
    }
  }
}

if (!acc.stopReason) {
  // Final foundation check even if budget remains unused intentionally
  const stopEarlyForSufficiency = certCheckpoint("end");
  if (!stopEarlyForSufficiency) {
    acc.stopReason =
      acc.totalCl >= effectiveTotal - 2 ? "budget_exhausted_uncertified" : "plan_exhausted_uncertified";
  }
}

const endSnap = liveSnap();
acc.endCases = Number(endSnap?.corpus?.cases || startCases + acc.laneA.casesAdded);
acc.endResolved = Number(endSnap?.resolvedAfter || startResolved);
acc.endExtracted = Number(endSnap?.extracted || startExtracted);
acc.finishedAt = new Date().toISOString();
acc.status = acc.clWastedOnInvalidMapping === 0 ? "PASS" : "FAIL";
acc.metrics = {
  laneAClPerCase: acc.laneA.casesAdded > 0 ? Number((acc.laneA.cl / acc.laneA.casesAdded).toFixed(3)) : null,
  remainingTo4700: Math.max(0, 4700 - acc.endCases),
};

fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-final-cert-checkpoint.json"), JSON.stringify(acc, null, 2));
process.stdout.write(
  `WEEK2_FINAL_CERT_DONE ${JSON.stringify({
    totalCl: acc.totalCl,
    laneA: { cl: acc.laneA.cl, cases: acc.laneA.casesAdded, hist: acc.laneA.histCases },
    laneB: { cl: acc.laneB.cl, acquired: acc.laneB.acquired, edges: acc.laneB.oldEdgesResolved },
    endCases: acc.endCases,
    stop: acc.stopReason,
    checkpoints: acc.certCheckpoints.map((c) => ({ name: c.name, allMaterial: c.allMaterial, cases: c.cases, state: c.statePass, hist: c.histPass })),
  })}\n`,
);
process.exit(acc.clWastedOnInvalidMapping === 0 ? 0 : 2);
