/**
 * Bulk CL citations.csv local identity matcher PROTOTYPE.
 * Zero CourtListener API. Zero production writes.
 *
 * Index key: volume|compactReporter|page → Set(cluster_id)
 * Deterministic AUTO classes only when exactly one cluster.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const {
  experimentalNormalize,
  parseVolReporterPage,
  classifyCaseCitationLookupEligibility,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const CSV = path.join(ROOT, "citations-2026-09-30.csv");
const SAMPLE = path.join(ROOT, "stratified-sample-2026-10-13.json");
const OUT = path.join(ROOT, "prototype-match-results-2026-10-13.json");

function compactReporter(r) {
  return String(r || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function vrpCompactKey(volume, reporter, page) {
  const v = Number(volume);
  const p = Number(String(page).replace(/[^0-9].*$/, "")); // drop page suffixes like 123a
  const rep = compactReporter(reporter);
  if (!Number.isFinite(v) || !Number.isFinite(p) || !rep) return null;
  return `${v}|${rep}|${p}`;
}

function citeToKey(normalizedOrRaw) {
  const lean = experimentalNormalize(normalizedOrRaw) || String(normalizedOrRaw || "");
  const p = parseVolReporterPage(lean);
  if (p) return vrpCompactKey(p.volume, p.reporter, p.page);
  // fallback: vol reporter page loose
  const m = lean.match(/^(\d{1,4})\s+([A-Za-z0-9 .']+?)\s+(\d{1,5}[A-Za-z]?)$/);
  if (m) return vrpCompactKey(m[1], m[2], m[3]);
  return null;
}

async function buildIndexForKeys(neededKeys) {
  const index = new Map(); // key -> Set(clusterId)
  const reporterExamples = new Map();
  let rows = 0;
  let hits = 0;
  const t0 = Date.now();
  const rl = readline.createInterface({ input: fs.createReadStream(CSV, { encoding: "utf8" }), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (!header) {
      header = line.split(",").map((h) => h.replace(/^"|"$/g, ""));
      continue;
    }
    rows += 1;
    // fast path: CSV is FORCE_QUOTE * so fields are quoted
    // id,volume,reporter,page,type,cluster_id,...
    const parts = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    if (parts.length < 6) continue;
    const volume = parts[1];
    const reporter = parts[2];
    const page = parts[3];
    const clusterId = parts[5];
    const key = vrpCompactKey(volume, reporter, page);
    if (!key) continue;
    if (!reporterExamples.has(compactReporter(reporter))) {
      reporterExamples.set(compactReporter(reporter), reporter);
    }
    if (neededKeys && !neededKeys.has(key)) continue;
    hits += 1;
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(String(clusterId));
  }
  return {
    index,
    rows,
    matchedRows: hits,
    ms: Date.now() - t0,
    reporterExamples: Object.fromEntries([...reporterExamples.entries()].slice(0, 80)),
  };
}

function classifyTarget(t, index) {
  const el = classifyCaseCitationLookupEligibility(t.raw, t.normalized);
  if (!el.eligible) {
    return { status: "INELIGIBLE", reason: el.lane, clusterIds: [], key: null };
  }
  const key = citeToKey(t.normalized) || citeToKey(t.raw);
  if (!key) {
    return { status: "NOT_FOUND", reason: "no_vrp_key", clusterIds: [], key: null };
  }
  const set = index.get(key);
  if (!set || set.size === 0) {
    return { status: "NOT_FOUND", reason: "key_absent", clusterIds: [], key };
  }
  const ids = [...set];
  if (ids.length > 1) {
    return { status: "AMBIGUOUS", reason: "multi_cluster_vrp", clusterIds: ids.slice(0, 8), key };
  }
  // Single cluster — classify resolution flavor
  let status = "RESOLVED_NORMALIZED";
  const exactLean = experimentalNormalize(t.normalized) || t.normalized;
  const p = parseVolReporterPage(exactLean);
  if (p && t.normalized && experimentalNormalize(t.normalized) === t.normalized) {
    status = "RESOLVED_EXACT";
  }
  // If raw differs from normalized but same key → still exact VRP
  if (t.raw && experimentalNormalize(t.raw) !== experimentalNormalize(t.normalized)) {
    status = "RESOLVED_NORMALIZED";
  }
  // Parallel/alias would require reverse lookup of other citations for same cluster —
  // marked when sample citation reporter differs from a known primary family but still unique
  if (p && /S\.\s*Ct|L\.\s*Ed/i.test(p.reporter)) {
    status = "RESOLVED_PARALLEL"; // secondary SCOTUS reporters treated as parallel-form identity
  }
  return { status, reason: "unique_vrp_cluster", clusterIds: ids, key };
}

async function main() {
  if (!fs.existsSync(CSV)) throw new Error(`missing ${CSV}`);
  if (!fs.existsSync(SAMPLE)) throw new Error(`missing ${SAMPLE}`);
  const sampleDoc = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  const sample = sampleDoc.sample;

  const neededKeys = new Set();
  for (const t of sample) {
    const k = citeToKey(t.normalized) || citeToKey(t.raw);
    if (k) neededKeys.add(k);
  }
  console.log(JSON.stringify({ phase: "BUILD_INDEX", sample: sample.length, neededKeys: neededKeys.size }));

  const built = await buildIndexForKeys(neededKeys);
  console.log(
    JSON.stringify({
      phase: "INDEX_DONE",
      rowsScanned: built.rows,
      matchedRows: built.matchedRows,
      keysIndexed: built.index.size,
      ms: built.ms,
      rowsPerSec: Math.round(built.rows / (built.ms / 1000)),
    }),
  );

  const tMatch0 = Date.now();
  const results = [];
  const counts = {
    RESOLVED_EXACT: 0,
    RESOLVED_NORMALIZED: 0,
    RESOLVED_PARALLEL: 0,
    RESOLVED_ALIAS: 0,
    AMBIGUOUS: 0,
    NOT_FOUND: 0,
    INELIGIBLE: 0,
  };
  for (const t of sample) {
    const r = classifyTarget(t, built.index);
    counts[r.status] = (counts[r.status] || 0) + 1;
    results.push({
      targetKey: t.targetKey,
      citation: t.normalized,
      edgeCount: t.edgeCount,
      eligible: t.eligible,
      flags: t.flags,
      ...r,
    });
  }
  const matchMs = Date.now() - tMatch0;
  const n = sample.length;
  const deterministic =
    counts.RESOLVED_EXACT + counts.RESOLVED_NORMALIZED + counts.RESOLVED_PARALLEL + counts.RESOLVED_ALIAS;
  const eligibleN = sample.filter((t) => t.eligible).length;

  // Structural validation of deterministic hits
  const det = results.filter((r) => String(r.status).startsWith("RESOLVED_"));
  const amb = results.filter((r) => r.status === "AMBIGUOUS");
  let reporterCollisions = 0;
  let suspicious = [];
  for (const r of det) {
    if (!r.key || r.clusterIds.length !== 1) {
      suspicious.push({ ...r, issue: "bad_det_shape" });
      continue;
    }
    // key must parse
    const [v, rep, p] = r.key.split("|");
    if (!v || !rep || !p) {
      suspicious.push({ citation: r.citation, issue: "malformed_key", key: r.key });
      continue;
    }
  }
  // Ambiguous = natural VRP collisions in CL data
  reporterCollisions = amb.length;

  // Estimate payoff from eligible deterministic rate on sample
  const detRateEligible = eligibleN ? deterministic / eligibleN : 0;
  const detRateAll = deterministic / n;
  const backlogTargets = sampleDoc.stats.backlog.uniqueTargets;
  const backlogEdges = sampleDoc.stats.backlog.unresolvedEdges;
  // Weight by edge buckets in sample for edge estimate
  let sampleEdges = 0;
  let sampleDetEdges = 0;
  for (const r of results) {
    sampleEdges += r.edgeCount;
    if (String(r.status).startsWith("RESOLVED_")) sampleDetEdges += r.edgeCount;
  }
  const edgeHitRate = sampleEdges ? sampleDetEdges / sampleEdges : 0;

  const out = {
    ok: true,
    dataset: "citations-2026-09-30.csv",
    indexBuild: {
      rowsScanned: built.rows,
      matchedRowsForSampleKeys: built.matchedRows,
      keysIndexed: built.index.size,
      ms: built.ms,
      rowsPerSec: Math.round(built.rows / (built.ms / 1000)),
    },
    sampleStats: sampleDoc.stats,
    counts,
    rates: {
      deterministicMatchRateAll: detRateAll,
      deterministicMatchRateEligible: detRateEligible,
      ambiguityRate: counts.AMBIGUOUS / n,
      notFoundRate: counts.NOT_FOUND / n,
      ineligibleRate: counts.INELIGIBLE / n,
      exact: counts.RESOLVED_EXACT / n,
      normalized: counts.RESOLVED_NORMALIZED / n,
      parallel: counts.RESOLVED_PARALLEL / n,
      alias: counts.RESOLVED_ALIAS / n,
    },
    validation: {
      deterministicCount: det.length,
      ambiguousCount: amb.length,
      suspiciousCount: suspicious.length,
      suspicious: suspicious.slice(0, 20),
      ambiguousSample: amb.slice(0, 15).map((a) => ({
        citation: a.citation,
        key: a.key,
        clusters: a.clusterIds,
        edges: a.edgeCount,
      })),
      resolvedSample: det.slice(0, 25).map((a) => ({
        citation: a.citation,
        status: a.status,
        key: a.key,
        clusterId: a.clusterIds[0],
        edges: a.edgeCount,
      })),
      estimatedFalsePositiveRate: suspicious.length === 0 ? 0 : suspicious.length / Math.max(1, det.length),
      reporterCollisionsObservedAsAmbiguous: reporterCollisions,
      note: "Precision validated structurally (unique VRP→cluster). Case-name/court not in citations.csv — residual false-positive risk from VRP collisions mislabeled as unique is captured via AMBIGUOUS; wrong-unique VRP without collision cannot be detected without cluster metadata.",
    },
    throughput: {
      sampleMatchMs: matchMs,
      sampleTargetsPerSec: n / (matchMs / 1000 || 1),
      fullScanRowsPerSec: Math.round(built.rows / (built.ms / 1000)),
      estimatedFullIndexBuildSec: Math.round(built.ms / 1000), // already full scan
      estimated49kLookupSecAfterIndex: Math.round(49000 / Math.max(1, n / (matchMs / 1000 || 1))),
    },
    payoffEstimate: {
      method: "extrapolate eligible-deterministic rate and edge-weighted hit rate from stratified sample; estimate only",
      uniqueTargetsPotentiallyResolvable: Math.round(backlogTargets * detRateAll),
      edgesPotentiallyResolvable: Math.round(backlogEdges * edgeHitRate),
      clCallsPotentiallyAvoided: Math.round(backlogTargets * detRateEligible),
      estimatedRemainingHardTargets: Math.round(backlogTargets * (1 - detRateAll)),
      sampleEdgeHitRate: edgeHitRate,
    },
    results,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        out: OUT,
        counts,
        rates: out.rates,
        payoffEstimate: out.payoffEstimate,
        throughput: out.throughput,
        validation: {
          deterministic: det.length,
          suspicious: suspicious.length,
          falsePositiveEst: out.validation.estimatedFalsePositiveRate,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
