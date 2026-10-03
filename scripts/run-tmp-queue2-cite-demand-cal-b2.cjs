/**
 * Citation-demand Calibration Block 2
 * Family-isolated micro-batches + exact per-citation edge attribution.
 * NO equal-share. NO full scale. Zero LLM.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const MANIFEST = path.join(REPORTS, "citation-demand-acquisition-manifest.json");
const OUT = path.join(REPORTS, "queue2-cite-demand-cal-b2-ops.json");
const COOLDOWN = path.join(REPORTS, "queue2-cite-demand-429-cooldown.json");
const BUDGET = Math.min(Math.max(Number(process.env.CITE_CAL_B2_BUDGET || 90), 40), 100);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 5000), 4750);
const DENY = new Set(["573 U.S. 373"]); // prior verified NOT_FOUND
const FAMILIES = ["us_reports", "federal_reporter", "regional_reporter", "federal_supplement"];

function lastJson(text) {
  const t = String(text || "");
  const start = t.lastIndexOf('{"ok"');
  if (start >= 0) {
    let depth = 0;
    for (let k = start; k < t.length; k++) {
      if (t[k] === "{") depth++;
      else if (t[k] === "}") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(t.slice(start, k + 1)); } catch { /* */ }
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

function flyNode(script, args, timeoutSec, envExtra = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-fly-node.cjs"), script, ...args], {
    encoding: "utf8",
    maxBuffer: 40e6,
    cwd: ROOT,
    env: {
      ...process.env,
      FLY_TOOL_TIMEOUT_SEC: String(timeoutSec),
      CL_RATE_MS: String(CL_RATE_MS),
      ...envExtra,
    },
  });
  return { status: r.status ?? 1, out: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}

function bundle(src, dest) {
  const b = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules/esbuild/bin/esbuild"),
      path.join(ROOT, src),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--packages=bundle",
      `--outfile=${path.join(ROOT, dest)}`,
    ],
    { encoding: "utf8", cwd: ROOT },
  );
  if (b.status !== 0) throw new Error(`esbuild failed: ${(b.stderr || b.stdout || "").slice(0, 400)}`);
}

function reresolve() {
  return flyNode("scripts/tmp-queue2-manual-cite-integrity-bundled.cjs", [], 300);
}

function edgeCounts(cites) {
  return flyNode("scripts/tmp-queue2-cite-target-edge-count-bundled.cjs", [cites.join("|")], 180);
}

function fsuppTop(n) {
  return flyNode("scripts/tmp-queue2-cite-target-edge-count-bundled.cjs", ["--fsupp-top", String(n)], 180);
}

function ensureFam(acc, f) {
  if (!acc.byFamily[f]) {
    acc.byFamily[f] = {
      attempts: 0,
      found: 0,
      acquired: 0,
      notFound: 0,
      ambiguous: 0,
      sourceErrors: 0,
      cl: 0,
      oldEdgesResolved: 0,
      edgeDemandSum: 0,
      actualDemandSum: 0,
      newEdgesIntroduced: 0,
    };
  }
  return acc.byFamily[f];
}

