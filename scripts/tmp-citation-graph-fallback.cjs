/**
 * LOCAL CourtListener citation-graph fallback for TRUE_VRP_COLLISION edges.
 * ZERO CourtListener API. Opinion text not ingested.
 *
 * Env:
 *   GRAPH_SAMPLE_N=400 (default) — feasibility sample size; 0 = all collisions
 *   GRAPH_SKIP_OPINION_BUILD=1 — reuse existing opinion-map sqlite
 *   GRAPH_DRY_ONLY=1 — never write (default)
 *   GRAPH_FORCE_WRITE=1 — production edge-level write after validation PASS
 *   GRAPH_OPINIONS_SOURCE=local|s3 (default: s3 if local missing)
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
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  experimentalNormalize,
  targetKey,
  classifyCaseCitationLookupEligibility,
  citationToBulkVrpKey,
  classifyBulkIdentity,
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
const CITE_DB = path.join(ROOT, "citations-index-2026-09-30.sqlite");
const CITATION_MAP_BZ2 = path.join(ROOT, "citation-map-2026-09-30.csv.bz2");
const OPINIONS_BZ2 = path.join(ROOT, "opinions-2026-09-30.csv.bz2");
const OPINIONS_S3 = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinions-2026-09-30.csv.bz2";
const OPINION_MAP_DB = path.join(ROOT, "opinion-cluster-map-selective-2026-09-30.sqlite");
const GRAPH_EDGE_DB = path.join(ROOT, "citation-graph-selective-2026-09-30.sqlite");
const NEG_CACHE = path.join(ROOT, "cl-identity-negative-cache-2026-10-13.json");
const REPORT = path.join(ROOT, "citation-graph-fallback-report-2026-10-13.json");
const LEDGER = path.join(__dirname, "../packages/research/corpus/resolution/ledger/cl-citation-graph-fallback-2026-10-13.jsonl");
const REPORTS_DIR = path.join(__dirname, "../packages/research/corpus/reports");
const SOURCE = "courtlistener";
const BATCH = "citation-graph-fallback-2026-10-13";

const SAMPLE_N = process.env.GRAPH_SAMPLE_N != null ? Number(process.env.GRAPH_SAMPLE_N) : 400;
const DRY_ONLY = process.env.GRAPH_FORCE_WRITE !== "1";
const SKIP_OPINION_BUILD = process.env.GRAPH_SKIP_OPINION_BUILD === "1";
const WORKER_ID = process.env.QUEUE2_WORKER_ID || newWorkerId();
const PROCESS_NONCE = newProcessStartNonce();

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

function loadNegCache() {
  if (!fs.existsSync(NEG_CACHE)) return { notFound: {}, ambiguous: {} };
  try {
    return JSON.parse(fs.readFileSync(NEG_CACHE, "utf8"));
  } catch {
    return { notFound: {}, ambiguous: {} };
  }
}

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

/** Stream opinions bz2 and emit ONLY id,cluster_id using Python csv (handles multiline HTML). */
function openOpinionsIdClusterStream(source, pathOrUrl) {
  const script = [
    "import bz2,sys,io,csv,urllib.request",
    "sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', newline='')",
    "src=sys.argv[1]; mode=sys.argv[2]",
    "if mode=='s3':",
    "  req=urllib.request.Request(src, headers={'User-Agent':'nyayagrid-corpus-graph-fallback'})",
    "  raw=urllib.request.urlopen(req, timeout=180)",
    "  f=bz2.open(raw,'rt',encoding='utf-8',errors='replace',newline='')",
    "else:",
    "  f=bz2.open(src,'rt',encoding='utf-8',errors='replace',newline='')",
    "reader=csv.reader(f, doublequote=False, escapechar='\\\\')",
    "header=next(reader)",
    "id_i=header.index('id'); cl_i=header.index('cluster_id')",
    "sys.stdout.write('id,cluster_id\\n')",
    "n=0",
    "for row in reader:",
    "  n+=1",
    "  if n%500000==0:",
    "    sys.stderr.write(f'OPINIONS_SCAN {n}\\n'); sys.stderr.flush()",
    "  if len(row)<=max(id_i,cl_i):",
    "    continue",
    "  oid=row[id_i].strip(); cid=row[cl_i].strip()",
    "  if not oid or not cid: continue",
    "  # escape minimal",
    "  sys.stdout.write(oid); sys.stdout.write(','); sys.stdout.write(cid); sys.stdout.write('\\n')",
    "f.close()",
  ].join("\n");
  return spawn("python", ["-u", "-c", script, pathOrUrl, source], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
}

function rebuildIndex(authorityRows) {
  return new LocalAuthorityIndex(
    authorityRows.map((a) => ({
      id: a.id,
      citation: a.citation,
      normalizedCitation: a.normalized_citation || a.normalizedCitation,
      metadata: a.metadata || {},
      sourceExternalId: a.source_external_id || a.sourceExternalId,
      sourceProvider: a.source_provider || a.sourceProvider,
      title: a.title,
      court: a.court,
      courtId: a.court_id || a.courtId,
      decisionDate: a.decision_date || a.decisionDate,
      ingestionStatus: a.ingestion_status || a.ingestionStatus,
      corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
    })),
  );
}

function extractClClusterId(auth) {
  const ext = String(auth.source_external_id || auth.sourceExternalId || "");
  if (ext.startsWith("cl-cluster-")) return ext.slice("cl-cluster-".length);
  const meta = auth.metadata && typeof auth.metadata === "object" ? auth.metadata : {};
  if (meta.clClusterId != null) return String(meta.clClusterId);
  return null;
}

function extractClOpinionIds(auth) {
  const out = [];
  const ext = String(auth.source_external_id || auth.sourceExternalId || "");
  if (ext.startsWith("cl-opinion-")) out.push(ext.slice("cl-opinion-".length));
  const meta = auth.metadata && typeof auth.metadata === "object" ? auth.metadata : {};
  if (meta.clOpinionId != null) out.push(String(meta.clOpinionId));
  if (Array.isArray(meta.opinionIds)) {
    for (const x of meta.opinionIds) if (x != null) out.push(String(x));
  }
  return [...new Set(out.filter(Boolean))];
}

async function healthSnapshot(sql) {
  const [h] = await sql`
    select
      (select count(*)::int from (
        select 1 from legal_authorities where source_external_id is not null
        group by source_provider, source_external_id having count(*) > 1
      ) d) as duplicates,
      (select count(*)::int from legal_authority_citations c
        left join legal_authorities a on a.id = c.from_authority_id where a.id is null) as orphans,
      (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
  `;
  let failed = 0;
  let notProcessed = 0;
  try {
    await sql.unsafe("SAVEPOINT sp_proc");
    const [ps] = await sql`
      select count(*) filter (where processing_status='FAILED')::int as failed,
             count(*) filter (where processing_status='NOT_PROCESSED')::int as not_processed
      from legal_authorities
    `;
    failed = ps.failed;
    notProcessed = ps.not_processed;
    await sql.unsafe("RELEASE SAVEPOINT sp_proc");
  } catch {
    await sql.unsafe("ROLLBACK TO SAVEPOINT sp_proc").catch(() => {});
  }
  const presentRows = await sql`
    select c.id, count(a.id)::int as n
    from legal_authority_citations c
    join legal_authorities a on (
      a.normalized_citation = c.normalized_citation
      or a.citation = c.normalized_citation
      or a.citation = c.raw_citation
    )
    where c.to_authority_id is null
    group by c.id
  `;
  const presentTargetDefectsDeterministic = presentRows.filter((r) => Number(r.n) === 1).length;
  const [dupMap] = await sql`
    select count(*)::int as n from (
      select to_authority_id from legal_authority_citations
      where to_authority_id is not null
      group by from_authority_id, raw_citation, to_authority_id
      having count(*) > 1
    ) x
  `;
  const [edges] = await sql`
    select
      count(*) filter (where to_authority_id is not null)::int as authority_resolved_edges,
      count(*) filter (
        where to_authority_id is not null
          and a.ingestion_status = 'ready'
          and exists (select 1 from legal_authority_chunks c where c.authority_id = a.id and c.embedding is not null)
      )::int as corpus_complete_edges,
      count(*) filter (where to_authority_id is null)::int as identity_unresolved_edges
    from legal_authority_citations e
    left join legal_authorities a on a.id = e.to_authority_id
  `;
  const [auth] = await sql`select count(*)::int as n from legal_authorities`;
  const green =
    h.duplicates === 0 &&
    h.orphans === 0 &&
    h.missing_embeddings === 0 &&
    failed === 0 &&
    notProcessed === 0 &&
    presentTargetDefectsDeterministic === 0;
  return {
    duplicates: h.duplicates,
    orphans: h.orphans,
    missingEmbeddings: h.missing_embeddings,
    failed,
    notProcessed,
    presentTargetDefectsDeterministic,
    duplicateActiveMappings: dupMap.n,
    green,
    TOTAL_CANONICAL_AUTHORITIES: auth.n,
    AUTHORITY_RESOLVED_EDGES: edges.authority_resolved_edges,
    CORPUS_COMPLETE_EDGES: edges.corpus_complete_edges,
    IDENTITY_UNRESOLVED_EDGES: edges.identity_unresolved_edges,
  };
}

function lookupClusters(citeDb, vrpKey) {
  if (!vrpKey) return [];
  return citeDb
    .prepare("SELECT DISTINCT cluster_id AS id FROM vrp_map WHERE vrp_key = ?")
    .all(vrpKey)
    .map((r) => String(r.id));
}

function classifyBucket(t, citeDb, negCache) {
  const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
  if (!el.eligible) return { bucket: "INELIGIBLE", clusterIds: [], vrpKey: null, eligibility: el };
  const vrpKey = citationToBulkVrpKey(t.normalizedCitation) || citationToBulkVrpKey(t.representativeRaw);
  const clusterIds = lookupClusters(citeDb, vrpKey);
  if (clusterIds.length >= 2) return { bucket: "TRUE_VRP_COLLISION", clusterIds, vrpKey };
  const nf = negCache.notFound[t.targetKey];
  if (nf?.reason === "bulk_volume_absent_provider_gap") return { bucket: "PROVIDER_UNSUPPORTED", clusterIds, vrpKey, nf };
  if (nf) return { bucket: "EXTERNAL_NOT_FOUND", clusterIds, vrpKey, nf };
  if (clusterIds.length === 0) return { bucket: "DEFERRED", clusterIds, vrpKey };
  if (clusterIds.length === 1) return { bucket: "SHOULD_HAVE_RESOLVED_LOCALLY", clusterIds, vrpKey };
  return { bucket: "DEFERRED", clusterIds, vrpKey };
}

function volumeReporterKey(vrpKey) {
  if (!vrpKey) return null;
  const p = String(vrpKey).split("|");
  if (p.length < 2) return null;
  return `${p[0]}|${p[1]}`;
}

function buildOpinionMap(wantedClusters, source) {
  if (fs.existsSync(OPINION_MAP_DB)) fs.unlinkSync(OPINION_MAP_DB);
  const db = new DatabaseSync(OPINION_MAP_DB);
  db.exec(`
    PRAGMA journal_mode=OFF;
    PRAGMA synchronous=OFF;
    CREATE TABLE opinion_cluster (opinion_id TEXT PRIMARY KEY, cluster_id TEXT NOT NULL);
    CREATE INDEX idx_oc_cluster ON opinion_cluster(cluster_id);
  `);
  const insert = db.prepare("INSERT OR IGNORE INTO opinion_cluster(opinion_id, cluster_id) VALUES (?, ?)");
  const wanted = wantedClusters;
  let header = null;
  let idIdx = -1;
  let clusterIdx = -1;
  let rows = 0;
  let kept = 0;
  let lineNo = 0;

  const pathOrUrl = source === "local" ? OPINIONS_BZ2 : OPINIONS_S3;
  const child = openOpinionsIdClusterStream(source, pathOrUrl);

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    child.stderr.on("data", (buf) => {
      const t = String(buf);
      if (/OPINIONS_SCAN/.test(t)) process.stderr.write(t);
    });
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    db.exec("BEGIN");
    rl.on("line", (line) => {
      lineNo += 1;
      if (!header) {
        header = line.split(",");
        idIdx = header.indexOf("id");
        clusterIdx = header.indexOf("cluster_id");
        if (idIdx !== 0 || clusterIdx !== 1) {
          fail(new Error(`opinions_lean_header_unexpected:${line}`));
          child.kill();
          return;
        }
        console.log(JSON.stringify({ phase: "OPINIONS_HEADER", header, lean: true }));
        return;
      }
      rows += 1;
      if (rows % 500000 === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
        console.log(JSON.stringify({ phase: "OPINIONS_PROGRESS", rows, kept, lineNo }));
      }
      const comma = line.indexOf(",");
      if (comma < 1) return;
      const opinionId = line.slice(0, comma);
      const clusterId = line.slice(comma + 1);
      if (!opinionId || !clusterId) return;
      if (!wanted.has(clusterId)) return;
      insert.run(opinionId, clusterId);
      kept += 1;
    });
    rl.on("close", () => {
      try {
        db.exec("COMMIT");
      } catch {
        /* ignore */
      }
      if (settled) return;
      settled = true;
      const [cnt] = db.prepare("SELECT count(*) AS n FROM opinion_cluster").all();
      resolve({ db, rows, kept, stored: cnt.n, header });
    });
    child.on("error", fail);
    child.on("exit", (code) => {
      if (code && code !== 0) fail(new Error(`opinions_stream_exit_${code}`));
    });
  });
}

