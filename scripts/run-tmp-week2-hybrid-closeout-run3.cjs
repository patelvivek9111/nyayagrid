/**
 * Week 2 Hybrid Closeout Run 3
 * Scale validated Lane A (micro→scale) ~70% + fresh U.S. Lane B ~30%
 * Zero LLM. Live case deltas. Fresh Lane B ops (no stale resume).
 *
 * Usage: node scripts/run-tmp-week2-hybrid-closeout-run3.cjs [totalBudget]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-hybrid-closeout-run3-ops.json");
const TOTAL = Math.min(Math.max(Number(process.argv[2] || process.env.WEEK2_HYBRID_R3_BUDGET || 120), 20), 170);
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
            try { return JSON.parse(t.slice(start, k + 1)); } catch { break; }
          }
        }
      }
    }
  }
  const lines = t.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* */ }
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
    } catch { /* */ }
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
        CL_FLY_EXEC_TIMEOUT_SEC: "540",
        CL_ORPHAN_WAIT_MS: "360000",
        FEATURE_AGENTS: "0",
      },
    },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  return { text, json: lastJson(text) };
}

const boot = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-quota.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-preflight.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));

const safeBudget = Number(boot.safeBudget || 0);
if (safeBudget < 20) {
  const early = {
    classification: "WEEK2_HYBRID_CLOSEOUT_RUN_3",
    status: "PARTIAL_QUOTA_WAIT",
    stopReason: "SAFE_BUDGET_LT_20",
    totalCl: 0,
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(OUT, JSON.stringify(early, null, 2));
  fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-checkpoint.json"), JSON.stringify(early, null, 2));
  console.log(JSON.stringify(early));
  process.exit(0);
}

const effectiveTotal = Math.min(TOTAL, safeBudget);
let laneABudget = Math.round(effectiveTotal * 0.7);
let laneBBudget = effectiveTotal - laneABudget;

const laneAPlan = preflight.laneAPlan.filter(
  (p) => registry.courts?.[p.clCourt]?.mappingStatus === "VALID_MAPPED",
);
if (laneAPlan.length === 0) {
  console.log(JSON.stringify({ ok: false, reason: "NO_VALID_MAPPED_LANE_A" }));
  process.exit(2);
}

const startSnap = liveSnap();
const startCases = Number(startSnap?.corpus?.cases || boot.start.cases);
const startResolved = Number(startSnap?.resolvedAfter || boot.start.resolved);
const startExtracted = Number(startSnap?.extracted || boot.start.extracted);

const acc = {
  classification: "WEEK2_HYBRID_CLOSEOUT_RUN_3",
  startedAt: new Date().toISOString(),
  totalBudget: effectiveTotal,
  pacingMs: CL_RATE_MS,
  startCases,
  startResolved,
  startExtracted,
  startStateDc: boot.start.stateDc,
  startFederal: boot.start.federal,
  mappingPreflight: preflight.mappingSummary,
  targetMaxPreflight: preflight.targetMaxSummary,
  newlyValidated: preflight.newlyValidated || [],
  laneA: {
    budget: laneABudget,
    cl: 0,
    casesAdded: 0,
    batches: [],
    productive: [],
    stopped: [],
    oldEdgesResolved: 0,
  },
  laneB: { budget: laneBBudget, cl: 0, attempted: 0, found: 0, acquired: 0, oldEdgesResolved: 0 },
  reallocationLog: [{ checkpoint: "start", laneAShare: 0.7, laneBShare: 0.3, reason: "scale_validated_state_depth" }],
  totalCl: 0,
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
  clWastedOnInvalidMapping: 0,
  clWastedOnCappedLane: 0,
};

process.stdout.write(
  `RUN3_START total=${effectiveTotal} A=${laneABudget} B=${laneBBudget} cases=${startCases} resolved=${startResolved} lanes=${laneAPlan.length}\n`,
);

function runLaneABlock(step, maxCalls, phase) {
  const before = liveSnap();
  const casesBefore = Number(before?.corpus?.cases || startCases + acc.laneA.casesAdded);
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
  const delta = Math.max(0, casesAfter - casesBefore);
  if (unmapped) acc.clWastedOnInvalidMapping += cl;
  acc.laneA.cl += cl;
  acc.totalCl += cl;
  acc.laneA.casesAdded += delta;
  const row = {
    ...step,
    phase,
    cl,
    casesBefore,
    casesAfter,
    liveDelta: delta,
    reason: j?.reason || null,
    status: j?.status || null,
    rateLimited,
    unmapped,
  };
  acc.laneA.batches.push(row);
  process.stdout.write(JSON.stringify({ lane: "A", phase, tag: step.tag, cl, liveDelta: delta, totalCl: acc.totalCl }) + "\n");
  return { cl, delta, rateLimited, unmapped, reason: j?.reason || null };
}

// --- LANE A micro→scale ---
for (const step of laneAPlan) {
  if (acc.laneA.cl >= laneABudget) break;
  if (acc.stopReason === "rate_limited" || acc.stopReason === "UNEXPECTED_UNMAPPED") break;

  const micro = Math.min(Number(step.microCalls || 10), laneABudget - acc.laneA.cl);
  if (micro < 3) break;
  const m = runLaneABlock(step, micro, "MICRO");
  if (m.unmapped) {
    acc.stopReason = "UNEXPECTED_UNMAPPED";
    acc.laneA.stopped.push({ path: step.tag, reason: "unmapped_after_preflight" });
    break;
  }
  if (m.rateLimited) {
    acc.stopReason = "rate_limited";
    acc.reliability["429"] += 1;
    acc.laneA.stopped.push({ path: step.tag, reason: "429" });
    break;
  }
  if (m.delta === 0) {
    acc.laneA.stopped.push({ path: step.tag, reason: m.reason || "zero_live_delta", cl: m.cl });
    continue;
  }
  acc.laneA.productive.push({
    path: step.tag,
    jurisdiction: step.jurisdiction,
    clCourt: step.clCourt,
    phase: "MICRO",
    cl: m.cl,
    liveDelta: m.delta,
    clPerCase: Number((m.cl / m.delta).toFixed(3)),
  });

  // Scale if productive (>=0.25 cases/CL ≈ <=4 CL/case) and budget remains
  const casesPerCl = m.delta / Math.max(m.cl, 1);
  if (casesPerCl >= 0.2 && acc.laneA.cl < laneABudget) {
    const scale = Math.min(Number(step.scaleCalls || 14), laneABudget - acc.laneA.cl);
    if (scale >= 6) {
      const s = runLaneABlock(step, scale, "SCALE");
      if (s.unmapped) {
        acc.stopReason = "UNEXPECTED_UNMAPPED";
        break;
      }
      if (s.rateLimited) {
        acc.stopReason = "rate_limited";
        break;
      }
      if (s.delta > 0) {
        acc.laneA.productive.push({
          path: step.tag,
          jurisdiction: step.jurisdiction,
          clCourt: step.clCourt,
          phase: "SCALE",
          cl: s.cl,
          liveDelta: s.delta,
          clPerCase: Number((s.cl / s.delta).toFixed(3)),
        });
      } else {
        acc.laneA.stopped.push({ path: `${step.tag}-SCALE`, reason: s.reason || "scale_zero", cl: s.cl });
      }
    }
  }

  // Checkpoint ~50 CL
  if (acc.totalCl >= 50 && !acc.reallocationLog.some((x) => x.checkpoint === "after_50cl")) {
    const aRate = acc.laneA.cl > 0 ? acc.laneA.casesAdded / acc.laneA.cl : 0;
    if (aRate >= 0.25) {
      const rem = effectiveTotal - acc.totalCl;
      laneABudget = acc.laneA.cl + Math.round(rem * 0.75);
      laneBBudget = effectiveTotal - laneABudget;
      acc.reallocationLog.push({
        checkpoint: "after_50cl",
        laneAShare: 0.75,
        laneBShare: 0.25,
        laneACasesPerCl: Number(aRate.toFixed(3)),
        reason: "laneA_strong_favor_state",
      });
    } else {
      acc.reallocationLog.push({
        checkpoint: "after_50cl",
        laneAShare: 0.7,
        laneBShare: 0.3,
        laneACasesPerCl: Number(aRate.toFixed(3)),
        reason: "hold_70_30",
      });
    }
  }
  if (acc.totalCl >= 100 && !acc.reallocationLog.some((x) => x.checkpoint === "after_100cl")) {
    const aRate = acc.laneA.cl > 0 ? acc.laneA.casesAdded / acc.laneA.cl : 0;
    acc.reallocationLog.push({
      checkpoint: "after_100cl",
      laneAShare: laneABudget / effectiveTotal,
      laneBShare: laneBBudget / effectiveTotal,
      laneACasesPerCl: Number(aRate.toFixed(3)),
      reason: "progress_checkpoint",
    });
  }
}

{
  const rr = liveSnap();
  acc.laneA.oldEdgesResolved = Math.max(0, Number(rr?.resolvedAfter || startResolved) - startResolved);
  process.stdout.write(
    `LANE_A_DONE cl=${acc.laneA.cl} cases=${acc.laneA.casesAdded} edges=${acc.laneA.oldEdgesResolved} invalidWaste=${acc.clWastedOnInvalidMapping}\n`,
  );
}

// --- LANE B fresh ---
if (acc.stopReason !== "UNEXPECTED_UNMAPPED" && acc.stopReason !== "rate_limited") {
  const bBudget = Math.min(laneBBudget, effectiveTotal - acc.totalCl);
  if (bBudget >= 8) {
    process.stdout.write(`\n=== LANE_B rebuild READY ===\n`);
    const rebuild = flyNode("scripts/tmp-queue2-cite-demand-rebuild-ready-pools-bundled.cjs", [], 240);
    process.stdout.write((rebuild.out || "").slice(0, 1200) + "\n");

    const laneBOps = path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.json");
    if (fs.existsSync(laneBOps)) {
      try {
        fs.renameSync(laneBOps, path.join(REPORTS, `week2-hybrid-closeout-lane-b-ops.before-run3-${Date.now()}.json`));
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
      fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-lane-b-ops.json"), JSON.stringify(bOps, null, 2));
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
  improvedVsPrior28: acc.laneA.casesAdded > 28,
};
acc.integrityFinal = {
  duplicates: Number(endSnap?.duplicateSourceIds || 0),
  orphans: Number(endSnap?.orphans || 0),
  missingEmbeddings: Number(endSnap?.chunks?.missing_embeddings || 0),
  chunks: Number(endSnap?.chunks?.chunks || 0),
};

fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-checkpoint.json"), JSON.stringify(acc, null, 2));
process.stdout.write(
  `WEEK2_HYBRID_RUN3_DONE ${JSON.stringify({
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
