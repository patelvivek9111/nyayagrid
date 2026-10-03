/**
 * Run Fly rebuild and persist READY pools into local manifest.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "packages/research/corpus/reports/citation-demand-acquisition-manifest.json");
const OUT = path.join(ROOT, "packages/research/corpus/reports/queue2-cite-demand-scale2-ready-pools.json");
const RAW = path.join(ROOT, "packages/research/corpus/reports/queue2-cite-demand-scale2-rebuild-raw.txt");

function lastJson(text) {
  const t = String(text || "");
  const marker = '{"ok":true,"classification":"CITATION_DEMAND_SCALE2_READY_REBUILD"';
  const start = t.lastIndexOf(marker);
  if (start < 0) {
    const i = t.lastIndexOf('{"ok"');
    if (i < 0) return null;
    return tryParse(t.slice(i));
  }
  return tryParse(t.slice(start));
}
function tryParse(s) {
  let depth = 0;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "{") depth++;
    else if (s[k] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(0, k + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function compactKey(c) {
  return String(c || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
}

// bundle
const b = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "node_modules/esbuild/bin/esbuild"),
    path.join(ROOT, "scripts/tmp-queue2-cite-demand-rebuild-ready-pools.cjs"),
    "--bundle", "--platform=node", "--format=cjs", "--packages=bundle",
    "--outfile=" + path.join(ROOT, "scripts/tmp-queue2-cite-demand-rebuild-ready-pools-bundled.cjs"),
  ],
  { encoding: "utf8", cwd: ROOT },
);
if (b.status !== 0) {
  console.log(JSON.stringify({ ok: false, reason: "esbuild_failed", err: (b.stderr || "").slice(0, 300) }));
  process.exit(2);
}

const us = process.argv[2] || "400";
const reg = process.argv[3] || "200";
const fed = process.argv[4] || "100";
const r = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/run-tmp-fly-node.cjs"), "scripts/tmp-queue2-cite-demand-rebuild-ready-pools-bundled.cjs", us, reg, fed],
  { encoding: "utf8", maxBuffer: 80e6, cwd: ROOT, env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: "300" } },
);
fs.writeFileSync(RAW, `${r.stdout || ""}\n${r.stderr || ""}`);
const j = lastJson(`${r.stdout || ""}\n${r.stderr || ""}`);
if (!j?.ok || !Array.isArray(j.selectedTargets)) {
  console.log(JSON.stringify({ ok: false, reason: "parse_failed", status: r.status, preview: String(r.stdout || r.stderr || "").slice(-500) }));
  process.exit(2);
}

let prior = { targets: [] };
if (fs.existsSync(MANIFEST)) prior = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const priorBy = new Map((prior.targets || []).map((t) => [compactKey(t.citation || t.canonicalTargetKey), t]));

// Preserve terminal history from local prior
const selectedKeys = new Set(j.selectedTargets.map((t) => compactKey(t.citation)));
const terminal = (prior.targets || []).filter((t) =>
  ["ACQUIRED", "NOT_FOUND_CL", "AMBIGUOUS", "BLOCKED", "DUPLICATE", "UNSUPPORTED", "ALREADY_PRESENT", "ALREADY_RESOLVED_LOCALLY", "PAUSED_FSUPP"].includes(t.status)
  && !selectedKeys.has(compactKey(t.citation)),
);

// Merge attempt history onto selected
for (const t of j.selectedTargets) {
  const p = priorBy.get(compactKey(t.citation));
  if (!p) continue;
  t.attemptCount = p.attemptCount || t.attemptCount || 0;
  t.statusHistory = p.statusHistory || t.statusHistory || [];
  t.actualCLRequests = p.actualCLRequests || 0;
  t.lastAttemptedAt = p.lastAttemptedAt || null;
  if (p.status === "ACQUIRED") {
    t.status = "ACQUIRED";
    t.acquired = true;
  }
}

const manifest = {
  generatedAt: j.generatedAt || new Date().toISOString(),
  courtListenerHttpCalls: 0,
  refreshClassification: "CITATION_DEMAND_ADAPTIVE_SCALE_2_READY_REBUILD",
  targets: [...j.selectedTargets.filter((t) => t.status === "READY_CL" || t.status === "PAUSED_FSUPP"), ...terminal],
  poolCounts: j.poolCounts,
  skipped: j.skipped,
  familyPilotStatsVersion: prior.familyPilotStatsVersion || null,
  calibrationBlock2: prior.calibrationBlock2 || null,
  adaptiveScale1: prior.adaptiveScale1 || null,
  adaptiveScale2: prior.adaptiveScale2 || null,
};
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

const ready = {
  us: manifest.targets.filter((t) => t.status === "READY_CL" && t.citationFamily === "us_reports").length,
  regional: manifest.targets.filter((t) => t.status === "READY_CL" && t.citationFamily === "regional_reporter").length,
  federal: manifest.targets.filter((t) => t.status === "READY_CL" && t.citationFamily === "federal_reporter").length,
  fsupp: manifest.targets.filter((t) => t.status === "PAUSED_FSUPP").length,
};
const summary = {
  ok: true,
  classification: "CITATION_DEMAND_SCALE2_READY_REBUILD_LOCAL",
  generatedAt: manifest.generatedAt,
  courtListenerHttpCalls: 0,
  poolCounts: j.poolCounts,
  localReady: ready,
  topUs: j.topUs,
  topRegional: j.topRegional,
  topFederal: j.topFederal,
  regionalSubfamilyCounts: j.regionalSubfamilyCounts,
  skipped: j.skipped,
  terminalPreserved: terminal.length,
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
