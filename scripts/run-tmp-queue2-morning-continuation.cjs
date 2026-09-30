#!/usr/bin/env node
/**
 * Morning continuation — G3H / G1 / district with tight CL budget.
 * Env: CONT_CL_BUDGET=20 CONT_CASE_TARGET=40
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const BUDGET = Number(process.env.CONT_CL_BUDGET || 20);
const CASE_TARGET = Number(process.env.CONT_CASE_TARGET || 40);

function lastJson(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* */ }
  }
  return null;
}
function flyNode(script, args = [], timeoutSec = 240) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/run-tmp-fly-node.cjs"), script, ...args], {
    encoding: "utf8", maxBuffer: 20e6, cwd: root,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec) },
  });
  return { status: r.status ?? 1, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`), stdout: r.stdout || "" };
}
function histWindow(court, gte, lte, take = 6) {
  const disc = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [court, gte, lte, String(Math.max(take, 8)), "search"], 90);
  let cl = Number(disc.json?.courtListenerHttpCalls || 0);
  if (disc.json?.status === "rate_limited") return { imported: 0, cl, status: "429", rateLimited: true };
  let ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (disc.json?.status === "HIST_QUERY_TIMEOUT") {
    const y = gte.slice(0, 4);
    const n = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [court, `${y}-01-01`, `${y}-12-31`, String(take), "search"], 90);
    cl += Number(n.json?.courtListenerHttpCalls || 0);
    ids = (n.json?.ids || []).map((x) => x.id).filter(Boolean);
  }
  if (!ids.length) return { imported: 0, cl, status: "empty" };
  const slice = ids.slice(0, take);
  const ing = flyNode("scripts/tmp-queue2-s3-hist-ingest-bundled.cjs", [court, slice.join(","), String(slice.length)], 240);
  cl += Number(ing.json?.courtListenerHttpCalls || 0);
  return {
    imported: Number(ing.json?.imported || 0),
    cl,
    status: ing.json?.status || "unknown",
    rateLimited: ing.json?.status === "rate_limited",
    skipped: Number(ing.json?.skipped || 0),
  };
}

const plan = [
  ["G3H", "ca11", "1990-01-01", "1994-12-31", 6],
  ["G3H", "ca6", "1990-01-01", "1994-12-31", 6],
  ["G3H", "ca7", "1990-01-01", "1994-12-31", 6],
  ["G3H", "ca9", "1990-01-01", "1994-12-31", 6],
  ["G1", "arizctapp", "1995-01-01", "2004-12-31", 5],
  ["G1", "connappct", "1995-01-01", "2004-12-31", 5],
  ["G1", "wisctapp", "1995-01-01", "2004-12-31", 5],
  ["DIST", "njd", "1990-01-01", "1999-12-31", 5],
  ["DIST", "paed", "1990-01-01", "1999-12-31", 5],
  ["DIST", "mad", "1990-01-01", "1999-12-31", 5],
  ["G3H", "ca11", "1995-01-01", "1999-12-31", 6],
  ["G2", "wis", "1985-01-01", "1994-12-31", 5],
  ["SCOTUS", "scotus", "1985-01-01", "1994-12-31", 5],
];

const acc = {
  classification: "MANUAL_QUEUE2_MORNING_CONTINUATION",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  totalCl: 0,
  totalImported: 0,
  batches: [],
  stopReason: null,
};
for (const [lane, court, gte, lte, take] of plan) {
  if (acc.totalCl >= BUDGET - 3) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }
  process.stdout.write(`\n=== ${lane} ${court} ${gte}..${lte} ===\n`);
  const h = histWindow(court, gte, lte, take);
  acc.totalCl += h.cl;
  acc.totalImported += h.imported;
  acc.batches.push({ lane, court, gte, lte, ...h });
  console.log(JSON.stringify({ court, imported: h.imported, cl: h.cl, totalCl: acc.totalCl, totalImported: acc.totalImported, status: h.status }));
  fs.writeFileSync(path.join(reports, "queue2-morning-continuation.json"), JSON.stringify(acc, null, 2));
  if (h.rateLimited) { acc.stopReason = "429"; break; }
}
if (!acc.stopReason) acc.stopReason = "plan_complete";
acc.finishedAt = new Date().toISOString();

const cite = flyNode("scripts/tmp-queue2-manual-cite-integrity-bundled.cjs", [], 300);
acc.citationReresolve = {
  newResolved: cite.json?.newResolved,
  resolvedAfter: cite.json?.resolvedAfter,
  resolvedBefore: cite.json?.resolvedBefore,
  targetAbsent: cite.json?.targetAbsent,
  extracted: cite.json?.extracted,
  duplicates: cite.json?.duplicates,
  orphans: cite.json?.orphans,
  missingEmbeddings: cite.json?.chunks?.missing_embeddings,
  corpus: cite.json?.corpus,
};
fs.writeFileSync(path.join(reports, "queue2-morning-continuation.json"), JSON.stringify(acc, null, 2));
console.log(JSON.stringify({ ok: true, totalCl: acc.totalCl, totalImported: acc.totalImported, stop: acc.stopReason, cases: acc.citationReresolve?.corpus?.cases }, null, 2));
