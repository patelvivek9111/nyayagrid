"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");

function read(p) {
  const b = fs.readFileSync(p);
  if (b[0] === 0xff && b[1] === 0xfe) return b.toString("utf16le");
  if (b.includes(0) && b[1] === 0) return b.toString("utf16le");
  return b.toString("utf8");
}
function parse(p, needle) {
  const t = read(p);
  const i = needle ? t.lastIndexOf(needle) : t.lastIndexOf('{"ok":true');
  if (i < 0) return null;
  let d = 0;
  for (let k = i; k < t.length; k++) {
    if (t[k] === "{") d++;
    else if (t[k] === "}") {
      d--;
      if (d === 0) return JSON.parse(t.slice(i, k + 1));
    }
  }
  return null;
}

// --- Zero-CL mapping expansion from authoritative local registry ---
const localReg = require(path.join(ROOT, "scripts/cl-court-map-registry.cjs"));
const wave2o = JSON.parse(fs.readFileSync(path.join(REPORTS, "wave2o-intermediate-appellate-prep.json"), "utf8"));
const run2Imports = {};
for (const f of [
  "week2-hybrid-closeout-lane-a-reopen.json",
  "week2-hybrid-closeout-run2-ops.json",
  "week2-hybrid-closeout-run2-extension.json",
]) {
  const p = path.join(REPORTS, f);
  if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const b of j.batches || j.laneA?.batches || []) {
    if (!b.clCourt) continue;
    // NEVER use casesAfter (corpus total). Prefer job items_imported / reportedImported.
    const imported = Number(b.reportedImported ?? b.items_imported ?? b.itemsImported ?? NaN);
    if (Number.isFinite(imported) && imported >= 0) {
      run2Imports[b.clCourt] = Math.max(run2Imports[b.clCourt] || 0, imported);
    }
  }
}

// Also promote courts verified in staging-cl-batch-job COURT_VERIFY_CACHE that are VERIFIED
const batchTs = fs.readFileSync(path.join(ROOT, "scripts/staging-cl-batch-job.ts"), "utf8");
const verifiedInBatch = new Set();
{
  const re = /\n  ([a-z0-9]+): \{\s*(?:\n\s*)?status: "VERIFIED"/g;
  let m;
  while ((m = re.exec(batchTs))) verifiedInBatch.add(m[1]);
}
// kyctapp is VERIFIED in batch job but may be missing from cl-court-map-registry
const extraVerified = {
  kyctapp: {
    clCourtId: "kyctapp",
    nyayaCourtId: "st-ky-app",
    courtName: "Kentucky Court of Appeals",
    jurisdiction: "KY",
    courtLevel: "state_appellate",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-29T20:16:00.000Z",
    evidence: "staging-cl-batch-job COURT_VERIFY_CACHE + week2 hybrid run2 productive ingest",
  },
};

const courts = {};
const list = Object.values(localReg.REGISTRY || {})
  .filter((x) => x && x.clCourtId)
  .filter((x) => x.clCourtId !== "kyctapp");
list.push(extraVerified.kyctapp);

let unknownBefore = 0;
let valid = 0;
let invalid = 0;
let newlyValidated = [];

for (const e of list) {
  const status =
    e.verificationStatus === "VERIFIED" || verifiedInBatch.has(e.clCourtId)
      ? "VALID_MAPPED"
      : e.verificationStatus === "MAPPING_INVALID"
        ? "INVALID_MAPPING"
        : "UNKNOWN_MAPPING";
  if (status === "UNKNOWN_MAPPING") unknownBefore++;
  if (status === "VALID_MAPPED") valid++;
  if (status === "INVALID_MAPPING") invalid++;
  courts[e.clCourtId] = {
    clCourtId: e.clCourtId,
    nyayaCourtId: e.nyayaCourtId || null,
    courtLevel: e.courtLevel || null,
    jurisdiction: e.jurisdiction || null,
    courtName: e.courtName || null,
    verificationStatus: e.verificationStatus || null,
    mappingStatus: status,
    mappingReason:
      status === "VALID_MAPPED"
        ? e.evidence || "local_registry_VERIFIED"
        : status === "INVALID_MAPPING"
          ? e.evidence || "MAPPING_INVALID"
          : e.evidence || "unproven_locally",
    lastVerified: e.verifiedAt || null,
    priorItemsImported:
      run2Imports[e.clCourtId] != null
        ? run2Imports[e.clCourtId]
        : Number.isFinite(Number(e.count))
          ? Number(e.count)
          : null,
    ingestEnabled: Boolean(e.ingestEnabled),
    notes: e.nextAction || null,
  };
}

// Document intermediate gaps from wave2o (no CL)
const intermediateGapNotes = [];
for (const row of wave2o.intermediateAppellate || []) {
  const j = row.jurisdiction || row.j;
  const exists = row.structureExists;
  const clId = row.clCourtId || row.candidateClId || row.clId || null;
  if (!exists) {
    intermediateGapNotes.push({
      jurisdiction: j,
      status: "NO_STRUCTURE",
      note: "wave2o structureExists:false",
    });
    continue;
  }
  if (clId && courts[clId]?.mappingStatus === "VALID_MAPPED") continue;
  if (clId && courts[clId]?.mappingStatus === "INVALID_MAPPING") {
    intermediateGapNotes.push({ jurisdiction: j, clCourtId: clId, status: "INVALID", note: "mapped invalid" });
    continue;
  }
  intermediateGapNotes.push({
    jurisdiction: j,
    clCourtId: clId,
    status: clId ? "UNKNOWN" : "UNKNOWN_NO_ID",
    note: "structure exists but no locally proven VALID CL id",
  });
}

// kyctapp newly added if not previously VALID in old registry
const prevPath = path.join(REPORTS, "queue2-court-mapping-registry.json");
const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, "utf8")) : { courts: {} };
if (prev.courts?.kyctapp?.mappingStatus !== "VALID_MAPPED" && courts.kyctapp?.mappingStatus === "VALID_MAPPED") {
  newlyValidated.push({
    court: "kyctapp",
    jurisdiction: "KY",
    evidence: courts.kyctapp.mappingReason,
    trackerDeficit: null,
  });
}
// Promote any court that was UNKNOWN before but VERIFIED in local registry now
for (const [id, c] of Object.entries(courts)) {
  const was = prev.courts?.[id]?.mappingStatus;
  if (c.mappingStatus === "VALID_MAPPED" && was && was !== "VALID_MAPPED") {
    if (!newlyValidated.some((x) => x.court === id)) {
      newlyValidated.push({
        court: id,
        jurisdiction: c.jurisdiction,
        evidence: c.mappingReason,
        courtLevel: c.courtLevel,
      });
    }
  }
}

