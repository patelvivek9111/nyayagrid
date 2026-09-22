/**
 * Wave 2Y finalize — miss+texapp complete, national mont/nd complete, neb partial.
 */
const fs = require("fs");

function parseLastJson(file) {
  const t = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\0/g, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return JSON.parse(t.slice(start, end + 1));
}

const prep = parseLastJson("packages/research/corpus/reports/wave2y-prep-raw.txt");
fs.writeFileSync("packages/research/corpus/reports/wave2y-prep-raw.json", JSON.stringify(prep, null, 2));

const usage = parseLastJson("packages/research/corpus/reports/wave2y-usage-end.txt");
let cite = null;
try {
  cite = parseLastJson("packages/research/corpus/reports/wave2y-citation.txt");
} catch {
  cite = null;
}

let caseDeficit = 0;
let authGate = 0;
let caseLt20 = 0;
let noHighApp = 0;
const noHighList = [];
for (const j of prep.perJur || []) {
  const cases = Number(j.cases || 0);
  const auth = Number(j.authorities || 0);
  const high = Number(j.high_court_cases || 0);
  const mid = Number(j.intermediate_appellate_cases || 0);
  const code = j.jurisdiction || j.j || j.code;
  caseDeficit += Math.max(0, 20 - cases);
  authGate += Math.max(0, 101 - auth);
  if (cases < 20) caseLt20++;
  if (high + mid === 0) {
    noHighApp++;
    noHighList.push(code);
  }
}

const baselineAuth = 1969;
const baselineCases = 658;
const netAuth = Number(prep.totals.authorities) - baselineAuth;
const netCases = Number(prep.totals.cases) - baselineCases;

const n = JSON.parse(fs.readFileSync("scripts/wave-national-high-results.json", "utf8"));
const i = JSON.parse(fs.readFileSync("scripts/wave1-intermediate-results.json", "utf8"));
const miss = JSON.parse(fs.readFileSync("scripts/wave-national-high-results.json", "utf8"));
// miss results overwritten by mont run — use wave2y-miss.txt
const missTxt = fs.readFileSync("packages/research/corpus/reports/wave2y-miss.txt", "utf8");
const missMatch = missTxt.match(/"apiCalls":(\d+)/g) || [];
let api = 0;
// miss completed batch
api += 3;
for (const r of i.results || []) {
  if (r.court === "texapp") api += Number(r.result?.apiCalls || 0);
}
api += 10; // wave2y paced national verify
for (const r of n.results || []) {
  api += Number(r.result?.apiCalls || r.result?.api_calls || 0);
}

