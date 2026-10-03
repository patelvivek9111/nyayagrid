/**
 * Citation-demand Adaptive Scale 3
 * 80/20 US/regional start; P.3d regional priority; federal/F.Supp OFF
 * Exact per-citation edge attribution. Live reallocation. Zero LLM.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const MANIFEST = path.join(REPORTS, "citation-demand-acquisition-manifest.json");
const OUT = path.join(REPORTS, "queue2-cite-demand-scale3-ops.json");
const COOLDOWN = path.join(REPORTS, "queue2-cite-demand-429-cooldown.json");
const BUDGET = Math.min(Math.max(Number(process.env.CITE_SCALE3_BUDGET || 100), 20), 150);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 5000), 5000);
const DENY = new Set(["573 U.S. 373"]);
const ACTIVE = ["us_reports", "regional_reporter", "federal_reporter"];
const PILOT = {
  us_reports: 4.505,
  regional_reporter: 1.946,
  federal_reporter: 1.286,
  federal_supplement: 0,
};

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

function flyNode(script, args, timeoutSec) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-fly-node.cjs"), script, ...args], {
    encoding: "utf8",
    maxBuffer: 40e6,
    cwd: ROOT,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec), CL_RATE_MS: String(CL_RATE_MS) },
  });
  return { status: r.status ?? 1, out: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}

function bundle(src, dest) {
  const b = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules/esbuild/bin/esbuild"),
      path.join(ROOT, src),
      "--bundle", "--platform=node", "--format=cjs", "--packages=bundle",
      `--outfile=${path.join(ROOT, dest)}`,
    ],
    { encoding: "utf8", cwd: ROOT },
  );
  if (b.status !== 0) throw new Error(`esbuild failed: ${(b.stderr || b.stdout || "").slice(0, 400)}`);
}

function reresolve() { return flyNode("scripts/tmp-queue2-manual-cite-integrity-bundled.cjs", [], 300); }
function edgeCounts(cites) { return flyNode("scripts/tmp-queue2-cite-target-edge-count-bundled.cjs", [cites.join("|")], 180); }

function subfamilyOf(citation) {
  const c = String(citation || "");
  if (/\bU\.?\s*S\.?\b/i.test(c) && !/Supp/i.test(c)) return "U.S.";
  if (/F\.?\s*4th/i.test(c)) return "F.4th";
  if (/F\.?\s*3d/i.test(c)) return "F.3d";
  if (/F\.?\s*2d/i.test(c)) return "F.2d";
  if (/F\.?\s*Supp/i.test(c)) return "F.Supp";
  if (/S\.?\s*E\.?\s*2d/i.test(c)) return "S.E.2d";
  if (/P\.?\s*3d|P3d/i.test(c)) return "P.3d";
  if (/P\.?\s*2d|P2d/i.test(c)) return "P.2d";
  if (/S\.?\s*W/i.test(c)) return "S.W.";
  if (/N\.?\s*E/i.test(c)) return "N.E.";
  if (/N\.?\s*W/i.test(c)) return "N.W.";
  if (/\bSo\./i.test(c)) return "So.";
  if (/\bA\.?\s*\d/i.test(c)) return "A.";
  return "other";
}

function ensureFam(acc, f) {
  if (!acc.byFamily[f]) {
    acc.byFamily[f] = {
      attempts: 0, found: 0, acquired: 0, notFound: 0, ambiguous: 0, sourceErrors: 0,
      cl: 0, oldEdgesResolved: 0, edgeDemandSum: 0, actualDemandSum: 0, newEdgesIntroduced: 0,
      recentEdges: [], recentCl: [],
    };
  }
  return acc.byFamily[f];
}

function famEdgesPerCl(s) {
  return s.cl > 0 ? s.oldEdgesResolved / s.cl : null;
}

function recentEdgesPerCl(s, n = 10) {
  const e = s.recentEdges || [];
  const c = s.recentCl || [];
  if (!e.length) return null;
  const take = Math.min(n, e.length);
  let es = 0, cs = 0;
  for (let i = e.length - take; i < e.length; i++) { es += e[i]; cs += c[i] || 0; }
  return cs > 0 ? es / cs : null;
}

function computeWeights(acc) {
  // Rank by recent if available else cumulative; start from pilot-informed defaults
  const scores = {};
  for (const f of ACTIVE) {
    const s = ensureFam(acc, f);
    const recent = recentEdgesPerCl(s, 10);
    const cum = famEdgesPerCl(s);
    const measured = recent != null ? recent : (cum != null ? cum : PILOT[f]);
    const decay = cum != null && PILOT[f] > 0 && recent != null && recent < 0.5 * PILOT[f];
    scores[f] = { measured, recent, cum, decay, paused: Boolean(s.paused) || decay };
  }
  const active = ACTIVE.filter((f) => !scores[f].paused && (acc.queuesLeft?.[f] || 0) > 0);
  if (!active.length) return { us_reports: 1, regional_reporter: 0, federal_reporter: 0, scores };

  // Softmax-ish proportional to measured productivity, with floors
  const vals = active.map((f) => Math.max(scores[f].measured || 0.01, 0.01));
  const sum = vals.reduce((a, b) => a + b, 0);
  const w = { us_reports: 0, regional_reporter: 0, federal_reporter: 0, federal_supplement: 0 };
  active.forEach((f, i) => { w[f] = vals[i] / sum; });

  // On first checkpoint before enough data, bias toward starting allocation 70/30
  const totalAcq = ACTIVE.reduce((n, f) => n + (acc.byFamily[f]?.acquired || 0), 0);
  if (totalAcq < 20) {
    w.us_reports = 0.80;
    w.regional_reporter = 0.20;
    w.federal_reporter = 0;
  } else {
    const usR = scores.us_reports.recent;
    const regR = scores.regional_reporter.recent;
    const regAcq = ensureFam(acc, "regional_reporter").acquired || 0;
    if (regR != null && regR < 1.75 && regAcq >= 5) {
      w.us_reports = Math.max(w.us_reports, 0.85);
      w.regional_reporter = Math.min(w.regional_reporter, 0.15);
    }
    if (regR != null && regR < 1.5 && regAcq >= 8) {
      w.us_reports = Math.max(w.us_reports, 0.90);
      w.regional_reporter = Math.min(w.regional_reporter, 0.10);
    }
    if (usR != null && regR != null && regR >= usR * 0.85 && regAcq >= 8) {
      w.regional_reporter = Math.max(w.regional_reporter, 0.25);
    }
    w.federal_reporter = 0;
    const sGate = (w.us_reports || 0) + (w.regional_reporter || 0) || 1;
    w.us_reports /= sGate;
    w.regional_reporter /= sGate;
  }
  // zero out paused/empty AFTER applying start bias
  for (const f of ACTIVE) {
    if (scores[f].paused || (acc.queuesLeft?.[f] || 0) === 0) w[f] = 0;
  }
  w.federal_reporter = 0;
  w.federal_supplement = 0;
  const s2 = (w.us_reports || 0) + (w.regional_reporter || 0) || 1;
  w.us_reports = (w.us_reports || 0) / s2;
  w.regional_reporter = (w.regional_reporter || 0) / s2;
  return { ...w, scores };
}

function pickQueues(manifest) {
  const by = { us_reports: [], regional_reporter: [], federal_reporter: [], federal_supplement: [] };
  for (const t of manifest.targets || []) {
    if (t.status !== "READY_CL") continue;
    if (t.localTargetPresent) continue;
    if (DENY.has(t.citation) || DENY.has(t.canonicalTargetKey)) continue;
    if (t.failureReason && /not_found|citation_lookup_not_found/i.test(String(t.failureReason))) continue;
    const f = t.citationFamily;
    if (!by[f] || f === "federal_supplement") continue;
    // Federal tertiary: only high-demand READY (>=8 live edges)
    if (f === "federal_reporter") continue; // SCALE3 routine OFF
    by[f].push(t);
  }
  for (const f of Object.keys(by)) {
    by[f].sort((a, b) => {
      // Prefer S.E.2d / P.3d within regional
      const subRank = (c) => {
        const s = subfamilyOf(c);
        if (s === "P.3d") return 5;
        if (s === "P.2d") return 3;
        if (s === "S.E.2d") return 2;
        return 1;
      };
      return (b.edgeDemand || 0) - (a.edgeDemand || 0) || subRank(b.citation) - subRank(a.citation);
    });
  }
  return by;
}

function familyTable(acc) {
  const out = {};
  for (const f of [...ACTIVE, "federal_supplement"]) {
    const s = ensureFam(acc, f);
    out[f] = {
      attempts: s.attempts,
      found: s.found,
      acquired: s.acquired,
      notFound: s.notFound,
      cl: s.cl,
      oldEdgesResolved: s.oldEdgesResolved,
      foundRate: s.attempts ? +(s.found / s.attempts).toFixed(3) : null,
      acquisitionRate: s.attempts ? +(s.acquired / s.attempts).toFixed(3) : null,
      clPerAcquired: s.acquired ? +(s.cl / s.acquired).toFixed(3) : null,
      edgesPerAcquired: s.acquired ? +(s.oldEdgesResolved / s.acquired).toFixed(3) : null,
      edgesPerCl: s.cl ? +(s.oldEdgesResolved / s.cl).toFixed(3) : null,
      recentEdgesPerCl: recentEdgesPerCl(s, 10) != null ? +recentEdgesPerCl(s, 10).toFixed(3) : null,
      pilotBaseline: PILOT[f],
      productivityDecay: Boolean(s.paused) || (recentEdgesPerCl(s, 10) != null && recentEdgesPerCl(s, 10) < 0.5 * PILOT[f]),
      demandRealization: s.edgeDemandSum ? +(s.actualDemandSum / s.edgeDemandSum).toFixed(3) : null,
      paused: Boolean(s.paused),
    };
  }
  return out;
}

function main() {
  const FINALIZE_ONLY = process.env.CITE_SCALE3_FINALIZE_ONLY === "1";
  bundle("scripts/tmp-queue2-cite-demand-multi-ingest.cjs", "scripts/tmp-queue2-cite-demand-multi-ingest-bundled.cjs");
  bundle("scripts/tmp-queue2-cite-target-edge-count.cjs", "scripts/tmp-queue2-cite-target-edge-count-bundled.cjs");

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const queues = pickQueues(manifest);
  const pointers = Object.fromEntries(Object.keys(queues).map((f) => [f, 0]));

  let prior = null;
  if (fs.existsSync(OUT)) {
    try { prior = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { prior = null; }
  }
  const already = new Set((prior?.targetRows || []).map((r) => String(r.citation || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "")));

  const startCite = reresolve();
  const sessionStartResolved = Number(prior?.startResolved ?? startCite.json?.resolvedAfter ?? 2155);
  const sessionStartCases = Number(prior?.startCases ?? startCite.json?.corpus?.cases ?? 3913);
  const sessionStartExtracted = Number(prior?.startExtracted ?? startCite.json?.extracted ?? 38359);
  const resumeResolved = Number(startCite.json?.resolvedAfter ?? sessionStartResolved);

  const acc = {
    classification: "CITATION_DEMAND_ADAPTIVE_SCALE_3",
    startedAt: prior?.startedAt || new Date().toISOString(),
    resumedAt: prior ? new Date().toISOString() : null,
    budget: BUDGET,
    pacingMs: CL_RATE_MS,
    attributionMethod: "exact_per_citation_edge_delta",
    equalShareUsed: false,
    fsuppStatus: "PAUSED_LOW_SAMPLE_NONPRODUCTIVE",
    startResolved: sessionStartResolved,
    startCases: sessionStartCases,
    startExtracted: sessionStartExtracted,
    totalCl: Number(prior?.totalCl || 0),
    targetsAttempted: Number(prior?.targetsAttempted || 0),
    targetsFound: Number(prior?.targetsFound || 0),
    targetsAcquired: Number(prior?.targetsAcquired || 0),
    productionEmbeddingChunks: Number(prior?.productionEmbeddingChunks || 0),
    byFamily: {},
    bySubfamily: prior?.bySubfamily || {},
    targetOutcomes: { ...(prior?.targetOutcomes || {}) },
    targetRows: [...(prior?.targetRows || [])],
    reallocationLog: [...(prior?.reallocationLog || [])],
    notes: [...(prior?.notes || [])],
    stopReason: null,
    reliability: { "408": 0, "429": Number(prior?.reliability?.["429"] || 0) },
    queuesLeft: {},
  };

  // rebuild family stats from rows
  for (const r of acc.targetRows) {
    already.add(String(r.citation || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, ""));
    const famStat = ensureFam(acc, r.family);
    famStat.attempts += 1;
    famStat.cl += Number(r.totalCLRequests || 0);
    famStat.edgeDemandSum += Number(r.edgeDemandBefore || 0);
    if (r.ingested || r.lookupResult === "FOUND_EXACT") famStat.found += 1;
    if (r.ingested) {
      famStat.acquired += 1;
      famStat.oldEdgesResolved += Number(r.oldUnresolvedEdgesResolved || 0);
      famStat.actualDemandSum += Number(r.oldUnresolvedEdgesResolved || 0);
      famStat.recentEdges.push(Number(r.oldUnresolvedEdgesResolved || 0));
      famStat.recentCl.push(Number(r.totalCLRequests || 0));
    } else if (r.outcome === "NOT_FOUND_CL") famStat.notFound += 1;
    else if (r.outcome === "SOURCE_ERROR") famStat.sourceErrors += 1;
  }

  // trim queues by already attempted
  for (const f of Object.keys(queues)) {
    queues[f] = queues[f].filter((t) => !already.has(String(t.citation || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "")));
    acc.queuesLeft[f] = queues[f].length;
  }
  process.stdout.write("QUEUES_LEFT " + JSON.stringify(acc.queuesLeft) + "\n");

  let weights = computeWeights(acc);
  process.stdout.write("WEIGHTS_START " + JSON.stringify({
    us: weights.us_reports, r: weights.regional_reporter, f: weights.federal_reporter,
  }) + "\n");
  acc.reallocationLog.push({
    at: new Date().toISOString(),
    checkpoint: "start",
    weights: { us: weights.us_reports, regional: weights.regional_reporter, federal: weights.federal_reporter },
    measured: Object.fromEntries(ACTIVE.map((f) => [f, weights.scores[f]])),
  });

  let sinceAcquired = 0;
  let consecutiveZeroCl = 0;
  const familyNotFound = Object.fromEntries(ACTIVE.map((f) => [f, 0]));
  const familyClSpend = Object.fromEntries(ACTIVE.map((f) => [f, 0]));
  const familyClBudgetShare = () => {
    // rolling CL share vs weights — pick family most under its weight share
    const total = Math.max(acc.totalCl - Number(prior?.totalCl || 0), 1);
    let best = null;
    let bestScore = -Infinity;
    for (const f of ACTIVE) {
      if (pointers[f] >= queues[f].length) continue;
      if (ensureFam(acc, f).paused) continue;
      const targetShare = weights[f] || 0;
      if (targetShare <= 0) continue;
      const actualShare = (familyClSpend[f] || 0) / total;
      const deficit = targetShare - actualShare;
      const rankBoost = (queues[f][pointers[f]]?.edgeDemand || 0) / 100;
      const score = deficit * 10 + rankBoost + (weights.scores[f]?.measured || 0);
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  };

  while (!FINALIZE_ONLY && acc.totalCl < BUDGET - 2) {
    const fam = familyClBudgetShare();
    if (!fam) {
      acc.stopReason = acc.stopReason || "target_pool_exhausted";
      break;
    }
    const t = queues[fam][pointers[fam]++];
    if (!t) continue;
    acc.queuesLeft[fam] = Math.max(0, queues[fam].length - pointers[fam]);

    const beforeEdge = edgeCounts([t.citation]);
    if (!beforeEdge.json?.ok || !beforeEdge.json?.counts?.[0]) {
      acc.notes.push({ at: new Date().toISOString(), note: "edge_count_failed", citation: t.citation });
      continue;
    }
    const before = beforeEdge.json.counts[0];
    if (Number(before.unresolved || 0) <= 0) {
      const mt = (manifest.targets || []).find((x) => x.citation === t.citation);
      if (mt) {
        mt.status = Number(before.resolved || 0) > 0 ? "ALREADY_RESOLVED_LOCALLY" : "SKIPPED_ZERO_LIVE_DEMAND";
        mt.lastAttemptedAt = new Date().toISOString();
      }
      process.stdout.write(`\n=== SCALE3 SKIP zero-live ${fam} | ${t.citation} ===\n`);
      continue;
    }

    process.stdout.write(`\n=== SCALE3 ${fam} | ${t.citation} | demand=${t.edgeDemand} | liveU=${before.unresolved} | w=${JSON.stringify({ us: +weights.us_reports.toFixed(2), r: +weights.regional_reporter.toFixed(2), f: +weights.federal_reporter.toFixed(2) })} ===\n`);

    const maxCalls = Math.min(6, BUDGET - acc.totalCl);
    const run = flyNode("scripts/tmp-queue2-cite-demand-multi-ingest-bundled.cjs", [t.citation, String(maxCalls), "1"], 360);
    const j = run.json || {};
    const cl = Number(j.courtListenerHttpCalls || 0);
    acc.totalCl += cl;
    familyClSpend[fam] = (familyClSpend[fam] || 0) + cl;

    if (j.rateLimited) {
      acc.reliability["429"] += 1;
      acc.stopReason = "429";
      fs.writeFileSync(COOLDOWN, JSON.stringify({
        classification: "CITE_DEMAND_429_STOP",
        at: new Date().toISOString(),
        totalCl: acc.totalCl,
        stopReason: "429",
        block: "adaptive_scale_3",
        retryAfter: j.retryAfter || null,
      }, null, 2));
    }

    const row = (j.results || [])[0] || (j.preverify || [])[0] || (j.deferred || [])[0] || {};
    const status = row.status || "NOT_FOUND_CL";
    const acquired = status === "imported" || status === "new_version";
    const alreadyPresent = status === "already_present";
    const found = acquired || alreadyPresent || status === "verified";
    const reason = String(row.reason || "");
    let outcome = "NOT_FOUND_CL";
    let lookupResult = "NOT_FOUND";
    if (acquired) { outcome = "ACQUIRED_PENDING"; lookupResult = "FOUND_EXACT"; }
    else if (alreadyPresent) { outcome = "FOUND_ALREADY_PRESENT"; lookupResult = "FOUND_EXACT"; }
    else if (/ambiguous/i.test(reason)) { outcome = "AMBIGUOUS"; lookupResult = "AMBIGUOUS"; }
    else if (/rate_limited|budget/i.test(reason) || acc.stopReason === "429") { outcome = "SOURCE_ERROR"; lookupResult = "SOURCE_ERROR"; }

    const famStat = ensureFam(acc, fam);
    acc.targetsAttempted += 1;
    famStat.attempts += 1;
    famStat.cl += cl;
    famStat.edgeDemandSum += Number(t.edgeDemand || 0);
    if (found) { acc.targetsFound += 1; famStat.found += 1; familyNotFound[fam] = 0; }
    else if (outcome === "AMBIGUOUS") famStat.ambiguous += 1;
    else if (outcome === "SOURCE_ERROR") famStat.sourceErrors += 1;
    else { famStat.notFound += 1; familyNotFound[fam] += 1; }

    let oldEdgesResolved = 0;
    let newEdgesIntroduced = 0;
    let after = before;
    if (acquired) {
      acc.targetsAcquired += 1;
      famStat.acquired += 1;
      sinceAcquired += 1;
      acc.productionEmbeddingChunks += Number(row.embeddedChunks || 0);
      // per-target reresolve for exact attribution
      reresolve();
      const afterEdge = edgeCounts([t.citation]);
      after = afterEdge.json?.counts?.[0] || before;
      oldEdgesResolved = Math.max(0, Number(before.unresolved || 0) - Number(after.unresolved || 0));
      newEdgesIntroduced = Math.max(0, Number(after.total || 0) - Number(before.total || 0));
      famStat.oldEdgesResolved += oldEdgesResolved;
      famStat.actualDemandSum += oldEdgesResolved;
      famStat.newEdgesIntroduced += newEdgesIntroduced;
      famStat.recentEdges.push(oldEdgesResolved);
      famStat.recentCl.push(cl);
      outcome = oldEdgesResolved > 0 ? "ACQUIRED_RESOLVED" : "ACQUIRED_ZERO_OLD_RESOLUTION";
      consecutiveZeroCl = 0;

      const sub = subfamilyOf(t.citation);
      acc.bySubfamily[sub] = acc.bySubfamily[sub] || { acquired: 0, cl: 0, oldEdgesResolved: 0 };
      acc.bySubfamily[sub].acquired += 1;
      acc.bySubfamily[sub].cl += cl;
      acc.bySubfamily[sub].oldEdgesResolved += oldEdgesResolved;
    } else if (cl > 0 && !found) {
      consecutiveZeroCl += cl;
      famStat.recentEdges.push(0);
      famStat.recentCl.push(cl);
    }

    acc.targetOutcomes[outcome] = (acc.targetOutcomes[outcome] || 0) + 1;
    const targetRow = {
      citation: t.citation,
      family: fam,
      subfamily: subfamilyOf(t.citation),
      manifestRank: t.rank || null,
      edgeDemandBefore: Number(t.edgeDemand || 0),
      totalCLRequests: cl,
      clRequests: {
        lookup: Number(row.preverifyCl || Math.min(cl, 1)),
        fetch: Number(row.acquireCl || (acquired ? Math.max(0, cl - 1) : 0)),
        fallbackSearch: 0,
        total: cl,
      },
      lookupResult,
      ingested: acquired,
      unresolvedEdgesBefore: before.unresolved,
      unresolvedEdgesAfter: after.unresolved,
      oldUnresolvedEdgesResolved: oldEdgesResolved,
      newCitationEdgesIntroduced: newEdgesIntroduced,
      actualEdgesPerCL: cl ? +(oldEdgesResolved / cl).toFixed(3) : null,
      actualCLPerTarget: cl,
      outcome,
      authorityId: row.authorityId || null,
      method: row.method || "citation-lookup",
      status,
      reason: reason || null,
    };
    acc.targetRows.push(targetRow);

    const mt = (manifest.targets || []).find((x) => x.citation === t.citation || x.canonicalTargetKey === t.citation);
    if (mt) {
      mt.lastAttemptedAt = new Date().toISOString();
      mt.actualCLRequests = (mt.actualCLRequests || 0) + cl;
      mt.actualOldEdgesResolved = oldEdgesResolved;
      mt.actualEdgesPerCL = targetRow.actualEdgesPerCL;
      mt.lookupMethod = "citation-lookup";
      mt.attemptCount = (mt.attemptCount || 0) + 1;
      mt.found = Boolean(found);
      mt.acquired = Boolean(acquired);
      mt.status = acquired ? "ACQUIRED" : alreadyPresent ? "ALREADY_PRESENT" : outcome;
      mt.failureReason = acquired || alreadyPresent ? null : (reason || outcome);
      mt.statusHistory = Array.isArray(mt.statusHistory) ? mt.statusHistory : [];
      mt.statusHistory.push({ status: mt.status, at: mt.lastAttemptedAt, cl, oldEdgesResolved, block: "scale3" });
    }

    fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
    process.stdout.write(JSON.stringify({
      citation: t.citation, family: fam, cl, totalCl: acc.totalCl, outcome, oldEdgesResolved, acquired: acc.targetsAcquired,
    }) + "\n");

    if (acc.stopReason === "429") break;
    if ((j.duplicateSourceIds || 0) > 0 || (j.orphans || 0) > 0 || (j.chunks?.missing_embeddings || 0) > 0) {
      acc.stopReason = "integrity_regression";
      break;
    }
    if (consecutiveZeroCl >= 5) {
      acc.notes.push({ at: new Date().toISOString(), note: "five_consecutive_cl_zero_progress", family: fam });
      ensureFam(acc, fam).paused = true;
      consecutiveZeroCl = 0;
    }
    if (familyNotFound[fam] >= 3) {
      acc.notes.push({ at: new Date().toISOString(), note: "three_consecutive_not_found", family: fam });
      // pause method for this family briefly by skipping remaining? keep going but mark
      familyNotFound[fam] = 0;
    }

    // Checkpoint every ~15 acquires
    if (sinceAcquired > 0 && ([20, 35, 60].includes(acc.targetsAcquired) || (sinceAcquired > 0 && sinceAcquired % 20 === 0))) {
      weights = computeWeights(acc);
      acc.reallocationLog.push({
        at: new Date().toISOString(),
        checkpoint: `acq_${acc.targetsAcquired}`,
        weights: { us: +weights.us_reports.toFixed(3), regional: +weights.regional_reporter.toFixed(3), federal: +weights.federal_reporter.toFixed(3) },
        familyTable: familyTable(acc),
        measuredOrder: ACTIVE.slice().sort((a, b) => (famEdgesPerCl(ensureFam(acc, b)) || 0) - (famEdgesPerCl(ensureFam(acc, a)) || 0)),
      });
      // integrity checkpoint
      const integ = reresolve();
      if ((integ.json?.duplicateSourceIds || 0) > 0 || (integ.json?.orphans || 0) > 0 || (integ.json?.chunks?.missing_embeddings || 0) > 0) {
        acc.stopReason = "integrity_regression";
        break;
      }
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
      fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
    }
  }

  const finalRr = reresolve();
  const endResolved = Number(finalRr.json?.resolvedAfter ?? resumeResolved);
  const endCases = Number(finalRr.json?.corpus?.cases || sessionStartCases);
  const endExtracted = Number(finalRr.json?.extracted ?? sessionStartExtracted);
  const exactOldEdges = acc.targetRows.reduce((s, r) => s + Number(r.oldUnresolvedEdgesResolved || 0), 0);

  acc.targetOutcomes = {};
  for (const r of acc.targetRows) acc.targetOutcomes[r.outcome] = (acc.targetOutcomes[r.outcome] || 0) + 1;

  acc.endResolved = endResolved;
  acc.endCases = endCases;
  acc.endExtracted = endExtracted;
  acc.oldUnresolvedEdgesResolvedExact = exactOldEdges;
  acc.oldUnresolvedEdgesResolvedGlobal = Math.max(0, endResolved - sessionStartResolved);
  acc.oldUnresolvedEdgesResolved = exactOldEdges;
  acc.usefulAuthoritiesAdded = Math.max(0, endCases - sessionStartCases);
  acc.familyTable = familyTable(acc);
  acc.metrics = {
    overallClPerAcquired: acc.targetsAcquired ? +(acc.totalCl / acc.targetsAcquired).toFixed(3) : null,
    overallOldEdgesPerAcquired: acc.targetsAcquired ? +(exactOldEdges / acc.targetsAcquired).toFixed(3) : null,
    overallOldEdgesPerCl: acc.totalCl ? +(exactOldEdges / acc.totalCl).toFixed(3) : null,
    globalResolvedDelta: Math.max(0, endResolved - sessionStartResolved),
    demandPredicted: acc.targetRows.reduce((s, r) => s + Number(r.edgeDemandBefore || 0), 0),
    demandActual: exactOldEdges,
    demandRealization: null,
    remainingTo10Pct: Math.ceil(0.1 * endExtracted) - endResolved,
  };
  if (acc.metrics.demandPredicted) {
    acc.metrics.demandRealization = +(acc.metrics.demandActual / acc.metrics.demandPredicted).toFixed(3);
  }

  // final weights snapshot
  weights = computeWeights(acc);
  acc.reallocationLog.push({
    at: new Date().toISOString(),
    checkpoint: "end",
    weights: { us: +weights.us_reports.toFixed(3), regional: +weights.regional_reporter.toFixed(3), federal: +weights.federal_reporter.toFixed(3) },
    familyTable: acc.familyTable,
    measuredOrder: ACTIVE.slice().sort((a, b) => (acc.familyTable[b].edgesPerCl || 0) - (acc.familyTable[a].edgesPerCl || 0)),
  });

  manifest.adaptiveScale3 = {
    generatedAt: new Date().toISOString(),
    version: "cite-demand-scale3-v1",
    totalCl: acc.totalCl,
    acquired: acc.targetsAcquired,
    oldEdgesResolvedExact: exactOldEdges,
    metrics: acc.metrics,
    familyTable: acc.familyTable,
    bySubfamily: acc.bySubfamily,
    reallocationLog: acc.reallocationLog,
    fsuppStatus: acc.fsuppStatus,
    equalShareUsed: false,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  if (!acc.stopReason) {
    acc.stopReason = acc.totalCl >= BUDGET - 2 ? "budget_exhausted" : "plan_complete";
  }
  acc.finishedAt = new Date().toISOString();
  acc.integrityFinal = {
    duplicates: finalRr.json?.duplicateSourceIds ?? null,
    orphans: finalRr.json?.orphans ?? null,
    missingEmbeddings: finalRr.json?.chunks?.missing_embeddings ?? null,
  };
  fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));

  console.log("CITE_SCALE3_DONE " + JSON.stringify({
    totalCl: acc.totalCl,
    attempted: acc.targetsAttempted,
    acquired: acc.targetsAcquired,
    oldEdgesExact: exactOldEdges,
    globalDelta: acc.oldUnresolvedEdgesResolvedGlobal,
    metrics: acc.metrics,
    familyTable: acc.familyTable,
    stop: acc.stopReason,
    reliability: acc.reliability,
  }));
  process.exit(acc.stopReason === "429" || acc.stopReason === "integrity_regression" ? 1 : 0);
}

main();
