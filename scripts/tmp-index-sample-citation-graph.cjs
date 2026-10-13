/**
 * Index citation-map edges for sample citing opinions (from collision-sample JSON).
 * ZERO CL API. Does not need opinion→cluster map yet.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const SAMPLE = path.join(ROOT, "collision-sample-2026-10-13.json");
const CITATION_MAP_BZ2 = path.join(ROOT, "citation-map-2026-09-30.csv.bz2");
const GRAPH_DB = path.join(ROOT, "citation-graph-selective-2026-09-30.sqlite");

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

async function main() {
  const sample = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  const citing = new Set();
  for (const e of sample.edges || []) {
    for (const op of e.citingOpinionIdsDirect || []) citing.add(String(op));
  }
  console.log(JSON.stringify({ phase: "START", citingOpinions: citing.size, edges: (sample.edges || []).length }));

  if (fs.existsSync(GRAPH_DB)) fs.unlinkSync(GRAPH_DB);
  const db = new DatabaseSync(GRAPH_DB);
  db.exec(`
    PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
    CREATE TABLE cite_edge (citing_opinion_id TEXT NOT NULL, cited_opinion_id TEXT NOT NULL);
    CREATE INDEX idx_cite_citing ON cite_edge(citing_opinion_id);
  `);
  const insert = db.prepare("INSERT INTO cite_edge(citing_opinion_id, cited_opinion_id) VALUES (?, ?)");
  const child = openBz2Stream(CITATION_MAP_BZ2);
  let header = null;
  let citingIdx = -1;
  let citedIdx = -1;
  let rows = 0;
  let kept = 0;
  const citedIds = new Set();

  await new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    db.exec("BEGIN");
    rl.on("line", (line) => {
      if (!header) {
        header = parseCsvLine(line).map((h) => h.replace(/^"|"$/g, ""));
        citingIdx = header.indexOf("citing_opinion_id");
        citedIdx = header.indexOf("cited_opinion_id");
        console.log(JSON.stringify({ phase: "HEADER", header }));
        return;
      }
      rows += 1;
      if (rows % 5000000 === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
        console.log(JSON.stringify({ phase: "PROGRESS", rows, kept, citedUnique: citedIds.size }));
      }
      const cols = parseCsvLine(line);
      const c = String(cols[citingIdx] || "").replace(/^"|"$/g, "");
      if (!citing.has(c)) return;
      const d = String(cols[citedIdx] || "").replace(/^"|"$/g, "");
      insert.run(c, d);
      citedIds.add(d);
      kept += 1;
    });
    rl.on("close", () => {
      db.exec("COMMIT");
      resolve();
    });
    child.on("error", reject);
  });

  fs.writeFileSync(path.join(ROOT, "sample-cited-opinion-ids.json"), JSON.stringify([...citedIds]));
  console.log(
    JSON.stringify({
      phase: "DONE",
      rows,
      kept,
      citingOpinions: citing.size,
      citedUnique: citedIds.size,
      graphDb: GRAPH_DB,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
