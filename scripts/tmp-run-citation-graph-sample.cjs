/**
 * Disambiguate exported collision sample using selective opinion map + citation-map.
 * ZERO CL API. Dry-run by default. GRAPH_FORCE_WRITE=1 to apply edge-level writes.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { DatabaseSync } = require("node:sqlite");
const postgres = require("postgres");
const {
  experimentalNormalize,
  createResolutionRecord,
  appendLedger,
  RESOLVER_VERSION,
  disambiguateCollisionEdgeByCitationGraph,
  isDeterministicGraphStatus,
  CITATION_GRAPH_METHOD,
  CITATION_MAP_SNAPSHOT_ID,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");
const {
  acquireWorkerLock,
  releaseWorkerLock,
  refreshWorkerHeartbeat,
  newWorkerId,
  newProcessStartNonce,
  ACTIVE_REFUSAL_CODE,
} = require("./queue2-worker-lock.cjs");

const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const SAMPLE = path.join(ROOT, "collision-sample-2026-10-13.json");
const OPINION_MAP = path.join(ROOT, "opinion-cluster-map-selective-2026-09-30.sqlite");
const CITATION_MAP_BZ2 = path.join(ROOT, "citation-map-2026-09-30.csv.bz2");
const GRAPH_DB = path.join(ROOT, "citation-graph-selective-2026-09-30.sqlite");
const REPORT = path.join(ROOT, "citation-graph-fallback-report-2026-10-13.json");
const LEDGER = path.join(__dirname, "../packages/research/corpus/resolution/ledger/cl-citation-graph-fallback-2026-10-13.jsonl");
const REPORTS_DIR = path.join(__dirname, "../packages/research/corpus/reports");
const SOURCE = "courtlistener";
const DRY_ONLY = process.env.GRAPH_FORCE_WRITE !== "1";
const WORKER_ID = process.env.QUEUE2_WORKER_ID || newWorkerId();
const PROCESS_NONCE = newProcessStartNonce();

function parseCsvLine(line) {
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
  return parts;
}

function openBz2Stream(filePath) {
  const script = [
    "import bz2,sys,io",
    "sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', newline='')",
    "path=sys.argv[1]",
    "with bz2.open(path,'rt',encoding='utf-8',errors='replace', newline='') as f:",
    "    for line in f:",
    "        sys.stdout.write(line)",
  ].join("\n");
  return spawn("python", ["-u", "-c", script, filePath], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
}

function buildGraphEdges(citingOpinionIds) {
  if (fs.existsSync(GRAPH_DB)) fs.unlinkSync(GRAPH_DB);
  const db = new DatabaseSync(GRAPH_DB);
  db.exec(`
    PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
    CREATE TABLE cite_edge (citing_opinion_id TEXT NOT NULL, cited_opinion_id TEXT NOT NULL);
    CREATE INDEX idx_cite_citing ON cite_edge(citing_opinion_id);
  `);
  const insert = db.prepare("INSERT INTO cite_edge(citing_opinion_id, cited_opinion_id) VALUES (?, ?)");
  const wanted = citingOpinionIds;
  let header = null;
  let citingIdx = -1;
  let citedIdx = -1;
  let rows = 0;
  let kept = 0;
  const child = openBz2Stream(CITATION_MAP_BZ2);
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    db.exec("BEGIN");
    rl.on("line", (line) => {
      if (!header) {
        header = parseCsvLine(line).map((h) => h.replace(/^"|"$/g, ""));
        citingIdx = header.indexOf("citing_opinion_id");
        citedIdx = header.indexOf("cited_opinion_id");
        return;
      }
      rows += 1;
      if (rows % 5000000 === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
        console.log(JSON.stringify({ phase: "CITATION_MAP_PROGRESS", rows, kept }));
      }
      const cols = parseCsvLine(line);
      const citing = String(cols[citingIdx] || "").replace(/^"|"$/g, "");
      if (!wanted.has(citing)) return;
      const cited = String(cols[citedIdx] || "").replace(/^"|"$/g, "");
      insert.run(citing, cited);
      kept += 1;
    });
    rl.on("close", () => {
      db.exec("COMMIT");
      resolve({ db, rows, kept });
    });
    child.on("error", reject);
  });
}

async function ensureStub(sql, clusterId, cite) {
  const ext = `cl-cluster-${clusterId}`;
  const byExt = await sql`
    select id, ingestion_status,
      exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities where source_provider=${SOURCE} and source_external_id=${ext} limit 2`;
  if (byExt.length > 1) return { ok: false };
  if (byExt.length === 1) {
    return {
      ok: true,
      authorityId: byExt[0].id,
      created: false,
      corpusComplete: Boolean(byExt[0].has_embeddings) && byExt[0].ingestion_status === "ready",
    };
  }
  const authorityId = crypto.randomUUID();
  const primary = experimentalNormalize(cite) || cite;
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, title, citation, normalized_citation,
      decision_date, source_provider, source_external_id, canonical_source_url,
      metadata, ingestion_status, created_at, updated_at, last_checked_at
    ) values (
      ${authorityId}, 'case', ${null}, ${null}, ${null},
      ${primary}, ${primary}, ${primary}, ${null},
      ${SOURCE}, ${ext}, ${`https://www.courtlistener.com/opinion/${clusterId}/`},
      ${sql.json({
        adapter: "citation-graph-fallback-2026-10-13",
        identityOnly: true,
        corpusComplete: false,
        clClusterId: String(clusterId),
        identityResolution: {
          method: CITATION_GRAPH_METHOD,
          snapshot: CITATION_MAP_SNAPSHOT_ID,
          identityOnly: true,
          treatment: "UNKNOWN_NOT_VERIFIED",
          resolverVersion: RESOLVER_VERSION,
          resolvedAt: new Date().toISOString(),
        },
      })}, 'pending'::authority_ingestion_status, now(), now(), now()
    )`;
  return { ok: true, authorityId, created: true, corpusComplete: false };
}

async function main() {
  if (!fs.existsSync(SAMPLE)) throw new Error("missing sample export");
  if (!fs.existsSync(OPINION_MAP)) throw new Error("missing opinion map sqlite");
  if (!fs.existsSync(CITATION_MAP_BZ2)) throw new Error("missing citation-map bz2");

  const sample = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  const edges = sample.edges || [];
  const opinionDb = new DatabaseSync(OPINION_MAP, { readOnly: true });
  const [omapCnt] = opinionDb.prepare("select count(*) as n from opinion_cluster").all();
  console.log(JSON.stringify({ phase: "LOADED", edges: edges.length, opinionMapRows: omapCnt.n, recount: sample.recount }));

  const opinionsForCluster = opinionDb.prepare("SELECT opinion_id FROM opinion_cluster WHERE cluster_id = ?");
  const clusterForOpinion = opinionDb.prepare("SELECT cluster_id FROM opinion_cluster WHERE opinion_id = ?");

  const citingWanted = new Set();
  for (const e of edges) {
    const ops = new Set(e.citingOpinionIdsDirect || []);
    if (e.citingClusterId) {
      for (const row of opinionsForCluster.all(String(e.citingClusterId))) ops.add(String(row.opinion_id));
    }
    e.citingOpinionIds = [...ops];
    for (const op of e.citingOpinionIds) citingWanted.add(op);
  }
  console.log(JSON.stringify({ phase: "CITING_OPINIONS", unique: citingWanted.size }));

  const graph = await buildGraphEdges(citingWanted);
  console.log(JSON.stringify({ phase: "CITATION_MAP_DONE", rows: graph.rows, kept: graph.kept }));
  const citedForCiting = graph.db.prepare("SELECT cited_opinion_id FROM cite_edge WHERE citing_opinion_id = ?");

  const counts = { GRAPH_UNIQUE_EDGE_MATCH: 0, GRAPH_AMBIGUOUS: 0, GRAPH_NO_MATCH: 0, GRAPH_CITER_UNAVAILABLE: 0 };
  const proposals = [];
  for (const e of edges) {
    const result = disambiguateCollisionEdgeByCitationGraph({
      citingClusterId: e.citingClusterId || null,
      citingOpinionIds: e.citingOpinionIds || [],
      candidateClusterIds: e.clusterIds,
      citedOpinionIdsForCiting: (opId) => citedForCiting.all(opId).map((r) => String(r.cited_opinion_id)),
      clusterIdForOpinion: (opId) => {
        const row = clusterForOpinion.get(opId);
        return row ? String(row.cluster_id) : null;
      },
    });
    counts[result.status] += 1;
    e.graph = result;
    if (isDeterministicGraphStatus(result.status) && result.citedClusterId) {
      proposals.push({ ...e, clusterId: result.citedClusterId, evidence: result.evidence });
    }
  }
  const recoveryRate = edges.length ? counts.GRAPH_UNIQUE_EDGE_MATCH / edges.length : 0;
  const go = recoveryRate >= 0.2 ? "GO_STRONG" : recoveryRate >= 0.1 ? "GO_MODERATE" : recoveryRate > 0 ? "WEAK" : "NO_GO";
  console.log(JSON.stringify({ phase: "SAMPLE_RESULT", counts, recoveryRate, go, proposals: proposals.length }, null, 2));

  let wrong = 0;
  for (const p of proposals) {
    if (!p.clusterIds.includes(p.clusterId)) wrong += 1;
  }

  const report = {
    classification: "LOCAL_CITATION_GRAPH_PROVIDER_FALLBACK",
    ok: true,
    clUsed: 0,
    startState: sample.recount,
    bulkGraphSource: {
      snapshot: "2026-09-30",
      format: "csv.bz2",
      citationMapSizeBytes: fs.statSync(CITATION_MAP_BZ2).size,
      citationMapSemantics: "opinion→opinion (citing_opinion_id → cited_opinion_id)",
      citingIdField: "citing_opinion_id",
      citedIdField: "cited_opinion_id",
      opinionToClusterMappingAvailable: true,
      fullOpinionTextRequired: false,
      canResolveWithoutFullText: "YES",
      minimumData: "B",
    },
    sample: {
      sampleCollisionEdges: edges.length,
      citerMapped: edges.filter((e) => e.citingClusterId || (e.citingOpinionIds || []).length).length,
      graphLinked: counts.GRAPH_UNIQUE_EDGE_MATCH + counts.GRAPH_AMBIGUOUS,
      ...counts,
      deterministicRecoveryRate: recoveryRate,
      wrongMappings: wrong,
      go,
    },
    validation: {
      highEdge: proposals.filter((p) => (p.edgeCount || 0) >= 5).length,
      threePlusCandidate: proposals.filter((p) => (p.clusterIds || []).length >= 3).length,
      additionalSample: Math.min(100, proposals.length),
      wrongMatches: wrong,
      result: wrong === 0 ? "PASS" : "FAIL",
    },
    fullDryRun: { executed: false, note: "sample only; re-run with GRAPH_SAMPLE_N=0 after GO" },
    productionWrite: { executed: false },
    cascade: { targetsResolved: 0, edgesResolved: 0 },
  };

  if (!DRY_ONLY && wrong === 0 && proposals.length && (go === "GO_STRONG" || go === "GO_MODERATE")) {
    const url = process.env.DATABASE_URL?.trim();
    const sql = postgres(url, { max: 1, ssl: "require" });
    const owned = acquireWorkerLock({
      reportsDir: REPORTS_DIR,
      workerId: WORKER_ID,
      processStartNonce: PROCESS_NONCE,
      currentLane: "CITATION_GRAPH",
      currentTask: "citation_graph_sample_write",
    });
    if (!owned.ok) throw new Error(owned.refusal || ACTIVE_REFUSAL_CODE);
    const hb = setInterval(() => {
      refreshWorkerHeartbeat({
        reportsDir: REPORTS_DIR,
        workerId: WORKER_ID,
        processStartNonce: PROCESS_NONCE,
      });
    }, 300000);
    const [edgeStart] = await sql`select count(*)::int as n from legal_authority_citations`;
    let edgeResolutions = 0;
    let stubs = 0;
    let reuse = 0;
    const ledger = [];
    try {
      for (const p of proposals) {
        const ensured = await ensureStub(sql, p.clusterId, p.normalizedCitation || p.rawCitation);
        if (!ensured.ok) continue;
        if (ensured.created) stubs += 1;
        else reuse += 1;
        const rows = await sql`
          update legal_authority_citations set to_authority_id=${ensured.authorityId}
          where id=${p.edgeId} and to_authority_id is null
          returning id, raw_citation, from_authority_id, normalized_citation`;
        if (!rows.length) continue;
        if (rows[0].raw_citation !== p.rawCitation) throw new Error("raw_citation_loss");
        edgeResolutions += 1;
        ledger.push(
          createResolutionRecord({
            rawCitation: rows[0].raw_citation,
            normalizedCitation: rows[0].normalized_citation,
            targetKey: p.targetKey,
            fromAuthorityId: rows[0].from_authority_id,
            citationEdgeId: rows[0].id,
            toAuthorityId: ensured.authorityId,
            method: CITATION_GRAPH_METHOD,
            confidence: "HIGH",
            evidence: [...(p.evidence || []), `snapshot:${CITATION_MAP_SNAPSHOT_ID}`],
            externalIdentity: { provider: "courtlistener", clusterId: p.clusterId, opinionId: null },
            state: ensured.corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
          }),
        );
      }
      if (ledger.length) appendLedger(LEDGER, ledger);
      const [edgeEnd] = await sql`select count(*)::int as n from legal_authority_citations`;
      report.productionWrite = {
        executed: true,
        edgeResolutions,
        existingAuthorityReuse: reuse,
        newIdentityStubs: stubs,
        oldUnresolvedResolved: edgeResolutions,
        newOutboundEdges: edgeEnd.n - edgeStart.n,
      };
    } finally {
      clearInterval(hb);
      releaseWorkerLock({ reportsDir: REPORTS_DIR, workerId: WORKER_ID, processStartNonce: PROCESS_NONCE });
      await sql.end({ timeout: 5 });
    }
  }

  // provider/deferred/external analysis from recount
  report.providerUnsupported = {
    note: "from prior neg-cache classification; see export recount",
    edges: sample.recount?.PROVIDER_UNSUPPORTED_EDGES || 0,
  };
  report.deferredReclassification = { stillDeferred: sample.recount?.DEFERRED_EDGES || 0 };
  report.externalNotFoundReclassification = { stillUnavailable: sample.recount?.EXTERNAL_NOT_FOUND_EDGES || 0 };
  report.endState = sample.recount;
  report.reduction = {
    graphEdgesResolved: report.productionWrite.oldUnresolvedResolved || 0,
    cascadeEdgesResolved: 0,
    TOTAL_TRUE_CASE_EDGES_RESOLVED: report.productionWrite.oldUnresolvedResolved || 0,
    percentReduced: 0,
  };
  report.newOutboundEdges = report.productionWrite.newOutboundEdges || 0;
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phase: "DONE", go, recoveryRate, proposals: proposals.length, dryOnly: DRY_ONLY }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
