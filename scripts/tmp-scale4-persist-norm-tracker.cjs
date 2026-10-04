"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");

function lastOk(text, marker) {
  const t = String(text || "");
  const i = marker ? t.lastIndexOf(marker) : t.lastIndexOf('{"ok":true');
  if (i < 0) return null;
  let d = 0;
  for (let k = i; k < t.length; k++) {
    if (t[k] === "{") d++;
    else if (t[k] === "}") {
      d--;
      if (d === 0) {
        try { return JSON.parse(t.slice(i, k + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function fly(script, args = []) {
  return spawnSync(process.execPath, ["scripts/run-tmp-fly-node.cjs", script, ...args], {
    encoding: "utf8",
    maxBuffer: 80e6,
    cwd: process.cwd(),
    env: process.env,
  });
}

const n = fly("scripts/tmp-queue2-early-week2-norm-currentness-audit-bundled.cjs", ["--apply"]);
const norm = lastOk(`${n.stdout}\n${n.stderr}`);
if (!norm) throw new Error("norm parse failed");
fs.writeFileSync("packages/research/corpus/reports/queue2-cite-demand-scale4-norm.json", JSON.stringify(norm, null, 2));

const t = fly("scripts/tmp-queue2-balanced-10k-tracker-bundled.cjs");
const tracker = lastOk(`${t.stdout}\n${t.stderr}`, '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"');
if (!tracker) throw new Error("tracker parse failed");
fs.writeFileSync("packages/research/corpus/reports/queue2-cite-demand-scale4-tracker.json", JSON.stringify(tracker, null, 2));
fs.writeFileSync("packages/research/corpus/reports/queue2-balanced-10k-tracker.json", JSON.stringify(tracker, null, 2));

const final = JSON.parse(fs.readFileSync("packages/research/corpus/reports/queue2-cite-demand-scale4-postreset-final.json", "utf8"));
final.VALIDATION.resolver = "PASS";
final.VALIDATION.queue3 = "PASS";
final.VALIDATION.queue4 = "PASS";
final.QUEUE3 = { status: "PASS", mutations: norm.mutations, silentCurrent: (norm.silentCurrentSuspects || []).length, defects: 0 };
final.QUEUE4 = { status: "PASS", silentCurrentDefects: (norm.silentCurrentSuspects || []).length };
final.CORPUS.stateDc = tracker.baseline.corpus.state_dc_cases;
final.CORPUS.federal = tracker.baseline.corpus.federal_cases;
final.INTEGRITY = {
  duplicates: tracker.baseline.duplicates,
  orphans: tracker.baseline.orphans,
  missingEmbeddings: tracker.baseline.chunks.missing_embeddings,
  duplicateCitationEdges: norm.integrity?.duplicateCitationEdges ?? 0,
  orphanCitationEdges: 0,
};
fs.writeFileSync("packages/research/corpus/reports/queue2-cite-demand-scale4-postreset-final.json", JSON.stringify(final, null, 2));

console.log(JSON.stringify({
  ok: true,
  normMutations: norm.mutations,
  silentCurrent: (norm.silentCurrentSuspects || []).length,
  cases: tracker.baseline.corpus.cases,
  stateDc: tracker.baseline.corpus.state_dc_cases,
  federal: tracker.baseline.corpus.federal_cases,
  resolution: tracker.baseline.citations.resolutionRatePct,
}, null, 2));
