/**
 * Week 2 Throughput Scale
 * Large safe hourly CL budget (~250-275), Lane A ~84% / Lane B ~16%
 * Proven winners get scale→extend blocks (not tiny micro-pilots).
 * Zero LLM. Live case deltas. Fresh Lane B ops.
 *
 * Usage: node scripts/run-tmp-week2-throughput-scale.cjs [totalBudget]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-throughput-scale-ops.json");
const TOTAL_ARG = Number(process.argv[2] || process.env.WEEK2_THROUGHPUT_BUDGET || 0);
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

function oneshot(step, maxCalls, tagSuffix) {
  const tag = tagSuffix ? `${step.tag}-${tagSuffix}` : step.tag;
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/run-tmp-manual-cl-oneshot.cjs"), step.clCourt, step.batchSize, step.targetMax, String(maxCalls), tag],
    {
      encoding: "utf8",
      maxBuffer: 40e6,
      cwd: ROOT,
      env: {
        ...process.env,
        CL_RATE_MS: String(Math.min(CL_RATE_MS, 2500)),
        CL_FLY_EXEC_TIMEOUT_SEC: "720",
        CL_ORPHAN_WAIT_MS: "420000",
        FEATURE_AGENTS: "0",
      },
    },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  return { text, json: lastJson(text) };
}

const boot = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-throughput-scale-quota.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-throughput-scale-preflight.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));

const safeBudget = Number(boot.safeBudget || 0);
if (safeBudget < 50) {
  const early = {
    classification: "WEEK2_THROUGHPUT_SCALE_BALANCED_CORPUS_AND_CITATION",
    status: "PARTIAL_QUOTA_WAIT",
    stopReason: "SAFE_BUDGET_LT_50",
    totalCl: 0,
    finishedAt: new Date().toISOString(),
    message:
      "Stopped intentionally because safe CourtListener quota was insufficient. Progress was checkpointed and validated. No long quota wait was performed.",
  };
  fs.writeFileSync(OUT, JSON.stringify(early, null, 2));
  fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-checkpoint.json"), JSON.stringify(early, null, 2));
  console.log(JSON.stringify(early));
  process.exit(0);
}

const preferred = Number(boot.preferred || Math.min(260, safeBudget));
const effectiveTotal = Math.min(TOTAL_ARG > 0 ? TOTAL_ARG : preferred, safeBudget, 275);
let laneABudget = Math.round(effectiveTotal * Number(boot.laneAShare || 0.84));
let laneBBudget = effectiveTotal - laneABudget;

const laneAPlan = preflight.laneAPlan.filter((p) => registry.courts?.[p.clCourt]?.mappingStatus === "VALID_MAPPED");
if (laneAPlan.length === 0) {
  console.log(JSON.stringify({ ok: false, reason: "NO_VALID_MAPPED_LANE_A" }));
  process.exit(2);
}

const startSnap = liveSnap();
const startCases = Number(startSnap?.corpus?.cases || boot.start.cases);
const startResolved = Number(startSnap?.resolvedAfter || boot.start.resolved);
const startExtracted = Number(startSnap?.extracted || boot.start.extracted);

const acc = {
  classification: "WEEK2_THROUGHPUT_SCALE_BALANCED_CORPUS_AND_CITATION",
  startedAt: new Date().toISOString(),
  totalBudget: effectiveTotal,
  throughputMode: Boolean(boot.throughputMode),
  safeBudget,
  pacingMs: CL_RATE_MS,
  startCases,
  startResolved,
  startExtracted,
  startStateDc: boot.start.stateDc,
  startFederal: boot.start.federal,
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
  reallocationLog: [
    {
      checkpoint: "start",
      laneAShare: Number(boot.laneAShare || 0.84),
      laneBShare: Number(boot.laneBShare || 0.16),
      reason: "throughput_state_depth_priority",
    },
  ],
  totalCl: 0,
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
  clWastedOnInvalidMapping: 0,
  clWastedOnCappedLane: 0,
};

process.stdout.write(
  `TS_START total=${effectiveTotal} A=${laneABudget} B=${laneBBudget} throughput=${acc.throughputMode} cases=${startCases} resolved=${startResolved} lanes=${laneAPlan.length}\n`,
);

function maybeCheckpoint(name, threshold) {
  if (acc.totalCl < threshold) return;
  if (acc.reallocationLog.some((x) => x.checkpoint === name)) return;
  const aRate = acc.laneA.cl > 0 ? acc.laneA.casesAdded / acc.laneA.cl : 0;
  if (aRate >= 0.3) {
    const rem = effectiveTotal - acc.totalCl;
    laneABudget = acc.laneA.cl + Math.round(rem * 0.88);
    laneBBudget = effectiveTotal - laneABudget;
    acc.reallocationLog.push({
      checkpoint: name,
      laneAShare: 0.88,
      laneBShare: 0.12,
      laneACasesPerCl: Number(aRate.toFixed(3)),
      laneACases: acc.laneA.casesAdded,
      laneACl: acc.laneA.cl,
      reason: "laneA_strong_increase_share",
    });
  } else if (aRate < 0.15 && acc.laneA.cl >= 60) {
    const rem = effectiveTotal - acc.totalCl;
    laneABudget = acc.laneA.cl + Math.round(rem * 0.6);
    laneBBudget = effectiveTotal - laneABudget;
    acc.reallocationLog.push({
      checkpoint: name,
      laneAShare: 0.6,
      laneBShare: 0.4,
      laneACasesPerCl: Number(aRate.toFixed(3)),
      laneACases: acc.laneA.casesAdded,
      laneACl: acc.laneA.cl,
      reason: "laneA_weak_shift_to_citation",
    });
  } else {
    acc.reallocationLog.push({
      checkpoint: name,
      laneAShare: laneABudget / effectiveTotal,
      laneBShare: laneBBudget / effectiveTotal,
      laneACasesPerCl: Number(aRate.toFixed(3)),
      laneACases: acc.laneA.casesAdded,
      laneACl: acc.laneA.cl,
      reason: "hold",
    });
  }
}

function runLaneABlock(step, maxCalls, phase) {
  const before = liveSnap();
  const casesBefore = Number(before?.corpus?.cases || startCases + acc.laneA.casesAdded);
  const resolvedBefore = Number(before?.resolvedAfter || startResolved + acc.laneA.oldEdgesResolved);
  process.stdout.write(
    `\n=== LANE_A_${phase} ${step.tag} court=${step.clCourt} targetMax=${step.targetMax} maxCalls=${maxCalls} casesBefore=${casesBefore} ===\n`,
  );
  const r = oneshot(step, maxCalls, phase.toLowerCase());
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
  if (!acc.laneA.perLane[step.clCourt]) {
    acc.laneA.perLane[step.clCourt] = { cl: 0, cases: 0, edges: 0, deficit: step.deficit, decision: "continue" };
  }
  acc.laneA.perLane[step.clCourt].cl += cl;
  acc.laneA.perLane[step.clCourt].cases += delta;
  acc.laneA.perLane[step.clCourt].edges += edgeDelta;
  const row = {
    ...step,
    phase,
    cl,
    casesBefore,
    casesAfter,
    liveDelta: delta,
    edgeDelta,
    reason: j?.reason || null,
    status: j?.status || null,
    rateLimited,
    unmapped,
  };
  acc.laneA.batches.push(row);
  process.stdout.write(
    JSON.stringify({ lane: "A", phase, tag: step.tag, cl, liveDelta: delta, edgeDelta, totalCl: acc.totalCl }) + "\n",
  );
  return { cl, delta, edgeDelta, rateLimited, unmapped, reason: j?.reason || null };
}

// --- LANE A scale→extend on proven winners ---
for (const step of laneAPlan) {
  if (acc.laneA.cl >= laneABudget) break;
  if (acc.stopReason === "rate_limited" || acc.stopReason === "UNEXPECTED_UNMAPPED") break;

  const scale = Math.min(Number(step.scaleCalls || 28), laneABudget - acc.laneA.cl);
  if (scale < 8) break;

  const s = runLaneABlock(step, scale, "SCALE");
  maybeCheckpoint("after_75cl", 75);
  maybeCheckpoint("after_150cl", 150);
  maybeCheckpoint("after_225cl", 225);

  if (s.unmapped) {
    acc.stopReason = "UNEXPECTED_UNMAPPED";
    acc.laneA.stopped.push({ path: step.tag, reason: "unmapped_after_preflight" });
    acc.laneA.perLane[step.clCourt].decision = "stop";
    break;
  }
  if (s.rateLimited) {
    acc.stopReason = "rate_limited";
    acc.reliability["429"] += 1;
    acc.laneA.stopped.push({ path: step.tag, reason: "429" });
    acc.laneA.perLane[step.clCourt].decision = "stop";
    break;
  }
  if (s.delta === 0) {
    acc.laneA.stopped.push({ path: step.tag, reason: s.reason || "zero_live_delta", cl: s.cl });
    acc.laneA.perLane[step.clCourt].decision = "stop";
    continue;
  }

  const casesPerCl = s.delta / Math.max(s.cl, 1);
  acc.laneA.productive.push({
    path: step.tag,
    jurisdiction: step.jurisdiction,
    clCourt: step.clCourt,
    phase: "SCALE",
    cl: s.cl,
    liveDelta: s.delta,
    edgeDelta: s.edgeDelta,
    clPerCase: Number((s.cl / s.delta).toFixed(3)),
  });

  // Extend if productive (>=0.25 cases/CL) and budget remains
  const extend = Math.min(Number(step.extendCalls || 0), laneABudget - acc.laneA.cl);
  if (casesPerCl >= 0.25 && extend >= 10) {
    const e = runLaneABlock(step, extend, "EXTEND");
    maybeCheckpoint("after_75cl", 75);
    maybeCheckpoint("after_150cl", 150);
    maybeCheckpoint("after_225cl", 225);
    if (e.unmapped) {
      acc.stopReason = "UNEXPECTED_UNMAPPED";
      break;
    }
    if (e.rateLimited) {
      acc.stopReason = "rate_limited";
      break;
    }
    if (e.delta > 0) {
      acc.laneA.productive.push({
        path: step.tag,
        jurisdiction: step.jurisdiction,
        clCourt: step.clCourt,
        phase: "EXTEND",
        cl: e.cl,
        liveDelta: e.delta,
        edgeDelta: e.edgeDelta,
        clPerCase: Number((e.cl / e.delta).toFixed(3)),
      });
      acc.laneA.perLane[step.clCourt].decision = "continue";
    } else {
      acc.laneA.stopped.push({ path: `${step.tag}-EXTEND`, reason: e.reason || "extend_zero", cl: e.cl });
      acc.laneA.perLane[step.clCourt].decision = "stop";
    }
  } else if (casesPerCl < 0.2) {
    acc.laneA.perLane[step.clCourt].decision = "stop";
    acc.laneA.stopped.push({ path: step.tag, reason: "yield_collapse", cl: s.cl, casesPerCl });
  }
}

{
  const rr = liveSnap();
  acc.laneA.oldEdgesResolved = Math.max(0, Number(rr?.resolvedAfter || startResolved) - startResolved);
  process.stdout.write(
    `LANE_A_DONE cl=${acc.laneA.cl} cases=${acc.laneA.casesAdded} edges=${acc.laneA.oldEdgesResolved} invalidWaste=${acc.clWastedOnInvalidMapping}\n`,
  );
}

// --- LANE B fresh U.S. ---
if (acc.stopReason !== "UNEXPECTED_UNMAPPED" && acc.stopReason !== "rate_limited") {
  const bBudget = Math.min(laneBBudget, effectiveTotal - acc.totalCl);
  if (bBudget >= 8) {
    process.stdout.write(`\n=== LANE_B rebuild READY ===\n`);
    const rebuild = flyNode("scripts/tmp-queue2-cite-demand-rebuild-ready-pools-bundled.cjs", [], 240);
    process.stdout.write((rebuild.out || "").slice(0, 1200) + "\n");

    const laneBOps = path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.json");
    if (fs.existsSync(laneBOps)) {
      try {
        fs.renameSync(laneBOps, path.join(REPORTS, `week2-throughput-scale-lane-b-ops.before-${Date.now()}.json`));
      } catch {
        fs.unlinkSync(laneBOps);
      }
    }

    process.stdout.write(`\n=== LANE_B citation US budget=${bBudget} ===\n`);
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
      fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-lane-b-ops.json"), JSON.stringify(bOps, null, 2));
      acc.laneB.cl = Number(bOps.totalCl || 0);
      acc.laneB.attempted = Number(bOps.targetsAttempted || 0);
      acc.laneB.found = Number(bOps.targetsFound || 0);
      acc.laneB.acquired = Number(bOps.targetsAcquired || 0);
      acc.laneB.oldEdgesResolved = Number(bOps.byFamily?.us_reports?.oldEdgesResolved || 0);
      acc.laneB.edgesPerCl = acc.laneB.cl > 0 ? Number((acc.laneB.oldEdgesResolved / acc.laneB.cl).toFixed(3)) : null;
      acc.laneB.foundRate = bOps.byFamily?.us_reports?.foundRate ?? null;
      acc.totalCl += acc.laneB.cl;
    }
  }
}

const endSnap = liveSnap();
acc.endCases = Number(endSnap?.corpus?.cases || startCases + acc.laneA.casesAdded);
acc.endResolved = Number(endSnap?.resolvedAfter || startResolved);
acc.endExtracted = Number(endSnap?.extracted || startExtracted);
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) {
  acc.stopReason = acc.totalCl >= effectiveTotal - 2 ? "budget_exhausted" : "plan_exhausted";
}
acc.status = acc.clWastedOnInvalidMapping === 0 ? "PASS" : "FAIL";
acc.metrics = {
  laneACasesPerCl: acc.laneA.cl > 0 ? Number((acc.laneA.casesAdded / acc.laneA.cl).toFixed(3)) : null,
  laneAClPerCase: acc.laneA.casesAdded > 0 ? Number((acc.laneA.cl / acc.laneA.casesAdded).toFixed(3)) : null,
  laneBEdgesPerCl: acc.laneB.edgesPerCl || null,
  netNewCases: acc.endCases - startCases,
  remainingTo4700: Math.max(0, 4700 - acc.endCases),
  live12_5Target: Math.ceil(acc.endExtracted * 0.125),
  liveGap12_5: Math.max(0, Math.ceil(acc.endExtracted * 0.125) - acc.endResolved),
  resolutionPct: Number(((acc.endResolved / acc.endExtracted) * 100).toFixed(2)),
  improvedVsPrior44: acc.laneA.casesAdded > 44,
};
acc.integrityFinal = {
  duplicates: Number(endSnap?.duplicateSourceIds || 0),
  orphans: Number(endSnap?.orphans || 0),
  missingEmbeddings: Number(endSnap?.chunks?.missing_embeddings || 0),
  chunks: Number(endSnap?.chunks?.chunks || 0),
};

fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-checkpoint.json"), JSON.stringify(acc, null, 2));
process.stdout.write(
  `WEEK2_THROUGHPUT_SCALE_DONE ${JSON.stringify({
    totalCl: acc.totalCl,
    laneA: { cl: acc.laneA.cl, cases: acc.laneA.casesAdded, edges: acc.laneA.oldEdgesResolved, clPerCase: acc.metrics.laneAClPerCase },
    laneB: { cl: acc.laneB.cl, acquired: acc.laneB.acquired, edges: acc.laneB.oldEdgesResolved },
    endCases: acc.endCases,
    endResolved: acc.endResolved,
    invalidWaste: acc.clWastedOnInvalidMapping,
    stop: acc.stopReason,
  })}\n`,
);
process.exit(acc.clWastedOnInvalidMapping === 0 ? 0 : 2);
