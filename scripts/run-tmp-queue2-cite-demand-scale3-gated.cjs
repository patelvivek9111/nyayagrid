/**
 * Gate Scale3 acquisition on live Tier-2 quota floors, then run.
 * Exactly one quota probe, then acquisition. Zero LLM.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const PREFERRED = Math.min(Math.max(Number(process.env.CITE_SCALE3_BUDGET || 100), 20), 150);

function lastJson(text) {
  const t = String(text || "");
  const start = t.lastIndexOf('{"ok"');
  if (start < 0) return null;
  let depth = 0;
  for (let k = start; k < t.length; k++) {
    if (t[k] === "{") depth++;
    else if (t[k] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(t.slice(start, k + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function probe() {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/run-wave2f-fly-tool.cjs"), "scripts/tmp-cl-api-usage-probe.cjs"],
    { encoding: "utf8", maxBuffer: 20e6, cwd: ROOT },
  );
  return lastJson(`${r.stdout || ""}\n${r.stderr || ""}`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const maxWaitMs = Number(process.env.CITE_SCALE3_QUOTA_WAIT_MS || 55 * 60 * 1000);
const pollEveryMs = Number(process.env.CITE_SCALE3_QUOTA_POLL_MS || 3 * 60 * 1000);
const started = Date.now();
let q = null;
let probes = 0;

while (Date.now() - started < maxWaitMs) {
  q = probe();
  probes += 1;
  if (!q?.limits) {
    console.log(JSON.stringify({ ok: false, reason: "quota_parse_failed", probes }));
    process.exit(2);
  }
  const hourRem = Number(q.limits.hour?.remaining ?? 0);
  const dayRem = Number(q.limits.day?.remaining ?? 0);
  const safeHour = Math.max(0, hourRem - HOUR_FLOOR);
  const safeDay = Math.max(0, dayRem - DAY_FLOOR);
  const safe = Math.min(PREFERRED, safeHour, safeDay);
  const snap = {
    ok: true,
    classification: "CITATION_DEMAND_ADAPTIVE_SCALE_3_QUOTA_GATE",
    at: new Date().toISOString(),
    probes,
    limits: q.limits,
    membership: q.membership || null,
    hourFloor: HOUR_FLOOR,
    dayFloor: DAY_FLOOR,
    preferred: PREFERRED,
    safeBudget: safe,
    pacingMs: 5000,
  };
  fs.writeFileSync(path.join(REPORTS, "queue2-cite-demand-scale3-quota-live.json"), JSON.stringify(snap, null, 2));
  console.log("QUOTA_GATE " + JSON.stringify({
    hourRem, dayRem, safe, resetHour: q.limits.hour?.reset_at, probes,
  }));
  if (safe >= 40) {
    // enough for a meaningful block
    const env = {
      ...process.env,
      CITE_SCALE3_BUDGET: String(safe),
      CL_RATE_MS: "5000",
    };
    console.log("LAUNCH_SCALE3 budget=" + safe);
    const run = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-queue2-cite-demand-scale3.cjs")], {
      encoding: "utf8",
      maxBuffer: 80e6,
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
    process.exit(run.status ?? 1);
  }
  if (Date.now() - started + pollEveryMs >= maxWaitMs) break;
  console.log(`WAIT_QUOTA sleeping ${pollEveryMs}ms`);
  sleep(pollEveryMs);
}

console.log(JSON.stringify({
  ok: false,
  reason: "quota_not_safe_within_wait",
  probes,
  last: q?.limits || null,
}));
process.exit(3);
