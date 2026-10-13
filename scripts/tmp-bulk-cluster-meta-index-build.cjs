/**
 * Build selective SQLite CourtListener opinion-cluster metadata index.
 * Streams bz2; indexes ONLY cluster IDs needed for current AMBIGUOUS VRP collisions.
 * Zero CL API. No full CSV materialization.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { DatabaseSync } = require("node:sqlite");
const postgres = require("postgres");
const {
  experimentalNormalize,
  citationToBulkVrpKey,
  classifyBulkIdentity,
  classifyCaseCitationLookupEligibility,
  buildUnresolvedTargetQueue,
  LocalAuthorityIndex,
  targetKey,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const BZ2 = path.join(ROOT, "opinion-clusters-2026-09-30.csv.bz2");
const CITE_DB = path.join(ROOT, "citations-index-2026-09-30.sqlite");
const DB_PATH = path.join(ROOT, "cluster-meta-2026-09-30.sqlite");
const META_JSON = path.join(ROOT, "cluster-meta-2026-09-30.meta.json");
const SNAPSHOT = "COURTLISTENER_BULK_CLUSTERS_2026_09_30";
/** Optional: precomputed JSON array of cluster id strings */
const WANT_FILE = path.join(ROOT, "ambiguous-candidate-cluster-ids.json");

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

function lookupClusters(citeDb, vrpKey) {
  if (!vrpKey) return [];
  return citeDb
    .prepare("SELECT DISTINCT cluster_id AS id FROM vrp_map WHERE vrp_key = ?")
    .all(vrpKey)
    .map((r) => String(r.id));
}

