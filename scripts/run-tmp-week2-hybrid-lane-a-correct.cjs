/**
 * Week2 hybrid Lane A corrective: ONLY CL_COURT_MAP-mapped courts.
 * Prefer intermediate gap states (vacapp/njsuperct/nebrctapp) + proven app courts
 * + underfilled high courts for top tracker deficits.
 * Cap +50 CL. Micro-pilot then scale. Zero LLM.
 *
 * Usage: node scripts/run-tmp-week2-hybrid-lane-a-correct.cjs [budget]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const OUT = path.join(REPORTS, "week2-hybrid-closeout-lane-a-correct.json");
const BUDGET = Math.min(Math.max(Number(process.argv[2] || 50), 10), 50);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 2500);

// Mapped courts only (staging-cl-batch-job CL_COURT_MAP). No michctapp/lactapp/etc.
const PLAN = [
  { jurisdiction: "VA", clCourt: "vacapp", batchSize: "4", targetMax: "16", maxCalls: "10", tag: "w2hc2-vacapp", lane: "G1" },
  { jurisdiction: "NJ", clCourt: "njsuperct", batchSize: "4", targetMax: "16", maxCalls: "10", tag: "w2hc2-njsuperct", lane: "G1" },
  { jurisdiction: "NE", clCourt: "nebrctapp", batchSize: "4", targetMax: "16", maxCalls: "8", tag: "w2hc2-nebrctapp", lane: "G1" },
  { jurisdiction: "WI", clCourt: "wisctapp", batchSize: "4", targetMax: "16", maxCalls: "8", tag: "w2hc2-wisctapp", lane: "G1" },
  { jurisdiction: "UT", clCourt: "utahctapp", batchSize: "4", targetMax: "16", maxCalls: "8", tag: "w2hc2-utahctapp", lane: "G1" },
  { jurisdiction: "MI", clCourt: "mich", batchSize: "4", targetMax: "20", maxCalls: "8", tag: "w2hc2-mich", lane: "G2" },
  { jurisdiction: "LA", clCourt: "la", batchSize: "4", targetMax: "20", maxCalls: "8", tag: "w2hc2-la", lane: "G2" },
  { jurisdiction: "WA", clCourt: "wash", batchSize: "4", targetMax: "20", maxCalls: "8", tag: "w2hc2-wash", lane: "G2" },
  { jurisdiction: "MD", clCourt: "md", batchSize: "4", targetMax: "20", maxCalls: "8", tag: "w2hc2-md", lane: "G2" },
  { jurisdiction: "NV", clCourt: "nev", batchSize: "4", targetMax: "20", maxCalls: "8", tag: "w2hc2-nev", lane: "G2" },
];

function lastJson(text) {
  const t = String(text || "");
  const lines = t.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* */ }
  }
  // Prefer result objects with items_imported
  const idx = t.lastIndexOf('"items_imported"');
  if (idx > 0) {
    const start = t.lastIndexOf("{", idx);
    if (start >= 0) {
      let d = 0;
      for (let k = start; k < t.length; k++) {
        if (t[k] === "{") d++;
        else if (t[k] === "}") {
          d--;
          if (d === 0) {
            try { return JSON.parse(t.slice(start, k + 1)); } catch { break; }
          }
        }
      }
    }
  }
  return null;
}

function oneshot(step, maxCalls) {
  const r = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/run-tmp-manual-cl-oneshot.cjs"),
      step.clCourt,
      step.batchSize,
      step.targetMax,
      String(maxCalls),
      step.tag,
    ],
    {
      encoding: "utf8",
      maxBuffer: 40e6,
      cwd: ROOT,
      env: {
        ...process.env,
        CL_RATE_MS: String(Math.min(CL_RATE_MS, 2500)),
        CL_FLY_EXEC_TIMEOUT_SEC: "540",
        CL_ORPHAN_WAIT_MS: "300000",
        FEATURE_AGENTS: "0",
      },
    },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  return { status: r.status ?? 1, text, json: lastJson(text) };
}

