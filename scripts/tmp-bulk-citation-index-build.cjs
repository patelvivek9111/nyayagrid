/**
 * Build durable SQLite CourtListener bulk citation identity index.
 * Input: citations-2026-09-30.csv (already downloaded). Zero CL API.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { DatabaseSync } = require("node:sqlite");
const {
  bulkVrpKey,
  compactReporter,
  formatBulkCitationDisplay,
  BULK_SNAPSHOT_ID,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const CSV = path.join(ROOT, "citations-2026-09-30.csv");
const DB_PATH = path.join(ROOT, "citations-index-2026-09-30.sqlite");
const META_JSON = path.join(ROOT, "citations-index-2026-09-30.meta.json");

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

function main() {
  if (!fs.existsSync(CSV)) {
    console.log(JSON.stringify({ ok: false, reason: "missing_csv", CSV }));
    process.exit(2);
  }
  const csvSize = fs.statSync(CSV).size;
  fs.mkdirSync(ROOT, { recursive: true });
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const t0 = Date.now();
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE vrp_map (
      vrp_key TEXT NOT NULL,
      cluster_id TEXT NOT NULL,
      volume INTEGER,
      reporter_raw TEXT,
      reporter_compact TEXT,
      page INTEGER,
      cite_type TEXT,
      PRIMARY KEY (vrp_key, cluster_id)
    );
    CREATE TABLE cluster_cites (
      cluster_id TEXT NOT NULL,
      citation_display TEXT NOT NULL,
      vrp_key TEXT NOT NULL,
      PRIMARY KEY (cluster_id, vrp_key)
    );
    CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);

  const insertVrp = db.prepare(`
    INSERT OR IGNORE INTO vrp_map (vrp_key, cluster_id, volume, reporter_raw, reporter_compact, page, cite_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCite = db.prepare(`
    INSERT OR IGNORE INTO cluster_cites (cluster_id, citation_display, vrp_key)
    VALUES (?, ?, ?)
  `);

  let rows = 0;
  let indexed = 0;
  let skipped = 0;
  const collisionProbe = new Map(); // vrp -> Set clusters during build (memory heavy if all — sample only unique via SQL later)

  async function run() {
    const rl = readline.createInterface({ input: fs.createReadStream(CSV, { encoding: "utf8" }), crlfDelay: Infinity });
    let headerDone = false;
    db.exec("BEGIN");
    for await (const line of rl) {
      if (!headerDone) {
        headerDone = true;
        const h = parseCsvLine(line).map((x) => x.toLowerCase());
        const need = ["volume", "reporter", "page", "cluster_id"];
        for (const n of need) {
          if (!h.includes(n)) throw new Error(`schema_missing_${n}`);
        }
        continue;
      }
      rows += 1;
      const parts = parseCsvLine(line);
      if (parts.length < 6) {
        skipped += 1;
        continue;
      }
      const volume = parts[1];
      const reporter = parts[2];
      const page = parts[3];
      const citeType = parts[4];
      const clusterId = String(parts[5] || "");
      const key = bulkVrpKey(volume, reporter, page);
      if (!key || !clusterId) {
        skipped += 1;
        continue;
      }
      const pageNum = Number(String(page).replace(/[^0-9].*$/, ""));
      const volNum = Number(volume);
      const repC = compactReporter(reporter);
      insertVrp.run(key, clusterId, volNum, reporter, repC, pageNum, citeType);
      const display = formatBulkCitationDisplay(volume, reporter, page);
      insertCite.run(clusterId, display, key);
      indexed += 1;
      if (indexed % 100000 === 0) {
        db.exec("COMMIT; BEGIN");
        if (indexed % 1000000 === 0) console.log(JSON.stringify({ progress: indexed, rows, ms: Date.now() - t0 }));
      }
    }
    db.exec("COMMIT");

    console.log(JSON.stringify({ phase: "INDEXING_COUNTS" }));
    const [vrpCount] = db.prepare("SELECT COUNT(*) AS n FROM vrp_map").all();
    const [keyCount] = db.prepare("SELECT COUNT(DISTINCT vrp_key) AS n FROM vrp_map").all();
    const [clusterCount] = db.prepare("SELECT COUNT(DISTINCT cluster_id) AS n FROM vrp_map").all();
    const [citeCount] = db.prepare("SELECT COUNT(*) AS n FROM cluster_cites").all();
    const [collisionKeys] = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT vrp_key FROM vrp_map GROUP BY vrp_key HAVING COUNT(DISTINCT cluster_id) > 1
         )`,
      )
      .all();
    const [collision2] = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT vrp_key FROM vrp_map GROUP BY vrp_key HAVING COUNT(DISTINCT cluster_id) = 2
         )`,
      )
      .all();
    const [collision3] = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT vrp_key FROM vrp_map GROUP BY vrp_key HAVING COUNT(DISTINCT cluster_id) >= 3
         )`,
      )
      .all();

    db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES (?,?)").run("snapshot", BULK_SNAPSHOT_ID);
    db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES (?,?)").run("source_csv", path.basename(CSV));
    db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES (?,?)").run("rows_scanned", String(rows));
    db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES (?,?)").run("built_at", new Date().toISOString());

    // Helpful indexes after load
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vrp_key ON vrp_map(vrp_key);
      CREATE INDEX IF NOT EXISTS idx_cluster_id ON vrp_map(cluster_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_cites ON cluster_cites(cluster_id);
    `);

    db.close();
    const buildMs = Date.now() - t0;
    const dbSize = fs.statSync(DB_PATH).size;
    const meta = {
      ok: true,
      snapshot: BULK_SNAPSHOT_ID,
      csvPath: CSV,
      csvSize,
      dbPath: DB_PATH,
      dbSize,
      buildMs,
      buildSeconds: Math.round(buildMs / 1000),
      rowsScanned: rows,
      rowsIndexed: indexed,
      skipped,
      uniqueVrpKeys: keyCount.n,
      uniqueClusters: clusterCount.n,
      vrpMapRows: vrpCount.n,
      clusterCiteRows: citeCount.n,
      collisionKeys: collisionKeys.n,
      collision2: collision2.n,
      collision3plus: collision3.n,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(META_JSON, JSON.stringify(meta, null, 2));
    console.log(JSON.stringify(meta, null, 2));
  }

  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
