/**
 * Week 2 hybrid closeout: Lane A balanced corpus + Lane B U.S. citation-demand.
 * No long waits. Zero LLM. Exact citation attribution for Lane B.
 *
 * Usage: node scripts/run-tmp-week2-hybrid-closeout.cjs [totalBudget]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-hybrid-closeout-ops.json");
const TOTAL = Math.min(Math.max(Number(process.argv[2] || process.env.WEEK2_HYBRID_BUDGET || 100), 20), 150);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 2500);

// Lane A micro-pilots: intermediate appellate for top tracker deficit states (verified CL court ids)
const LANE_A_PLAN = [
  { jurisdiction: "MI", clCourt: "michctapp", batchSize: "5", targetMax: "20", maxCalls: "12", tag: "w2h-michctapp", lane: "G1" },
  { jurisdiction: "LA", clCourt: "lactapp", batchSize: "5", targetMax: "20", maxCalls: "12", tag: "w2h-lactapp", lane: "G1" },
  { jurisdiction: "MD", clCourt: "mdctapp", batchSize: "5", targetMax: "20", maxCalls: "12", tag: "w2h-mdctapp", lane: "G1" },
  { jurisdiction: "NV", clCourt: "nevctapp", batchSize: "5", targetMax: "20", maxCalls: "12", tag: "w2h-nevctapp", lane: "G1" },
  { jurisdiction: "TN", clCourt: "tennctapp", batchSize: "5", targetMax: "20", maxCalls: "10", tag: "w2h-tennctapp", lane: "G1" },
  { jurisdiction: "IA", clCourt: "iowactapp", batchSize: "5", targetMax: "20", maxCalls: "10", tag: "w2h-iowactapp", lane: "G1" },
];

function lastJson(text) {
  const t = String(text || "");
  const lines = t.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* */ }
  }
  const start = t.lastIndexOf('{"ok"');
  if (start < 0) return null;
  let d = 0;
  for (let k = start; k < t.length; k++) {
    if (t[k] === "{") d++;
    else if (t[k] === "}") {
      d--;
      if (d === 0) {
        try { return JSON.parse(t.slice(start, k + 1)); } catch { return null; }
      }
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

function reresolve() {
  return flyNode("scripts/tmp-queue2-manual-cite-integrity-bundled.cjs", [], 300);
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
        FEATURE_AGENTS: "0",
      },
    },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const j = lastJson(text);
  return { status: r.status ?? 1, text, json: j };
}

