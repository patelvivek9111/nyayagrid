/**
 * Lane A reopen: raise targetMax above prior items_imported so jobs resume.
 * Measure useful cases via LIVE corpus delta only (ignore stale items_imported).
 * Cap 40 CL. Zero LLM.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-hybrid-closeout-lane-a-reopen.json");
const BUDGET = Math.min(Math.max(Number(process.argv[2] || 40), 8), 40);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 2500);

const PLAN = [
  { jurisdiction: "WI", clCourt: "wisctapp", batchSize: "5", targetMax: "100", maxCalls: "8", tag: "w2hr-wisctapp" },
  { jurisdiction: "UT", clCourt: "utahctapp", batchSize: "5", targetMax: "80", maxCalls: "8", tag: "w2hr-utahctapp" },
  { jurisdiction: "IN", clCourt: "indctapp", batchSize: "5", targetMax: "80", maxCalls: "8", tag: "w2hr-indctapp" },
  { jurisdiction: "KY", clCourt: "kyctapp", batchSize: "5", targetMax: "80", maxCalls: "8", tag: "w2hr-kyctapp" },
  { jurisdiction: "MI", clCourt: "mich", batchSize: "5", targetMax: "100", maxCalls: "8", tag: "w2hr-mich" },
  { jurisdiction: "LA", clCourt: "la", batchSize: "5", targetMax: "100", maxCalls: "8", tag: "w2hr-la" },
  { jurisdiction: "WA", clCourt: "wash", batchSize: "5", targetMax: "100", maxCalls: "8", tag: "w2hr-wash" },
  { jurisdiction: "MD", clCourt: "md", batchSize: "5", targetMax: "100", maxCalls: "8", tag: "w2hr-md" },
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

function liveCases() {
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

const start = liveCases();
const startCases = Number(start?.corpus?.cases || 0);
const acc = {
  classification: "WEEK2_HYBRID_LANE_A_REOPEN",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  startCases,
  batches: [],
  quarantined: [],
  productive: [],
  cl: 0,
  liveCasesAdded: 0,
  stopReason: null,
};

process.stdout.write(`LANE_A_REOPEN_START budget=${BUDGET} startCases=${startCases}\n`);

for (const step of PLAN) {
  if (acc.cl >= BUDGET) {
    acc.stopReason = "budget_exhausted";
    break;
  }
  const maxCalls = Math.min(Number(step.maxCalls), BUDGET - acc.cl);
  if (maxCalls < 3) break;

  const before = liveCases();
  const casesBefore = Number(before?.corpus?.cases || acc.startCases + acc.liveCasesAdded);
  process.stdout.write(`\n=== ${step.tag} court=${step.clCourt} targetMax=${step.targetMax} maxCalls=${maxCalls} casesBefore=${casesBefore} ===\n`);
  const r = oneshot(step, maxCalls);
  const j = r.json;
  const cl = Number(j?.sessionApiCalls ?? j?.apiCallsDelta ?? j?.apiCalls ?? 0) || 0;
  const rateLimited = Number(j?.rateLimitCount || 0) > 0 || /HTTP\s*429|"status"\s*:\s*429|RATE_LIMITED/i.test(r.text);
  const already = String(j?.reason || "").includes("already_completed");
  const mappingInvalid = /mapping_invalid|MAPPING_INVALID|unmapped_court/i.test(r.text);
  const after = liveCases();
  const casesAfter = Number(after?.corpus?.cases || casesBefore);
  const delta = Math.max(0, casesAfter - casesBefore);
  acc.cl += cl;
  acc.liveCasesAdded += delta;
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
    already,
    mappingInvalid,
  };
  acc.batches.push(row);
  process.stdout.write(JSON.stringify({ tag: step.tag, cl, liveDelta: delta, casesAfter, totalCl: acc.cl, totalLiveAdds: acc.liveCasesAdded, reason: row.reason }) + "\n");

  if (rateLimited) {
    acc.stopReason = "rate_limited";
    acc.quarantined.push({ path: step.tag, reason: "429" });
    break;
  }
  if (mappingInvalid || already || delta === 0) {
    acc.quarantined.push({ path: step.tag, reason: mappingInvalid ? "mapping_invalid" : already ? "already_completed" : "zero_live_delta", cl });
    continue;
  }
  acc.productive.push({ path: step.tag, jurisdiction: step.jurisdiction, cl, liveDelta: delta });
}

if (!acc.stopReason) acc.stopReason = acc.cl >= BUDGET ? "budget_exhausted" : "plan_exhausted";
acc.finishedAt = new Date().toISOString();
acc.endCases = startCases + acc.liveCasesAdded;
acc.clPerCase = acc.liveCasesAdded > 0 ? Number((acc.cl / acc.liveCasesAdded).toFixed(3)) : null;
fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
process.stdout.write(`LANE_A_REOPEN_DONE ${JSON.stringify({ cl: acc.cl, liveCasesAdded: acc.liveCasesAdded, clPerCase: acc.clPerCase, endCases: acc.endCases, stop: acc.stopReason })}\n`);
process.exit(0);