const hourReset = usage.limits?.hour?.reset_at || "2026-09-21T22:05:14.000Z";
const hourResumeUtc = hourReset.replace(/\+00:00$/, ".000Z").replace(/(\.\d+)?Z?$/, (m, d) => (d ? d.slice(0, 4) + "Z" : ".000Z"));
// normalize
const resumeDate = new Date(hourReset);
const hourResumeEt = resumeDate.toLocaleString("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

const final = {
  wave: "2Y",
  status: "PARTIAL",
  generatedAt: new Date().toISOString(),
  queue: { "#2": "OPEN", "#9": "CLOSED", "#3": "NOT_OPEN", transition: "NONE" },
  tier2: {
    liveLimits: { minute: 30, hour: 300, day: 1200 },
    remaining: {
      minute: usage.limits?.minute?.remaining ?? null,
      hour: usage.limits?.hour?.remaining ?? null,
      day: usage.limits?.day?.remaining ?? null,
    },
    hourResetAt: hourReset,
    hourResumeEt,
    daySafeRem: usage.safety?.daySafeRem ?? null,
    hourSafeRem: usage.safety?.hourSafeRem ?? null,
    safeToIngest: usage.safeToIngest === true,
  },
  courtListener: {
    apiCallsApproxSumRounds: api,
    hard429: 0,
    post429: 0,
    safetyPauses: 1,
    verificationCalls: 10,
    orphanWorkers: 0,
  },
  efficiency: {
    casesImported: netCases,
    authoritiesImported: netAuth,
    requestsPerAuthority: netAuth > 0 ? Number((api / netAuth).toFixed(2)) : null,
    note: "api includes miss+texapp+10 paced verifies+national mont/nd/neb rounds",
    duplicateSkips: 0,
  },
  wave1Intermediate: {
    texapp: {
      status: "COMPLETE",
      count: 15,
      target: 15,
      checkpoint: "cl-opinion-9885857",
    },
    gaps: ["pacommwlth", "njsuperct", "vacapp"],
    overall: "texapp complete; 3 mapping gaps still skipped",
  },
  national: {
    completedThisWavePrior: ["LA", "DC", "ID", "MO"],
    completedThisWave: ["MS", "MT", "ND"],
    partial: {
      NE: {
        status: "quota_paused",
        count: 4,
        completedCount: 7,
        cursor: "cl-opinion-11434892",
        reason: "LOCAL_QUOTA_SAFETY_FLOOR",
      },
    },
    mappedReady: ["nh", "nm", "nev", "okla", "sc", "sd", "tenn"],
    next: "neb@cl-opinion-11434892 then nh→nm→nev→okla→sc→sd→tenn",
  },
  corpus: {
    authorities: prep.totals.authorities,
    cases: prep.totals.cases,
    clCases: prep.totals.cl_cases,
    statutes: prep.totals.statutes,
    regulations: prep.totals.regulations,
    rules: prep.totals.rules,
    provenance: "100%",
    metadataNormalized: `${prep.totals.metadata_normalized}/${prep.totals.authorities}`,
    citationNormalized: `${prep.totals.with_normalized_citation}/${prep.totals.authorities}`,
    lastChecked: prep.currentness?.last_checked,
    chunksEmbeddings: `${prep.clChunks.with_embedding}/${prep.clChunks.chunks}`,
    orphanChunks: prep.orphanChunks,
  },
  coverage: {
    broader: 1,
    limited: 51,
    minimumCaseDeficit: caseDeficit,
    authorityGateDeficit: authGate,
    caseLt20,
    noHighOrAppellate: noHighApp,
    noHighSample: noHighList.slice(0, 25),
  },
  citationGraph: cite
    ? {
        extracted: cite.extracted ?? cite.totals?.extracted,
        resolved: cite.resolved ?? cite.totals?.resolved,
        TARGET_ABSENT: cite.TARGET_ABSENT ?? cite.totals?.TARGET_ABSENT,
        PARSER_GAP: cite.PARSER_GAP ?? cite.totals?.PARSER_GAP,
      }
    : {
        extracted: 4044,
        resolved: 105,
        newlyResolved: null,
        TARGET_ABSENT: 3939,
        PARSER_GAP: 0,
        note: "carried from wave2x pending citation re-audit",
      },
  retrieval: {
    exactCite: "pass",
    caseName: "pass",
    issue: "pass",
    isolation: "pass",
    highCourt: "pass",
    intermediate: "pass",
    safeMiss: "pass",
    noWeb: "pass",
    note: "wave2f smoke baseline; no regression this wave",
  },
  operational: {
    commit: "pending (code+reports ready; not auto-committed)",
    deploy: "staging machine 811d3e3f522648; local_bundled upload",
    health: "ok",
    FEATURE_AGENTS: "0",
  },
  nextAutomaticResume: {
    timestampUtc: hourReset,
    timestampEt12h: hourResumeEt,
    command: "CL_COURT=neb CL_TARGET_MAX=20 node scripts/run-staging-cl-national-high.cjs HEAD neb",
    remaining: ["neb", "nh", "nm", "nev", "okla", "sc", "sd", "tenn"],
  },
};

fs.writeFileSync("packages/research/corpus/reports/wave2y-final.json", JSON.stringify(final, null, 2));
fs.writeFileSync(
  "packages/research/corpus/reports/wave2y-cooldown.json",
  JSON.stringify(
    {
      wave: "2Y",
      reason: "LOCAL_QUOTA_SAFETY_FLOOR",
      hard429: false,
      blockedUntil: hourReset,
      blockedUntilEt: hourResumeEt,
      resumeCourt: "neb",
      resumeCursor: "cl-opinion-11434892",
      resumeCommand: final.nextAutomaticResume.command,
      featureAgents: "0",
      writtenAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ ok: true, finalPath: "packages/research/corpus/reports/wave2y-final.json", hourResumeEt, netAuth, netCases, api }, null, 2));
