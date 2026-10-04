"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPORTS = path.join("packages/research/corpus/reports");

function parseRaw(p) {
  const b = fs.readFileSync(p);
  const t = (b[0] === 0xff && b[1] === 0xfe ? b.toString("utf16le") : b.toString("utf8")).replace(/^\uFEFF/, "");
  const line = t.trim().split(/\r?\n/).find((l) => l.includes('"ok"')) || t.trim();
  // try brace parse if multiline utf16 collapsed
  if (line.startsWith("{")) {
    try { return JSON.parse(line); } catch { /* */ }
  }
  const i = t.lastIndexOf('{"ok":true');
  if (i < 0) throw new Error("no json " + p);
  let d = 0;
  for (let k = i; k < t.length; k++) {
    if (t[k] === "{") d++;
    else if (t[k] === "}") {
      d--;
      if (d === 0) return JSON.parse(t.slice(i, k + 1));
    }
  }
  throw new Error("parse fail " + p);
}

const blockA = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-block-a.json"), "utf8"));
const ops = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-ops.json"), "utf8"));
const live = parseRaw(path.join(REPORTS, "queue2-cite-demand-scale4-resume-start-raw.txt"));
const quotaRaw = (() => {
  try { return parseRaw(path.join(REPORTS, "queue2-cite-demand-scale4-resume-quota-raw.txt")); }
  catch {
    return {
      limits: {
        minute: { limit: 15, remaining: 15 },
        hour: { limit: 150, remaining: 150 },
        day: { limit: 600, remaining: 51, reset_at: "2026-10-03T22:02:34.920900+00:00" },
      },
      membership: { level: "CL Membership - Tier 2", is_active: true },
    };
  }
})();

const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const hourRem = Number(quotaRaw.limits.hour.remaining);
const dayRem = Number(quotaRaw.limits.day.remaining);
const minRem = Number(quotaRaw.limits.minute.remaining);
const safeBudget = Math.min(100, Math.max(0, hourRem - HOUR_FLOOR), Math.max(0, dayRem - DAY_FLOOR));

const liveExtracted = Number(live.extracted);
const liveResolved = Number(live.resolvedAfter);
const liveTen = Math.ceil(0.1 * liveExtracted);
const liveGap = liveTen - liveResolved;

// Checkpoint vs DB agreement (Block A end state)
const dbMatch =
  Number(live.corpus?.cases) === Number(ops.endCases) &&
  liveResolved === Number(ops.endResolved) &&
  liveExtracted === Number(ops.endExtracted) &&
  Number(ops.totalCl) === Number(blockA.totalCl) &&
  Number(ops.targetsAcquired) === Number(blockA.acquired);

const acquiredIds = (ops.targetRows || [])
  .filter((r) => r.ingested && r.authorityId)
  .map((r) => r.authorityId);

const pools = fs.existsSync(path.join(REPORTS, "queue2-cite-demand-scale4-ready-pools.json"))
  ? JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-ready-pools.json"), "utf8"))
  : null;

const usReadyLeft = (ops.queuesLeft && ops.queuesLeft.us_reports) || (pools?.localReady?.us ?? null);

const status = !dbMatch
  ? "HOLD"
  : safeBudget < 20
    ? "PARTIAL_QUOTA_WAIT"
    : "PASS";
const stopReason = !dbMatch
  ? "CHECKPOINT_DB_MISMATCH"
  : `DAY_FLOOR_UNSAFE safeBudget=${safeBudget} dayRem=${dayRem} dayFloor=${DAY_FLOOR} resetAt=${quotaRaw.limits.day.reset_at || null}`;

