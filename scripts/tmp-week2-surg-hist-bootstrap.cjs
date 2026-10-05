/**
 * Week 2 Surgical Historical Closeout — bootstrap (1 prior quota probe + live snaps).
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const MAX_BUDGET = 175;
const STATE_PASS_FLOOR = 3450;
const PRE2000_PASS_FLOOR = 900;
const PRE1980_PASS_FLOOR = 260;

function read(p) {
  const b = fs.readFileSync(p);
  if (b[0] === 0xff && b[1] === 0xfe) return b.toString("utf16le");
  if (b.includes(0) && b[1] === 0) return b.toString("utf16le");
  return b.toString("utf8");
}
function parse(p, needle) {
  const t = read(p);
  const markers = needle
    ? [needle]
    : ['{"ok":true,"classification":"QUEUE2_SESSION2_QUOTA_PROBE"', '{"ok":true,"courtListenerHttpCalls"', '{"ok":true'];
  for (const m of markers) {
    const i = t.lastIndexOf(m);
    if (i < 0) continue;
    let d = 0;
    for (let k = i; k < t.length; k++) {
      if (t[k] === "{") d++;
      else if (t[k] === "}") {
        d--;
        if (d === 0) {
          try {
            return JSON.parse(t.slice(i, k + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  // pretty JSON fallback
  const brace = t.indexOf("{");
  if (brace >= 0) {
    let d = 0;
    for (let k = brace; k < t.length; k++) {
      if (t[k] === "{") d++;
      else if (t[k] === "}") {
        d--;
        if (d === 0) {
          try {
            return JSON.parse(t.slice(brace, k + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

const q = parse(path.join(REPORTS, "week2-surg-hist-quota-raw.txt"));
const s = parse(path.join(REPORTS, "week2-surg-hist-start-raw.txt"), '{"ok":true,"courtListenerHttpCalls"');
const tr = parse(path.join(REPORTS, "week2-surg-hist-tracker-raw.txt"), '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"');
const jobs = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-surg-hist-jobs.json"), "utf8"));
if (!q || !s || !tr) {
  console.log(JSON.stringify({ ok: false, q: !!q, s: !!s, tr: !!tr }));
  process.exit(2);
}

const registry = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));
const hourRem = Number(q.limits.hour.remaining);
const dayRem = Number(q.limits.day.remaining);
const safeBudget = Math.min(Math.max(0, hourRem - HOUR_FLOOR), Math.max(0, dayRem - DAY_FLOOR), MAX_BUDGET);
const preferred = Math.min(MAX_BUDGET, safeBudget);

const states = tr.states || [];
const intermediate = states.reduce((a, x) => a + Number(x.intermediateAppellate || 0), 0);
const pre2000 = states.reduce((a, x) => a + Number(x.pre2000 || 0), 0);
const pre1980 = states.reduce((a, x) => a + Number(x.pre1980 || 0), 0);
const byJ = Object.fromEntries(states.map((x) => [x.jurisdiction, x]));
const jobByCourt = Object.fromEntries((jobs.jobs || []).map((j) => [j.cl_court, j]));

const primary = ["wash", "kyctapp", "indctapp"];
const probe = ["arizctapp", "nmctapp", "utahctapp", "wisctapp"];
const plan = [];

function addLane(clCourt, role, pre80Calls, pre2kCalls) {
  const c = registry.courts?.[clCourt];
  if (!c || c.mappingStatus !== "VALID_MAPPED") return;
  const job = jobByCourt[clCourt] || {};
  const imported = Number(job.items_imported || 0);
  const priorTarget = Number(job.target_max || 200);
  const targetMax = Math.max(priorTarget, imported + 80, 280);
  const st = byJ[c.jurisdiction] || {};
  plan.push({
    role,
    jurisdiction: c.jurisdiction,
    clCourt,
    courtLevel: c.courtLevel,
    batchSize: "8",
    targetMax: String(targetMax),
    itemsImported: imported,
    priorTargetMax: priorTarget,
    requiredTargetMax: targetMax,
    pre80Calls: String(pre80Calls),
    pre2kCalls: String(pre2kCalls),
    pre80Gte: "1900-01-01",
    pre80Lte: "1979-12-31",
    pre2kGte: "1980-01-01",
    pre2kLte: "1999-12-31",
    tag: `w2surg-${clCourt}`,
    deficit: Number(st.deficit || 0),
    pre2000: Number(st.pre2000 || 0),
    pre1980: Number(st.pre1980 || 0),
    saturationDiagnosis:
      imported >= priorTarget
        ? "TARGETMAX_SPECIFIC"
        : "WINDOW_OR_SOURCE_LIKELY",
  });
}

for (const id of primary) addLane(id, "PRIMARY", 25, 20);
for (const id of probe) addLane(id, "PROBE_RECOVER", 15, 0);

const boot = {
  ok: true,
  classification: "WEEK2_SURGICAL_HISTORICAL_CLOSEOUT_BOOTSTRAP",
  generatedAt: new Date().toISOString(),
  membership: q.membership,
  limits: q.limits,
  hourFloor: HOUR_FLOOR,
  dayFloor: DAY_FLOOR,
  safeBudget,
  preferred,
  thresholds: {
    STATE_PASS_FLOOR,
    PRE2000_PASS_FLOOR,
    PRE1980_PASS_FLOOR,
    sufficientlyCloseCases: 4650,
  },
  start: {
    cases: s.corpus.cases,
    extracted: s.extracted,
    resolved: s.resolvedAfter,
    unresolved: s.targetAbsent,
    parserGap: s.parserGap,
    stateDc: tr.progress.stateDcCurrent,
    federal: tr.progress.federalCurrent,
    intermediate,
    pre2000,
    pre1980,
    duplicates: s.duplicateSourceIds,
    orphans: s.orphans,
    missingEmbeddings: s.chunks?.missing_embeddings,
  },
  gaps: {
    state: Math.max(0, STATE_PASS_FLOOR - Number(tr.progress.stateDcCurrent)),
    pre2000: Math.max(0, PRE2000_PASS_FLOOR - pre2000),
    pre1980: Math.max(0, PRE1980_PASS_FLOOR - pre1980),
    to4650: Math.max(0, 4650 - Number(s.corpus.cases)),
    to4700: Math.max(0, 4700 - Number(s.corpus.cases)),
  },
  jobs: jobs.jobs,
  courtListenerHttpCalls: 1,
  safety: {
    queue2Worker: "STOPPED",
    competingCl: "NONE_OBSERVED",
    laneAChild: null,
    queues: {
      "#2": "OPEN",
      "#3_program": "OPEN",
      "#3_worker": "NOT_OPEN",
      "#4_program": "OPEN",
      "#4_worker": "NOT_OPEN",
      "#5": "NOT_OPEN",
      "#9": "CLOSED",
    },
  },
};

const preflight = {
  classification: "WEEK2_SURGICAL_HISTORICAL_CLOSEOUT_PREFLIGHT",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
  laneAPlan: plan,
  targetMaxSummary: {
    lanesExpanded: plan.map((p) => ({
      clCourt: p.clCourt,
      itemsImported: p.itemsImported,
      priorTargetMax: p.priorTargetMax,
      newTargetMax: p.requiredTargetMax,
      saturationDiagnosis: p.saturationDiagnosis,
    })),
    clWastedDueCap: 0,
  },
  earlyStopCl: 50,
  secondStopCl: 100,
  thirdStopCl: 150,
  laneB: 0,
};

fs.writeFileSync(path.join(REPORTS, "week2-surg-hist-quota.json"), JSON.stringify(boot, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-surg-hist-start.json"), JSON.stringify({ ok: true, ...boot.start }, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-surg-hist-tracker.json"), JSON.stringify(tr, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-surg-hist-preflight.json"), JSON.stringify(preflight, null, 2));
fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tr, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      safeBudget,
      preferred,
      start: boot.start,
      gaps: boot.gaps,
      lanes: plan.map(
        (p) =>
          `${p.clCourt}[${p.role}] imported=${p.itemsImported} targetMax ${p.priorTargetMax}->${p.requiredTargetMax} pre80=${p.pre1980} pre2k=${p.pre2000}`,
      ),
    },
    null,
    2,
  ),
);
process.exit(safeBudget < 50 ? 3 : 0);
