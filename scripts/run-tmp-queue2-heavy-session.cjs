/**
 * MANUAL Queue #2 heavy recovered-quota session.
 * Phased hist discovery→ingest + bounded district oneshots.
 * Env: HEAVY_CL_BUDGET=620 HEAVY_CASE_TARGET=360
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const reportPath = path.join(reports, "queue2-heavy-session-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.HEAVY_CL_BUDGET || 620), 40), 700);
const CASE_TARGET = Math.min(Math.max(Number(process.env.HEAVY_CASE_TARGET || 360), 50), 500);
const COURT_CAP = 18;

// Pack aliases → CL slug
const CLUG = {
  "ne-high": "neb",
  "nc-high": "nc",
  "id-high": "idaho",
  "al-high": "ala",
  "ak-high": "alaska",
  "ok-high": "okla",
};

function lastJson(text) {
  const lines = String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* keep */
    }
  }
  const t = String(text || "");
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

function remoteBusy() {
  const r = spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "ps -o pid,ppid,etime,args"],
    { encoding: "utf8", maxBuffer: 4_000_000 },
  );
  return /staging-cl-batch-job-bundled|cl-batch-owner/.test(`${r.stdout || ""}\n${r.stderr || ""}`);
}

function flyNode(script, args, timeoutSec) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/run-tmp-fly-node.cjs"), script, ...args], {
    encoding: "utf8",
    maxBuffer: 20_000_000,
    cwd: root,
    env: {
      ...process.env,
      FLY_TOOL_TIMEOUT_SEC: String(timeoutSec),
      CL_HARD_TIMEOUT_MS: String(Math.min(timeoutSec * 1000 - 5000, 120000)),
    },
  });
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  return { status: r.status ?? 1, text, json: lastJson(text) };
}

function histWindow(lane, courtRaw, gte, lte, take) {
  const court = CLUG[courtRaw] || courtRaw;
  const disc = flyNode(
    "scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs",
    [court, gte, lte, String(Math.max(take + 2, 8)), "search"],
    90,
  );
  let cl = Number(disc.json?.courtListenerHttpCalls || 0);
  if (disc.json?.status === "rate_limited") {
    return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true };
  }
  let ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (disc.json?.status === "HIST_QUERY_TIMEOUT" || /\b408\b/.test(disc.text || "")) {
    const y = gte.slice(0, 4);
    const n = flyNode(
      "scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs",
      [court, `${y}-01-01`, `${y}-12-31`, String(take), "search"],
      90,
    );
    cl += Number(n.json?.courtListenerHttpCalls || 0);
    ids = (n.json?.ids || []).map((x) => x.id).filter(Boolean);
    if (n.json?.status === "rate_limited") {
      return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true };
    }
  }
  if (!ids.length) return { lane, court, gte, lte, imported: 0, cl, status: "empty" };
  const slice = ids.slice(0, take);
  const ing = flyNode(
    "scripts/tmp-queue2-s3-hist-ingest-bundled.cjs",
    [court, slice.join(","), String(slice.length)],
    240,
  );
  cl += Number(ing.json?.courtListenerHttpCalls || 0);
  return {
    lane,
    court,
    gte,
    lte,
    imported: Number(ing.json?.imported || 0),
    cl,
    status: ing.json?.status || "unknown",
    rateLimited: ing.json?.status === "rate_limited",
    skipped: Number(ing.json?.skipped || 0),
    reason: ing.json?.reason || null,
  };
}