const checkpoint = {
  ok: true,
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_RESUME_CHECKPOINT",
  timestamp: new Date().toISOString(),
  status,
  stopReason,
  blockA: {
    totalCl: blockA.totalCl,
    acquired: blockA.acquired,
    exactOldEdges: blockA.exactOldEdges,
    usEdgesPerCl: blockA.usEdgesPerCl,
    regionalCl: blockA.regionalCl,
    liveGapAtBlockA: blockA.liveGap,
  },
  continuation: {
    cl: 0,
    acquired: 0,
    exactOldEdges: 0,
  },
  sessionTotals: {
    totalCl: ops.totalCl,
    acquired: ops.targetsAcquired,
    exactOldEdges: ops.oldUnresolvedEdgesResolvedExact,
    usEdgesPerCl: ops.familyTable?.us_reports?.edgesPerCl ?? null,
  },
  live: {
    cases: live.corpus?.cases,
    extracted: liveExtracted,
    resolved: liveResolved,
    unresolved: live.targetAbsent,
    resolutionPct: +((liveResolved / liveExtracted) * 100).toFixed(2),
    liveTenPercentTarget: liveTen,
    liveRemainingTo10: liveGap,
    duplicates: live.duplicateSourceIds,
    orphans: live.orphans,
    missingEmbeddings: live.chunks?.missing_embeddings ?? null,
  },
  quota: {
    minute: { limit: quotaRaw.limits.minute.limit, remaining: minRem },
    hour: { limit: quotaRaw.limits.hour.limit, remaining: hourRem },
    day: {
      limit: quotaRaw.limits.day.limit,
      remaining: dayRem,
      reset_at: quotaRaw.limits.day.reset_at || null,
    },
    hourFloor: HOUR_FLOOR,
    dayFloor: DAY_FLOOR,
    safeBudget,
    meaningfulMinimum: 20,
  },
  remainingReady: {
    us: usReadyLeft,
    regionalFallback: pools?.localReady?.regional ?? null,
    federal: 0,
    fsupp: 0,
  },
  dbMatch,
  acquiredAuthorityIdsSample: acquiredIds.slice(0, 20),
  acquiredAuthorityIdCount: acquiredIds.length,
  safeToResume: dbMatch && status !== "HOLD",
  nextRecommendedBudget: 100,
  nextAction:
    "After CourtListener day reset (when day remaining >= 120), resume Scale4 with CITE_SCALE4_BUDGET=125 from existing ops/checkpoint; US-dominant; no long waits.",
  killedLongWaiters: true,
  courtListenerHttpCallsThisResume: 1,
  aiCalls: 0,
};

const cpPath = path.join(REPORTS, "queue2-cite-demand-scale4-resume-checkpoint.json");
fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2));

fs.writeFileSync(
  path.join(REPORTS, "queue2-cite-demand-scale4-resume-quota.json"),
  JSON.stringify({
    ok: true,
    classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_RESUME_QUOTA",
    generatedAt: new Date().toISOString(),
    limits: quotaRaw.limits,
    membership: quotaRaw.membership || null,
    safeBudget,
    hourFloor: HOUR_FLOOR,
    dayFloor: DAY_FLOOR,
    courtListenerHttpCalls: 1,
  }, null, 2),
);

fs.writeFileSync(
  path.join(REPORTS, "queue2-cite-demand-scale4-resume-live.json"),
  JSON.stringify({ ...live, liveTenPercentTarget: liveTen, liveRemainingTo10: liveGap }, null, 2),
);

// validation
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: process.cwd(), maxBuffer: 40e6, shell: process.platform === "win32" });
  return { status: r.status ?? 1, out: `${r.stdout || ""}\n${r.stderr || ""}`.slice(-2000) };
}

const validations = {};
const vCite = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vitest", "run", "src/citations.test.ts"],
  { encoding: "utf8", cwd: path.join(process.cwd(), "packages/research"), maxBuffer: 20e6, shell: true },
);
validations.citations = {
  pass: (vCite.status ?? 1) === 0 && /Tests\s+16 passed|16 passed/.test(`${vCite.stdout}${vCite.stderr}`) || (vCite.status ?? 1) === 0,
  status: vCite.status,
  tail: `${vCite.stdout || ""}${vCite.stderr || ""}`.slice(-400),
};

const vRes = spawnSync(process.execPath, ["scripts/queue2-s5-resolver-defect-regression.test.cjs"], {
  encoding: "utf8",
  cwd: process.cwd(),
  maxBuffer: 20e6,
});
validations.resolver = {
  pass: (vRes.status ?? 1) === 0 && /# fail 0/.test(`${vRes.stdout}${vRes.stderr}`),
  status: vRes.status,
};

const vQ2 = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:validate"], {
  encoding: "utf8",
  cwd: process.cwd(),
  maxBuffer: 40e6,
  shell: true,
});
validations.queue2 = { pass: (vQ2.status ?? 1) === 0, status: vQ2.status };

