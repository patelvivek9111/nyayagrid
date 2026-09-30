#!/usr/bin/env node
/**
 * Bundle + run overnight Wave A live DB probe (zero CL, zero mutations).
 * Usage: node scripts/run-tmp-queue2-overnight-wave-a.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const src = "scripts/tmp-queue2-overnight-wave-a.cjs";
const bundled = "scripts/tmp-queue2-overnight-wave-a-bundled.cjs";

function lastJson(text) {
  const lines = String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* keep */
    }
  }
  return null;
}

const build = spawnSync(
  "npx",
  ["esbuild", src, "--bundle", "--platform=node", "--outfile=" + bundled],
  { cwd: root, encoding: "utf8", shell: true },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}

const run = spawnSync(process.execPath, ["scripts/run-tmp-fly-node.cjs", bundled], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 32_000_000,
  env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: "300" },
});
const raw = `${run.stdout || ""}\n${run.stderr || ""}`;
fs.writeFileSync(path.join(reports, "queue2-overnight-wave-a-raw.txt"), raw.slice(0, 2_000_000));
const json = lastJson(run.stdout || "");
if (!json || !json.ok) {
  fs.writeFileSync(
    path.join(reports, "queue2-overnight-wave-a.json"),
    JSON.stringify({ ok: false, status: run.status, err: json || raw.slice(0, 2000) }, null, 2),
  );
  process.exit(run.status || 1);
}

fs.writeFileSync(path.join(reports, "queue2-overnight-wave-a.json"), JSON.stringify(json, null, 2));
fs.writeFileSync(path.join(reports, "queue2-balanced-10k-tracker.json"), JSON.stringify(json.tracker, null, 2));
fs.writeFileSync(path.join(reports, "queue2-federal-depth-map.json"), JSON.stringify({
  classification: "QUEUE2_FEDERAL_DEPTH_MAP",
  generatedAt: json.generatedAt,
  courtListenerHttpCalls: 0,
  ...json.federalDepth,
}, null, 2));
fs.writeFileSync(path.join(reports, "queue2-district-manifest.json"), JSON.stringify({
  classification: "QUEUE2_DISTRICT_MANIFEST",
  generatedAt: json.generatedAt,
  courtListenerHttpCalls: 0,
  ...json.districtManifest,
}, null, 2));
fs.writeFileSync(path.join(reports, "queue2-state-intermediate-manifest.json"), JSON.stringify({
  classification: "QUEUE2_STATE_INTERMEDIATE_MANIFEST",
  generatedAt: json.generatedAt,
  courtListenerHttpCalls: 0,
  ...json.intermediateManifest,
}, null, 2));
fs.writeFileSync(path.join(reports, "queue2-year-distribution.json"), JSON.stringify({
  classification: "QUEUE2_YEAR_DISTRIBUTION",
  generatedAt: json.generatedAt,
  courtListenerHttpCalls: 0,
  ...json.yearDistribution,
}, null, 2));
fs.writeFileSync(path.join(reports, "queue2-retrieval-diversity.json"), JSON.stringify({
  classification: "QUEUE2_RETRIEVAL_DIVERSITY",
  generatedAt: json.generatedAt,
  courtListenerHttpCalls: 0,
  ...json.retrievalDiversity,
}, null, 2));
fs.writeFileSync(path.join(reports, "queue2-integrity-full-pass.json"), JSON.stringify({
  classification: "QUEUE2_INTEGRITY_FULL_PASS",
  generatedAt: json.generatedAt,
  courtListenerHttpCalls: 0,
  mutations: 0,
  ...json.integrity,
}, null, 2));

console.log(JSON.stringify({
  ok: true,
  cases: json.tracker?.progress?.casesCurrent,
  federal: json.tracker?.progress?.federalCurrent,
  stateDc: json.tracker?.progress?.stateDcCurrent,
  districts: json.districtManifest?.courts?.length,
  intermediates: json.intermediateManifest?.verified?.length,
  integrityDupes: json.integrity?.duplicateSourceIdentities,
}, null, 2));