function extractBatchMetrics(j, text) {
  const cl =
    Number(
      j?.sessionApiCalls ??
        j?.apiCallsDelta ??
        j?.courtListenerHttpCalls ??
        j?.sessionCalls ??
        j?.clCalls ??
        j?.requests ??
        0,
    ) ||
    Number((text.match(/"sessionApiCalls"\s*:\s*(\d+)/) || [])[1] || 0) ||
    Number((text.match(/courtListenerHttpCalls["']?\s*[:=]\s*(\d+)/) || [])[1] || 0);
  const cases =
    Number(
      j?.items_imported ??
        j?.itemsImported ??
        j?.imported ??
        j?.newCases ??
        j?.casesAdded ??
        j?.usefulCases ??
        0,
    ) ||
    Number((text.match(/"items_imported"\s*:\s*(\d+)/) || [])[1] || 0) ||
    Number((text.match(/itemsImported["']?\s*[:=]\s*(\d+)/) || [])[1] || 0);
  // Avoid false positives from last429Endpoint / citation strings containing 429
  const rateLimited =
    Boolean(j?.rateLimited) ||
    Number(j?.rateLimitCount || 0) > 0 ||
    /HTTP\s*429|"status"\s*:\s*429|Retry-After|RATE_LIMITED/i.test(text);
  const empty = cases === 0 && (/EMPTY|zero.?results|no.?results/i.test(text) || Number(j?.items_discovered || 0) === 0);
  return { cl, cases, rateLimited, empty, status: j?.status || j?.jobStatus || null };
}

const boot = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-quota.json"), "utf8"));
const startSnap = reresolve();
const startResolved = Number(startSnap.json?.resolvedAfter ?? boot.start.resolved);
const startCases = Number(startSnap.json?.corpus?.cases ?? boot.start.cases);
const startExtracted = Number(startSnap.json?.extracted ?? boot.start.extracted);

let laneABudget = Math.round(TOTAL * (boot.laneAShare || 0.55));
let laneBBudget = TOTAL - laneABudget;

const acc = {
  classification: "WEEK2_HYBRID_CLOSEOUT_BALANCED_CORPUS_AND_CITATION_DEMAND",
  startedAt: new Date().toISOString(),
  totalBudget: TOTAL,
  pacingMs: CL_RATE_MS,
  startCases,
  startResolved,
  startExtracted,
  startStateDc: boot.start.stateDc,
  startFederal: boot.start.federal,
  laneA: {
    budget: laneABudget,
    cl: 0,
    casesAdded: 0,
    batches: [],
    quarantined: [],
    oldEdgesResolved: 0,
  },
  laneB: {
    budget: laneBBudget,
    cl: 0,
    attempted: 0,
    found: 0,
    acquired: 0,
    oldEdgesResolved: 0,
    targetRows: [],
  },
  reallocationLog: [],
  totalCl: 0,
  stopReason: null,
  reliability: { "429": 0, "408": 0 },
  notes: [],
};

fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
process.stdout.write(`HYBRID_START total=${TOTAL} A=${laneABudget} B=${laneBBudget} cases=${startCases} resolved=${startResolved}\n`);

// ---------- LANE A ----------
for (const step of LANE_A_PLAN) {
  if (acc.laneA.cl >= laneABudget - 2) break;
  if (acc.stopReason) break;
  const rem = laneABudget - acc.laneA.cl;
  const maxCalls = Math.min(Number(step.maxCalls), rem, 12);
  if (maxCalls < 6) break;

  process.stdout.write(`\n=== LANE_A ${step.tag} court=${step.clCourt} maxCalls=${maxCalls} ===\n`);
  const beforeCases = Number(reresolve().json?.corpus?.cases || startCases);
  const beforeResolved = Number(reresolve().json?.resolvedAfter || startResolved);
  const run = oneshot(step, maxCalls);
  const m = extractBatchMetrics(run.json, run.text);
  if (m.rateLimited) {
    acc.reliability["429"] += 1;
    acc.stopReason = "429";
  }
  if (/408|HIST_QUERY_TIMEOUT|LANE_A_CHILD_SURVIVED/i.test(run.text)) {
    acc.reliability["408"] += 1;
    acc.notes.push({ at: new Date().toISOString(), note: "laneA_408_or_timeout", tag: step.tag });
  }

  const after = reresolve().json || {};
  const afterCases = Number(after.corpus?.cases || beforeCases);
  const afterResolved = Number(after.resolvedAfter || beforeResolved);
  const casesAdded = Math.max(0, afterCases - beforeCases);
  const cl = m.cl > 0 ? m.cl : maxCalls; // fallback accounting if parse weak
  const edgesFromA = Math.max(0, afterResolved - beforeResolved);

  acc.laneA.cl += cl;
  acc.laneA.casesAdded += casesAdded;
  acc.laneA.oldEdgesResolved += edgesFromA;
  acc.totalCl += cl;
  const row = {
    ...step,
    cl,
    casesAdded,
    clPerCase: casesAdded ? +(cl / casesAdded).toFixed(3) : null,
    edgesResolvedDelta: edgesFromA,
    rateLimited: m.rateLimited,
    empty: m.empty || casesAdded === 0,
    status: m.status,
  };
  acc.laneA.batches.push(row);
  if (row.empty) {
    acc.laneA.quarantined.push({ path: step.tag, reason: "empty_or_zero_cases", cl });
  }
  fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
  process.stdout.write(JSON.stringify({ lane: "A", tag: step.tag, cl, casesAdded, edges: edgesFromA, totalCl: acc.totalCl }) + "\n");
  if (acc.stopReason === "429") break;
}

// Mid checkpoint reallocation
{
  const aEff = acc.laneA.cl > 0 ? acc.laneA.casesAdded / acc.laneA.cl : 0;
  const bPrior = 3.3; // expected citation e/CL
  let reason = "hold_55_45";
  if (aEff >= 0.25 && acc.laneA.casesAdded >= 5) {
    // productive state growth — keep or bump A
    laneABudget = Math.min(TOTAL, Math.round(TOTAL * 0.6));
    laneBBudget = TOTAL - laneABudget;
    reason = "laneA_productive_bump_to_60";
  } else if (aEff < 0.1 && acc.laneA.cl >= 20) {
    laneABudget = Math.round(TOTAL * 0.4);
    laneBBudget = TOTAL - laneABudget;
    reason = "laneA_weak_shift_to_citation";
  }
  acc.reallocationLog.push({
    at: new Date().toISOString(),
    checkpoint: "after_laneA_block",
    laneAShare: +(laneABudget / TOTAL).toFixed(2),
    laneBShare: +(laneBBudget / TOTAL).toFixed(2),
    laneACasesPerCl: +aEff.toFixed(3),
    reason,
  });
  acc.laneA.budget = laneABudget;
  acc.laneB.budget = laneBBudget;
}

// ---------- LANE B: U.S. citation-demand via scale4 runner with remaining budget ----------
if (!acc.stopReason) {
  // Rebuild READY pools
  process.stdout.write("\n=== LANE_B rebuild READY ===\n");
  spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/run-tmp-queue2-cite-demand-rebuild-ready-local-scale4.cjs"), "300", "30", "0"],
    { encoding: "utf8", maxBuffer: 80e6, cwd: ROOT, env: process.env, stdio: "inherit" },
  );

  // Ensure scale4 ops does not resume prior Scale4 session — use fresh scale5/hybrid ops path
  // Generate a hybrid-specific scale runner by env override on a thin wrapper
  const remB = Math.max(0, laneBBudget - acc.laneB.cl);
  const citeBudget = remB;
  if (citeBudget >= 10) {
    process.stdout.write(`\n=== LANE_B citation US budget=${citeBudget} ===\n`);
    // Use scale4 runner but with fresh OUT via copy of script env — set CITE_SCALE4_BUDGET and
    // temporarily point by writing a hybrid ops bootstrap that scale4 won't confuse: we run scale5-like
    // dedicated small runner inline targeting US only from manifest.
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts/run-tmp-week2-hybrid-lane-b-cite.cjs"), String(citeBudget)],
      {
        encoding: "utf8",
        maxBuffer: 80e6,
        cwd: ROOT,
        env: { ...process.env, CL_RATE_MS: String(CL_RATE_MS) },
        stdio: "inherit",
      },
    );
    const laneBOpsPath = path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.json");
    if (fs.existsSync(laneBOpsPath)) {
      const b = JSON.parse(fs.readFileSync(laneBOpsPath, "utf8"));
      acc.laneB.cl = Number(b.totalCl || 0);
      acc.laneB.attempted = Number(b.targetsAttempted || 0);
      acc.laneB.found = Number(b.targetsFound || 0);
      acc.laneB.acquired = Number(b.targetsAcquired || 0);
      acc.laneB.oldEdgesResolved = Number(b.oldUnresolvedEdgesResolvedExact || 0);
      acc.laneB.targetRows = b.targetRows || [];
      acc.laneB.familyTable = b.familyTable || null;
      acc.laneB.usWindows = b.usWindows || null;
      acc.totalCl = acc.laneA.cl + acc.laneB.cl;
      if (b.stopReason === "429") {
        acc.stopReason = "429";
        acc.reliability["429"] += 1;
      }
      if (b.reliability) {
        acc.reliability["408"] += Number(b.reliability["408"] || 0);
      }
    } else {
      acc.notes.push({ at: new Date().toISOString(), note: "laneB_ops_missing", status: r.status });
    }
  }
}

const final = reresolve().json || {};
acc.endCases = Number(final.corpus?.cases || startCases);
acc.endResolved = Number(final.resolvedAfter || startResolved);
acc.endExtracted = Number(final.extracted || startExtracted);
acc.endStateDc = null;
acc.endFederal = null;
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) {
  acc.stopReason = acc.totalCl >= TOTAL - 2 ? "budget_exhausted" : "plan_complete";
}
acc.metrics = {
  laneACasesPerCl: acc.laneA.cl ? +(acc.laneA.casesAdded / acc.laneA.cl).toFixed(3) : null,
  laneBEdgesPerCl: acc.laneB.cl ? +(acc.laneB.oldEdgesResolved / acc.laneB.cl).toFixed(3) : null,
  netNewCases: Math.max(0, acc.endCases - startCases),
  remainingTo4700: Math.max(0, 4700 - acc.endCases),
  live12_5Target: Math.ceil(acc.endExtracted * 0.125),
  liveGap12_5: Math.max(0, Math.ceil(acc.endExtracted * 0.125) - acc.endResolved),
  resolutionPct: +((acc.endResolved / acc.endExtracted) * 100).toFixed(2),
};
acc.integrityFinal = {
  duplicates: final.duplicateSourceIds ?? null,
  orphans: final.orphans ?? null,
  missingEmbeddings: final.chunks?.missing_embeddings ?? null,
};
fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
console.log("WEEK2_HYBRID_DONE " + JSON.stringify({
  totalCl: acc.totalCl,
  laneA: { cl: acc.laneA.cl, cases: acc.laneA.casesAdded, edges: acc.laneA.oldEdgesResolved },
  laneB: { cl: acc.laneB.cl, acquired: acc.laneB.acquired, edges: acc.laneB.oldEdgesResolved },
  endCases: acc.endCases,
  endResolved: acc.endResolved,
  stop: acc.stopReason,
}));
process.exit(acc.stopReason === "429" ? 1 : 0);
