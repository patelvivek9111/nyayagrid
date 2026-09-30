#!/usr/bin/env node
/**
 * Morning pack execution — manual bounded batches after day-quota reset.
 * Usage: node scripts/run-tmp-queue2-morning-pack.cjs
 *
 * Env:
 *   MORNING_CL_BUDGET=350   (hard stop; leave day>=40)
 *   MORNING_CASE_TARGET=175
 *   MORNING_SKIP_A2=0
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const BUDGET = Number(process.env.MORNING_CL_BUDGET || 350);
const CASE_TARGET = Number(process.env.MORNING_CASE_TARGET || 175);
const PRESERVE_DAY = Number(process.env.MORNING_PRESERVE_DAY || 45);

function lastJson(text) {
  const lines = String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* keep */
    }
  }
  return null;
}

function flyNode(script, args = [], timeoutSec = 240) {
  const r = spawnSync(
    process.execPath,
    [path.join(root, "scripts/run-tmp-fly-node.cjs"), script, ...args],
    {
      encoding: "utf8",
      maxBuffer: 20e6,
      cwd: root,
      env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec) },
    },
  );
  return {
    status: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`),
  };
}

function oneshot(court, batchSize, targetMax, maxCalls, tag) {
  const r = spawnSync(
    process.execPath,
    [
      path.join(root, "scripts/run-tmp-manual-cl-oneshot.cjs"),
      court,
      String(batchSize),
      String(targetMax),
      String(maxCalls),
      tag,
    ],
    { encoding: "utf8", maxBuffer: 20e6, cwd: root },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const json = lastJson(text);
  const cl =
    Number(json?.courtListenerHttpCalls || json?.apiCalls || json?.clCalls || 0) ||
    (text.match(/courtListenerHttpCalls["\s:]+(\d+)/) || [])[1] ||
    0;
  const imported =
    Number(json?.imported || json?.casesAdded || json?.newCases || 0) ||
    (text.match(/"imported"\s*:\s*(\d+)/) || [])[1] ||
    0;
  return {
    status: r.status ?? 1,
    json,
    cl: Number(cl),
    imported: Number(imported),
    text: text.slice(0, 4000),
    rateLimited: /429|rate_limited/i.test(text),
    timedOut408: /408|LANE_A_CHILD_SURVIVED/i.test(text),
  };
}

function histWindow(court, gte, lte, take = 8) {
  const disc = flyNode(
    "scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs",
    [court, gte, lte, String(Math.max(take, 8)), "search"],
    90,
  );
  let cl = Number(disc.json?.courtListenerHttpCalls || 0);
  if (disc.json?.status === "rate_limited") {
    return { imported: 0, cl, status: "429", ids: [] };
  }
  let ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (disc.json?.status === "HIST_QUERY_TIMEOUT") {
    const y = gte.slice(0, 4);
    const n = flyNode(
      "scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs",
      [court, `${y}-01-01`, `${y}-12-31`, String(take), "search"],
      90,
    );
    cl += Number(n.json?.courtListenerHttpCalls || 0);
    ids = (n.json?.ids || []).map((x) => x.id).filter(Boolean);
  }
  if (!ids.length) return { imported: 0, cl, status: "empty", ids: [] };
  const slice = ids.slice(0, take);
  const ing = flyNode(
    "scripts/tmp-queue2-s3-hist-ingest-bundled.cjs",
    [court, slice.join(","), String(slice.length)],
    240,
  );
  cl += Number(ing.json?.courtListenerHttpCalls || 0);
  return {
    imported: Number(ing.json?.imported || 0),
    cl,
    status: ing.json?.status || "unknown",
    ids: slice,
    rateLimited: ing.json?.status === "rate_limited",
  };
}

function citeIntegrity() {
  // ensure bundled exists
  if (!fs.existsSync(path.join(root, "scripts/tmp-queue2-manual-cite-integrity-bundled.cjs"))) {
    spawnSync(
      "npx",
      [
        "esbuild",
        "scripts/tmp-queue2-manual-cite-integrity.cjs",
        "--bundle",
        "--platform=node",
        "--outfile=scripts/tmp-queue2-manual-cite-integrity-bundled.cjs",
      ],
      { cwd: root, encoding: "utf8", shell: true },
    );
  }
  return flyNode("scripts/tmp-queue2-manual-cite-integrity-bundled.cjs", [], 300);
}

function liveCount() {
  // reuse overnight wave-a tracker bundle if present; else oneshot truth via cite integrity corpus fields
  const r = citeIntegrity();
  return {
    cases: r.json?.corpus?.cases ?? null,
    citations: {
      extracted: r.json?.extracted,
      resolved: r.json?.resolvedAfter,
      targetAbsent: r.json?.targetAbsent,
    },
    integrity: {
      duplicates: r.json?.duplicates,
      orphans: r.json?.orphans,
      missingEmbeddings: r.json?.missingEmbeddings ?? r.json?.chunks?.missing_embeddings,
    },
    raw: r.json,
  };
}

const pack = JSON.parse(
  fs.readFileSync(path.join(reports, "queue2-morning-execution-pack.json"), "utf8"),
);
const dual = JSON.parse(
  fs.readFileSync(path.join(reports, "queue2-dual-value-case-queue.json"), "utf8"),
);

const acc = {
  classification: "MANUAL_QUEUE2_MORNING_EXECUTION_PACK",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  caseTarget: CASE_TARGET,
  preserveDay: PRESERVE_DAY,
  totalCl: 0,
  totalImported: 0,
  batches: [],
  skipped: [],
  dualValue: { candidates: 0, imported: 0, cl: 0, resolvedDelta: 0 },
  lanes: {
    dualValue: { imported: 0, cl: 0 },
    G3H: { imported: 0, cl: 0 },
    G2: { imported: 0, cl: 0 },
    G1: { imported: 0, cl: 0 },
    G3_DISTRICT: { imported: 0, cl: 0 },
    G3_SCOTUS: { imported: 0, cl: 0 },
    A2: { imported: 0, cl: 0, resolved: 0 },
  },
  stopReason: null,
  rateLimited: false,
  timedOut408: false,
};

function remainingBudget() {
  return BUDGET - acc.totalCl;
}

function stopIfNeeded(reason) {
  if (acc.stopReason) return true;
  if (remainingBudget() < 8) {
    acc.stopReason = reason || "budget_exhausted";
    return true;
  }
  if (acc.totalImported >= CASE_TARGET) {
    acc.stopReason = reason || "case_target_met";
    return true;
  }
  return false;
}

// Ensure hist tools bundled
for (const [src, out] of [
  ["scripts/tmp-queue2-s3-hist-discover-v2.cjs", "scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs"],
  ["scripts/tmp-queue2-s3-hist-ingest.cjs", "scripts/tmp-queue2-s3-hist-ingest-bundled.cjs"],
]) {
  if (!fs.existsSync(path.join(root, out)) && fs.existsSync(path.join(root, src))) {
    spawnSync("npx", ["esbuild", src, "--bundle", "--platform=node", `--outfile=${out}`], {
      cwd: root,
      encoding: "utf8",
      shell: true,
    });
  }
}

// --- Dual-value SCOTUS A2 via citation-target ingest (bounded) ---
const dualUs = (dual.top20 || [])
  .filter((t) => t.clObtainable && t.family === "us_reports")
  .slice(0, 8);
if (dualUs.length && process.env.MORNING_SKIP_A2 !== "1") {
  // Bundle A2 if needed
  if (!fs.existsSync(path.join(root, "scripts/tmp-queue2-a2-citation-target-ingest-bundled.cjs"))) {
    spawnSync(
      "npx",
      [
        "esbuild",
        "scripts/tmp-queue2-a2-citation-target-ingest.cjs",
        "--bundle",
        "--platform=node",
        "--outfile=scripts/tmp-queue2-a2-citation-target-ingest-bundled.cjs",
      ],
      { cwd: root, encoding: "utf8", shell: true },
    );
  }
  const cites = dualUs.map((t) => t.normalizedCitation).join("|");
  process.stdout.write(`\n=== DUAL-VALUE A2 ${dualUs.length} cites ===\n`);
  const a2 = flyNode(
    "scripts/tmp-queue2-a2-citation-target-ingest-bundled.cjs",
    [cites, "18"],
    420,
  );
  // If A2 needs env, fall back to SCOTUS historical oneshot batches instead
  const a2Cl = Number(a2.json?.courtListenerHttpCalls || 0);
  const a2Imp = Number(a2.json?.imported || a2.json?.ingested || 0);
  if (a2Cl > 0 || a2Imp > 0) {
    acc.totalCl += a2Cl;
    acc.totalImported += a2Imp;
    acc.lanes.dualValue.imported += a2Imp;
    acc.lanes.dualValue.cl += a2Cl;
    acc.lanes.A2.imported += a2Imp;
    acc.lanes.A2.cl += a2Cl;
    acc.dualValue.candidates = dualUs.length;
    acc.dualValue.imported += a2Imp;
    acc.dualValue.cl += a2Cl;
    acc.batches.push({
      lane: "DUAL_VALUE_A2",
      cites: dualUs.map((t) => t.normalizedCitation),
      imported: a2Imp,
      cl: a2Cl,
      status: a2.json?.status || "ran",
    });
  } else {
    acc.skipped.push({
      lane: "DUAL_VALUE_A2",
      reason: "a2_env_or_empty",
      detail: String(a2.json?.err || a2.json?.reason || "no_import").slice(0, 200),
    });
    // Fallback: SCOTUS historical window (dual-value adjacent)
    process.stdout.write("=== FALLBACK G3 SCOTUS hist ===\n");
    const h = histWindow("scotus", "1990-01-01", "1999-12-31", 8);
    acc.totalCl += h.cl;
    acc.totalImported += h.imported;
    acc.lanes.G3_SCOTUS.imported += h.imported;
    acc.lanes.G3_SCOTUS.cl += h.cl;
    acc.lanes.dualValue.imported += h.imported;
    acc.lanes.dualValue.cl += h.cl;
    acc.batches.push({ lane: "G3_SCOTUS_hist_fallback", ...h });
    if (h.rateLimited) {
      acc.rateLimited = true;
      acc.stopReason = "429";
    }
  }
}

// --- Federal historical weak circuits ---
const G3H = [
  ["ca11", "1990-01-01", "1994-12-31"],
  ["ca6", "1990-01-01", "1994-12-31"],
  ["ca7", "1990-01-01", "1994-12-31"],
  ["ca9", "1990-01-01", "1994-12-31"],
  ["ca11", "1995-01-01", "1999-12-31"],
  ["ca6", "1995-01-01", "1999-12-31"],
  ["ca8", "1990-01-01", "1994-12-31"],
  ["cadc", "1990-01-01", "1994-12-31"],
];
for (const [court, gte, lte] of G3H) {
  if (stopIfNeeded()) break;
  if (acc.rateLimited) break;
  process.stdout.write(`\n=== G3H ${court} ${gte}..${lte} ===\n`);
  const h = histWindow(court, gte, lte, 8);
  acc.totalCl += h.cl;
  acc.totalImported += h.imported;
  acc.lanes.G3H.imported += h.imported;
  acc.lanes.G3H.cl += h.cl;
  acc.batches.push({ lane: "G3_FEDERAL_HISTORICAL", court, gte, lte, ...h });
  fs.writeFileSync(path.join(reports, "queue2-morning-session-progress.json"), JSON.stringify(acc, null, 2));
  if (h.rateLimited) {
    acc.rateLimited = true;
    acc.stopReason = "429";
    break;
  }
}

// --- State intermediate verified ---
const G1 = [
  "arizctapp",
  "connappct",
  "nmctapp",
  "indctapp",
  "wisctapp",
  "utahctapp",
  "illappct",
  "massappct",
];
for (const court of G1) {
  if (stopIfNeeded()) break;
  if (acc.rateLimited) break;
  process.stdout.write(`\n=== G1 ${court} ===\n`);
  // Prefer historical intermediate window when thin
  const h = histWindow(court, "1995-01-01", "2004-12-31", 6);
  if (h.imported === 0 && h.status === "empty") {
    const o = oneshot(court, 6, 80, 14, `morn-g1-${court}`);
    acc.totalCl += o.cl;
    acc.totalImported += o.imported;
    acc.lanes.G1.imported += o.imported;
    acc.lanes.G1.cl += o.cl;
    acc.batches.push({ lane: "G1_STATE_INTERMEDIATE", court, mode: "oneshot", imported: o.imported, cl: o.cl, status: o.status });
    if (o.rateLimited) {
      acc.rateLimited = true;
      acc.stopReason = "429";
      break;
    }
    if (o.timedOut408) {
      acc.timedOut408 = true;
      // continue other courts; 408 architecture already kills remote
    }
  } else {
    acc.totalCl += h.cl;
    acc.totalImported += h.imported;
    acc.lanes.G1.imported += h.imported;
    acc.lanes.G1.cl += h.cl;
    acc.batches.push({ lane: "G1_STATE_INTERMEDIATE", court, mode: "hist", gte: "1995-01-01", lte: "2004-12-31", ...h });
    if (h.rateLimited) {
      acc.rateLimited = true;
      acc.stopReason = "429";
      break;
    }
  }
  fs.writeFileSync(path.join(reports, "queue2-morning-session-progress.json"), JSON.stringify(acc, null, 2));
}

// --- State historical high courts thin ---
const G2 = [
  ["wis", "1985-01-01", "1994-12-31"],
  ["conn", "1985-01-01", "1994-12-31"],
  ["nm", "1985-01-01", "1994-12-31"],
  ["ariz", "1985-01-01", "1994-12-31"],
  ["utah", "1985-01-01", "1994-12-31"],
  ["ind", "1985-01-01", "1994-12-31"],
];
for (const [court, gte, lte] of G2) {
  if (stopIfNeeded()) break;
  if (acc.rateLimited) break;
  process.stdout.write(`\n=== G2 ${court} ${gte}..${lte} ===\n`);
  const h = histWindow(court, gte, lte, 6);
  acc.totalCl += h.cl;
  acc.totalImported += h.imported;
  acc.lanes.G2.imported += h.imported;
  acc.lanes.G2.cl += h.cl;
  acc.batches.push({ lane: "G2_STATE_HISTORICAL", court, gte, lte, ...h });
  if (h.rateLimited) {
    acc.rateLimited = true;
    acc.stopReason = "429";
    break;
  }
  fs.writeFileSync(path.join(reports, "queue2-morning-session-progress.json"), JSON.stringify(acc, null, 2));
}

// --- District expansion ---
const DIST = [
  ["njd", "1990-01-01", "1999-12-31"],
  ["paed", "1990-01-01", "1999-12-31"],
  ["mad", "1990-01-01", "1999-12-31"],
  ["flsd", "1990-01-01", "1999-12-31"],
  ["txnd", "1990-01-01", "1999-12-31"],
  ["cand", "1990-01-01", "1999-12-31"],
  ["waed", "1990-01-01", "1999-12-31"],
  ["dcd", "2000-01-01", "2009-12-31"],
  ["txsd", "2000-01-01", "2009-12-31"],
  ["ilnd", "1985-01-01", "1994-12-31"],
];
for (const [court, gte, lte] of DIST) {
  if (stopIfNeeded()) break;
  if (acc.rateLimited) break;
  if (acc.lanes.G3_DISTRICT.imported >= 50) break;
  process.stdout.write(`\n=== DISTRICT ${court} ${gte}..${lte} ===\n`);
  const h = histWindow(court, gte, lte, 5);
  acc.totalCl += h.cl;
  acc.totalImported += h.imported;
  acc.lanes.G3_DISTRICT.imported += h.imported;
  acc.lanes.G3_DISTRICT.cl += h.cl;
  acc.batches.push({ lane: "G3_DISTRICT", court, gte, lte, ...h });
  if (h.rateLimited) {
    acc.rateLimited = true;
    acc.stopReason = "429";
    break;
  }
  fs.writeFileSync(path.join(reports, "queue2-morning-session-progress.json"), JSON.stringify(acc, null, 2));
}

if (!acc.stopReason) acc.stopReason = "plan_complete";

// Citation reresolve
process.stdout.write("\n=== CITE INTEGRITY ===\n");
const citeBeforeImported = acc.totalImported;
const cite = citeIntegrity();
acc.citationReresolve = {
  newResolved: cite.json?.newResolved,
  resolvedAfter: cite.json?.resolvedAfter,
  resolvedBefore: cite.json?.resolvedBefore,
  targetAbsent: cite.json?.targetAbsent,
  extracted: cite.json?.extracted,
  duplicates: cite.json?.duplicates,
  orphans: cite.json?.orphans,
  missingEmbeddings: cite.json?.chunks?.missing_embeddings ?? cite.json?.missingEmbeddings,
  corpus: cite.json?.corpus,
};

acc.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(reports, "queue2-morning-session.json"), JSON.stringify(acc, null, 2));
console.log(
  JSON.stringify({
    ok: !acc.rateLimited || acc.totalImported > 0,
    totalCl: acc.totalCl,
    totalImported: acc.totalImported,
    stopReason: acc.stopReason,
    lanes: acc.lanes,
    cases: acc.citationReresolve?.corpus?.cases,
  }),
);
process.exit(acc.rateLimited && acc.totalImported === 0 ? 1 : 0);
