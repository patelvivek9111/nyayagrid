/**
 * Week 2 Hybrid Closeout Run 2
 * 70% Lane A (VALID_MAPPED + targetMax preflight) / 30% Lane B U.S. citation
 * No long waits. Zero LLM. Live case deltas only for Lane A.
 *
 * Usage: node scripts/run-tmp-week2-hybrid-closeout-run2.cjs [totalBudget]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-hybrid-closeout-run2-ops.json");
const TOTAL = Math.min(Math.max(Number(process.argv[2] || process.env.WEEK2_HYBRID_R2_BUDGET || 100), 20), 150);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 2500);
const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;

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

function oneshot(step, maxCalls) {
  const r = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/run-tmp-manual-cl-oneshot.cjs"),
      step.clCourt,
      step.batchSize,
      step.targetMax,
      String(maxCalls),
      step.tag,
    ],
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
  return { status: r.status ?? 1, text, json: lastJson(text) };
}

// --- PHASE: load preflight ---
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-preflight.json"), "utf8"));
const boot = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-quota.json"), "utf8"));
if (Number(preflight.mappingSummary.clWastedOnInvalid) !== 0) {
  console.log(JSON.stringify({ ok: false, reason: "PREFLIGHT_CL_WASTE_NONZERO" }));
  process.exit(2);
}
const registry = JSON.parse(
  fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"),
);
const laneAPlan = preflight.laneAPlan.filter((p) => {
  const mapStatus = registry.courts?.[p.clCourt]?.mappingStatus;
  const row = preflight.allPreflight.find((x) => x.clCourt === p.clCourt);
  // Allow productive VALID courts even if not in top-deficit allPreflight rows
  if (mapStatus === "VALID_MAPPED") return true;
  return row && row.eligible && row.mappingStatus === "VALID_MAPPED";
});
if (laneAPlan.length === 0) {
  console.log(JSON.stringify({ ok: false, reason: "NO_VALID_MAPPED_LANE_A" }));
  process.exit(2);
}

let laneABudget = Math.round(TOTAL * 0.7);
let laneBBudget = TOTAL - laneABudget;
const safeBudget = Number(boot.safeBudget || 0);
if (safeBudget < 20) {
  const acc = {
    classification: "WEEK2_HYBRID_CLOSEOUT_RUN_2",
    status: "PARTIAL_QUOTA_WAIT",
    stopReason: "SAFE_BUDGET_LT_20",
    totalCl: 0,
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
  console.log(JSON.stringify(acc));
  process.exit(0);
}
const effectiveTotal = Math.min(TOTAL, safeBudget);
laneABudget = Math.round(effectiveTotal * 0.7);
laneBBudget = effectiveTotal - laneABudget;

const startSnap = liveSnap();
const startCases = Number(startSnap?.corpus?.cases || boot.start.cases);
const startResolved = Number(startSnap?.resolvedAfter || boot.start.resolved);
const startExtracted = Number(startSnap?.extracted || boot.start.extracted);

const acc = {
  classification: "WEEK2_HYBRID_CLOSEOUT_RUN_2",
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
  laneA: {
    budget: laneABudget,
    cl: 0,
    casesAdded: 0,
    batches: [],
    stopped: [],
    productive: [],
    oldEdgesResolved: 0,
  },
  laneB: {
    budget: laneBBudget,
    cl: 0,
    attempted: 0,
    found: 0,
    acquired: 0,
    oldEdgesResolved: 0,
  },
  reallocationLog: [
    { checkpoint: "start", laneAShare: 0.7, laneBShare: 0.3, reason: "week2_state_depth_primary" },
  ],
  totalCl: 0,
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
};

process.stdout.write(
  `RUN2_START total=${effectiveTotal} A=${laneABudget} B=${laneBBudget} cases=${startCases} resolved=${startResolved} validMapped=${laneAPlan.length}\n`,
);

// --- LANE A ---
let resolvedAfterA = startResolved;
for (const step of laneAPlan) {
  if (acc.laneA.cl >= laneABudget) break;
  const maxCalls = Math.min(Number(step.maxCalls || 10), laneABudget - acc.laneA.cl);
  if (maxCalls < 3) break;

  const before = liveSnap();
  const casesBefore = Number(before?.corpus?.cases || startCases + acc.laneA.casesAdded);
  process.stdout.write(`\n=== LANE_A ${step.tag} court=${step.clCourt} targetMax=${step.targetMax} maxCalls=${maxCalls} casesBefore=${casesBefore} ===\n`);
  const r = oneshot(step, maxCalls);
  const j = r.json;
  const cl = Number(j?.sessionApiCalls ?? j?.apiCallsDelta ?? j?.apiCalls ?? 0) || 0;
  const rateLimited = Number(j?.rateLimitCount || 0) > 0 || /HTTP\s*429|"status"\s*:\s*429|RATE_LIMITED/i.test(r.text);
  const unmapped = /unmapped_court|MAPPING_INVALID/i.test(r.text) || String(j?.reason || "").includes("unmapped");
  const already = String(j?.reason || "").includes("already_completed");
  const after = liveSnap();
  const casesAfter = Number(after?.corpus?.cases || casesBefore);
  const delta = Math.max(0, casesAfter - casesBefore);

  acc.laneA.cl += cl;
  acc.totalCl += cl;
  acc.laneA.casesAdded += delta;
  const row = {
    ...step,
    cl,
    casesBefore,
    casesAfter,
    liveDelta: delta,
    reportedImported: Number(j?.items_imported || 0),
    reason: j?.reason || null,
    status: j?.status || null,
    rateLimited,
    unmapped,
    already,
  };
  acc.laneA.batches.push(row);
  process.stdout.write(JSON.stringify({ lane: "A", tag: step.tag, cl, liveDelta: delta, totalCl: acc.totalCl, casesAfter }) + "\n");

  if (rateLimited) {
    acc.reliability["429"] += 1;
    acc.stopReason = "rate_limited";
    acc.laneA.stopped.push({ path: step.tag, reason: "429" });
    break;
  }
  if (unmapped) {
    // Must not happen after preflight — hard stop
    acc.stopReason = "UNEXPECTED_UNMAPPED_AFTER_PREFLIGHT";
    acc.laneA.stopped.push({ path: step.tag, reason: "unmapped_after_preflight" });
    break;
  }
  if (delta === 0) {
    acc.laneA.stopped.push({
      path: step.tag,
      reason: already ? "already_completed" : String(j?.reason || "zero_live_delta"),
      cl,
    });
    continue;
  }
  acc.laneA.productive.push({
    path: step.tag,
    jurisdiction: step.jurisdiction,
    clCourt: step.clCourt,
    cl,
    liveDelta: delta,
    clPerCase: Number((cl / delta).toFixed(3)),
  });

  // Mid realloc after ~50 CL
  if (acc.totalCl >= 50 && acc.reallocationLog.length === 1) {
    const aRate = acc.laneA.cl > 0 ? acc.laneA.casesAdded / acc.laneA.cl : 0;
    if (aRate >= 0.15) {
      // keep favoring A — bump remaining toward A
      const rem = effectiveTotal - acc.totalCl;
      laneABudget = acc.laneA.cl + Math.round(rem * 0.75);
      laneBBudget = effectiveTotal - laneABudget;
      acc.reallocationLog.push({
        checkpoint: "after_50cl",
        laneAShare: 0.75,
        laneBShare: 0.25,
        laneACasesPerCl: Number(aRate.toFixed(3)),
        reason: "laneA_productive_favor_state_depth",
      });
    } else {
      laneABudget = acc.laneA.cl + Math.round((effectiveTotal - acc.totalCl) * 0.5);
      laneBBudget = effectiveTotal - laneABudget;
      acc.reallocationLog.push({
        checkpoint: "after_50cl",
        laneAShare: 0.5,
        laneBShare: 0.5,
        laneACasesPerCl: Number(aRate.toFixed(3)),
        reason: "laneA_weak_boost_citation",
      });
    }
  }
}

// Reresolve after Lane A for cross-lane attribution
{
  const rr = liveSnap();
  resolvedAfterA = Number(rr?.resolvedAfter || startResolved);
  acc.laneA.oldEdgesResolved = Math.max(0, resolvedAfterA - startResolved);
  process.stdout.write(`LANE_A_DONE cl=${acc.laneA.cl} cases=${acc.laneA.casesAdded} edges=${acc.laneA.oldEdgesResolved}\n`);
}

// --- LANE B ---
if (acc.stopReason !== "UNEXPECTED_UNMAPPED_AFTER_PREFLIGHT" && acc.stopReason !== "rate_limited") {
  const bBudget = Math.min(laneBBudget, effectiveTotal - acc.totalCl);
  if (bBudget >= 8) {
    process.stdout.write(`\n=== LANE_B rebuild READY ===\n`);
    const rebuildBundled = path.join(ROOT, "scripts/tmp-queue2-cite-demand-rebuild-ready-pools-bundled.cjs");
    const rebuildScript = fs.existsSync(rebuildBundled)
      ? "scripts/tmp-queue2-cite-demand-rebuild-ready-pools-bundled.cjs"
      : "scripts/tmp-queue2-cite-demand-rebuild-ready-pools.cjs";
    const rebuild = flyNode(rebuildScript, [], 240);
    process.stdout.write((rebuild.out || "").slice(0, 1500) + "\n");

    // Fresh Lane B ops — do not resume prior hybrid closeout totals
    const laneBOps = path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.json");
    const laneBArchive = path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.prev.json");
    if (fs.existsSync(laneBOps)) {
      try { fs.renameSync(laneBOps, laneBArchive); } catch { fs.unlinkSync(laneBOps); }
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
    const bOpsPath = path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.json");
    // Lane B runner writes to week2-hybrid-closeout-lane-b-ops.json — copy to run2-specific
    if (fs.existsSync(bOpsPath)) {
      const bOps = JSON.parse(fs.readFileSync(bOpsPath, "utf8"));
      fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-lane-b-ops.json"), JSON.stringify(bOps, null, 2));
      acc.laneB.cl = Number(bOps.totalCl || 0);
      acc.laneB.attempted = Number(bOps.targetsAttempted || 0);
      acc.laneB.found = Number(bOps.targetsFound || 0);
      acc.laneB.acquired = Number(bOps.targetsAcquired || 0);
      acc.laneB.oldEdgesResolved = Number(bOps.byFamily?.us_reports?.oldEdgesResolved || 0);
      acc.laneB.edgesPerCl = acc.laneB.cl > 0 ? Number((acc.laneB.oldEdgesResolved / acc.laneB.cl).toFixed(3)) : null;
      acc.laneB.familyTable = bOps.byFamily || null;
      acc.totalCl += acc.laneB.cl;
      if (bOps.reliability?.["429"]) acc.reliability["429"] += Number(bOps.reliability["429"]);
    }
  }
}

const endSnap = liveSnap();
acc.endCases = Number(endSnap?.corpus?.cases || startCases + acc.laneA.casesAdded);
acc.endResolved = Number(endSnap?.resolvedAfter || resolvedAfterA);
acc.endExtracted = Number(endSnap?.extracted || startExtracted);
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) {
  acc.stopReason =
    acc.totalCl >= effectiveTotal
      ? "budget_exhausted"
      : Number(boot.limits?.hour?.remaining || 999) - acc.totalCl <= HOUR_FLOOR
        ? "approaching_hour_floor"
        : "plan_exhausted";
}
acc.metrics = {
  laneACasesPerCl: acc.laneA.cl > 0 ? Number((acc.laneA.casesAdded / acc.laneA.cl).toFixed(3)) : null,
  laneBEdgesPerCl: acc.laneB.edgesPerCl || null,
  netNewCases: acc.endCases - startCases,
  remainingTo4700: Math.max(0, 4700 - acc.endCases),
  live12_5Target: Math.ceil(acc.endExtracted * 0.125),
  liveGap12_5: Math.max(0, Math.ceil(acc.endExtracted * 0.125) - acc.endResolved),
  resolutionPct: Number(((acc.endResolved / acc.endExtracted) * 100).toFixed(2)),
};
acc.integrityFinal = {
  duplicates: Number(endSnap?.duplicateSourceIds || 0),
  orphans: Number(endSnap?.orphans || 0),
  missingEmbeddings: Number(endSnap?.chunks?.missing_embeddings || 0),
  chunks: Number(endSnap?.chunks?.chunks || 0),
};

fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
process.stdout.write(
  `WEEK2_HYBRID_RUN2_DONE ${JSON.stringify({
    totalCl: acc.totalCl,
    laneA: { cl: acc.laneA.cl, cases: acc.laneA.casesAdded, edges: acc.laneA.oldEdgesResolved },
    laneB: { cl: acc.laneB.cl, acquired: acc.laneB.acquired, edges: acc.laneB.oldEdgesResolved },
    endCases: acc.endCases,
    endResolved: acc.endResolved,
    stop: acc.stopReason,
  })}\n`,
);
process.exit(0);