function oneshot(clCourt, batchSize, targetMax, maxCalls, tag) {
  const r = spawnSync(
    process.execPath,
    ["scripts/run-tmp-manual-cl-oneshot.cjs", clCourt, String(batchSize), String(targetMax), String(maxCalls), tag],
    {
      encoding: "utf8",
      maxBuffer: 20_000_000,
      cwd: root,
      env: {
        ...process.env,
        CL_FLY_EXEC_TIMEOUT_SEC: "540",
        CL_RATE_MS: "2500",
        CL_KEEP_DATE_FILTER: "0",
        CL_ORPHAN_WAIT_MS: "60000",
      },
    },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const j = lastJson(text);
  const fr = j?.fileResult || j || {};
  return {
    lane: "DISTRICT_RECENT",
    court: clCourt,
    imported: Number(fr.items_imported ?? fr.itemsImported ?? 0),
    cl: Number(fr.sessionApiCalls ?? fr.apiCalls ?? 0),
    status: fr.status || j?.status || "unknown",
    rateLimited: fr.status === "rate_limited" || /\b429\b/.test(text),
    textHit408: /408|HIST_QUERY_TIMEOUT|ORPHAN|LANE_A_CHILD/.test(text),
  };
}

// Interleave lanes for balance; prioritize weak circuits + pack state/district.
const PLAN = [];

// --- Dual-value / SCOTUS historical depth (corpus G3, not blind A2) ---
for (const [gte, lte] of [
  ["2005-01-01", "2015-12-31"],
  ["1990-01-01", "1999-12-31"],
  ["1980-01-01", "1989-12-31"],
]) {
  PLAN.push({ kind: "hist", lane: "SCOTUS", court: "scotus", gte, lte, take: 8 });
}

// --- Federal historical (rotate weak circuits) ---
const G3H = ["ca11", "ca6", "ca7", "ca9", "cadc", "ca8", "cafc", "ca5", "ca3", "ca4", "ca2", "ca1", "ca10"];
const G3H_WINDOWS = [
  ["2000-01-01", "2015-12-31"],
  ["1995-01-01", "1999-12-31"],
  ["1990-01-01", "1994-12-31"],
  ["1980-01-01", "1989-12-31"],
];
for (const [gte, lte] of G3H_WINDOWS) {
  for (const court of G3H) {
    PLAN.push({ kind: "hist", lane: "G3H", court, gte, lte, take: 8 });
  }
}

// --- District historical (rotate; avoid NYSD/CACD domination via take caps) ---
const DIST_HIST = [
  ["txnd", "1985-01-01", "1994-12-31", 8],
  ["cand", "1985-01-01", "1994-12-31", 8],
  ["waed", "1985-01-01", "1994-12-31", 8],
  ["dcd", "1985-01-01", "1994-12-31", 8],
  ["njd", "1985-01-01", "1999-12-31", 8],
  ["paed", "1985-01-01", "1999-12-31", 8],
  ["mad", "1985-01-01", "1999-12-31", 8],
  ["flsd", "1985-01-01", "1999-12-31", 8],
  ["ilnd", "1985-01-01", "1999-12-31", 8],
  ["txsd", "1985-01-01", "1999-12-31", 8],
  ["nysd", "1975-01-01", "1989-12-31", 6],
  ["cacd", "1975-01-01", "1989-12-31", 6],
  ["txnd", "2000-01-01", "2015-12-31", 6],
  ["cand", "2000-01-01", "2015-12-31", 6],
  ["waed", "2000-01-01", "2015-12-31", 6],
  ["dcd", "2000-01-01", "2015-12-31", 6],
];
for (const [court, gte, lte, take] of DIST_HIST) {
  PLAN.push({ kind: "hist", lane: "DISTRICT_HIST", court, gte, lte, take });
}

// --- State historical high courts from pack ---
const G2 = [
  ["neb", "1980-01-01", "1999-12-31", 8],
  ["nc", "1980-01-01", "1999-12-31", 8],
  ["idaho", "1980-01-01", "1999-12-31", 8],
  ["ala", "1980-01-01", "1999-12-31", 8],
  ["alaska", "1980-01-01", "1999-12-31", 8],
  ["okla", "1980-01-01", "1999-12-31", 8],
  ["or", "1980-01-01", "1999-12-31", 8],
  ["mo", "1980-01-01", "1999-12-31", 8],
  ["neb", "1970-01-01", "1979-12-31", 6],
  ["nc", "1970-01-01", "1979-12-31", 6],
  ["idaho", "1970-01-01", "1979-12-31", 6],
  ["ala", "1970-01-01", "1979-12-31", 6],
];
for (const [court, gte, lte, take] of G2) {
  PLAN.push({ kind: "hist", lane: "G2", court, gte, lte, take });
}

// --- Intermediate appellate from pack ---
const G1 = [
  ["nyappdiv", "1985-01-01", "1999-12-31", 10],
  ["calctapp", "1985-01-01", "1999-12-31", 10],
  ["fladistctapp", "1985-01-01", "1999-12-31", 10],
  ["massappct", "1985-01-01", "1999-12-31", 10],
  ["pasuperct", "1985-01-01", "1999-12-31", 10],
  ["illappct", "1985-01-01", "1999-12-31", 10],
  ["indctapp", "1985-01-01", "1999-12-31", 10],
  ["nmctapp", "1985-01-01", "1999-12-31", 10],
  ["arizctapp", "1985-01-01", "1999-12-31", 8],
  ["connappct", "1985-01-01", "1999-12-31", 8],
  ["wisctapp", "1985-01-01", "1999-12-31", 8],
  ["utahctapp", "1985-01-01", "1999-12-31", 8],
];
for (const [court, gte, lte, take] of G1) {
  PLAN.push({ kind: "hist", lane: "G1", court, gte, lte, take });
}

// --- Recent district oneshots (diversity fill) ---
const DIST_RECENT = ["txsd", "njd", "paed", "mad", "flsd", "txnd", "waed", "cand", "ilnd", "dcd"];
for (const court of DIST_RECENT) {
  PLAN.push({ kind: "oneshot", lane: "DISTRICT_RECENT", court, batchSize: 5, targetMax: 10, maxCalls: 14 });
}

const acc = {
  classification: "MANUAL_QUEUE2_HEAVY_RECOVERED_QUOTA_SESSION_OPS",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  caseTarget: CASE_TARGET,
  totalCl: 0,
  totalImported: 0,
  byLane: {},
  perCourt: {},
  batches: [],
  stopReason: null,
  reliability: { "408": 0, "429": 0, timeouts: 0 },
};

if (remoteBusy()) {
  acc.stopReason = "remote_child_present";
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  process.exit(2);
}

function bumpLane(lane, imported, cl) {
  acc.byLane[lane] = acc.byLane[lane] || { imported: 0, cl: 0, batches: 0 };
  acc.byLane[lane].imported += imported;
  acc.byLane[lane].cl += cl;
  acc.byLane[lane].batches += 1;
}

function efficiencyOk(lane) {
  const L = acc.byLane[lane];
  if (!L || L.imported < 8) return true;
  return L.cl / Math.max(L.imported, 1) <= 3.5;
}

for (const step of PLAN) {
  if (acc.totalCl >= BUDGET - 5) {
    acc.stopReason = "budget_exhausted";
    break;
  }
  if (acc.totalImported >= CASE_TARGET) {
    acc.stopReason = "case_target_met";
    break;
  }
  if (remoteBusy()) {
    acc.stopReason = "remote_child_appeared";
    break;
  }

  const courtKey = CLUG[step.court] || step.court;
  const courtImported = acc.perCourt[courtKey]?.imported || 0;
  if (courtImported >= COURT_CAP) continue;
  if (!efficiencyOk(step.lane)) {
    process.stdout.write(`SKIP_INEFFICIENT ${step.lane}\n`);
    continue;
  }

  process.stdout.write(`\n=== ${step.lane} ${courtKey} ${step.gte || "recent"}..${step.lte || ""} ===\n`);

  let row;
  if (step.kind === "hist") {
    row = histWindow(step.lane, step.court, step.gte, step.lte, step.take);
  } else {
    const remain = Math.max(BUDGET - acc.totalCl, 4);
    row = oneshot(step.court, step.batchSize, step.targetMax, Math.min(step.maxCalls, remain), `heavy-${step.court}`);
  }

  acc.batches.push(row);
  acc.totalCl += row.cl || 0;
  acc.totalImported += row.imported || 0;
  bumpLane(step.lane, row.imported || 0, row.cl || 0);
  acc.perCourt[courtKey] = acc.perCourt[courtKey] || { imported: 0, cl: 0 };
  acc.perCourt[courtKey].imported += row.imported || 0;
  acc.perCourt[courtKey].cl += row.cl || 0;

  process.stdout.write(
    JSON.stringify({
      lane: step.lane,
      court: courtKey,
      imported: row.imported,
      cl: row.cl,
      status: row.status,
      totalCl: acc.totalCl,
      totalImported: acc.totalImported,
    }) + "\n",
  );
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));

  if (row.rateLimited || row.status === "429") {
    acc.reliability["429"] += 1;
    acc.stopReason = "429";
    break;
  }
  if (row.textHit408 || row.status === "HIST_QUERY_TIMEOUT") {
    acc.reliability["408"] += 1;
    // switch lane pattern — continue other courts
    continue;
  }
}

acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log(
  "HEAVY_DONE " +
    JSON.stringify({
      totalCl: acc.totalCl,
      totalImported: acc.totalImported,
      byLane: acc.byLane,
      stop: acc.stopReason,
      reliability: acc.reliability,
    }),
);
process.exit(acc.stopReason === "429" || acc.stopReason === "remote_child_present" || acc.stopReason === "remote_child_appeared" ? 1 : 0);
