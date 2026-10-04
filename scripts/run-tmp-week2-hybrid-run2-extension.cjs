/**
 * Run2 extension: VALID intermediate Lane A + fresh U.S. Lane B.
 * Uses remaining safe budget. Live case deltas only.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-hybrid-closeout-run2-extension.json");
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 2500);
const A_BUDGET = Math.min(Math.max(Number(process.argv[2] || 40), 8), 50);
const B_BUDGET = Math.min(Math.max(Number(process.argv[3] || 30), 8), 40);

const PLAN = [
  { jurisdiction: "WI", clCourt: "wisctapp", batchSize: "5", targetMax: "140", maxCalls: "10", tag: "w2r2x-wisctapp" },
  { jurisdiction: "UT", clCourt: "utahctapp", batchSize: "5", targetMax: "120", maxCalls: "10", tag: "w2r2x-utahctapp" },
  { jurisdiction: "IN", clCourt: "indctapp", batchSize: "5", targetMax: "120", maxCalls: "10", tag: "w2r2x-indctapp" },
  { jurisdiction: "KY", clCourt: "kyctapp", batchSize: "5", targetMax: "120", maxCalls: "10", tag: "w2r2x-kyctapp" },
];

const registry = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));
for (const step of PLAN) {
  if (registry.courts?.[step.clCourt]?.mappingStatus !== "VALID_MAPPED") {
    console.log(JSON.stringify({ ok: false, reason: "INVALID_AFTER_PREFLIGHT", court: step.clCourt }));
    process.exit(2);
  }
}

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
  return null;
}

function liveSnap() {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/run-tmp-fly-node.cjs"), "scripts/tmp-queue2-manual-cite-integrity-bundled.cjs"],
    { encoding: "utf8", maxBuffer: 40e6, cwd: ROOT, env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: "240" } },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const lines = text.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(lines[i]);
      if (j?.corpus?.cases != null) return j;
    } catch { /* */ }
  }
  return null;
}

function oneshot(step, maxCalls) {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/run-tmp-manual-cl-oneshot.cjs"), step.clCourt, step.batchSize, step.targetMax, String(maxCalls), step.tag],
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
  return { text: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}

const start = liveSnap();
const acc = {
  classification: "WEEK2_HYBRID_CLOSEOUT_RUN2_EXTENSION",
  startedAt: new Date().toISOString(),
  startCases: Number(start?.corpus?.cases || 0),
  startResolved: Number(start?.resolvedAfter || 0),
  laneA: { budget: A_BUDGET, cl: 0, casesAdded: 0, batches: [], productive: [], stopped: [] },
  laneB: { budget: B_BUDGET, cl: 0, acquired: 0, oldEdgesResolved: 0 },
  totalCl: 0,
  clWastedOnInvalidMapping: 0,
};

process.stdout.write(`RUN2_EXT_START A=${A_BUDGET} B=${B_BUDGET} cases=${acc.startCases}\n`);

for (const step of PLAN) {
  if (acc.laneA.cl >= A_BUDGET) break;
  const maxCalls = Math.min(Number(step.maxCalls), A_BUDGET - acc.laneA.cl);
  if (maxCalls < 3) break;
  const before = liveSnap();
  const casesBefore = Number(before?.corpus?.cases || acc.startCases + acc.laneA.casesAdded);
  process.stdout.write(`\n=== EXT_A ${step.tag} maxCalls=${maxCalls} casesBefore=${casesBefore} ===\n`);
  const r = oneshot(step, maxCalls);
  const j = r.json;
  const cl = Number(j?.sessionApiCalls ?? j?.apiCallsDelta ?? j?.apiCalls ?? 0) || 0;
  if (/unmapped_court|MAPPING_INVALID/i.test(r.text)) {
    acc.clWastedOnInvalidMapping += cl;
    acc.laneA.stopped.push({ path: step.tag, reason: "unmapped" });
    continue;
  }
  const after = liveSnap();
  const casesAfter = Number(after?.corpus?.cases || casesBefore);
  const delta = Math.max(0, casesAfter - casesBefore);
  acc.laneA.cl += cl;
  acc.totalCl += cl;
  acc.laneA.casesAdded += delta;
  acc.laneA.batches.push({ ...step, cl, liveDelta: delta, casesBefore, casesAfter, reason: j?.reason || null });
  process.stdout.write(JSON.stringify({ tag: step.tag, cl, liveDelta: delta, totalCl: acc.totalCl }) + "\n");
  if (delta === 0) acc.laneA.stopped.push({ path: step.tag, reason: j?.reason || "zero_delta", cl });
  else acc.laneA.productive.push({ path: step.tag, cl, liveDelta: delta });
  if (Number(j?.rateLimitCount || 0) > 0) break;
}

const mid = liveSnap();
acc.laneA.oldEdgesResolved = Math.max(0, Number(mid?.resolvedAfter || 0) - acc.startResolved);

// Fresh Lane B
const laneBOps = path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.json");
if (fs.existsSync(laneBOps)) {
  try { fs.renameSync(laneBOps, path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.run2main.json")); } catch { fs.unlinkSync(laneBOps); }
}
const rebuildBundled = "scripts/tmp-queue2-cite-demand-rebuild-ready-pools-bundled.cjs";
if (fs.existsSync(path.join(ROOT, rebuildBundled))) {
  spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-fly-node.cjs"), rebuildBundled], {
    encoding: "utf8",
    maxBuffer: 40e6,
    cwd: ROOT,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: "240" },
  });
}
process.stdout.write(`\n=== EXT_B US budget=${B_BUDGET} ===\n`);
const b = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-week2-hybrid-lane-b-cite.cjs"), String(B_BUDGET)], {
  encoding: "utf8",
  maxBuffer: 40e6,
  cwd: ROOT,
  env: { ...process.env, CL_RATE_MS: String(CL_RATE_MS), FEATURE_AGENTS: "0" },
});
process.stdout.write(b.stdout || "");
if (fs.existsSync(laneBOps)) {
  const bOps = JSON.parse(fs.readFileSync(laneBOps, "utf8"));
  fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-lane-b-ops.json"), JSON.stringify(bOps, null, 2));
  acc.laneB.cl = Number(bOps.totalCl || 0);
  acc.laneB.attempted = Number(bOps.targetsAttempted || 0);
  acc.laneB.acquired = Number(bOps.targetsAcquired || 0);
  acc.laneB.oldEdgesResolved = Number(bOps.byFamily?.us_reports?.oldEdgesResolved || 0);
  acc.laneB.edgesPerCl = acc.laneB.cl > 0 ? Number((acc.laneB.oldEdgesResolved / acc.laneB.cl).toFixed(3)) : null;
  acc.totalCl += acc.laneB.cl;
}

const end = liveSnap();
acc.endCases = Number(end?.corpus?.cases || 0);
acc.endResolved = Number(end?.resolvedAfter || 0);
acc.endExtracted = Number(end?.extracted || 0);
acc.finishedAt = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
process.stdout.write(
  `RUN2_EXT_DONE ${JSON.stringify({
    totalCl: acc.totalCl,
    laneA: { cl: acc.laneA.cl, cases: acc.laneA.casesAdded, edges: acc.laneA.oldEdgesResolved },
    laneB: { cl: acc.laneB.cl, acquired: acc.laneB.acquired, edges: acc.laneB.oldEdgesResolved },
    endCases: acc.endCases,
    endResolved: acc.endResolved,
    invalidWaste: acc.clWastedOnInvalidMapping,
  })}\n`,
);
process.exit(acc.clWastedOnInvalidMapping === 0 ? 0 : 2);
