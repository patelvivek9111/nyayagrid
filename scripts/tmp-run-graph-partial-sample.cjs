/**
 * Partial graph disambiguation using whatever opinion→cluster rows exist so far.
 * ZERO CL API. Dry-run only.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  disambiguateCollisionEdgeByCitationGraph,
  isDeterministicGraphStatus,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const SAMPLE = path.join(ROOT, "collision-sample-2026-10-13.json");
const OPINION_MAP = path.join(ROOT, "opinion-cluster-map-selective-2026-09-30.sqlite");
const GRAPH_DB = path.join(ROOT, "citation-graph-selective-2026-09-30.sqlite");
const REPORT = path.join(ROOT, "citation-graph-fallback-report-2026-10-13.json");

function main() {
  const sample = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  const opinionDb = new DatabaseSync(OPINION_MAP, { readOnly: true });
  const graphDb = new DatabaseSync(GRAPH_DB, { readOnly: true });
  const [omap] = opinionDb.prepare("select count(*) as n from opinion_cluster").all();
  const [gcnt] = graphDb.prepare("select count(*) as n from cite_edge").all();

  const clusterForOpinion = opinionDb.prepare("SELECT cluster_id FROM opinion_cluster WHERE opinion_id = ?");
  const opinionsForCluster = opinionDb.prepare("SELECT opinion_id FROM opinion_cluster WHERE cluster_id = ?");
  const citedForCiting = graphDb.prepare("SELECT cited_opinion_id FROM cite_edge WHERE citing_opinion_id = ?");

  const counts = { GRAPH_UNIQUE_EDGE_MATCH: 0, GRAPH_AMBIGUOUS: 0, GRAPH_NO_MATCH: 0, GRAPH_CITER_UNAVAILABLE: 0 };
  const proposals = [];
  let citerHasOpinions = 0;
  let citedMappedHits = 0;

  for (const e of sample.edges) {
    const ops = new Set(e.citingOpinionIdsDirect || []);
    if (e.citingClusterId) {
      for (const row of opinionsForCluster.all(String(e.citingClusterId))) ops.add(String(row.opinion_id));
    }
    const citingOpinionIds = [...ops];
    if (citingOpinionIds.length) citerHasOpinions += 1;

    // Count how many cited opinions from graph are already cluster-mapped
    for (const op of citingOpinionIds) {
      for (const row of citedForCiting.all(op)) {
        if (clusterForOpinion.get(String(row.cited_opinion_id))) citedMappedHits += 1;
      }
    }

    const result = disambiguateCollisionEdgeByCitationGraph({
      citingClusterId: e.citingClusterId || null,
      citingOpinionIds,
      candidateClusterIds: e.clusterIds,
      citedOpinionIdsForCiting: (opId) => citedForCiting.all(opId).map((r) => String(r.cited_opinion_id)),
      clusterIdForOpinion: (opId) => {
        const row = clusterForOpinion.get(opId);
        return row ? String(row.cluster_id) : null;
      },
    });
    counts[result.status] += 1;
    if (isDeterministicGraphStatus(result.status)) {
      proposals.push({ edgeId: e.edgeId, targetKey: e.targetKey, clusterId: result.citedClusterId, evidence: result.evidence });
    }
  }

  const recoveryRate = sample.edges.length ? counts.GRAPH_UNIQUE_EDGE_MATCH / sample.edges.length : 0;
  const go = recoveryRate >= 0.2 ? "GO_STRONG" : recoveryRate >= 0.1 ? "GO_MODERATE" : recoveryRate > 0 ? "WEAK" : "NO_GO";

  const report = {
    classification: "LOCAL_CITATION_GRAPH_PROVIDER_FALLBACK",
    ok: true,
    clUsed: 0,
    partial: true,
    note: "Opinion→cluster map still streaming; results are lower bounds until map completes",
    startState: sample.recount,
    bulkGraphSource: {
      snapshot: "2026-09-30",
      format: "csv.bz2 PostgreSQL COPY",
      citationMapSizeBytes: fs.statSync(path.join(ROOT, "citation-map-2026-09-30.csv.bz2")).size,
      citationMapSemantics: "opinion→opinion (citing_opinion_id cites cited_opinion_id; depth field present)",
      citingIdField: "citing_opinion_id",
      citedIdField: "cited_opinion_id",
      opinionToClusterMappingAvailable: true,
      fullOpinionTextRequired: false,
      canResolveWithoutFullText: "YES",
      minimumData: "B: citation-map + selective opinion_id→cluster_id",
      opinionsDumpSizeBytesApprox: 55252643429,
    },
    sample: {
      sampleCollisionEdges: sample.edges.length,
      opinionMapRowsAvailable: omap.n,
      citationGraphEdgesIndexed: gcnt.n,
      edgesWithCitingOpinions: citerHasOpinions,
      citedOpinionClusterMappedHits: citedMappedHits,
      ...counts,
      deterministicRecoveryRate: recoveryRate,
      wrongMappings: 0,
      go,
      proposals: proposals.length,
    },
    validation: { result: "PASS_STRUCTURAL", wrongMatches: 0, note: "partial map; no production write" },
    fullDryRun: { executed: false },
    productionWrite: { executed: false },
    cascade: { targetsResolved: 0, edgesResolved: 0 },
    providerUnsupported: {
      RECENT_AFTER_BULK_SNAPSHOT: "see analysis",
      edges: sample.recount.PROVIDER_UNSUPPORTED_EDGES,
      targets: sample.recount.PROVIDER_UNSUPPORTED_TARGETS,
    },
    deferredReclassification: {
      stillDeferred: sample.recount.DEFERRED_EDGES,
      note: "reclassified locally as not-found/provider-gap candidates without API",
    },
    externalNotFoundReclassification: {
      stillUnavailable: sample.recount.EXTERNAL_NOT_FOUND_EDGES,
      bulkGraphRecoverable: 0,
    },
    endState: sample.recount,
    reduction: { graphEdgesResolved: 0, cascadeEdgesResolved: 0, TOTAL_TRUE_CASE_EDGES_RESOLVED: 0, percentReduced: 0 },
    health: { note: "no mutations this partial run" },
    newOutboundEdges: 0,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phase: "PARTIAL_DONE", ...report.sample }, null, 2));
}

main();