function normalizeCiteKey(c) {
  return String(c || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
}

function pickQueues(manifest, fsuppTargets, alreadyDone) {
  const by = Object.fromEntries(FAMILIES.map((f) => [f, []]));
  const done = alreadyDone || new Set();
  for (const t of manifest.targets || []) {
    if (t.status !== "READY_CL") continue;
    if (t.localTargetPresent) continue;
    if (DENY.has(t.citation) || DENY.has(t.canonicalTargetKey)) continue;
    if (done.has(normalizeCiteKey(t.citation))) continue;
    if (t.status === "ACQUIRED" || t.acquired) continue;
    const f = t.citationFamily;
    if (!by[f]) continue;
    by[f].push(t);
  }
  for (const f of FAMILIES) by[f].sort((a, b) => (b.edgeDemand || 0) - (a.edgeDemand || 0));

  // Supplemental F.Supp from live DB demand (not a full rebuild)
  const seen = new Set((manifest.targets || []).map((t) => normalizeCiteKey(t.citation)));
  for (const t of fsuppTargets || []) {
    const key = normalizeCiteKey(t.citation);
    if (!key || seen.has(key) || done.has(key)) continue;
    if (!/f\.?\s*supp/i.test(t.citation || "")) continue;
    // Require parseable-looking volume/page (reject "406 F. Supp.10")
    if (!/^\d+\s+F\.?\s*Supp\.?\s*(\d+d\s+)?\d+$/i.test(String(t.citation).replace(/\s+/g, " ").trim())
      && !/^\d+\s+F\.?\s*Supp\.?\s*\d+d\s+\d+$/i.test(String(t.citation).replace(/\s+/g, " ").trim())) {
      // allow "112 F. Supp. 3d 817"
      const c = String(t.citation).replace(/\s+/g, " ").trim();
      if (!/^\d+\s+F\.?\s*Supp\.?\s*(?:\d+d\s+)?\d+$/i.test(c) && !/^\d+\s+F\.?\s*Supp\.?\s*\d+d\s+\d+$/i.test(c)) {
        continue;
      }
    }
    const cite = String(t.citation).replace(/\s+/g, " ").trim();
    by.federal_supplement.push({
      citation: cite,
      canonicalTargetKey: cite,
      citationFamily: "federal_supplement",
      edgeDemand: t.edgeDemand || 1,
      coverageValue: 1,
      status: "READY_CL",
      supplemental: true,
      sourceStrategy: "courtlistener",
    });
    seen.add(key);
  }
  by.federal_supplement.sort((a, b) => (b.edgeDemand || 0) - (a.edgeDemand || 0));
  return by;
}

function familyTable(acc) {
  const out = {};
  for (const f of FAMILIES) {
    const s = acc.byFamily[f] || {
      attempts: 0, found: 0, acquired: 0, notFound: 0, ambiguous: 0, sourceErrors: 0,
      cl: 0, oldEdgesResolved: 0, edgeDemandSum: 0, actualDemandSum: 0, newEdgesIntroduced: 0,
    };
    const conf =
      s.acquired >= 10 ? "MODERATE" :
      s.acquired >= 8 ? "LOW_MODERATE" :
      s.acquired >= 1 ? "LOW_SAMPLE" :
      s.attempts > 0 ? "INSUFFICIENT" : "NONE";
    out[f] = {
      attempts: s.attempts,
      found: s.found,
      acquired: s.acquired,
      notFound: s.notFound,
      ambiguous: s.ambiguous,
      sourceErrors: s.sourceErrors,
      cl: s.cl,
      oldEdgesResolved: s.oldEdgesResolved,
      foundRate: s.attempts ? +(s.found / s.attempts).toFixed(3) : null,
      acquisitionRate: s.attempts ? +(s.acquired / s.attempts).toFixed(3) : null,
      clPerAcquired: s.acquired ? +(s.cl / s.acquired).toFixed(3) : null,
      edgesPerAcquired: s.acquired ? +(s.oldEdgesResolved / s.acquired).toFixed(3) : null,
      edgesPerCl: s.cl ? +(s.oldEdgesResolved / s.cl).toFixed(3) : null,
      medianEdgeDemand: null,
      demandRealization: s.edgeDemandSum ? +(s.actualDemandSum / s.edgeDemandSum).toFixed(3) : null,
      sampleConfidence: conf,
    };
  }
  // median demand from target rows
  for (const f of FAMILIES) {
    const demands = acc.targetRows.filter((r) => r.family === f).map((r) => r.edgeDemandBefore).sort((a, b) => a - b);
    if (demands.length) {
      const mid = Math.floor(demands.length / 2);
      out[f].medianEdgeDemand = demands.length % 2 ? demands[mid] : +((demands[mid - 1] + demands[mid]) / 2).toFixed(1);
    }
  }
  return out;
}

function main() {
  const FINALIZE_ONLY = process.env.CITE_CAL_B2_FINALIZE_ONLY === "1";
  bundle("scripts/tmp-queue2-cite-demand-multi-ingest.cjs", "scripts/tmp-queue2-cite-demand-multi-ingest-bundled.cjs");
  bundle("scripts/tmp-queue2-cite-target-edge-count.cjs", "scripts/tmp-queue2-cite-target-edge-count-bundled.cjs");

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const fsupp = fsuppTop(25);
  const fsuppTargets = (fsupp.json?.targets || []).map((t) => ({
    ...t,
    citation: String(t.citation || "").replace(/\s+/g, " ").trim(),
  })).filter((t) => {
    const c = t.citation;
    // Keep only parseable F.Supp forms (volume + reporter + page)
    return /^\d+\s+F\.?\s*Supp\.?\s*(?:2d\s+|3d\s+)?\d+$/i.test(c);
  });

  // Resume from corrected partial ops if present
  const alreadyDone = new Set();
  const priorOpsPath = path.join(REPORTS, "queue2-cite-demand-cal-b2-ops-partial.json");
  let prior = null;
  if (fs.existsSync(priorOpsPath)) {
    try { prior = JSON.parse(fs.readFileSync(priorOpsPath, "utf8")); } catch { prior = null; }
  } else if (fs.existsSync(OUT)) {
    try {
      prior = JSON.parse(fs.readFileSync(OUT, "utf8"));
      fs.writeFileSync(priorOpsPath, JSON.stringify(prior, null, 2));
    } catch { prior = null; }
  }
  if (prior) {
    for (const r of prior.targetRows || []) {
      alreadyDone.add(normalizeCiteKey(r.citation));
    }
  }

  const queues = pickQueues(manifest, fsuppTargets, alreadyDone);
  const startCite = reresolve();
  const sessionStartResolved = 1880;
  const sessionStartCases = 3875;
  const sessionStartExtracted = 36912;
  const resumeResolved = Number(startCite.json?.resolvedAfter ?? startCite.json?.resolvedBefore ?? sessionStartResolved);
  const resumeCases = Number(startCite.json?.corpus?.cases || sessionStartCases);
  const resumeExtracted = Number(startCite.json?.extracted ?? sessionStartExtracted);

  const acc = {
    classification: "CITATION_DEMAND_CALIBRATION_BLOCK_2",
    startedAt: prior?.startedAt || new Date().toISOString(),
    resumedAt: new Date().toISOString(),
    budget: BUDGET,
    pacingMs: CL_RATE_MS,
    attributionMethod: "exact_per_citation_edge_delta",
    equalShareUsed: false,
    sessionStartResolved,
    sessionStartCases,
    sessionStartExtracted,
    startResolved: sessionStartResolved,
    startCases: sessionStartCases,
    startExtracted: sessionStartExtracted,
    resumeResolved,
    resumeCases,
    resumeExtracted,
    totalCl: Number(prior?.totalCl || 0),
    targetsAttempted: Number(prior?.targetsAttempted || 0),
    targetsFound: Number(prior?.targetsFound || 0),
    targetsAcquired: Number(prior?.targetsAcquired || 0),
    productionEmbeddingChunks: Number(prior?.productionEmbeddingChunks || 0),
    byFamily: {},
    targetOutcomes: { ...(prior?.targetOutcomes || {}) },
    targetRows: [...(prior?.targetRows || [])],
    familyBatches: [...(prior?.familyBatches || [])],
    fsuppSupplementalAvailable: fsuppTargets.length,
    stopReason: null,
    reliability: { "408": 0, "429": Number(prior?.reliability?.["429"] || 0) },
    notes: [...(prior?.notes || []), { at: new Date().toISOString(), note: "resume_after_edge_count_fix", priorCl: prior?.totalCl || 0 }],
  };

  // Rebuild family stats from (possibly posthoc-corrected) target rows
  for (const r of acc.targetRows) {
    const famStat = ensureFam(acc, r.family);
    famStat.attempts += 1;
    famStat.cl += Number(r.totalCLRequests || 0);
    famStat.edgeDemandSum += Number(r.edgeDemandBefore || 0);
    if (r.lookupResult === "FOUND_EXACT" || r.ingested || r.outcome === "FOUND_ALREADY_PRESENT") famStat.found += 1;
    if (r.ingested) {
      famStat.acquired += 1;
      famStat.oldEdgesResolved += Number(r.oldUnresolvedEdgesResolved || 0);
      famStat.actualDemandSum += Number(r.oldUnresolvedEdgesResolved || 0);
      famStat.newEdgesIntroduced += Number(r.newCitationEdgesIntroduced || 0);
    } else if (r.outcome === "AMBIGUOUS") famStat.ambiguous += 1;
    else if (r.outcome === "SOURCE_ERROR") famStat.sourceErrors += 1;
    else famStat.notFound += 1;
  }

  // Round-robin family attempts aiming ~12-15 each, adapt to queue depth
  const perFamilyTarget = 12;
  const pointers = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
  let consecutiveZeroProgressCl = 0;
  let familyMethodNotFound = Object.fromEntries(FAMILIES.map((f) => [f, 0]));

  const FOCUS = process.env.CITE_CAL_B2_FOCUS_FAMILY || "";

  function nextTarget() {
    // Prefer families furthest below target attempts, with remaining queue
    let scored = FAMILIES.map((f) => {
      const s = acc.byFamily[f];
      const attempts = s?.attempts || 0;
      const acquired = s?.acquired || 0;
      const remaining = (queues[f]?.length || 0) - (pointers[f] || 0);
      return { f, attempts, acquired, remaining, deficit: perFamilyTarget - attempts };
    })
      .filter((x) => x.remaining > 0 && x.attempts < perFamilyTarget + 6);
    if (FOCUS) {
      const focused = scored.filter((x) => x.f === FOCUS);
      if (focused.length) scored = focused;
    } else {
      scored.sort((a, b) => b.deficit - a.deficit || a.acquired - b.acquired || a.attempts - b.attempts);
    }
    if (!scored.length) return null;
    const pick = scored[0];
    const t = queues[pick.f][pointers[pick.f]++];
    return t || null;
  }

  while (!FINALIZE_ONLY && acc.totalCl < BUDGET - 3) {
    const t = nextTarget();
    if (!t) {
      acc.stopReason = acc.stopReason || "target_pool_exhausted";
      break;
    }
    const fam = t.citationFamily;
    const famStat = ensureFam(acc, fam);

    // Exact pre-count for THIS citation only (must succeed)
    const beforeEdge = edgeCounts([t.citation]);
    if (!beforeEdge.json?.ok || !beforeEdge.json?.counts?.[0]) {
      acc.notes = acc.notes || [];
      acc.notes.push({ at: new Date().toISOString(), note: "edge_count_failed", citation: t.citation, err: beforeEdge.json?.error || "no_counts" });
      process.stdout.write(`\n=== B2 SKIP edge_count_failed ${t.citation} ===\n`);
      continue;
    }
    const before = beforeEdge.json.counts[0];
    // Stale manifest: skip targets with no live unresolved edges
    if (Number(before.unresolved || 0) <= 0) {
      acc.staleSkipped = (acc.staleSkipped || 0) + 1;
      let mt = (manifest.targets || []).find((x) => x.citation === t.citation || x.canonicalTargetKey === t.citation);
      if (mt) {
        mt.status = Number(before.resolved || 0) > 0 ? "ALREADY_RESOLVED_LOCALLY" : "SKIPPED_ZERO_LIVE_DEMAND";
        mt.lastAttemptedAt = new Date().toISOString();
        mt.failureReason = "zero_live_unresolved_edges";
      }
      process.stdout.write(`\n=== B2 SKIP stale/zero-live ${fam} | ${t.citation} | resolved=${before.resolved} unresolved=0 ===\n`);
      continue;
    }

    process.stdout.write(`\n=== B2 ${fam} | ${t.citation} | demand=${t.edgeDemand} | liveUnresolved=${before.unresolved} ===\n`);

    const maxCalls = Math.min(6, BUDGET - acc.totalCl);
    const run = flyNode(
      "scripts/tmp-queue2-cite-demand-multi-ingest-bundled.cjs",
      [t.citation, String(maxCalls), "1"],
      360,
    );
    const j = run.json || {};
    const cl = Number(j.courtListenerHttpCalls || 0);
    acc.totalCl += cl;

    if (j.rateLimited || j.status === "rate_limited") {
      acc.reliability["429"] += 1;
      acc.stopReason = "429";
      fs.writeFileSync(COOLDOWN, JSON.stringify({
        classification: "CITE_DEMAND_429_STOP",
        at: new Date().toISOString(),
        totalCl: acc.totalCl,
        stopReason: "429",
        retryAfter: j.retryAfter || j.lastRetryAfter || null,
        note: "minute_or_hour_limit; no post-429 CL",
        block: "calibration_b2",
      }, null, 2));
      // record attempt
    }

    const row = (j.results || [])[0] || (j.preverify || [])[0] || (j.deferred || [])[0] || {};
    const status = row.status || "NOT_FOUND_CL";
    const acquired = status === "imported" || status === "new_version";
    const already = status === "already_present";
    const found = acquired || already || status === "verified";
    const reason = String(row.reason || "");

    let outcome = "NOT_FOUND_CL";
    let lookupResult = "NOT_FOUND";
    if (acquired) { outcome = "ACQUIRED_PENDING_RERESOLVE"; lookupResult = "FOUND_EXACT"; }
    else if (already) { outcome = "FOUND_ALREADY_PRESENT"; lookupResult = "FOUND_EXACT"; }
    else if (/ambiguous/i.test(reason)) { outcome = "AMBIGUOUS"; lookupResult = "AMBIGUOUS"; }
    else if (/rate_limited|budget/i.test(reason) || acc.stopReason === "429") { outcome = "SOURCE_ERROR"; lookupResult = "SOURCE_ERROR"; }
    else if (status === "preverify_fail" || status === "skipped" || status === "deferred") {
      if (/rate_limited|budget/i.test(reason)) { outcome = "SOURCE_ERROR"; lookupResult = "SOURCE_ERROR"; }
      else { outcome = "NOT_FOUND_CL"; lookupResult = "NOT_FOUND"; }
    }

    acc.targetsAttempted += 1;
    famStat.attempts += 1;
    famStat.cl += cl;
    famStat.edgeDemandSum += Number(t.edgeDemand || 0);
    if (found) { acc.targetsFound += 1; famStat.found += 1; familyMethodNotFound[fam] = 0; }
    else if (outcome === "AMBIGUOUS") { famStat.ambiguous += 1; }
    else if (outcome === "SOURCE_ERROR") { famStat.sourceErrors += 1; }
    else { famStat.notFound += 1; familyMethodNotFound[fam] += 1; }

    let oldEdgesResolved = 0;
    let newEdgesIntroduced = 0;
    let after = before;

    if (acquired) {
      acc.targetsAcquired += 1;
      famStat.acquired += 1;
      acc.productionEmbeddingChunks += Number(row.embeddedChunks || 0);

      const rr = reresolve();
      const afterEdge = edgeCounts([t.citation]);
      after = afterEdge.json?.counts?.[0] || before;
      oldEdgesResolved = Math.max(0, Number(before.unresolved || 0) - Number(after.unresolved || 0));
      newEdgesIntroduced = Math.max(0, Number(after.total || 0) - Number(before.total || 0));
      famStat.oldEdgesResolved += oldEdgesResolved;
      famStat.actualDemandSum += oldEdgesResolved;
      famStat.newEdgesIntroduced += newEdgesIntroduced;
      outcome = oldEdgesResolved > 0 ? "ACQUIRED_RESOLVED" : "ACQUIRED_ZERO_OLD_RESOLUTION";
      consecutiveZeroProgressCl = 0;

      // global resolved cursor note
      acc.lastReresolve = {
        at: new Date().toISOString(),
        resolvedAfter: rr.json?.resolvedAfter ?? null,
        citation: t.citation,
        oldEdgesResolved,
      };
    } else if (cl > 0 && !found) {
      consecutiveZeroProgressCl += cl;
    } else if (found) {
      consecutiveZeroProgressCl = 0;
    }

    acc.targetOutcomes[outcome] = (acc.targetOutcomes[outcome] || 0) + 1;

    const targetRow = {
      citation: t.citation,
      family: fam,
      edgeDemandBefore: Number(t.edgeDemand || 0),
      manifestRank: t.rank || null,
      supplemental: Boolean(t.supplemental),
      clRequests: {
        lookup: Number(row.preverifyCl || (found || outcome === "NOT_FOUND_CL" || outcome === "SOURCE_ERROR" ? Math.min(cl, 1) : 0)),
        fallbackSearch: 0,
        fetch: Number(row.acquireCl || (acquired ? Math.max(0, cl - 1) : 0)),
        other: 0,
        total: cl,
      },
      totalCLRequests: cl,
      lookupResult,
      ingested: acquired,
      unresolvedEdgesBefore: before.unresolved,
      unresolvedEdgesAfter: after.unresolved,
      oldUnresolvedEdgesResolved: oldEdgesResolved,
      newCitationEdgesIntroduced: newEdgesIntroduced,
      usefulAuthorityAdded: acquired,
      actualEdgesPerCL: cl ? +(oldEdgesResolved / cl).toFixed(3) : null,
      actualCLPerTarget: cl,
      outcome,
      authorityId: row.authorityId || null,
      method: row.method || "citation-lookup",
      historicalAcquisitionPrior: "UNKNOWN",
      status,
      reason: reason || null,
    };
    acc.targetRows.push(targetRow);
    acc.familyBatches.push({
      family: fam,
      citations: [t.citation],
      cl,
      acquired: acquired ? 1 : 0,
      oldEdgesResolved,
      attribution: "exact_per_citation_edge_delta",
    });

    // manifest update
    let mt = (manifest.targets || []).find((x) => x.citation === t.citation || x.canonicalTargetKey === t.citation);
    if (!mt && t.supplemental) {
      mt = {
        citation: t.citation,
        canonicalTargetKey: t.citation,
        citationFamily: fam,
        edgeDemand: t.edgeDemand,
        coverageValue: 1,
        status: "READY_CL",
        supplemental: true,
      };
      manifest.targets.push(mt);
    }
    if (mt) {
      mt.lastAttemptedAt = new Date().toISOString();
      mt.actualCLRequests = (mt.actualCLRequests || 0) + cl;
      mt.found = Boolean(found);
      mt.acquired = Boolean(acquired);
      mt.actualOldEdgesResolved = oldEdgesResolved;
      mt.actualEdgesPerCL = targetRow.actualEdgesPerCL;
      mt.status = acquired ? "ACQUIRED" : already ? "ALREADY_PRESENT" : outcome;
      mt.failureReason = acquired || already ? null : (reason || outcome);
      mt.statusHistory = Array.isArray(mt.statusHistory) ? mt.statusHistory : [];
      mt.statusHistory.push({ status: mt.status, at: mt.lastAttemptedAt, cl, oldEdgesResolved, block: "cal_b2" });
    }

    fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
    process.stdout.write(JSON.stringify({
      citation: t.citation,
      family: fam,
      cl,
      totalCl: acc.totalCl,
      outcome,
      oldEdgesResolved,
      acquired: acc.targetsAcquired,
    }) + "\n");

    if (acc.stopReason === "429") break;

    if (consecutiveZeroProgressCl >= 5) {
      acc.notes = acc.notes || [];
      acc.notes.push({ at: new Date().toISOString(), note: "five_consecutive_cl_zero_progress", pausedPath: "citation-lookup" });
      // pause only if widespread; continue other families by resetting counter softly
      consecutiveZeroProgressCl = 0;
    }
    if (familyMethodNotFound[fam] >= 3) {
      acc.notes = acc.notes || [];
      acc.notes.push({ at: new Date().toISOString(), note: "three_consecutive_not_found", family: fam });
      // skip rest of this family for now
      pointers[fam] = queues[fam].length;
      familyMethodNotFound[fam] = 0;
    }

    // integrity soft check from last ingest
    if ((j.duplicateSourceIds || 0) > 0 || (j.orphans || 0) > 0 || (j.chunks?.missing_embeddings || 0) > 0) {
      acc.stopReason = "integrity_regression";
      break;
    }
  }

  // final integrity + global resolved
  const finalRr = reresolve();
  const endResolved = Number(finalRr.json?.resolvedAfter ?? sessionStartResolved);
  const endCases = Number(finalRr.json?.corpus?.cases || sessionStartCases);
  const endExtracted = Number(finalRr.json?.extracted ?? sessionStartExtracted);

  acc.endResolved = endResolved;
  acc.endCases = endCases;
  acc.endExtracted = endExtracted;
  // Prefer sum of exact per-target deltas (authoritative for family economics)
  const exactOldEdges = acc.targetRows.reduce((s, r) => s + Number(r.oldUnresolvedEdgesResolved || 0), 0);
  acc.oldUnresolvedEdgesResolvedExact = exactOldEdges;
  acc.oldUnresolvedEdgesResolvedGlobal = Math.max(0, endResolved - sessionStartResolved);
  acc.oldUnresolvedEdgesResolved = exactOldEdges;
  acc.usefulAuthoritiesAdded = Math.max(0, endCases - sessionStartCases);
  // Rebuild outcome tallies from rows (correct posthoc)
  acc.targetOutcomes = {};
  for (const r of acc.targetRows) {
    acc.targetOutcomes[r.outcome] = (acc.targetOutcomes[r.outcome] || 0) + 1;
  }
  acc.familyTable = familyTable(acc);
  acc.metrics = {
    overallClPerAcquired: acc.targetsAcquired ? +(acc.totalCl / acc.targetsAcquired).toFixed(3) : null,
    overallOldEdgesPerAcquired: acc.targetsAcquired ? +(exactOldEdges / acc.targetsAcquired).toFixed(3) : null,
    overallOldEdgesPerCl: acc.totalCl ? +(exactOldEdges / acc.totalCl).toFixed(3) : null,
    globalResolvedDelta: Math.max(0, endResolved - sessionStartResolved),
    demandPredicted: acc.targetRows.reduce((s, r) => s + Number(r.edgeDemandBefore || 0), 0),
    demandActual: exactOldEdges,
    demandRealization: null,
  };
  if (acc.metrics.demandPredicted) {
    acc.metrics.demandRealization = +(acc.metrics.demandActual / acc.metrics.demandPredicted).toFixed(3);
  }

  // Calibration gate
  const ft = acc.familyTable;
  const measurable = FAMILIES.filter((f) => (ft[f]?.acquired || 0) >= 8);
  const distinguishable = ["us_reports", "federal_reporter", "regional_reporter"].every((f) => (ft[f]?.acquired || 0) >= 8);
  const fsuppOk = (ft.federal_supplement?.acquired || 0) >= 5 || (ft.federal_supplement?.attempts || 0) === 0 && acc.fsuppSupplementalAvailable === 0;
  acc.calibrationGate = {
    status: distinguishable && measurable.length >= 3 ? "CALIBRATION_SUFFICIENT" : "CALIBRATION_INSUFFICIENT",
    reason: distinguishable
      ? `>=8 acquires for US/federal/regional; families measured=${measurable.join(",")}; fsupp acquired=${ft.federal_supplement?.acquired || 0}`
      : `need >=8 acquires each for US/federal/regional; got US=${ft.us_reports?.acquired || 0} fed=${ft.federal_reporter?.acquired || 0} reg=${ft.regional_reporter?.acquired || 0} fsupp=${ft.federal_supplement?.acquired || 0}`,
    fsuppNote: acc.fsuppSupplementalAvailable === 0 && (ft.federal_supplement?.attempts || 0) === 0
      ? "no_fsupp_ready_targets_in_manifest_or_db_top"
      : null,
  };

  // Productivity bands only if sufficient
  if (acc.calibrationGate.status === "CALIBRATION_SUFFICIENT") {
    const scored = FAMILIES
      .map((f) => ({ family: f, edgesPerCl: ft[f].edgesPerCl, n: ft[f].acquired }))
      .filter((x) => x.n >= 8 && x.edgesPerCl != null)
      .sort((a, b) => b.edgesPerCl - a.edgesPerCl);
    if (scored.length >= 3) {
      const vals = scored.map((x) => x.edgesPerCl);
      acc.productivityBands = {
        HIGH: { families: [scored[0].family], range: [scored[0].edgesPerCl], mean: scored[0].edgesPerCl, sampleCount: scored[0].n },
        MEDIUM: { families: scored.slice(1, -1).map((x) => x.family), range: scored.slice(1, -1).map((x) => x.edgesPerCl), sampleCount: scored.slice(1, -1).reduce((s, x) => s + x.n, 0) },
        LOW: { families: [scored[scored.length - 1].family], range: [scored[scored.length - 1].edgesPerCl], sampleCount: scored[scored.length - 1].n },
        observedValues: vals,
        method: "rank_by_measured_edges_per_cl_min8",
      };
    } else {
      acc.productivityBands = { note: "sufficient gate met but band split deferred", scored };
    }
  } else {
    acc.productivityBands = { note: "CALIBRATION_INSUFFICIENT — bands not derived" };
  }

  // Provisional rerank top 25
  const famProd = Object.fromEntries(FAMILIES.map((f) => [f, ft[f]?.edgesPerCl]));
  const remaining = (manifest.targets || [])
    .filter((t) => t.status === "READY_CL" && !DENY.has(t.citation))
    .map((t) => {
      const prod = famProd[t.citationFamily];
      const prodScore = prod != null ? prod : 0;
      const identityConfidence = 1;
      const corpusCoverageValue = Number(t.coverageValue || 1);
      const failurePenalty = t.failureReason ? 2 : 0;
      const citationImpact = Number(t.edgeDemand || 0) * (1 + prodScore);
      const finalScore = citationImpact + corpusCoverageValue * 2 - failurePenalty;
      return {
        citation: t.citation,
        family: t.citationFamily,
        edgeDemand: t.edgeDemand,
        measuredFamilyProductivity: prod ?? null,
        identityConfidence,
        corpusCoverageValue,
        citationImpact: +citationImpact.toFixed(2),
        finalScore: +finalScore.toFixed(2),
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 25)
    .map((t, i) => ({ rank: i + 1, ...t }));
  acc.provisionalRerankTop25 = remaining;

  manifest.calibrationBlock2 = {
    generatedAt: new Date().toISOString(),
    version: "cite-demand-cal-b2-v1",
    totalCl: acc.totalCl,
    acquired: acc.targetsAcquired,
    oldEdgesResolvedExact: exactOldEdges,
    metrics: acc.metrics,
    familyTable: acc.familyTable,
    calibrationGate: acc.calibrationGate,
    productivityBands: acc.productivityBands,
    equalShareUsed: false,
    attributionMethod: acc.attributionMethod,
  };
  manifest.familyPilotStatsVersion = "cite-demand-cal-b2-v1";
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  if (!acc.stopReason) {
    acc.stopReason = acc.totalCl >= BUDGET - 3 ? "budget_exhausted" : "plan_complete";
  }
  acc.finishedAt = new Date().toISOString();
  acc.integrityFinal = {
    duplicates: finalRr.json?.duplicateSourceIds ?? null,
    orphans: finalRr.json?.orphans ?? null,
    missingEmbeddings: finalRr.json?.chunks?.missing_embeddings ?? null,
  };
  fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));

  console.log("CITE_CAL_B2_DONE " + JSON.stringify({
    totalCl: acc.totalCl,
    attempted: acc.targetsAttempted,
    acquired: acc.targetsAcquired,
    oldEdgesExact: exactOldEdges,
    globalDelta: acc.oldUnresolvedEdgesResolvedGlobal,
    metrics: acc.metrics,
    familyTable: acc.familyTable,
    gate: acc.calibrationGate,
    stop: acc.stopReason,
    reliability: acc.reliability,
  }));
  process.exit(acc.stopReason === "429" || acc.stopReason === "integrity_regression" ? 1 : 0);
}

main();