async function collectWantedClusterIds() {
  if (fs.existsSync(WANT_FILE)) {
    const arr = JSON.parse(fs.readFileSync(WANT_FILE, "utf8"));
    return new Set(arr.map(String));
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    throw new Error("need Neon DATABASE_URL to discover ambiguous cluster ids (or provide ambiguous-candidate-cluster-ids.json)");
  }
  if (!fs.existsSync(CITE_DB)) throw new Error(`missing citations index: ${CITE_DB}`);

  const citeDb = new DatabaseSync(CITE_DB, { readOnly: true });
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  try {
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation,
             a.court_id as from_court_id, a.court as from_court
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
    const index = new LocalAuthorityIndex(
      authorityRows.map((a) => ({
        id: a.id,
        citation: a.citation,
        normalizedCitation: a.normalized_citation,
        metadata: a.metadata || {},
        sourceExternalId: a.source_external_id,
        sourceProvider: a.source_provider,
        title: a.title,
        court: a.court,
        courtId: a.court_id,
        decisionDate: a.decision_date,
        ingestionStatus: a.ingestion_status,
        corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
      })),
    );
    const queue = buildUnresolvedTargetQueue(
      unresolved.map((e) => ({
        id: e.id,
        fromAuthorityId: e.from_authority_id,
        rawCitation: e.raw_citation,
        normalizedCitation: e.normalized_citation,
        fromCourtId: e.from_court_id,
        fromCourt: e.from_court,
      })),
      index,
    );
    const want = new Set();
    let ambTargets = 0;
    for (const t of queue.targets) {
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      if (!el.eligible) continue;
      const vrpKey = citationToBulkVrpKey(t.normalizedCitation) || citationToBulkVrpKey(t.representativeRaw);
      const clusters = lookupClusters(citeDb, vrpKey);
      const bulk = classifyBulkIdentity({
        raw: t.representativeRaw,
        normalized: t.normalizedCitation,
        clusterIds: clusters,
        vrpKey,
      });
      if (bulk.status === "AMBIGUOUS") {
        ambTargets += 1;
        for (const id of bulk.clusterIds) want.add(String(id));
      }
    }
    fs.writeFileSync(
      WANT_FILE,
      JSON.stringify({ ambTargets, clusterCount: want.size, clusterIds: [...want] }, null, 2),
    );
    console.log(JSON.stringify({ phase: "WANT_SET", ambTargets, clusterCount: want.size }));
    return want;
  } finally {
    citeDb.close();
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  if (!fs.existsSync(BZ2)) {
    console.log(JSON.stringify({ ok: false, reason: "missing_bz2", BZ2 }));
    process.exit(2);
  }
  const compressedSize = fs.statSync(BZ2).size;
  const want = await collectWantedClusterIds();
  // Also accept { clusterIds: [...] } file shape
  const wantSet = want instanceof Set ? want : new Set((want.clusterIds || want).map(String));

  fs.mkdirSync(ROOT, { recursive: true });
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const t0 = Date.now();
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE clusters (
      cluster_id TEXT PRIMARY KEY,
      case_name TEXT,
      case_name_full TEXT,
      case_name_short TEXT,
      date_filed TEXT,
      date_filed_is_approximate INTEGER,
      precedential_status TEXT,
      slug TEXT,
      docket_id TEXT,
      citation_count INTEGER
    );
    CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO clusters (
      cluster_id, case_name, case_name_full, case_name_short,
      date_filed, date_filed_is_approximate, precedential_status, slug, docket_id, citation_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const child = openBz2Stream(BZ2);
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let header = null;
  let idx = {};
  let rows = 0;
  let indexed = 0;
  let bytesApprox = 0;
  db.exec("BEGIN");

  for await (const line of rl) {
    bytesApprox += line.length + 1;
    if (!header) {
      header = parseCsvLine(line).map((h) => h.replace(/^"|"$/g, "").toLowerCase());
      for (const n of ["id", "case_name", "date_filed"]) {
        if (!header.includes(n)) throw new Error(`schema_missing_${n}`);
      }
      idx = Object.fromEntries(header.map((h, i) => [h, i]));
      console.log(JSON.stringify({ phase: "HEADER", columns: header.length, wanted: wantSet.size }));
      continue;
    }
    rows += 1;
    if (rows % 2000000 === 0) {
      console.log(JSON.stringify({ scanned: rows, indexed, remainingWant: wantSet.size - indexed, elapsedSec: Math.round((Date.now() - t0) / 1000) }));
      if (indexed >= wantSet.size) break;
    }
    const parts = parseCsvLine(line);
    const id = String(parts[idx.id] || "").replace(/^"|"$/g, "");
    if (!id || !wantSet.has(id)) continue;
    const dateFiled = String(parts[idx.date_filed] || "").replace(/^"|"$/g, "").slice(0, 10);
    const approxRaw = String(parts[idx.date_filed_is_approximate] || "").replace(/^"|"$/g, "").toLowerCase();
    const approx = approxRaw === "t" || approxRaw === "true" || approxRaw === "1" ? 1 : 0;
    insert.run(
      id,
      String(parts[idx.case_name] || "").replace(/^"|"$/g, "").slice(0, 500),
      String(parts[idx.case_name_full] || "").replace(/^"|"$/g, "").slice(0, 800),
      String(parts[idx.case_name_short] || "").replace(/^"|"$/g, "").slice(0, 200),
      dateFiled || null,
      approx,
      String(parts[idx.precedential_status] || "").replace(/^"|"$/g, "").slice(0, 64),
      String(parts[idx.slug] || "").replace(/^"|"$/g, "").slice(0, 120),
      String(parts[idx.docket_id] || "").replace(/^"|"$/g, ""),
      Number(String(parts[idx.citation_count] || "").replace(/^"|"$/g, "")) || 0,
    );
    indexed += 1;
    if (indexed >= wantSet.size) {
      console.log(JSON.stringify({ phase: "ALL_WANTED_FOUND", indexed, scanned: rows }));
      break;
    }
  }
  db.exec("COMMIT");
  try {
    child.kill();
  } catch {
    /* */
  }

  const buildMs = Date.now() - t0;
  const dbSize = fs.statSync(DB_PATH).size;
  const missing = [...wantSet].filter((id) => !db.prepare("SELECT 1 FROM clusters WHERE cluster_id=?").get(id));
  db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)").run("snapshot", SNAPSHOT);
  db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)").run("clusters", String(indexed));
  db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)").run("mode", "selective_ambiguous_candidates");
  db.close();

  const meta = {
    ok: true,
    mode: "selective_ambiguous_candidates",
    snapshot: SNAPSHOT,
    bz2Path: BZ2,
    compressedSize,
    approxUnpackedBytesStreamed: bytesApprox,
    dbPath: DB_PATH,
    dbSize,
    buildMs,
    buildSeconds: Math.round(buildMs / 1000),
    rowsScanned: rows,
    clustersWanted: wantSet.size,
    clustersIndexed: indexed,
    missingWanted: missing.length,
    missingSample: missing.slice(0, 20),
    schemaFields: [
      "cluster_id",
      "case_name",
      "case_name_full",
      "case_name_short",
      "date_filed",
      "date_filed_is_approximate",
      "precedential_status",
      "slug",
      "docket_id",
      "citation_count",
    ],
    missingFromBulk: ["court_id", "docket_number", "canonical_citation"],
    note: "Selective index of ambiguous VRP candidate clusters only. court_id/docket_number require dockets bulk (not downloaded).",
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(META_JSON, JSON.stringify(meta, null, 2));
  console.log("CLUSTER_META_INDEX_BUILD_COMPLETE");
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
