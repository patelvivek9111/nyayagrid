#!/usr/bin/env node
/**
 * Overnight Wave B — citation probes (zero CL, zero mutations by default).
 * Runs: citation-target-priority, denom sample≥1000, present-unresolved scan.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");

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

function bundle(src, out) {
  const r = spawnSync("npx", ["esbuild", src, "--bundle", "--platform=node", `--outfile=${out}`], {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `bundle fail ${src}`);
}

function fly(bundled, env = {}, timeoutSec = 300) {
  const r = spawnSync(process.execPath, ["scripts/run-tmp-fly-node.cjs", bundled], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32_000_000,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec), ...env },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", json: lastJson(r.stdout || "") };
}

const summary = {
  classification: "OVERNIGHT_ZERO_QUOTA_WAVE_B_PROBES",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
  steps: [],
};

// 1) Citation target priority / family inventory
bundle(
  "scripts/tmp-queue2-citation-target-priority.cjs",
  "scripts/tmp-queue2-citation-target-priority-bundled.cjs",
);
const pri = fly("scripts/tmp-queue2-citation-target-priority-bundled.cjs", {}, 360);
fs.writeFileSync(path.join(reports, "queue2-overnight-cite-priority-raw.txt"), (pri.stdout + "\n" + pri.stderr).slice(0, 2_000_000));
if (pri.json?.ok !== false && pri.json) {
  fs.writeFileSync(path.join(reports, "queue2-citation-target-priority-last.json"), JSON.stringify(pri.json, null, 2));
  if (pri.json.reporterGap) {
    fs.writeFileSync(path.join(reports, "queue2-citation-reporter-gap.json"), JSON.stringify(pri.json.reporterGap, null, 2));
  }
  summary.steps.push({ id: "citation_target_priority", ok: true });
} else {
  summary.steps.push({ id: "citation_target_priority", ok: false, err: (pri.json || pri.stdout || "").toString().slice(0, 400) });
}

// 2) Denominator sample ≥1000
bundle("scripts/tmp-queue2-s3-denom-sample.cjs", "scripts/tmp-queue2-s3-denom-sample-bundled.cjs");
const denom = fly(
  "scripts/tmp-queue2-s3-denom-sample-bundled.cjs",
  {
    DENOM_SAMPLE_TARGET: "1000",
    DENOM_PER_STRATUM: "120",
    DENOM_SAMPLE_OUT: "/tmp/queue2-citation-denominator-sample-1000.json",
  },
  360,
);
fs.writeFileSync(path.join(reports, "queue2-overnight-denom-1000-raw.txt"), (denom.stdout + "\n" + denom.stderr).slice(0, 2_000_000));
if (denom.json?.ok) {
  denom.json.classification = "QUEUE2_CITATION_DENOMINATOR_SAMPLE_1000";
  fs.writeFileSync(
    path.join(reports, "queue2-citation-denominator-sample-1000.json"),
    JSON.stringify(denom.json, null, 2),
  );
  summary.steps.push({ id: "denom_1000", ok: true, sampleSize: denom.json.sampleSize });
} else {
  summary.steps.push({ id: "denom_1000", ok: false, err: String(denom.json?.err || denom.stdout).slice(0, 400) });
}

// 3) Present-unresolved scan (read-only; no APPLY)
bundle(
  "scripts/tmp-queue2-s5-present-unresolved-scan.cjs",
  "scripts/tmp-queue2-s5-present-unresolved-scan-bundled.cjs",
);
const present = fly("scripts/tmp-queue2-s5-present-unresolved-scan-bundled.cjs", {}, 300);
fs.writeFileSync(path.join(reports, "queue2-overnight-present-unresolved-raw.txt"), (present.stdout + "\n" + present.stderr).slice(0, 1_000_000));
if (present.json) {
  fs.writeFileSync(path.join(reports, "queue2-overnight-present-unresolved.json"), JSON.stringify(present.json, null, 2));
  summary.steps.push({
    id: "present_unresolved",
    ok: true,
    total: present.json.total ?? present.json.presentUnresolved ?? present.json.count,
  });
} else {
  summary.steps.push({ id: "present_unresolved", ok: false });
}

summary.ok = summary.steps.every((s) => s.ok);
fs.writeFileSync(path.join(reports, "queue2-overnight-wave-b-probes.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