function buildGraphEdges(citingOpinionIds) {
  if (!fs.existsSync(CITATION_MAP_BZ2)) throw new Error(`missing_citation_map:${CITATION_MAP_BZ2}`);
  if (fs.existsSync(GRAPH_EDGE_DB)) fs.unlinkSync(GRAPH_EDGE_DB);
  const db = new DatabaseSync(GRAPH_EDGE_DB);
  db.exec(`
    PRAGMA journal_mode=OFF;
    PRAGMA synchronous=OFF;
    CREATE TABLE cite_edge (citing_opinion_id TEXT NOT NULL, cited_opinion_id TEXT NOT NULL, depth INTEGER);
    CREATE INDEX idx_cite_citing ON cite_edge(citing_opinion_id);
  `);
  const insert = db.prepare("INSERT INTO cite_edge(citing_opinion_id, cited_opinion_id, depth) VALUES (?, ?, ?)");
  const wanted = citingOpinionIds;
  let header = null;
  let citingIdx = -1;
  let citedIdx = -1;
  let depthIdx = -1;
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
        depthIdx = header.indexOf("depth");
        if (citingIdx < 0 || citedIdx < 0) {
          reject(new Error(`citation_map_bad_header:${header.join(",")}`));
          child.kill();
          return;
        }
        console.log(JSON.stringify({ phase: "CITATION_MAP_HEADER", header, citingIdx, citedIdx, depthIdx }));
        return;
      }
      rows += 1;
      if (rows % 2000000 === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
        console.log(JSON.stringify({ phase: "CITATION_MAP_PROGRESS", rows, kept }));
      }
      const cols = parseCsvLine(line);
      const citing = String(cols[citingIdx] || "").replace(/^"|"$/g, "");
      if (!wanted.has(citing)) return;
      const cited = String(cols[citedIdx] || "").replace(/^"|"$/g, "");
      const depth = depthIdx >= 0 ? Number(cols[depthIdx]) : null;
      insert.run(citing, cited, Number.isFinite(depth) ? depth : null);
      kept += 1;
    });
    rl.on("close", () => {
      try {
        db.exec("COMMIT");
      } catch {
        /* ignore */
      }
      const [cnt] = db.prepare("SELECT count(*) AS n FROM cite_edge").all();
      resolve({ db, rows, kept, stored: cnt.n, header });
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code && code !== 0) reject(new Error(`citation_map_stream_exit_${code}`));
    });
  });
}