function metrics(j, text) {
  const cl =
    Number(
      j?.sessionApiCalls ??
        j?.apiCallsDelta ??
        j?.apiCalls ??
        j?.courtListenerHttpCalls ??
        j?.sessionCalls ??
        j?.clCalls ??
        j?.requests ??
        0,
    ) ||
    Number((text.match(/"sessionApiCalls"\s*:\s*(\d+)/) || [])[1] || 0) ||
    Number((text.match(/courtListenerHttpCalls["']?\s*[:=]\s*(\d+)/) || [])[1] || 0);
  const cases =
    Number(
      j?.items_imported ??
        j?.itemsImported ??
        j?.imported ??
        j?.newCases ??
        j?.casesAdded ??
        j?.usefulCases ??
        0,
    ) ||
    Number((text.match(/"items_imported"\s*:\s*(\d+)/) || [])[1] || 0) ||
    Number((text.match(/itemsImported["']?\s*[:=]\s*(\d+)/) || [])[1] || 0);
  const unmapped = /unmapped_court/i.test(text) || String(j?.reason || "").includes("unmapped_court");
  const rateLimited =
    Boolean(j?.rateLimited) ||
    Number(j?.rateLimitCount || 0) > 0 ||
    /HTTP\s*429|"status"\s*:\s*429|Retry-After|RATE_LIMITED/i.test(text);
  const timedOut = /HIST_QUERY_TIMEOUT|LANE_A_CHILD_SURVIVED_PARENT|request returned non-2xx status: 408/i.test(text) && cases === 0;
  const empty =
    cases === 0 &&
    (unmapped ||
      /EMPTY|zero.?results|no.?results/i.test(text) ||
      Number(j?.items_discovered || 0) === 0 ||
      timedOut);
  return { cl, cases, rateLimited, empty, unmapped, timedOut, status: j?.status || j?.jobStatus || null };
}

const acc = {
  classification: "WEEK2_HYBRID_LANE_A_CORRECTIVE",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  batches: [],
  quarantined: [],
  productive: [],
  cl: 0,
  casesAdded: 0,
  stopReason: null,
  notes: [
    "Prior Lane A used unmapped intermediate IDs (michctapp/lactapp/mdctapp/nevctapp/tennctapp).",
    "Corrective uses only verified CL_COURT_MAP courts.",
  ],
};

process.stdout.write(`LANE_A_CORRECT_START budget=${BUDGET}\n`);

for (const step of PLAN) {
  if (acc.cl >= BUDGET) {
    acc.stopReason = "budget_exhausted";
    break;
  }
  const rem = BUDGET - acc.cl;
  const pilotCalls = Math.min(5, rem, Number(step.maxCalls));
  if (pilotCalls < 3) break;

  process.stdout.write(`\n=== PILOT ${step.tag} court=${step.clCourt} maxCalls=${pilotCalls} ===\n`);
  let r = oneshot(step, pilotCalls);
  let m = metrics(r.json, r.text);
  // If fly 408 with zero metrics, do not invent CL burn; record timedOut
  if (m.cl === 0 && m.timedOut) m.cl = 0;
  else if (m.cl === 0 && m.cases === 0 && !m.unmapped && r.status !== 0) m.cl = 0;

  acc.cl += m.cl;
  acc.casesAdded += m.cases;
  acc.batches.push({
    ...step,
    phase: "pilot",
    cl: m.cl,
    casesAdded: m.cases,
    empty: m.empty,
    rateLimited: m.rateLimited,
    unmapped: m.unmapped,
    timedOut: m.timedOut,
    status: m.status,
  });
  process.stdout.write(
    JSON.stringify({
      lane: "A_correct",
      tag: step.tag,
      phase: "pilot",
      cl: m.cl,
      casesAdded: m.cases,
      timedOut: m.timedOut,
      unmapped: m.unmapped,
      totalCl: acc.cl,
    }) + "\n",
  );

  if (m.rateLimited) {
    acc.stopReason = "rate_limited";
    acc.quarantined.push({ path: step.tag, reason: "429_or_rate_limit", cl: m.cl });
    break;
  }
  if (m.unmapped) {
    acc.quarantined.push({ path: step.tag, reason: "unmapped_court", cl: m.cl });
    continue;
  }
  if (m.timedOut && m.cases === 0) {
    acc.quarantined.push({ path: step.tag, reason: "fly_408_or_orphan_timeout", cl: m.cl });
    // Continue to next court; do not burn more on same path this run
    continue;
  }
  if (m.cases === 0 || m.empty) {
    acc.quarantined.push({ path: step.tag, reason: "empty_or_zero_cases", cl: m.cl });
    continue;
  }

  const scaleRem = Math.min(Number(step.maxCalls) - m.cl, BUDGET - acc.cl);
  if (scaleRem >= 3) {
    process.stdout.write(`\n=== SCALE ${step.tag} court=${step.clCourt} maxCalls=${scaleRem} ===\n`);
    r = oneshot({ ...step, tag: `${step.tag}-s` }, scaleRem);
    m = metrics(r.json, r.text);
    acc.cl += m.cl;
    acc.casesAdded += m.cases;
    acc.batches.push({
      ...step,
      phase: "scale",
      cl: m.cl,
      casesAdded: m.cases,
      empty: m.empty,
      rateLimited: m.rateLimited,
      unmapped: m.unmapped,
      timedOut: m.timedOut,
      status: m.status,
    });
    process.stdout.write(
      JSON.stringify({
        lane: "A_correct",
        tag: step.tag,
        phase: "scale",
        cl: m.cl,
        casesAdded: m.cases,
        totalCl: acc.cl,
      }) + "\n",
    );
    if (m.rateLimited) {
      acc.stopReason = "rate_limited";
      break;
    }
  }
  const rows = acc.batches.filter((b) => b.tag === step.tag || String(b.tag).startsWith(step.tag));
  acc.productive.push({
    path: step.tag,
    jurisdiction: step.jurisdiction,
    clCourt: step.clCourt,
    cl: rows.reduce((n, b) => n + b.cl, 0),
    cases: rows.reduce((n, b) => n + b.casesAdded, 0),
  });
}

if (!acc.stopReason) acc.stopReason = acc.cl >= BUDGET ? "budget_exhausted" : "plan_exhausted";
acc.finishedAt = new Date().toISOString();
acc.clPerCase = acc.casesAdded > 0 ? Number((acc.cl / acc.casesAdded).toFixed(3)) : null;
fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
process.stdout.write(
  `LANE_A_CORRECT_DONE ${JSON.stringify({
    cl: acc.cl,
    cases: acc.casesAdded,
    clPerCase: acc.clPerCase,
    stop: acc.stopReason,
    productive: acc.productive.length,
    quarantined: acc.quarantined.length,
  })}\n`,
);
process.exit(0);
