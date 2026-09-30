/**
 * Session 4 — phased historical scale-up (G3H / G2).
 * Discover (search) → bounded ID list → ingest. No long attached opinions discovery.
 *
 * Env:
 *   S4_CL_BUDGET=195
 *   S4_PLAN=g3h|g2|all
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-s4-hist-scale.json");
const BUDGET = Math.min(Math.max(Number(process.env.S4_CL_BUDGET || 195), 20), 400);
const PLAN_MODE = String(process.env.S4_PLAN || "all").toLowerCase();

const WINDOWS = [
  ["1995-01-01", "1999-12-31"],
  ["1990-01-01", "1994-12-31"],
  ["1980-01-01", "1989-12-31"],
];

// Weakest pre-2000 circuits first (from live tracker)
const G3H = [
  "ca4", "ca3", "ca8", "cafc", "ca2", "ca10", "cadc", "ca6", "ca7", "ca1", "ca11", "ca9", "scotus",
];
const G2 = [
  "arizctapp", "connappct", "wisctapp", "utahctapp", "nmctapp", "indctapp",
  "ariz", "conn", "wis", "utah", "nm", "ind",
];

function lastJson(text) {
  const lines = String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") || l.includes('{"ok"'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const s = lines[i].includes("{") ? lines[i].slice(lines[i].indexOf("{")) : lines[i];
    try {
      return JSON.parse(s);
    } catch {
      /* keep */
    }
  }
  // brace extract
  const t = String(text || "").replace(/^\uFEFF/, "");
  const start = t.lastIndexOf('{"ok"');
  if (start < 0) return null;
  let depth = 0;
  for (let k = start; k < t.length; k++) {
    if (t[k] === "{") depth++;
    else if (t[k] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, k + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function flyNode(script, args, timeoutSec) {
  const r = spawnSync(
    process.execPath,
    [path.join(root, "scripts/run-tmp-fly-node.cjs"), script, ...args],
    {
      encoding: "utf8",
      maxBuffer: 16_000_000,
      cwd: root,
      env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec), CL_HARD_TIMEOUT_MS: String(Math.min(timeoutSec * 1000 - 5000, 120000)) },
    },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  return { status: r.status ?? 1, text, json: lastJson(text) };
}

function remoteBusy() {
  const r = spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "ps -o pid,ppid,etime,args"],
    { encoding: "utf8", maxBuffer: 4_000_000 },
  );
  return /staging-cl-batch-job-bundled|cl-batch-owner/.test(`${r.stdout || ""}\n${r.stderr || ""}`);
}

const acc = {
  classification: "MANUAL_QUEUE2_BALANCED_10K_SESSION_4_HIST_SCALE",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  planMode: PLAN_MODE,
  windows: [],
  byLane: {
    G3H: { cl: 0, imported: 0, windows: 0 },
    G2: { cl: 0, imported: 0, windows: 0 },
  },
  totalCl: 0,
  totalImported: 0,
  perCourt: {},
  stopReason: null,
  reliability: { timeouts: 0, rateLimited: 0, orphans: 0 },
};

if (remoteBusy()) {
  acc.stopReason = "remote_child_present";
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  process.exit(2);
}

const plan = [];
if (PLAN_MODE === "g3h" || PLAN_MODE === "all") {
  for (const court of G3H) {
    for (const [gte, lte] of WINDOWS.slice(0, 2)) {
      plan.push({ lane: "G3H", court, gte, lte, maxIds: 10, maxIngest: 8 });
    }
  }
}
if (PLAN_MODE === "g2" || PLAN_MODE === "all") {
  for (const court of G2) {
    for (const [gte, lte] of WINDOWS.slice(0, 2)) {
      plan.push({ lane: "G2", court, gte, lte, maxIds: 10, maxIngest: 8 });
    }
  }
}

