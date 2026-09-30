#!/usr/bin/env node
/**
 * Cheap test suite inventory by subsystem (file counts; no full execution).
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (["node_modules", ".git", "dist", ".next", "coverage"].includes(ent.name)) continue;
      walk(p, acc);
    } else if (/\.(test|spec)\.(ts|tsx|js|cjs|mjs)$/.test(ent.name) || /\.test\.cjs$/.test(ent.name)) {
      acc.push(p);
    }
  }
  return acc;
}

const files = walk(root);
function bucket(f) {
  const s = f.replace(/\\/g, "/").toLowerCase();
  if (s.includes("citation") || s.includes("cite")) return "citation_parser_resolver";
  if (s.includes("ingest") || s.includes("adapter") || s.includes("corpus")) return "corpus_ingestion";
  if (s.includes("normaliz")) return "normalization";
  if (s.includes("retriev") || s.includes("search")) return "retrieval";
  if (s.includes("currentness")) return "currentness";
  if (s.includes("graph")) return "graph";
  if (s.includes("draft")) return "drafting";
  if (s.includes("permission") || s.includes("rbac") || s.includes("isolation")) return "RBAC_matter_isolation";
  if (s.includes("storage") || s.includes("document") || s.includes("upload")) return "storage_upload";
  if (s.includes("queue2") || s.includes("cl-") || s.includes("worker")) return "queue2_harness";
  if (s.includes("agent")) return "agents";
  if (s.includes("benchmark") || s.includes("nyaya-bench")) return "benchmark_harness";
  if (s.includes("api") || s.includes("route")) return "API";
  return "other";
}

const by = {};
for (const f of files) {
  const b = bucket(f);
  by[b] = by[b] || [];
  by[b].push(path.relative(root, f).replace(/\\/g, "/"));
}

const inventory = {
  classification: "QUEUE2_TEST_SUITE_INVENTORY",
  generatedAt: new Date().toISOString(),
  totalTestFiles: files.length,
  bySubsystem: Object.fromEntries(
    Object.entries(by).map(([k, v]) => [k, { fileCount: v.length, files: v.slice(0, 40) }]),
  ),
  strongAreas: Object.entries(by)
    .filter(([, v]) => v.length >= 8)
    .map(([k, v]) => ({ area: k, files: v.length })),
  weakAreas: [
    { area: "drafting", note: by.drafting ? `${by.drafting.length} files` : "few/no dedicated tests" },
    { area: "graph", note: by.graph ? `${by.graph.length} files` : "few/no dedicated tests" },
    { area: "normalization", note: by.normalization ? `${by.normalization.length} files` : "mostly via citations tests" },
  ],
  newRegressionTestsTonight: [
    "scripts/queue2-s5-resolver-defect-regression.test.cjs (expanded to 10 invariants)",
  ],
};
fs.writeFileSync(path.join(reports, "queue2-test-suite-inventory.json"), JSON.stringify(inventory, null, 2));
console.log(JSON.stringify({ ok: true, totalTestFiles: files.length, buckets: Object.keys(by).length }, null, 2));