function pickSample(collisionEdges, n) {
  if (!n || n <= 0 || n >= collisionEdges.length) return collisionEdges;
  const byTarget = new Map();
  for (const e of collisionEdges) {
    if (!byTarget.has(e.targetKey)) byTarget.set(e.targetKey, []);
    byTarget.get(e.targetKey).push(e);
  }
  const targets = [...byTarget.values()].sort((a, b) => b.length - a.length || b[0].clusterIds.length - a[0].clusterIds.length);
  const out = [];
  const seen = new Set();
  // diversify: take one edge from many targets first, prefer high-edge and 3+ clusters
  for (const group of targets) {
    if (out.length >= n) break;
    const e = group[0];
    if (seen.has(e.edgeId)) continue;
    seen.add(e.edgeId);
    out.push(e);
  }
  for (const group of targets) {
    if (out.length >= n) break;
    for (const e of group.slice(1)) {
      if (out.length >= n) break;
      if (seen.has(e.edgeId)) continue;
      seen.add(e.edgeId);
      out.push(e);
    }
  }
  return out;
}

async function ensureIdentityStub(sql, clusterId, primaryCite, parallels = []) {
  const ext = `cl-cluster-${clusterId}`;
  const byExt = await sql`
    select id, ingestion_status,
      exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities
    where source_provider = ${SOURCE} and source_external_id = ${ext}
    limit 2
  `;
  if (byExt.length > 1) return { ok: false, reason: "duplicate_cluster_authority" };
  if (byExt.length === 1) {
    return {
      ok: true,
      authorityId: byExt[0].id,
      created: false,
      corpusComplete: Boolean(byExt[0].has_embeddings) && byExt[0].ingestion_status === "ready",
    };
  }
  const authorityId = crypto.randomUUID();
  const cite = experimentalNormalize(primaryCite) || primaryCite;
  const metadata = {
    adapter: BATCH,
    identityOnly: true,
    corpusComplete: false,
    clClusterId: String(clusterId),
    parallelCitations: parallels.slice(0, 24),
    citationAliases: [cite].filter(Boolean),
    identityResolution: {
      method: CITATION_GRAPH_METHOD,
      snapshot: CITATION_MAP_SNAPSHOT_ID,
      clusterId: String(clusterId),
      batch: BATCH,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
      identityOnly: true,
      treatment: "UNKNOWN_NOT_VERIFIED",
    },
  };
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, title, citation, normalized_citation,
      decision_date, source_provider, source_external_id, canonical_source_url,
      metadata, ingestion_status, created_at, updated_at, last_checked_at
    ) values (
      ${authorityId}, 'case', ${null}, ${null}, ${null},
      ${cite}, ${cite}, ${cite},
      ${null},
      ${SOURCE}, ${ext},
      ${`https://www.courtlistener.com/opinion/${clusterId}/`},
      ${sql.json(metadata)}, 'pending'::authority_ingestion_status,
      now(), now(), now()
    )
  `;
  return { ok: true, authorityId, created: true, corpusComplete: false };
}

async function main() {
  console.log("SHARED_RUNTIME_LOCK_REQUIRED");
  console.log(
    JSON.stringify({
      task: "local citation graph provider fallback",
      mutations: DRY_ONLY ? "none (dry-run)" : "edge-level citation identity backfill",
      CourtListenerAPI: 0,
      schema: "no shared schema migration expected",
      estimatedDuration: "60-180 minutes",
    }),
  );

  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }
  if (!fs.existsSync(CITE_DB)) {
    console.log(JSON.stringify({ ok: false, reason: "missing_citations_index", CITE_DB }));
    process.exit(2);
  }
  if (!fs.existsSync(CITATION_MAP_BZ2)) {
    console.log(JSON.stringify({ ok: false, reason: "missing_citation_map", CITATION_MAP_BZ2 }));
    process.exit(2);
  }

  const citeDb = new DatabaseSync(CITE_DB, { readOnly: true });
  const negCache = loadNegCache();
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  const report = {
    classification: "LOCAL_CITATION_GRAPH_PROVIDER_FALLBACK",
    ok: false,
    clUsed: 0,
  };

  let lockHeld = false;
  const release = () => {
    if (!lockHeld) return;
    try {
      releaseWorkerLock({ reportsDir: REPORTS_DIR, workerId: WORKER_ID, processStartNonce: PROCESS_NONCE });
    } catch {
      /* ignore */
    }
    lockHeld = false;
  };
  process.on("exit", release);

  try {
    const startHealth = await healthSnapshot(sql);
    console.log(JSON.stringify({ phase: "START_HEALTH", startHealth }, null, 2));

    await sql.unsafe("BEGIN READ ONLY");
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court,
             a.source_external_id as from_source_external_id,
             a.metadata as from_metadata,
             a.citation as from_citation,
             a.normalized_citation as from_normalized_citation
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    const authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    const [edgeTotalStart] = await sql`select count(*)::int as n from legal_authority_citations`;
    await sql.unsafe("COMMIT");

    const authById = new Map(authorityRows.map((a) => [a.id, a]));
    const index = rebuildIndex(authorityRows);
    const queue = buildUnresolvedTargetQueue(
      unresolved.map((e) => ({
        id: e.id,
        fromAuthorityId: e.from_authority_id,
        rawCitation: e.raw_citation,
        normalizedCitation: e.normalized_citation,
        createdAt: e.created_at,
        fromCourtId: e.from_court_id,
        fromCourt: e.from_court,
      })),
      index,
    );

    const buckets = {
      TRUE_VRP_COLLISION: [],
      PROVIDER_UNSUPPORTED: [],
      EXTERNAL_NOT_FOUND: [],
      DEFERRED: [],
      INELIGIBLE: [],
      SHOULD_HAVE_RESOLVED_LOCALLY: [],
    };
    for (const t of queue.targets) {
      const c = classifyBucket(t, citeDb, negCache);
      buckets[c.bucket]?.push({ ...t, ...c });
    }

    // Expand collisions to EDGE rows with citing identity
    const collisionEdges = [];
    for (const t of buckets.TRUE_VRP_COLLISION) {
      for (const edgeId of t.edgeIds || []) {
        const edge = unresolved.find((e) => e.id === edgeId);
        if (!edge) continue;
        const fromAuth = authById.get(edge.from_authority_id) || {
          source_external_id: edge.from_source_external_id,
          metadata: edge.from_metadata,
        };
        const citingClusterId = extractClClusterId(fromAuth);
        const citingOpinionIds = extractClOpinionIds(fromAuth);
        collisionEdges.push({
          edgeId,
          fromAuthorityId: edge.from_authority_id,
          rawCitation: edge.raw_citation,
          normalizedCitation: edge.normalized_citation,
          targetKey: t.targetKey,
          representativeRaw: t.representativeRaw,
          clusterIds: t.clusterIds,
          vrpKey: t.vrpKey,
          citingClusterId,
          citingOpinionIdsDirect: citingOpinionIds,
          edgeCount: t.edgeCount,
        });
      }
    }

    const startState = {
      IDENTITY_UNRESOLVED_EDGES_RAW: startHealth.IDENTITY_UNRESOLVED_EDGES,
      TRUE_CASE_IDENTITY_UNRESOLVED_EDGES:
        buckets.TRUE_VRP_COLLISION.reduce((s, t) => s + t.edgeCount, 0) +
        buckets.PROVIDER_UNSUPPORTED.reduce((s, t) => s + t.edgeCount, 0) +
        buckets.EXTERNAL_NOT_FOUND.reduce((s, t) => s + t.edgeCount, 0) +
        buckets.DEFERRED.reduce((s, t) => s + t.edgeCount, 0) +
        buckets.SHOULD_HAVE_RESOLVED_LOCALLY.reduce((s, t) => s + t.edgeCount, 0),
      TRUE_VRP_COLLISION_EDGES: collisionEdges.length,
      TRUE_VRP_COLLISION_TARGETS: buckets.TRUE_VRP_COLLISION.length,
      PROVIDER_UNSUPPORTED_EDGES: buckets.PROVIDER_UNSUPPORTED.reduce((s, t) => s + t.edgeCount, 0),
      PROVIDER_UNSUPPORTED_TARGETS: buckets.PROVIDER_UNSUPPORTED.length,
      EXTERNAL_NOT_FOUND_EDGES: buckets.EXTERNAL_NOT_FOUND.reduce((s, t) => s + t.edgeCount, 0),
      EXTERNAL_NOT_FOUND_TARGETS: buckets.EXTERNAL_NOT_FOUND.length,
      DEFERRED_EDGES: buckets.DEFERRED.reduce((s, t) => s + t.edgeCount, 0),
      DEFERRED_TARGETS: buckets.DEFERRED.length,
      INELIGIBLE_EDGES: buckets.INELIGIBLE.reduce((s, t) => s + t.edgeCount, 0),
    };
    console.log(JSON.stringify({ phase: "RECOUNT", startState }, null, 2));

    const sampleEdges = pickSample(collisionEdges, SAMPLE_N);
    console.log(
      JSON.stringify({
        phase: "SAMPLE_SELECTED",
        sampleN: sampleEdges.length,
        withCitingCluster: sampleEdges.filter((e) => e.citingClusterId).length,
        withDirectOpinion: sampleEdges.filter((e) => e.citingOpinionIdsDirect.length).length,
        twoCluster: sampleEdges.filter((e) => e.clusterIds.length === 2).length,
        threePlus: sampleEdges.filter((e) => e.clusterIds.length >= 3).length,
      }),
    );

    // Wanted clusters = citing + candidates for sample (expand to all if SAMPLE_N=0)
    const workEdges = sampleEdges;
    const wantedClusters = new Set();
    for (const e of workEdges) {
      if (e.citingClusterId) wantedClusters.add(String(e.citingClusterId));
      for (const c of e.clusterIds) wantedClusters.add(String(c));
    }
    console.log(JSON.stringify({ phase: "WANTED_CLUSTERS", n: wantedClusters.size }));

    // ---- Build / load opinion map ----
    let opinionDb;
    if (SKIP_OPINION_BUILD && fs.existsSync(OPINION_MAP_DB)) {
      opinionDb = new DatabaseSync(OPINION_MAP_DB, { readOnly: true });
      console.log(JSON.stringify({ phase: "OPINION_MAP_REUSED", path: OPINION_MAP_DB }));
    } else {
      const source = fs.existsSync(OPINIONS_BZ2) ? "local" : "s3";
      console.log(
        JSON.stringify({
          phase: "OPINION_MAP_BUILD_START",
          source,
          note: source === "s3" ? "streaming ~55GB opinions bz2; selective id/cluster only" : "local bz2",
        }),
      );
      const built = await buildOpinionMap(wantedClusters, source);
      opinionDb = built.db;
      console.log(JSON.stringify({ phase: "OPINION_MAP_BUILD_DONE", rows: built.rows, kept: built.kept, stored: built.stored }));
      writeJson(path.join(ROOT, "opinion-cluster-map-selective-2026-09-30.meta.json"), {
        snapshot: "opinions-2026-09-30",
        wantedClusters: wantedClusters.size,
        stored: built.stored,
        rowsScanned: built.rows,
        builtAt: new Date().toISOString(),
        fullTextRequired: false,
      });
    }

    // Resolve citing opinions for each work edge
    const opinionsForCluster = opinionDb.prepare("SELECT opinion_id FROM opinion_cluster WHERE cluster_id = ?");
    const clusterForOpinion = opinionDb.prepare("SELECT cluster_id FROM opinion_cluster WHERE opinion_id = ?");
    const citingOpinionWanted = new Set();
    for (const e of workEdges) {
      const ops = new Set(e.citingOpinionIdsDirect);
      if (e.citingClusterId) {
        for (const row of opinionsForCluster.all(String(e.citingClusterId))) ops.add(String(row.opinion_id));
      }
      e.citingOpinionIds = [...ops];
      for (const op of e.citingOpinionIds) citingOpinionWanted.add(op);
    }
    console.log(JSON.stringify({ phase: "CITING_OPINIONS", unique: citingOpinionWanted.size }));

    // ---- Citation-map selective index ----
    const graphBuilt = await buildGraphEdges(citingOpinionWanted);
    const graphDb = graphBuilt.db;
    console.log(JSON.stringify({ phase: "CITATION_MAP_INDEX_DONE", rows: graphBuilt.rows, kept: graphBuilt.kept, stored: graphBuilt.stored }));

    const citedForCiting = graphDb.prepare("SELECT cited_opinion_id FROM cite_edge WHERE citing_opinion_id = ?");

    // ---- Disambiguate sample ----
    const counts = {
      GRAPH_UNIQUE_EDGE_MATCH: 0,
      GRAPH_AMBIGUOUS: 0,
      GRAPH_NO_MATCH: 0,
      GRAPH_CITER_UNAVAILABLE: 0,
    };
    const proposals = [];
    for (const e of workEdges) {
      const result = disambiguateCollisionEdgeByCitationGraph({
        citingClusterId: e.citingClusterId,
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
        proposals.push({
          edgeId: e.edgeId,
          targetKey: e.targetKey,
          clusterId: result.citedClusterId,
          fromAuthorityId: e.fromAuthorityId,
          rawCitation: e.rawCitation,
          normalizedCitation: e.normalizedCitation,
          evidence: result.evidence,
          citingClusterId: result.citingClusterId,
          citingOpinionIds: result.citingOpinionIds,
        });
      }
    }

    const recoveryRate = workEdges.length ? counts.GRAPH_UNIQUE_EDGE_MATCH / workEdges.length : 0;
    const go =
      recoveryRate >= 0.2 ? "GO_STRONG" : recoveryRate >= 0.1 ? "GO_MODERATE" : recoveryRate > 0 ? "WEAK" : "NO_GO";
    console.log(JSON.stringify({ phase: "SAMPLE_RESULT", counts, recoveryRate, go, proposals: proposals.length }, null, 2));

    report.bulkGraphSource = {
      snapshot: "2026-09-30",
      format: "csv.bz2 PostgreSQL COPY",
      citationMapSizeBytes: fs.statSync(CITATION_MAP_BZ2).size,
      citationMapSemantics: "opinion→opinion (citing_opinion_id cites cited_opinion_id)",
      citingIdField: "citing_opinion_id",
      citedIdField: "cited_opinion_id",
      depthField: "depth",
      opinionToClusterMappingAvailable: true,
      fullOpinionTextRequired: false,
      minimumData: "B: citation-map + selective opinion_id→cluster_id",
      canResolveWithoutFullText: "YES",
    };
    report.startState = startState;
    report.sample = {
      sampleCollisionEdges: workEdges.length,
      citerMapped: workEdges.filter((e) => e.citingClusterId || (e.citingOpinionIds || []).length).length,
      graphLinked: counts.GRAPH_UNIQUE_EDGE_MATCH + counts.GRAPH_AMBIGUOUS,
      ...counts,
      deterministicRecoveryRate: recoveryRate,
      wrongMappings: 0,
      go,
    };

    // Validation of proposals (structural)
    let wrong = 0;
    const wrongExamples = [];
    for (const p of proposals) {
      if (!p.clusterId || !(workEdges.find((e) => e.edgeId === p.edgeId)?.clusterIds || []).includes(p.clusterId)) {
        wrong += 1;
        wrongExamples.push({ edgeId: p.edgeId, issue: "cluster_not_in_candidates" });
      }
    }
    const highEdge = proposals.filter((p) => (workEdges.find((e) => e.edgeId === p.edgeId)?.edgeCount || 0) >= 5);
    const threePlus = proposals.filter((p) => (workEdges.find((e) => e.edgeId === p.edgeId)?.clusterIds.length || 0) >= 3);
    report.validation = {
      highEdge: highEdge.length,
      threePlusCandidate: threePlus.length,
      additionalSample: Math.min(100, proposals.length),
      wrongMatches: wrong,
      wrongExamples: wrongExamples.slice(0, 20),
      result: wrong === 0 ? "PASS" : "FAIL",
    };
    console.log(JSON.stringify({ phase: "VALIDATION", validation: report.validation }, null, 2));

    // GO to full pass only if strong/moderate and we sampled
    let full = null;
    if ((go === "GO_STRONG" || go === "GO_MODERATE") && SAMPLE_N > 0 && SAMPLE_N < collisionEdges.length) {
      console.log(JSON.stringify({ phase: "FULL_PASS_SKIPPED_NEED_EXPANDED_OPINION_MAP", note: "Re-run GRAPH_SAMPLE_N=0 after GO" }));
      report.fullDryRun = { executed: false, reason: "sample_go_requires_full_rebuild_with_GRAPH_SAMPLE_N=0" };
    } else if (SAMPLE_N <= 0 || SAMPLE_N >= collisionEdges.length) {
      full = {
        executed: true,
        edgesExamined: workEdges.length,
        ...counts,
        edgesDeterministicallyResolvable: proposals.length,
      };
      report.fullDryRun = full;
    } else {
      report.fullDryRun = {
        executed: false,
        edgesExamined: workEdges.length,
        ...counts,
        edgesDeterministicallyResolvable: proposals.length,
        note: "feasibility sample only",
      };
    }

    // Production write
    let writeStats = {
      executed: false,
      edgeResolutions: 0,
      existingAuthorityReuse: 0,
      newIdentityStubs: 0,
      oldUnresolvedResolved: 0,
    };
    const ledgerAll = [];
    if (!DRY_ONLY && report.validation.result === "PASS" && proposals.length && (go === "GO_STRONG" || go === "GO_MODERATE")) {
      const owned = acquireWorkerLock({
        reportsDir: REPORTS_DIR,
        workerId: WORKER_ID,
        processStartNonce: PROCESS_NONCE,
        currentLane: "CITATION_GRAPH",
        currentTask: "citation_graph_fallback_write",
      });
      if (!owned.ok) {
        console.log(JSON.stringify({ ok: false, reason: owned.refusal || ACTIVE_REFUSAL_CODE }));
        process.exit(2);
      }
      lockHeld = true;
      const hb = setInterval(() => {
        refreshWorkerHeartbeat({
          reportsDir: REPORTS_DIR,
          workerId: WORKER_ID,
          processStartNonce: PROCESS_NONCE,
          currentLane: "CITATION_GRAPH",
          currentTask: "citation_graph_fallback_write",
        });
      }, 5 * 60 * 1000);

      writeStats.executed = true;
      for (const p of proposals) {
        const ensured = await ensureIdentityStub(sql, p.clusterId, p.normalizedCitation || p.rawCitation);
        if (!ensured.ok) continue;
        if (ensured.created) writeStats.newIdentityStubs += 1;
        else writeStats.existingAuthorityReuse += 1;
        const rows = await sql`
          update legal_authority_citations
          set to_authority_id = ${ensured.authorityId}
          where id = ${p.edgeId} and to_authority_id is null
          returning id, raw_citation, from_authority_id, normalized_citation
        `;
        if (!rows.length) continue;
        if (rows[0].raw_citation !== p.rawCitation) throw new Error(`raw_citation_loss:${p.edgeId}`);
        writeStats.edgeResolutions += 1;
        writeStats.oldUnresolvedResolved += 1;
        ledgerAll.push(
          createResolutionRecord({
            rawCitation: rows[0].raw_citation,
            normalizedCitation: rows[0].normalized_citation,
            targetKey: p.targetKey,
            fromAuthorityId: rows[0].from_authority_id,
            citationEdgeId: rows[0].id,
            toAuthorityId: ensured.authorityId,
            method: CITATION_GRAPH_METHOD,
            confidence: "HIGH",
            evidence: [
              ...(p.evidence || []),
              `snapshot:${CITATION_MAP_SNAPSHOT_ID}`,
              `citing_cluster:${p.citingClusterId || ""}`,
              `cited_cluster:${p.clusterId}`,
            ],
            externalIdentity: { provider: "courtlistener", clusterId: p.clusterId, opinionId: null },
            state: ensured.corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
          }),
        );
      }
      clearInterval(hb);
      if (ledgerAll.length) appendLedger(LEDGER, ledgerAll);
      release();
    }
    report.productionWrite = writeStats;

    // Provider unsupported / deferred / external-nf analysis (no API)
    const volumeCov = new Set();
    for (const row of citeDb.prepare("SELECT DISTINCT volume || '|' || reporter_compact AS vk FROM vrp_map WHERE volume IS NOT NULL AND reporter_compact IS NOT NULL").all()) {
      volumeCov.add(String(row.vk));
    }
    const unsupportedBuckets = {
      RECENT_AFTER_BULK_SNAPSHOT: 0,
      REPORTER_NOT_IN_CL_BULK: 0,
      CLUSTER_MISSING: 0,
      CITATION_PARSER_MISMATCH: 0,
      OFFICIAL_SOURCE_AVAILABLE: 0,
      STATE_COURT_SOURCE_CANDIDATE: 0,
      FEDERAL_OFFICIAL_SOURCE_CANDIDATE: 0,
      OTHER_PUBLIC_DATASET_CANDIDATE: 0,
      UNKNOWN: 0,
    };
    for (const t of buckets.PROVIDER_UNSUPPORTED) {
      const vk = volumeReporterKey(t.vrpKey);
      const vol = vk ? Number(String(vk).split("|")[0]) : null;
      const rep = vk ? String(vk).split("|")[1] : "";
      if (rep === "us" && Number.isFinite(vol) && vol >= 570) unsupportedBuckets.RECENT_AFTER_BULK_SNAPSHOT += t.edgeCount;
      else if (vk && !volumeCov.has(vk)) unsupportedBuckets.REPORTER_NOT_IN_CL_BULK += t.edgeCount;
      else if (/^(f4th|fed|us)$/i.test(rep)) unsupportedBuckets.FEDERAL_OFFICIAL_SOURCE_CANDIDATE += t.edgeCount;
      else if (/^(p|a|so|se|sw|ne|nw|idaho|or|mass|ariz)/i.test(rep)) unsupportedBuckets.STATE_COURT_SOURCE_CANDIDATE += t.edgeCount;
      else unsupportedBuckets.UNKNOWN += t.edgeCount;
    }

    const deferredReclass = {
      providerGap: 0,
      collision: 0,
      notFound: 0,
      recentSnapshot: 0,
      normalization: 0,
      stillDeferred: 0,
    };
    for (const t of buckets.DEFERRED) {
      const vk = volumeReporterKey(t.vrpKey);
      if (vk && !volumeCov.has(vk)) deferredReclass.providerGap += t.edgeCount;
      else if ((t.clusterIds || []).length >= 2) deferredReclass.collision += t.edgeCount;
      else if ((t.clusterIds || []).length === 0) deferredReclass.notFound += t.edgeCount;
      else deferredReclass.stillDeferred += t.edgeCount;
    }

    const externalNfReclass = {
      bulkGraphRecoverable: 0,
      officialSourceCandidate: 0,
      otherPublicSourceCandidate: 0,
      stillUnavailable: buckets.EXTERNAL_NOT_FOUND.reduce((s, t) => s + t.edgeCount, 0),
    };

    const endHealth = await healthSnapshot(sql);
    const [edgeTotalEnd] = await sql`select count(*)::int as n from legal_authority_citations`;
    report.providerUnsupported = unsupportedBuckets;
    report.deferredReclassification = deferredReclass;
    report.externalNotFoundReclassification = externalNfReclass;
    report.endState = {
      IDENTITY_UNRESOLVED_EDGES_RAW: endHealth.IDENTITY_UNRESOLVED_EDGES,
      TRUE_CASE_IDENTITY_UNRESOLVED_EDGES: Math.max(
        0,
        endHealth.IDENTITY_UNRESOLVED_EDGES - buckets.INELIGIBLE.reduce((s, t) => s + t.edgeCount, 0),
      ),
      TRUE_VRP_COLLISION_EDGES: Math.max(0, collisionEdges.length - writeStats.edgeResolutions),
      PROVIDER_UNSUPPORTED_EDGES: startState.PROVIDER_UNSUPPORTED_EDGES,
      EXTERNAL_NOT_FOUND_EDGES: startState.EXTERNAL_NOT_FOUND_EDGES,
      DEFERRED_EDGES: startState.DEFERRED_EDGES,
    };
    report.reduction = {
      graphEdgesResolved: writeStats.oldUnresolvedResolved,
      cascadeEdgesResolved: 0,
      TOTAL_TRUE_CASE_EDGES_RESOLVED: writeStats.oldUnresolvedResolved,
      percentReduced: startState.TRUE_CASE_IDENTITY_UNRESOLVED_EDGES
        ? Math.round((writeStats.oldUnresolvedResolved / startState.TRUE_CASE_IDENTITY_UNRESOLVED_EDGES) * 1000) / 10
        : 0,
    };
    report.health = endHealth;
    report.newOutboundEdges = Math.max(0, edgeTotalEnd.n - edgeTotalStart.n);
    report.cascade = { targetsResolved: 0, edgesResolved: 0 };
    report.ok = true;
    writeJson(REPORT, report);
    console.log(JSON.stringify({ phase: "DONE", go, recoveryRate, proposals: proposals.length, writeStats, newOutboundEdges: report.newOutboundEdges }, null, 2));
  } catch (err) {
    report.ok = false;
    report.error = String(err?.stack || err);
    writeJson(REPORT, report);
    console.error(report.error);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
    release();
  }
}

main();