const registry = {
  classification: "QUEUE2_COURT_MAPPING_REGISTRY",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
  source: [
    "scripts/cl-court-map-registry.cjs",
    "scripts/staging-cl-batch-job.ts COURT_VERIFY_CACHE",
    "packages/research/corpus/reports/wave2o-intermediate-appellate-prep.json",
    "week2 hybrid run2 productive imports",
  ],
  summary: {
    total: Object.keys(courts).length,
    VALID_MAPPED: valid,
    INVALID_MAPPING: invalid,
    UNKNOWN_MAPPING: Object.values(courts).filter((c) => c.mappingStatus === "UNKNOWN_MAPPING").length,
    newlyValidated: newlyValidated.length,
    clSpentOnMapping: 0,
  },
  newlyValidated,
  intermediateGapNotes,
  courts,
};
fs.writeFileSync(prevPath, JSON.stringify(registry, null, 2));

// --- Bootstrap quota/start ---
const q = parse(path.join(REPORTS, "week2-hybrid-closeout-run3-quota-raw.txt"));
const s = parse(path.join(REPORTS, "week2-hybrid-closeout-run3-start-raw.txt"));
const tr = parse(
  path.join(REPORTS, "week2-hybrid-closeout-run3-tracker-raw.txt"),
  '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"',
);
if (!q || !s || !tr) {
  console.log(JSON.stringify({ ok: false, q: !!q, s: !!s, tr: !!tr }));
  process.exit(2);
}

const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const hourRem = Number(q.limits.hour.remaining);
const dayRem = Number(q.limits.day.remaining);
const minLim = Number(q.limits.minute.limit);
const preferred = 120;
const safe = Math.min(preferred, Math.max(0, hourRem - HOUR_FLOOR), Math.max(0, dayRem - DAY_FLOOR));
const live12 = Math.ceil(s.extracted * 0.125);