for (const step of plan) {
  if (acc.totalCl >= BUDGET - 5) {
    acc.stopReason = "budget_exhausted";
    break;
  }
  const courtCap = acc.perCourt[step.court]?.imported || 0;
  if (courtCap >= 18) continue;

  process.stdout.write(`\n=== ${step.lane} ${step.court} ${step.gte}..${step.lte} ===\n`);

  // DISCOVERY
  const disc = flyNode(
    "scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs",
    [step.court, step.gte, step.lte, String(step.maxIds), "search"],
    90,
  );
  const dCl = Number(disc.json?.courtListenerHttpCalls || 0);
  acc.totalCl += dCl;
  acc.byLane[step.lane].cl += dCl;

  if (disc.json?.status === "rate_limited" || disc.json?.status === 429) {
    acc.reliability.rateLimited += 1;
    acc.stopReason = "429";
    acc.windows.push({ ...step, phase: "DISCOVERY", status: "rate_limited", cl: dCl });
    break;
  }
  if (disc.json?.status === "HIST_QUERY_TIMEOUT") {
    acc.reliability.timeouts += 1;
    acc.windows.push({ ...step, phase: "DISCOVERY", status: "HIST_QUERY_TIMEOUT", cl: dCl });
    // narrow year window once
    const year = step.gte.slice(0, 4);
    const narrow = flyNode(
      "scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs",
      [step.court, `${year}-01-01`, `${year}-12-31`, String(step.maxIds), "search"],
      90,
    );
    const nCl = Number(narrow.json?.courtListenerHttpCalls || 0);
    acc.totalCl += nCl;
    acc.byLane[step.lane].cl += nCl;
    disc.json = narrow.json;
    if (!narrow.json?.ok || !(narrow.json?.ids || []).length) {
      acc.windows.push({ ...step, phase: "DISCOVERY", status: "narrow_failed", cl: nCl });
      continue;
    }
  }

  const ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (!ids.length) {
    acc.windows.push({ ...step, phase: "DISCOVERY", status: "empty", cl: dCl, count: 0 });
    continue;
  }

  // INGEST bounded
  const take = ids.slice(0, step.maxIngest);
  const ing = flyNode(
    "scripts/tmp-queue2-s3-hist-ingest-bundled.cjs",
    [step.court, take.join(","), String(step.maxIngest)],
    240,
  );
  const iCl = Number(ing.json?.courtListenerHttpCalls || 0);
  const imported = Number(ing.json?.imported || 0);
  acc.totalCl += iCl;
  acc.totalImported += imported;
  acc.byLane[step.lane].cl += iCl;
  acc.byLane[step.lane].imported += imported;
  acc.byLane[step.lane].windows += 1;
  acc.perCourt[step.court] = acc.perCourt[step.court] || { imported: 0, cl: 0 };
  acc.perCourt[step.court].imported += imported;
  acc.perCourt[step.court].cl += dCl + iCl;

  const row = {
    lane: step.lane,
    court: step.court,
    gte: step.gte,
    lte: step.lte,
    discovered: ids.length,
    imported,
    cl: dCl + iCl,
    status: ing.json?.status || "unknown",
    results: (ing.json?.results || []).map((r) => ({ id: r.id, status: r.status, d: r.decisionDate })),
  };
  acc.windows.push(row);
  process.stdout.write(`${JSON.stringify({ court: step.court, imported, cl: row.cl, totalCl: acc.totalCl, totalImported: acc.totalImported })}\n`);
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));

  if (ing.json?.status === "rate_limited" || (ing.json?.results || []).some((r) => r.status === "rate_limited")) {
    acc.reliability.rateLimited += 1;
    acc.stopReason = "429";
    break;
  }
  if (ing.json?.status === "HIST_QUERY_TIMEOUT") {
    acc.reliability.timeouts += 1;
    // continue to next window; do not leave orphans (ingest exits)
  }
}

acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete_or_caps";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
process.stdout.write(
  `\nHIST_SCALE_DONE ${JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, stop: acc.stopReason })}\n`,
);
process.exit(acc.stopReason === "429" ? 1 : 0);
