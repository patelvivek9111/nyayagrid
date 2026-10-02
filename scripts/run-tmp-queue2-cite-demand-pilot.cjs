/**
 * Citation-demand stratified CL pilot orchestrator.
 * Uses citation-lookup multi-family ingest. Measures old-edges/CL.
 * No blind historical window scanning.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const MANIFEST = path.join(REPORTS, "citation-demand-acquisition-manifest.json");
const OUT = path.join(REPORTS, "queue2-cite-demand-pilot-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.CITE_PILOT_CL_BUDGET || 100), 40), 120);
const DENY = new Set(["573 U.S. 373"]); // prior verified NOT_FOUND

// Weak historical prior — veto only, no numeric cost
const BAD_SOURCE_SIGNAL = new Set([
  "ca2_hist_1990s", "ca4_hist_1990s", "ca10_hist_1990s", "cafc_empty", "waed_1985_1994",
]);

function lastJson(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* */ }
  }
  return null;
}
function flyNode(script, args, timeoutSec) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-fly-node.cjs"), script, ...args], {
    encoding: "utf8", maxBuffer: 30e6, cwd: ROOT,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec) },
  });
  return { status: r.status ?? 1, out: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}
function reresolve() {
  return flyNode("scripts/tmp-queue2-manual-cite-integrity-bundled.cjs", [], 300);
}