const boot = {
  ok: true,
  classification: "WEEK2_HYBRID_CLOSEOUT_RUN3_BOOTSTRAP",
  generatedAt: new Date().toISOString(),
  membership: q.membership,
  limits: q.limits,
  hourFloor: HOUR_FLOOR,
  dayFloor: DAY_FLOOR,
  preferred,
  safeBudget: safe,
  pacingMs: minLim <= 15 ? 5000 : 4000,
  laneAShare: 0.7,
  laneBShare: 0.3,
  start: {
    cases: s.corpus.cases,
    extracted: s.extracted,
    resolved: s.resolvedAfter,
    unresolved: s.targetAbsent,
    stateDc: tr.progress.stateDcCurrent,
    federal: tr.progress.federalCurrent,
    resolutionPct: Number(((s.resolvedAfter / s.extracted) * 100).toFixed(2)),
    live12_5Target: live12,
    liveGap12_5: Math.max(0, live12 - s.resolvedAfter),
    week2Gap: Math.max(0, 4700 - s.corpus.cases),
    duplicates: s.duplicateSourceIds,
    orphans: s.orphans,
    missingEmbeddings: s.chunks?.missing_embeddings,
  },
  mapping: registry.summary,
  newlyValidated,
  courtListenerHttpCalls: 1,
};
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-quota.json"), JSON.stringify(boot, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-start.json"), JSON.stringify({ ok: true, ...boot.start }, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-tracker.json"), JSON.stringify(tr, null, 2));
fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tr, null, 2));

// Lane A plan: productive first, then VALID intermediate, then high courts for top deficits
const productive = ["wisctapp", "utahctapp", "indctapp", "kyctapp", "la", "wash", "md", "mich"];
const byJ = Object.fromEntries((tr.states || []).map((x) => [x.jurisdiction, x]));
const plan = [];
function addCourt(clCourt, micro = 10, scale = 16) {
  const c = courts[clCourt];
  if (!c || c.mappingStatus !== "VALID_MAPPED") return;
  if (plan.some((p) => p.clCourt === clCourt)) return;
  const st = byJ[c.jurisdiction] || {};
  const importedEst =
    c.priorItemsImported == null || !Number.isFinite(Number(c.priorItemsImported))
      ? 40
      : Math.min(Number(c.priorItemsImported), 140);
  // Raise targetMax well above estimated items_imported so jobs are not already_completed
  const targetMax = Math.min(220, Math.max(importedEst + 80, 160));
  plan.push({
    jurisdiction: c.jurisdiction,
    clCourt,
    courtLevel: c.courtLevel,
    batchSize: "6",
    targetMax: String(targetMax),
    microCalls: String(micro),
    scaleCalls: String(scale),
    tag: `w2r3-${clCourt}`,
    deficit: st.deficit || 0,
    intermediateLayerGap: Boolean(st.intermediateLayerGap),
    itemsImportedEstimate: importedEst,
    remainingCapacity: Math.max(0, targetMax - importedEst),
  });
}
for (const id of productive) addCourt(id, 10, 18);
// Additional VALID intermediates with tracker deficits
for (const id of ["arizctapp", "nmctapp", "connappct", "calctapp", "pasuperct", "illappct", "massappct", "fladistctapp", "nyappdiv", "texapp"]) {
  addCourt(id, 8, 14);
}
// Top deficit high courts still VALID
for (const st of (tr.topUnderrepresented || []).slice(0, 12)) {
  const highs = {
    MI: "mich",
    NV: "nev",
    NJ: "nj",
    NE: "neb",
    NC: "nc",
    TN: "tenn",
    VA: "va",
    AK: "alaska",
    ID: "idaho",
    OR: "or",
    LA: "la",
    WA: "wash",
    MD: "md",
  };
  const id = highs[st.jurisdiction];
  if (id) addCourt(id, 10, 16);
}

const preflight = {
  classification: "WEEK2_HYBRID_CLOSEOUT_RUN3_PREFLIGHT",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
  mappingSummary: {
    ...registry.summary,
    unknownBefore: prev.summary?.UNKNOWN_MAPPING ?? unknownBefore,
    newVALID_MAPPED: newlyValidated.length,
    remainingUNKNOWN: registry.summary.UNKNOWN_MAPPING,
    INVALID: registry.summary.INVALID_MAPPING,
    clSpent: 0,
  },
  targetMaxSummary: {
    cappedBefore: plan.filter((p) => p.remainingCapacity <= 0).length,
    fixed: plan.filter((p) => p.remainingCapacity > 0).length,
    clWasted: 0,
  },
  laneAPlan: plan.filter((p) => p.remainingCapacity > 0).slice(0, 12),
  intermediateGaps: intermediateGapNotes,
  newlyValidated,
};
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-preflight.json"), JSON.stringify(preflight, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      safe,
      tier: q.membership?.level,
      minute: q.limits.minute,
      hour: q.limits.hour,
      day: { limit: q.limits.day.limit, remaining: dayRem },
      start: boot.start,
      mapping: preflight.mappingSummary,
      newlyValidated,
      laneAPlan: preflight.laneAPlan.map((p) => `${p.clCourt}@${p.targetMax}(micro${p.microCalls}+scale${p.scaleCalls})`),
    },
    null,
    2,
  ),
);
process.exit(safe < 20 ? 3 : 0);
