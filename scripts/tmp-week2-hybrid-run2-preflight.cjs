/**
 * Week2 Hybrid Closeout Run 2 — LOCAL court-mapping + targetMax preflight.
 * Zero CL. Zero LLM.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const BATCH_TS = path.join(ROOT, "scripts/staging-cl-batch-job.ts");
const VERIFY_JSON = path.join(REPORTS, "cl-court-verification-cache.json");
const REOPEN = path.join(REPORTS, "week2-hybrid-closeout-lane-a-reopen.json");
const TRACKER = path.join(REPORTS, "week2-hybrid-closeout-tracker.json");

function extractCourtMap(ts) {
  const start = ts.indexOf("const CL_COURT_MAP");
  const end = ts.indexOf("\n/**\n * Offline-persisted", start);
  const chunk = ts.slice(start, end > start ? end : start + 20000);
  const entries = {};
  const re = /\n  ([a-z0-9]+): \{ courtId: "([^"]+)", courtLevel: "([^"]+)", authorityState: "([^"]+)", courtName: "([^"]+)"/g;
  let m;
  while ((m = re.exec(chunk))) {
    entries[m[1]] = {
      clCourtId: m[1],
      nyayaCourtId: m[2],
      courtLevel: m[3],
      jurisdiction: m[4],
      courtName: m[5],
    };
  }
  return entries;
}

function extractVerifyCache(ts) {
  const start = ts.indexOf("const COURT_VERIFY_CACHE");
  const end = ts.indexOf("\nfunction ", start);
  const chunk = ts.slice(start, end > start ? end : start + 40000);
  const out = {};
  const re =
    /\n  ([a-z0-9]+): \{\s*(?:\n\s*)?status: "(VERIFIED|MAPPING_INVALID|NEEDS_SINGLE_VERIFICATION|TRANSIENT_RETRY)"/g;
  let m;
  while ((m = re.exec(chunk))) {
    out[m[1]] = m[2];
  }
  return out;
}

const ts = fs.readFileSync(BATCH_TS, "utf8");
const courtMap = extractCourtMap(ts);
const verifyTs = extractVerifyCache(ts);
const verifyJson = JSON.parse(fs.readFileSync(VERIFY_JSON, "utf8"));
const reopen = fs.existsSync(REOPEN) ? JSON.parse(fs.readFileSync(REOPEN, "utf8")) : null;
const tracker = fs.existsSync(TRACKER)
  ? JSON.parse(fs.readFileSync(TRACKER, "utf8"))
  : JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), "utf8"));

// Prior-run imported counts (from reopen) to size targetMax
const priorImported = {};
for (const b of reopen?.batches || []) {
  priorImported[b.clCourt] = Math.max(priorImported[b.clCourt] || 0, Number(b.reportedImported || 0));
}

// Known invalid from prior hybrid + cache
const knownInvalid = new Set([
  "vacapp",
  "njsuperct",
  "pacommwlth",
  "nebrctapp", // prior run: MAPPING_INVALID at runtime
  "michctapp",
  "lactapp",
  "mdctapp",
  "nevctapp",
  "tennctapp",
  "iowactapp",
]);

function classify(clCourtId) {
  if (knownInvalid.has(clCourtId)) {
    return {
      status: "INVALID_MAPPING",
      reason: "prior_runtime_or_cache_invalid",
    };
  }
  const v =
    verifyTs[clCourtId] ||
    verifyJson.entries?.[clCourtId]?.status ||
    null;
  if (v === "MAPPING_INVALID") {
    return { status: "INVALID_MAPPING", reason: "COURT_VERIFY_CACHE" };
  }
  if (!courtMap[clCourtId]) {
    return { status: "UNKNOWN_MAPPING", reason: "absent_from_CL_COURT_MAP" };
  }
  if (v === "VERIFIED") {
    return { status: "VALID_MAPPED", reason: "VERIFIED_CACHE" };
  }
  // In map but never verified — do not spend CL
  return { status: "UNKNOWN_MAPPING", reason: "in_map_but_not_verified" };
}

const registry = {
  classification: "QUEUE2_COURT_MAPPING_REGISTRY",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
  source: [
    "scripts/staging-cl-batch-job.ts CL_COURT_MAP",
    "scripts/staging-cl-batch-job.ts COURT_VERIFY_CACHE",
    "packages/research/corpus/reports/cl-court-verification-cache.json",
    "week2-hybrid-closeout-lane-a-reopen.json prior imports",
  ],
  courts: {},
};

for (const [id, meta] of Object.entries(courtMap)) {
  const c = classify(id);
  registry.courts[id] = {
    ...meta,
    verificationStatus: verifyTs[id] || verifyJson.entries?.[id]?.status || null,
    mappingStatus: c.status,
    mappingReason: c.reason,
    lastVerified: verifyJson.entries?.[id]?.verifiedAt || null,
    priorItemsImported: priorImported[id] || null,
    notes: c.status === "VALID_MAPPED" ? "eligible_for_laneA" : "blocked_from_cl",
  };
}

// Also record known invalids not in map
for (const id of knownInvalid) {
  if (!registry.courts[id]) {
    const c = classify(id);
    registry.courts[id] = {
      clCourtId: id,
      nyayaCourtId: null,
      courtLevel: null,
      jurisdiction: null,
      courtName: null,
      verificationStatus: verifyJson.entries?.[id]?.status || null,
      mappingStatus: c.status,
      mappingReason: c.reason,
      lastVerified: null,
      priorItemsImported: null,
      notes: "not_in_CL_COURT_MAP_or_known_bad",
    };
  }
}

fs.writeFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), JSON.stringify(registry, null, 2));

// Rank tracker deficits → candidate courts (VALID_MAPPED only)
const jToCl = {
  WI: ["wisctapp", "wis"],
  UT: ["utahctapp", "utah"],
  IN: ["indctapp", "ind"],
  KY: ["kyctapp", "ky"],
  MI: ["mich"], // no VALID intermediate
  LA: ["la"],
  WA: ["wash"],
  MD: ["md"],
  NV: ["nev"],
  TN: ["tenn"],
  IA: ["iowa"],
  AZ: ["arizctapp", "ariz"],
  NM: ["nmctapp", "nm"],
  NE: ["neb"], // nebrctapp INVALID
  NJ: ["nj"], // njsuperct INVALID
  VA: ["va"], // vacapp INVALID
  NC: ["nc"],
  OR: ["or"],
  ID: ["idaho"],
  AK: ["alaska"],
  HI: ["haw"],
  AL: ["ala"],
  OH: ["ohio"],
  KS: ["kan"],
  CT: ["connappct", "conn"],
  ME: ["me"],
  SD: ["sd"],
  ND: ["nd"],
  MT: ["mont"],
  WY: ["wyo"],
  VT: ["vt"],
  NH: ["nh"],
  RI: ["ri"],
};

const states = tracker.states || tracker.topUnderrepresented || [];
const ranked = [...states].sort((a, b) => {
  const ai = a.intermediateLayerGap ? 1 : 0;
  const bi = b.intermediateLayerGap ? 1 : 0;
  if (bi !== ai) return bi - ai;
  return (b.deficit || 0) - (a.deficit || 0);
});

const candidates = [];
const preflightRows = [];
for (const st of ranked.slice(0, 25)) {
  const ids = jToCl[st.jurisdiction] || [];
  for (const clCourt of ids) {
    const c = classify(clCourt);
    const meta = courtMap[clCourt] || registry.courts[clCourt];
    const imported = Number(priorImported[clCourt] || 0);
    // Deterministic targetMax: max(imported+40, 120) capped 180
    const targetMax = Math.min(180, Math.max(imported + 40, 120));
    const row = {
      jurisdiction: st.jurisdiction,
      deficit: st.deficit,
      intermediateLayerGap: Boolean(st.intermediateLayerGap),
      intermediateAppellate: st.intermediateAppellate,
      clCourt,
      courtLevel: meta?.courtLevel || null,
      mappingStatus: c.status,
      mappingReason: c.reason,
      itemsImportedEstimate: imported,
      targetMax,
      remainingCapacity: Math.max(0, targetMax - imported),
      eligible: c.status === "VALID_MAPPED" && targetMax > imported,
    };
    preflightRows.push(row);
    if (row.eligible) candidates.push(row);
  }
}

// Prefer previously productive VALID intermediate, then other intermediate, then high courts for gap states
const productiveFirst = ["wisctapp", "utahctapp", "indctapp", "kyctapp", "arizctapp", "nmctapp"];
candidates.sort((a, b) => {
  const ap = productiveFirst.indexOf(a.clCourt);
  const bp = productiveFirst.indexOf(b.clCourt);
  if (ap !== -1 || bp !== -1) {
    if (ap === -1) return 1;
    if (bp === -1) return -1;
    return ap - bp;
  }
  const al = a.courtLevel === "state_appellate" ? 0 : 1;
  const bl = b.courtLevel === "state_appellate" ? 0 : 1;
  if (al !== bl) return al - bl;
  if (b.intermediateLayerGap !== a.intermediateLayerGap) {
    return (b.intermediateLayerGap ? 1 : 0) - (a.intermediateLayerGap ? 1 : 0);
  }
  return b.deficit - a.deficit;
});

// Ensure productive intermediate are in plan even if jurisdiction not in top-25 ranked list
for (const clCourt of productiveFirst) {
  if (candidates.some((c) => c.clCourt === clCourt)) continue;
  const c = classify(clCourt);
  const meta = courtMap[clCourt];
  if (c.status !== "VALID_MAPPED" || !meta) continue;
  const imported = Number(priorImported[clCourt] || 0);
  const targetMax = Math.min(180, Math.max(imported + 40, 120));
  candidates.unshift({
    jurisdiction: meta.jurisdiction,
    deficit: (states.find((s) => s.jurisdiction === meta.jurisdiction) || {}).deficit || 0,
    intermediateLayerGap: false,
    intermediateAppellate: null,
    clCourt,
    courtLevel: meta.courtLevel,
    mappingStatus: c.status,
    mappingReason: c.reason,
    itemsImportedEstimate: imported,
    targetMax,
    remainingCapacity: Math.max(0, targetMax - imported),
    eligible: true,
  });
}

const laneASelected = [];
const seenCourts = new Set();
const byCourt = Object.fromEntries(candidates.map((c) => [c.clCourt, c]));
for (const clCourt of productiveFirst) {
  const c = byCourt[clCourt];
  if (!c || seenCourts.has(clCourt)) continue;
  seenCourts.add(clCourt);
  laneASelected.push(c);
}
for (const c of candidates) {
  if (seenCourts.has(c.clCourt)) continue;
  seenCourts.add(c.clCourt);
  laneASelected.push(c);
  if (laneASelected.length >= 10) break;
}

const plan = {
  classification: "WEEK2_HYBRID_CLOSEOUT_RUN2_PREFLIGHT",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
  mappingSummary: {
    candidateCourts: preflightRows.length,
    VALID_MAPPED: preflightRows.filter((r) => r.mappingStatus === "VALID_MAPPED").length,
    INVALID_MAPPING: preflightRows.filter((r) => r.mappingStatus === "INVALID_MAPPING").length,
    UNKNOWN_MAPPING: preflightRows.filter((r) => r.mappingStatus === "UNKNOWN_MAPPING").length,
    clWastedOnInvalid: 0,
  },
  targetMaxSummary: {
    lanesCappedBefore: preflightRows.filter((r) => r.mappingStatus === "VALID_MAPPED" && r.targetMax <= r.itemsImportedEstimate).length,
    lanesFixed: candidates.length,
    clWastedOnCapped: 0,
  },
  blockedInvalid: preflightRows.filter((r) => r.mappingStatus === "INVALID_MAPPING"),
  blockedUnknown: preflightRows.filter((r) => r.mappingStatus === "UNKNOWN_MAPPING"),
  laneAPlan: laneASelected.map((c) => ({
    jurisdiction: c.jurisdiction,
    clCourt: c.clCourt,
    courtLevel: c.courtLevel,
    batchSize: "5",
    targetMax: String(c.targetMax),
    maxCalls: "10",
    tag: `w2r2-${c.clCourt}`,
    deficit: c.deficit,
    intermediateLayerGap: c.intermediateLayerGap,
  })),
  allPreflight: preflightRows,
};

fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-preflight.json"), JSON.stringify(plan, null, 2));
console.log(
  JSON.stringify(
    {
      ok: true,
      mapping: plan.mappingSummary,
      targetMax: plan.targetMaxSummary,
      laneAPlan: plan.laneAPlan.map((x) => `${x.clCourt}@${x.targetMax}(${x.jurisdiction})`),
      blockedInvalid: plan.blockedInvalid.map((x) => x.clCourt),
      blockedUnknown: plan.blockedUnknown.map((x) => x.clCourt),
    },
    null,
    2,
  ),
);
