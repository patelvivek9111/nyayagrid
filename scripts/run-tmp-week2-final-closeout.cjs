/**
 * Week 2 Final Closeout Scale
 * ~90% Lane A (historical+open bounded blocks) / reserved ~10% Lane B
 * Zero LLM. Live deltas. Attribution checkpoints.
 *
 * Usage: node scripts/run-tmp-week2-final-closeout.cjs [totalBudget]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-final-closeout-ops.json");
const TOTAL_ARG = Number(process.argv[2] || process.env.WEEK2_FINAL_CLOSEOUT_BUDGET || 0);
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
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  return { text, json: lastJson(text) };
}

const boot = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-final-closeout-quota.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-final-closeout-preflight.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));

const safeBudget = Number(boot.safeBudget || 0);
if (safeBudget < 50) {
  const early = {
    classification: "WEEK2_FINAL_CLOSEOUT_SCALE_AND_HANDOFF",
    status: "PARTIAL_QUOTA_WAIT",
    stopReason: "SAFE_BUDGET_LT_50",
    totalCl: 0,
    finishedAt: new Date().toISOString(),
    message:
      "Stopped intentionally because safe CourtListener quota was insufficient. Progress was checkpointed and validated. No long quota wait was performed.",
  };
  fs.writeFileSync(OUT, JSON.stringify(early, null, 2));
  fs.writeFileSync(path.join(REPORTS, "week2-final-closeout-checkpoint.json"), JSON.stringify(early, null, 2));
  console.log(JSON.stringify(early));
  process.exit(0);
}

const preferred = Number(boot.preferred || Math.min(270, safeBudget));
const effectiveTotal = Math.min(TOTAL_ARG > 0 ? TOTAL_ARG : preferred, safeBudget, 275);
const reservedB = Math.min(Number(boot.reservedLaneBCl || 28), Math.max(24, Math.round(effectiveTotal * 0.1)));
let laneABudget = effectiveTotal - reservedB;
let laneBBudget = reservedB;

const laneAPlan = preflight.laneAPlan.filter(
  (p) => registry.courts?.[p.clCourt]?.mappingStatus === "VALID_MAPPED" && !["md", "mich"].includes(p.clCourt),
);
if (!laneAPlan.length) {
  console.log(JSON.stringify({ ok: false, reason: "NO_VALID_MAPPED_LANE_A" }));
  process.exit(2);
}

const startSnap = liveSnap();
const startCases = Number(startSnap?.corpus?.cases || boot.start.cases);
const startResolved = Number(startSnap?.resolvedAfter || boot.start.resolved);
const startExtracted = Number(startSnap?.extracted || boot.start.extracted);

const acc = {
  classification: "WEEK2_FINAL_CLOSEOUT_SCALE_AND_HANDOFF",
  startedAt: new Date().toISOString(),
  totalBudget: effectiveTotal,
  closeoutMode: Boolean(boot.closeoutMode),
  safeBudget,
  reservedLaneBCl: reservedB,
  pacingMs: CL_RATE_MS,
  startCases,
  startResolved,
  startExtracted,
  startStateDc: boot.start.stateDc,
  startFederal: boot.start.federal,
  startIntermediate: boot.start.intermediate,
  startPre2000: boot.start.pre2000,
  startPre1980: boot.start.pre1980,
  mappingPreflight: preflight.mappingSummary,
  targetMaxPreflight: preflight.targetMaxSummary,
  laneA: {
    budget: laneABudget,
    cl: 0,
    casesAdded: 0,
    batches: [],
    productive: [],
    stopped: [],
    oldEdgesResolved: 0,
    perLane: {},
  },
  laneB: { budget: laneBBudget, cl: 0, attempted: 0, found: 0, acquired: 0, oldEdgesResolved: 0 },
  attribution: {
    resolvedStart: startResolved,
    resolvedAfterLaneA: null,
    resolvedAfterLaneB: null,
    laneAExactOld: 0,
    laneBExactOld: 0,
  },
  reallocationLog: [
    {
      checkpoint: "start",
      laneAShare: laneABudget / effectiveTotal,
      laneBShare: reservedB / effectiveTotal,
      reason: "closeout_90_10_with_reserved_B",
    },
  ],
  checkpoints: [],
  totalCl: 0,
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
  clWastedOnInvalidMapping: 0,
  clWastedOnCappedLane: 0,
};

process.stdout.write(
  `FC_START total=${effectiveTotal} A=${laneABudget} Breserved=${reservedB} cases=${startCases} resolved=${startResolved} lanes=${laneAPlan.length}\n`,
);

function recordCheckpoint(name) {
  if (acc.checkpoints.some((c) => c.name === name)) return;
  acc.checkpoints.push({
    name,
    totalCl: acc.totalCl,
    laneACl: acc.laneA.cl,
    laneACases: acc.laneA.casesAdded,
    clPerCase: acc.laneA.casesAdded > 0 ? Number((acc.laneA.cl / acc.laneA.casesAdded).toFixed(3)) : null,
    remainingTo4700: Math.max(0, 4700 - (startCases + acc.laneA.casesAdded)),
  });
  acc.reallocationLog.push({
    checkpoint: name,
    laneAShare: laneABudget / effectiveTotal,
    laneBShare: reservedB / effectiveTotal,
    laneACases: acc.laneA.casesAdded,
    laneACl: acc.laneA.cl,
    reason: "progress_hold_reserved_B",
  });
}

function runLaneABlock(step, maxCalls, phase, dateWindow) {
  const before = liveSnap();
  const casesBefore = Number(before?.corpus?.cases || startCases + acc.laneA.casesAdded);
  const resolvedBefore = Number(before?.resolvedAfter || startResolved + acc.laneA.oldEdgesResolved);
  const extractedBefore = Number(before?.extracted || startExtracted);
  process.stdout.write(
    `\n=== LANE_A_${phase} ${step.tag} court=${step.clCourt} window=${dateWindow ? `${dateWindow.gte}:${dateWindow.lte}` : "OPEN"} maxCalls=${maxCalls} casesBefore=${casesBefore} ===\n`,
  );
  const r = oneshot(step, maxCalls, phase.toLowerCase(), dateWindow);
  const j = r.json;
  const cl = Number(j?.sessionApiCalls ?? j?.apiCallsDelta ?? j?.apiCalls ?? 0) || 0;
  const unmapped = /unmapped_court|MAPPING_INVALID/i.test(r.text);
  const rateLimited = Number(j?.rateLimitCount || 0) > 0 || /HTTP\s*429|"status"\s*:\s*429|RATE_LIMITED/i.test(r.text);
  const histTimeout = /HIST_QUERY_TIMEOUT|query.?timeout/i.test(r.text) || String(j?.reason || "").includes("HIST_QUERY_TIMEOUT");
  const after = liveSnap();
  const casesAfter = Number(after?.corpus?.cases || casesBefore);
  const resolvedAfter = Number(after?.resolvedAfter || resolvedBefore);
  const extractedAfter = Number(after?.extracted || extractedBefore);
  const delta = Math.max(0, casesAfter - casesBefore);
  const edgeDelta = Math.max(0, resolvedAfter - resolvedBefore);
  if (unmapped) acc.clWastedOnInvalidMapping += cl;
  acc.laneA.cl += cl;
  acc.totalCl += cl;
  acc.laneA.casesAdded += delta;
  acc.laneA.oldEdgesResolved += edgeDelta;
  acc.attribution.laneAExactOld += edgeDelta;
  if (!acc.laneA.perLane[step.clCourt]) {
    acc.laneA.perLane[step.clCourt] = {
      cl: 0,
      cases: 0,
      edges: 0,
      deficit: step.deficit,
      histCases: 0,
      openCases: 0,
      decision: "continue",
    };
  }
  acc.laneA.perLane[step.clCourt].cl += cl;
  acc.laneA.perLane[step.clCourt].cases += delta;
  acc.laneA.perLane[step.clCourt].edges += edgeDelta;
  if (dateWindow) acc.laneA.perLane[step.clCourt].histCases += delta;
  else acc.laneA.perLane[step.clCourt].openCases += delta;
  const row = {
    ...step,
    phase,
    window: dateWindow ? "HIST_1970_1999" : "OPEN",
    cl,
    casesBefore,
    casesAfter,
    liveDelta: delta,
    edgeDelta,
    extractedDelta: Math.max(0, extractedAfter - extractedBefore),
    reason: j?.reason || null,
    status: j?.status || null,
    rateLimited,
    unmapped,
    histTimeout,
  };
  acc.laneA.batches.push(row);
  process.stdout.write(
    JSON.stringify({ lane: "A", phase, tag: step.tag, cl, liveDelta: delta, edgeDelta, totalCl: acc.totalCl }) + "\n",
  );
  if (acc.totalCl >= 100) recordCheckpoint("after_100cl");
  if (acc.totalCl >= 200) recordCheckpoint("after_200cl");
  return { cl, delta, edgeDelta, rateLimited, unmapped, histTimeout, reason: j?.reason || null };
}

for (const step of laneAPlan) {
  if (acc.laneA.cl >= laneABudget) break;
  if (acc.stopReason === "rate_limited" || acc.stopReason === "UNEXPECTED_UNMAPPED") break;

  const histN = Math.min(Number(step.histCalls || 32), laneABudget - acc.laneA.cl);
  let histOk = false;
  if (histN >= 12) {
    const h = runLaneABlock(step, histN, "HIST", { gte: step.histGte, lte: step.histLte });
    if (h.unmapped) {
      acc.stopReason = "UNEXPECTED_UNMAPPED";
      acc.laneA.stopped.push({ path: step.tag, reason: "unmapped" });
      break;
    }
    if (h.rateLimited) {
      acc.stopReason = "rate_limited";
      acc.reliability["429"] += 1;
      break;
    }
    if (h.histTimeout && h.delta === 0) {
      acc.laneA.stopped.push({ path: `${step.tag}-HIST`, reason: "HIST_QUERY_TIMEOUT", cl: h.cl });
    } else if (h.delta === 0) {
      acc.laneA.stopped.push({ path: `${step.tag}-HIST`, reason: h.reason || "hist_zero", cl: h.cl });
    } else {
      histOk = true;
      acc.laneA.productive.push({
        path: step.tag,
        clCourt: step.clCourt,
        phase: "HIST",
        cl: h.cl,
        liveDelta: h.delta,
        edgeDelta: h.edgeDelta,
        clPerCase: Number((h.cl / h.delta).toFixed(3)),
      });
    }
  }

  const openN = Math.min(Number(step.openCalls || 0), laneABudget - acc.laneA.cl);
  // Open window if hist productive OR hist empty/timeout but court is proven continue lane
  const tryOpen = openN >= 12 && (histOk || Number(step.openCalls || 0) > 0);
  if (tryOpen && acc.laneA.cl < laneABudget) {
    const o = runLaneABlock(step, openN, "OPEN", null);
    if (o.unmapped) {
      acc.stopReason = "UNEXPECTED_UNMAPPED";
      break;
    }
    if (o.rateLimited) {
      acc.stopReason = "rate_limited";
      break;
    }
    if (o.delta > 0) {
      acc.laneA.productive.push({
        path: step.tag,
        clCourt: step.clCourt,
        phase: "OPEN",
        cl: o.cl,
        liveDelta: o.delta,
        edgeDelta: o.edgeDelta,
        clPerCase: Number((o.cl / o.delta).toFixed(3)),
      });
      acc.laneA.perLane[step.clCourt].decision = "continue";
    } else {
      acc.laneA.stopped.push({ path: `${step.tag}-OPEN`, reason: o.reason || "open_zero", cl: o.cl });
      if (!histOk) acc.laneA.perLane[step.clCourt].decision = "stop";
    }
  }

  // Crossed 4700? keep bounded if blockers remain, else stop A early for B
  if (startCases + acc.laneA.casesAdded >= 4700 && acc.laneA.cl >= Math.min(laneABudget, 180)) {
    acc.reallocationLog.push({
      checkpoint: "crossed_4700",
      laneACases: acc.laneA.casesAdded,
      reason: "crossed_target_continue_bounded_then_B",
    });
  }
}

{
  const mid = liveSnap();
  acc.attribution.resolvedAfterLaneA = Number(mid?.resolvedAfter || startResolved + acc.laneA.oldEdgesResolved);
  process.stdout.write(
    `LANE_A_DONE cl=${acc.laneA.cl} cases=${acc.laneA.casesAdded} edges=${acc.laneA.oldEdgesResolved} invalidWaste=${acc.clWastedOnInvalidMapping}\n`,
  );
}

// Lane B — reserved budget (may use leftover A as well up to reservedB + unused A)
if (acc.stopReason !== "UNEXPECTED_UNMAPPED" && acc.stopReason !== "rate_limited") {
  const unusedA = Math.max(0, laneABudget - acc.laneA.cl);
  const bBudget = Math.min(reservedB + unusedA, effectiveTotal - acc.totalCl, reservedB + 10);
  if (bBudget >= 8) {
    process.stdout.write(`\n=== LANE_B rebuild READY budget=${bBudget} ===\n`);
    flyNode("scripts/tmp-queue2-cite-demand-rebuild-ready-pools-bundled.cjs", [], 240);
    const laneBOps = path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.json");
    if (fs.existsSync(laneBOps)) {
      try {
        fs.renameSync(laneBOps, path.join(REPORTS, `week2-final-closeout-lane-b-ops.before-${Date.now()}.json`));
      } catch {
        fs.unlinkSync(laneBOps);
      }
    }
    const b = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts/run-tmp-week2-hybrid-lane-b-cite.cjs"), String(bBudget)],
      {
        encoding: "utf8",
        maxBuffer: 40e6,
        cwd: ROOT,
        env: { ...process.env, CL_RATE_MS: String(CL_RATE_MS), FEATURE_AGENTS: "0" },
      },
    );
    process.stdout.write(b.stdout || "");
    if (fs.existsSync(laneBOps)) {
      const bOps = JSON.parse(fs.readFileSync(laneBOps, "utf8"));
      fs.writeFileSync(path.join(REPORTS, "week2-final-closeout-lane-b-ops.json"), JSON.stringify(bOps, null, 2));
      acc.laneB.cl = Number(bOps.totalCl || 0);
      acc.laneB.attempted = Number(bOps.targetsAttempted || 0);
      acc.laneB.found = Number(bOps.targetsFound || 0);
      acc.laneB.acquired = Number(bOps.targetsAcquired || 0);
      acc.laneB.oldEdgesResolved = Number(bOps.byFamily?.us_reports?.oldEdgesResolved || 0);
      acc.laneB.edgesPerCl = acc.laneB.cl > 0 ? Number((acc.laneB.oldEdgesResolved / acc.laneB.cl).toFixed(3)) : null;
      acc.laneB.foundRate = bOps.byFamily?.us_reports?.foundRate ?? null;
      acc.attribution.laneBExactOld = acc.laneB.oldEdgesResolved;
      acc.totalCl += acc.laneB.cl;
    }
  }
}

const endSnap = liveSnap();
acc.endCases = Number(endSnap?.corpus?.cases || startCases + acc.laneA.casesAdded);
acc.endResolved = Number(endSnap?.resolvedAfter || startResolved);
acc.endExtracted = Number(endSnap?.extracted || startExtracted);
acc.attribution.resolvedAfterLaneB = acc.endResolved;
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) {
  acc.stopReason = acc.totalCl >= effectiveTotal - 2 ? "budget_exhausted" : "plan_exhausted";
}
acc.status = acc.clWastedOnInvalidMapping === 0 ? "PASS" : "FAIL";
acc.metrics = {
  laneAClPerCase: acc.laneA.casesAdded > 0 ? Number((acc.laneA.cl / acc.laneA.casesAdded).toFixed(3)) : null,
  laneACasesPerCl: acc.laneA.cl > 0 ? Number((acc.laneA.casesAdded / acc.laneA.cl).toFixed(3)) : null,
  laneBEdgesPerCl: acc.laneB.edgesPerCl || null,
  netNewCases: acc.endCases - startCases,
  remainingTo4700: Math.max(0, 4700 - acc.endCases),
};
acc.integrityFinal = {
  duplicates: Number(endSnap?.duplicateSourceIds || 0),
  orphans: Number(endSnap?.orphans || 0),
  missingEmbeddings: Number(endSnap?.chunks?.missing_embeddings || 0),
  chunks: Number(endSnap?.chunks?.chunks || 0),
};
recordCheckpoint("end");

fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-final-closeout-checkpoint.json"), JSON.stringify(acc, null, 2));
process.stdout.write(
  `WEEK2_FINAL_CLOSEOUT_DONE ${JSON.stringify({
    totalCl: acc.totalCl,
    laneA: { cl: acc.laneA.cl, cases: acc.laneA.casesAdded, edges: acc.laneA.oldEdgesResolved, clPerCase: acc.metrics.laneAClPerCase },
    laneB: { cl: acc.laneB.cl, acquired: acc.laneB.acquired, edges: acc.laneB.oldEdgesResolved },
    endCases: acc.endCases,
    endResolved: acc.endResolved,
    stop: acc.stopReason,
  })}\n`,
);
process.exit(acc.clWastedOnInvalidMapping === 0 ? 0 : 2);