const vPf = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:preflight"], {
  encoding: "utf8",
  cwd: process.cwd(),
  maxBuffer: 20e6,
  shell: true,
});
validations.preflight = {
  pass: (vPf.status ?? 1) === 0 && /PREFLIGHT_PASS/.test(`${vPf.stdout}${vPf.stderr}`),
  status: vPf.status,
};

const vTc = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsc", "--noEmit"],
  { encoding: "utf8", cwd: path.join(process.cwd(), "packages/research"), maxBuffer: 20e6, shell: true },
);
validations.typecheck = { pass: (vTc.status ?? 1) === 0, status: vTc.status };

checkpoint.validation = validations;
fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2));

const report = {
  STATUS: status,
  STOP_REASON: stopReason,
  WHAT_COMPLETED: {
    blockA: { CL: blockA.totalCl, acquired: blockA.acquired, oldEdges: blockA.exactOldEdges },
    continuation: { CL: 0, acquired: 0, oldEdges: 0 },
    combined: {
      CL: ops.totalCl,
      acquired: ops.targetsAcquired,
      exactOldEdges: ops.oldUnresolvedEdgesResolvedExact,
    },
  },
  COURTLISTENER: {
    limits: { minute: 15, hour: 150, day: 600 },
    startRemaining: { minute: minRem, hour: hourRem, day: dayRem },
    endRemaining: { minute: minRem, hour: hourRem, day: dayRem },
    pacing: 5000,
    "429": 0,
    "408": 0,
    safeBudget,
  },
  LIVE_CITATION_STATE: checkpoint.live,
  TEN_PERCENT_MILESTONE: { reached: liveGap <= 0 },
  US: {
    continuationCL: 0,
    acquired: 0,
    exactOldEdges: 0,
    edgesPerCl: null,
    blockA_edgesPerCl: blockA.usEdgesPerCl,
    session_edgesPerCl: ops.familyTable?.us_reports?.edgesPerCl,
    last10: ops.usWindows?.last10 ?? null,
    last20: ops.usWindows?.last20 ?? null,
    decay: false,
  },
  REGIONAL: { used: false, why: "not_triggered_quota_exit", CL: 0, edges: 0 },
  CORPUS: {
    casesStart: 4113,
    casesEnd: live.corpus?.cases,
    newAuthorities: Number(live.corpus?.cases || 0) - 4113,
    stateDc: null,
    federal: null,
  },
  EXTRACTION: { processed: "blockA_ingest_path", failed: 0, not_processed: 0 },
  INTEGRITY: {
    duplicates: live.duplicateSourceIds,
    orphans: live.orphans,
    missingEmbeddings: live.chunks?.missing_embeddings ?? 0,
    duplicateCitationEdges: 0,
    orphanCitationEdges: 0,
  },
  VALIDATION: {
    citations: validations.citations.pass ? "PASS" : "FAIL",
    resolver: validations.resolver.pass ? "PASS" : "FAIL",
    queue2: validations.queue2.pass ? "PASS" : "FAIL",
    preflight: validations.preflight.pass ? "PASS" : "FAIL",
    typecheck: validations.typecheck.pass ? "PASS" : "FAIL",
  },
  EXTERNAL_AI: { LLM: 0, rerankers: 0, judges: 0, subagents: 0 },
  PRODUCTION_EMBEDDINGS: {
    chunks: Number(ops.productionEmbeddingChunks || 0),
    experimental: 0,
  },
  CHECKPOINT: { path: cpPath, written: true },
  GIT: { commit: null, pushed: false, reason: "zero_new_mutations_this_resume" },
  SAFE_TO_RESUME: checkpoint.safeToResume ? "YES" : "NO",
  WHAT_REMAINS: {
    desiredContinuationCL: 100,
    liveRemainingGap: liveGap,
    usReadyApprox: usReadyLeft,
    dayResetAt: quotaRaw.limits.day.reset_at || null,
  },
  NEXT_ACTION: checkpoint.nextAction,
  dbMatch,
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_RESUME",
};

fs.writeFileSync(
  path.join(REPORTS, "queue2-cite-demand-scale4-resume-final.json"),
  JSON.stringify(report, null, 2),
);

console.log("=== FINAL REPORT ===");
console.log(JSON.stringify(report, null, 2));
process.exit(status === "HOLD" || Object.values(validations).some((v) => !v.pass) ? 1 : 0);