function pickStratified(manifest, nPerFamily) {
  const by = { us_reports: [], federal_reporter: [], regional_reporter: [], federal_supplement: [] };
  for (const t of manifest.targets || []) {
    if (t.status !== "READY_CL") continue;
    if (t.localTargetPresent) continue;
    if (DENY.has(t.citation) || DENY.has(t.canonicalTargetKey)) continue;
    const f = t.citationFamily;
    if (!by[f]) continue;
    by[f].push(t);
  }
  for (const f of Object.keys(by)) by[f].sort((a, b) => (b.edgeDemand || 0) - (a.edgeDemand || 0));
  const picked = [];
  for (const f of ["us_reports", "federal_reporter", "regional_reporter", "federal_supplement"]) {
    for (const t of by[f].slice(0, nPerFamily)) {
      picked.push({
        ...t,
        historicalAcquisitionPrior: "UNKNOWN", // target-mode; old window cost not applicable
      });
    }
  }
  // If no F.Supp in top500, leave empty — that's fine
  return picked;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  // Bundle multi-ingest for fly upload (must inline postgres)
  const bundlePath = path.join(ROOT, "scripts/tmp-queue2-cite-demand-multi-ingest-bundled.cjs");
  const b = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules/esbuild/bin/esbuild"),
      path.join(ROOT, "scripts/tmp-queue2-cite-demand-multi-ingest.cjs"),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--packages=bundle",
      "--outfile=" + bundlePath,
    ],
    { encoding: "utf8", cwd: ROOT },
  );
  if (b.status !== 0) {
    console.log(JSON.stringify({ ok: false, reason: "esbuild_failed", err: (b.stderr || b.stdout || "").slice(0, 500) }));
    process.exit(2);
  }

  const seed = pickStratified(manifest, 12); // up to 12 per family
  const startCite = reresolve();
  const startResolved = Number(startCite.json?.resolvedAfter || startCite.json?.resolved || 1815);
  const startCases = Number(startCite.json?.corpus?.cases || 3867);

  const acc = {
    classification: "CITATION_DEMAND_TARGETED_CL_PILOT",
    startedAt: new Date().toISOString(),
    budget: BUDGET,
    startResolved,
    startCases,
    totalCl: 1, // quota probe already counted separately; pilot CL starts at 0 for acquisition — we track acquisition CL only
    acquisitionCl: 0,
    targetsAttempted: 0,
    targetsFound: 0,
    targetsAcquired: 0,
    byFamily: {},
    targetOutcomes: {},
    batches: [],
    targetRows: [],
    weakPriorNotes: [],
    stopReason: null,
    reliability: { "408": 0, "429": 0 },
    badSourceSignalKnown: [...BAD_SOURCE_SIGNAL],
  };
  // Reset acquisitionCl to 0 properly
  acc.totalCl = 0;

  // Process in micro-batches of 4 mixed-family when possible
  const queue = [...seed];
  let sinceReresolveAcquired = 0;
  let resolvedCursor = startResolved;

  while (queue.length && acc.totalCl < BUDGET - 4) {
    // take next up to 4 from different families preferentially
    const batch = [];
    const usedFam = new Set();
    for (let i = 0; i < queue.length && batch.length < 4; i++) {
      const t = queue[i];
      if (usedFam.has(t.citationFamily) && batch.length < 3) continue;
      batch.push(t);
      usedFam.add(t.citationFamily);
      queue.splice(i, 1);
      i--;
    }
    if (!batch.length) break;

    const cites = batch.map((t) => t.citation).join("|");
    const maxCalls = Math.min(16, BUDGET - acc.totalCl);
    const acquireLimit = batch.length;
    process.stdout.write(`\n=== PILOT BATCH ${batch.map((t) => t.citation).join(" | ")} ===\n`);

    const run = flyNode(
      "scripts/tmp-queue2-cite-demand-multi-ingest-bundled.cjs",
      [cites, String(maxCalls), String(acquireLimit)],
      420,
    );
    const j = run.json || {};
    const cl = Number(j.courtListenerHttpCalls || 0);
    acc.totalCl += cl;
    acc.batches.push({ cites: batch.map((t) => t.citation), cl, json: {
      acquired: j.acquired, rateLimited: j.rateLimited, deferred: j.deferred, results: j.results, preverify: j.preverify,
    }});

    if (j.rateLimited || j.status === "rate_limited") {
      acc.reliability["429"] += 1;
      acc.stopReason = "429";
      break;
    }

    const resultByCite = new Map();
    for (const r of j.results || []) resultByCite.set(r.citation, r);
    for (const p of j.preverify || []) {
      if (!resultByCite.has(p.citation)) resultByCite.set(p.citation, p);
    }
    for (const d of j.deferred || []) {
      if (!resultByCite.has(d.citation)) resultByCite.set(d.citation, { ...d, status: "deferred" });
    }

    for (const t of batch) {
      acc.targetsAttempted += 1;
      const r = resultByCite.get(t.citation) || resultByCite.get(t.canonicalTargetKey) || {};
      // try normalized forms
      let row = r;
      if (!row.status) {
        for (const [k, v] of resultByCite.entries()) {
          if (String(k).replace(/\s+/g, "") === String(t.citation).replace(/\s+/g, "")) { row = v; break; }
        }
      }
      const status = row.status || "NOT_FOUND_CL";
      const acquired = status === "imported" || status === "new_version";
      const already = status === "already_present";
      const found = acquired || already || status === "verified";
      if (found) acc.targetsFound += 1;
      if (acquired) {
        acc.targetsAcquired += 1;
        sinceReresolveAcquired += 1;
      }

      let outcome = "NOT_FOUND_CL";
      if (acquired) outcome = "ACQUIRED_PENDING_RERESOLVE";
      else if (already) outcome = "FOUND_ALREADY_PRESENT";
      else if (status === "deferred" || status === "preverify_fail") {
        const reason = row.reason || "";
        if (/ambiguous/i.test(reason)) outcome = "AMBIGUOUS";
        else if (/already/i.test(reason)) outcome = "FOUND_ALREADY_PRESENT";
        else if (/rate_limited|budget/i.test(reason)) outcome = "BLOCKED";
        else outcome = "NOT_FOUND_CL";
      } else if (status === "skipped") outcome = "NOT_FOUND_CL";

      acc.targetOutcomes[outcome] = (acc.targetOutcomes[outcome] || 0) + 1;
      const fam = t.citationFamily;
      acc.byFamily[fam] = acc.byFamily[fam] || { attempts: 0, acquired: 0, found: 0, cl: 0, edgeDemandSum: 0, oldEdgesResolved: 0 };
      acc.byFamily[fam].attempts += 1;
      acc.byFamily[fam].cl += Number(row.clRequests || 0);
      acc.byFamily[fam].edgeDemandSum += Number(t.edgeDemand || 0);
      if (acquired) acc.byFamily[fam].acquired += 1;
      if (found) acc.byFamily[fam].found += 1;

      acc.targetRows.push({
        citation: t.citation,
        family: fam,
        edgeDemand: t.edgeDemand,
        clRequests: Number(row.clRequests || 0),
        status: row.status || null,
        reason: row.reason || null,
        outcome,
        authorityId: row.authorityId || null,
        method: row.method || "citation-lookup",
        historicalAcquisitionPrior: t.historicalAcquisitionPrior,
        oldEdgesResolved: null, // filled after reresolve attribution approximately
      });

      // update manifest target in memory
      const mt = (manifest.targets || []).find((x) => x.citation === t.citation || x.canonicalTargetKey === t.canonicalTargetKey);
      if (mt) {
        mt.lastAttemptedAt = new Date().toISOString();
        mt.actualCLRequests = (mt.actualCLRequests || 0) + Number(row.clRequests || 0);
        mt.found = Boolean(found);
        mt.acquired = Boolean(acquired);
        mt.status = acquired ? "ACQUIRED" : already ? "ALREADY_PRESENT" : outcome;
        mt.failureReason = acquired || already ? null : (row.reason || outcome);
      }
    }

    fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
    process.stdout.write(JSON.stringify({
      batchCl: cl,
      totalCl: acc.totalCl,
      acquired: acc.targetsAcquired,
      attempted: acc.targetsAttempted,
      rateLimited: j.rateLimited || false,
    }) + "\n");

    if (sinceReresolveAcquired >= 12 || (acc.targetsAcquired > 0 && queue.length === 0)) {
      const rr = reresolve();
      const after = Number(rr.json?.resolvedAfter || resolvedCursor);
      const delta = Math.max(0, after - resolvedCursor);
      // attribute proportionally to acquired since last reresolve without per-target precision
      const recent = acc.targetRows.filter((x) => x.outcome === "ACQUIRED_PENDING_RERESOLVE" && x.oldEdgesResolved == null);
      const per = recent.length ? delta / recent.length : 0;
      for (const x of recent) {
        x.oldEdgesResolved = +per.toFixed(3);
        x.outcome = per > 0 ? "ACQUIRED_RESOLVED" : "ACQUIRED_ZERO_OLD_RESOLUTION";
        acc.targetOutcomes[x.outcome] = (acc.targetOutcomes[x.outcome] || 0) + 1;
        acc.targetOutcomes.ACQUIRED_PENDING_RERESOLVE = Math.max(0, (acc.targetOutcomes.ACQUIRED_PENDING_RERESOLVE || 0) - 1);
        if (acc.byFamily[x.family]) acc.byFamily[x.family].oldEdgesResolved += x.oldEdgesResolved;
      }
      resolvedCursor = after;
      sinceReresolveAcquired = 0;
      acc.lastReresolve = { at: new Date().toISOString(), resolved: after, delta };
      fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
    }

    // zero-progress breaker: 5 consecutive CL with no acquire/found
    const last = acc.targetRows.slice(-5);
    if (last.length >= 5 && last.every((x) => x.outcome === "NOT_FOUND_CL" || x.outcome === "BLOCKED") && last.reduce((s, x) => s + x.clRequests, 0) >= 5) {
      // don't stop whole pilot — just note; continue other families
      acc.weakPriorNotes.push({ note: "five_consecutive_not_found", citations: last.map((x) => x.citation) });
    }
  }

  // final reresolve
  const finalRr = reresolve();
  const endResolved = Number(finalRr.json?.resolvedAfter || resolvedCursor);
  const endCases = Number(finalRr.json?.corpus?.cases || startCases);
  // flush pending
  const pending = acc.targetRows.filter((x) => x.outcome === "ACQUIRED_PENDING_RERESOLVE");
  const finalDelta = Math.max(0, endResolved - resolvedCursor);
  const per = pending.length ? finalDelta / pending.length : 0;
  for (const x of pending) {
    x.oldEdgesResolved = +per.toFixed(3);
    x.outcome = per > 0 ? "ACQUIRED_RESOLVED" : "ACQUIRED_ZERO_OLD_RESOLUTION";
    acc.targetOutcomes[x.outcome] = (acc.targetOutcomes[x.outcome] || 0) + 1;
    acc.targetOutcomes.ACQUIRED_PENDING_RERESOLVE = Math.max(0, (acc.targetOutcomes.ACQUIRED_PENDING_RERESOLVE || 0) - 1);
    if (acc.byFamily[x.family]) acc.byFamily[x.family].oldEdgesResolved += x.oldEdgesResolved;
  }

  const oldEdgesResolved = Math.max(0, endResolved - startResolved);
  acc.endResolved = endResolved;
  acc.endCases = endCases;
  acc.oldUnresolvedEdgesResolved = oldEdgesResolved;
  acc.usefulAuthoritiesAdded = Math.max(0, endCases - startCases);
  acc.metrics = {
    overallClPerTarget: acc.targetsAcquired ? +(acc.totalCl / acc.targetsAcquired).toFixed(3) : null,
    overallOldEdgesPerCl: acc.totalCl ? +(oldEdgesResolved / acc.totalCl).toFixed(3) : null,
    overallOldEdgesPerTarget: acc.targetsAcquired ? +(oldEdgesResolved / acc.targetsAcquired).toFixed(3) : null,
    successfulTargetsPerCl: acc.totalCl ? +(acc.targetsAcquired / acc.totalCl).toFixed(3) : null,
  };

  // family table
  acc.familyTable = {};
  for (const [f, s] of Object.entries(acc.byFamily)) {
    acc.familyTable[f] = {
      attempts: s.attempts,
      acquired: s.acquired,
      found: s.found,
      cl: s.cl,
      oldEdgesResolved: +s.oldEdgesResolved.toFixed(3),
      clPerTarget: s.acquired ? +(s.cl / s.acquired).toFixed(3) : null,
      edgesPerTarget: s.acquired ? +(s.oldEdgesResolved / s.acquired).toFixed(3) : null,
      edgesPerCl: s.cl ? +(s.oldEdgesResolved / s.cl).toFixed(3) : null,
      sampleConfidence: s.acquired >= 4 ? "MODERATE" : s.acquired >= 2 ? "LOW_SAMPLE" : "INSUFFICIENT",
    };
  }

  // data-derived bands from families with acquired>=2
  const scored = Object.entries(acc.familyTable)
    .filter(([, v]) => v.acquired >= 2 && v.edgesPerCl != null)
    .map(([f, v]) => ({ family: f, edgesPerCl: v.edgesPerCl }))
    .sort((a, b) => b.edgesPerCl - a.edgesPerCl);
  if (scored.length >= 3) {
    const third = Math.ceil(scored.length / 3);
    acc.productivityBands = {
      HIGH: { range: scored.slice(0, third).map((x) => x.edgesPerCl), families: scored.slice(0, third).map((x) => x.family) },
      MEDIUM: { range: scored.slice(third, 2 * third).map((x) => x.edgesPerCl), families: scored.slice(third, 2 * third).map((x) => x.family) },
      LOW: { range: scored.slice(2 * third).map((x) => x.edgesPerCl), families: scored.slice(2 * third).map((x) => x.family) },
      method: "tertiles_among_families_with_acquired_ge_2",
    };
  } else if (scored.length > 0) {
    acc.productivityBands = {
      HIGH: { range: [scored[0].edgesPerCl], families: [scored[0].family] },
      MEDIUM: { range: scored.slice(1).map((x) => x.edgesPerCl), families: scored.slice(1).map((x) => x.family) },
      LOW: { range: [], families: [] },
      method: "ranked_small_sample",
      note: "LOW_SAMPLE — do not overfit",
    };
  } else {
    acc.productivityBands = { HIGH: { range: [], families: [] }, MEDIUM: { range: [], families: [] }, LOW: { range: [], families: [] }, method: "insufficient_sample" };
  }

  // provisional rerank remaining READY
  const famProd = Object.fromEntries(Object.entries(acc.familyTable).map(([f, v]) => [f, v.edgesPerCl || 0]));
  const remaining = (manifest.targets || [])
    .filter((t) => t.status === "READY_CL" && !t.acquired && !DENY.has(t.citation))
    .map((t) => {
      const prod = famProd[t.citationFamily] || 0;
      const citationImpact = Number(t.edgeDemand || 0) * (0.5 + prod); // demand × measured productivity
      const corpusCoverageValue = Number(t.coverageValue || 1);
      const identityConfidence = 1; // all READY_CL have parseable cites
      const finalScore = citationImpact + corpusCoverageValue;
      return {
        citation: t.citation,
        family: t.citationFamily,
        edgeDemand: t.edgeDemand,
        measuredFamilyEdgesPerCl: prod || null,
        corpusCoverageValue,
        identityConfidence,
        finalScore,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 20)
    .map((t, i) => ({ rank: i + 1, ...t }));
  acc.provisionalRerankTop20 = remaining;

  manifest.pilotStats = {
    generatedAt: new Date().toISOString(),
    version: "cite-demand-pilot-v1",
    totalCl: acc.totalCl,
    acquired: acc.targetsAcquired,
    oldEdgesResolved,
    metrics: acc.metrics,
    familyTable: acc.familyTable,
    productivityBands: acc.productivityBands,
  };
  manifest.familyPilotStatsVersion = "cite-demand-pilot-v1";
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  if (!acc.stopReason) acc.stopReason = acc.totalCl >= BUDGET - 4 ? "budget_exhausted" : "plan_complete";
  acc.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
  console.log("CITE_PILOT_DONE " + JSON.stringify({
    totalCl: acc.totalCl,
    attempted: acc.targetsAttempted,
    acquired: acc.targetsAcquired,
    oldEdgesResolved,
    metrics: acc.metrics,
    familyTable: acc.familyTable,
    stop: acc.stopReason,
    reliability: acc.reliability,
  }));
  process.exit(acc.stopReason === "429" ? 1 : 0);
}

main();
