/**
 * CourtListener court-id verification registry (pure, no network).
 * Offline statuses come from persisted local evidence only — never invent IDs.
 */

/** @typedef {'VERIFIED'|'MAPPING_INVALID'|'NEEDS_SINGLE_VERIFICATION'|'TRANSIENT_RETRY'|'KNOWN_UNVERIFIED'|'MISSING'} VerifyStatus */

/**
 * @typedef {object} CourtRegistryEntry
 * @property {string} clCourtId
 * @property {string} nyayaCourtId
 * @property {string} courtName
 * @property {string} jurisdiction
 * @property {string} courtLevel
 * @property {VerifyStatus} verificationStatus
 * @property {string|null} [invalidCandidateId]
 * @property {string|null} [canonicalClId]
 * @property {boolean} ingestEnabled
 * @property {string|null} [verifiedAt]
 * @property {string} [evidence]
 * @property {string|null} [transientError]
 * @property {number|null} [target]
 * @property {string|null} [checkpoint]
 * @property {number|null} [count]
 * @property {string|null} [nextAction]
 */

/** @type {Record<string, CourtRegistryEntry>} */
const REGISTRY = {
  // Wave-1 highs — verified by successful opinion ingest
  ny: {
    clCourtId: "ny",
    nyayaCourtId: "st-ny-high",
    courtName: "New York Court of Appeals",
    jurisdiction: "NY",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  cal: {
    clCourtId: "cal",
    nyayaCourtId: "st-ca-high",
    courtName: "Supreme Court of California",
    jurisdiction: "CA",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  pa: {
    clCourtId: "pa",
    nyayaCourtId: "st-pa-high",
    courtName: "Supreme Court of Pennsylvania",
    jurisdiction: "PA",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  nj: {
    clCourtId: "nj",
    nyayaCourtId: "st-nj-high",
    courtName: "Supreme Court of New Jersey",
    jurisdiction: "NJ",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  fla: {
    clCourtId: "fla",
    nyayaCourtId: "st-fl-high",
    courtName: "Supreme Court of Florida",
    jurisdiction: "FL",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  tex: {
    clCourtId: "tex",
    nyayaCourtId: "st-tx-high",
    courtName: "Supreme Court of Texas",
    jurisdiction: "TX",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  texcrimapp: {
    clCourtId: "texcrimapp",
    nyayaCourtId: "st-tx-crim-high",
    courtName: "Texas Court of Criminal Appeals",
    jurisdiction: "TX",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  ill: {
    clCourtId: "ill",
    nyayaCourtId: "st-il-high",
    courtName: "Supreme Court of Illinois",
    jurisdiction: "IL",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  mass: {
    clCourtId: "mass",
    nyayaCourtId: "st-ma-high",
    courtName: "Supreme Judicial Court of Massachusetts",
    jurisdiction: "MA",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  va: {
    clCourtId: "va",
    nyayaCourtId: "st-va-high",
    courtName: "Supreme Court of Virginia",
    jurisdiction: "VA",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  del: {
    clCourtId: "del",
    nyayaCourtId: "st-de-high",
    courtName: "Supreme Court of Delaware",
    jurisdiction: "DE",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:50:00.000Z",
    evidence: "successful_opinion_ingest>=20",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },

  // Wave-1 intermediates — successful
  nyappdiv: {
    clCourtId: "nyappdiv",
    nyayaCourtId: "st-ny-app",
    courtName: "New York Supreme Court, Appellate Division",
    jurisdiction: "NY",
    courtLevel: "state_appellate",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:57:00.000Z",
    evidence: "successful_opinion_ingest>=15",
    target: 15,
    count: 15,
    checkpoint: "cl-opinion-11443015",
    nextAction: "complete",
  },
  calctapp: {
    clCourtId: "calctapp",
    nyayaCourtId: "st-ca-app",
    courtName: "California Court of Appeal",
    jurisdiction: "CA",
    courtLevel: "state_appellate",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T17:57:00.000Z",
    evidence: "successful_opinion_ingest>=15",
    target: 15,
    count: 15,
    checkpoint: "cl-opinion-11443170",
    nextAction: "complete",
  },
  pasuperct: {
    clCourtId: "pasuperct",
    nyayaCourtId: "st-pa-super",
    courtName: "Superior Court of Pennsylvania",
    jurisdiction: "PA",
    courtLevel: "state_appellate",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T18:41:00.000Z",
    evidence: "successful_opinion_ingest>=15",
    target: 15,
    count: 15,
    checkpoint: "cl-opinion-11441953",
    nextAction: "complete",
  },
  fladistctapp: {
    clCourtId: "fladistctapp",
    nyayaCourtId: "st-fl-app",
    courtName: "Florida District Courts of Appeal",
    jurisdiction: "FL",
    courtLevel: "state_appellate",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T18:44:00.000Z",
    evidence: "successful_opinion_ingest>=15",
    target: 15,
    count: 15,
    checkpoint: "cl-opinion-11444300",
    nextAction: "complete",
  },
  illappct: {
    clCourtId: "illappct",
    nyayaCourtId: "st-il-app",
    courtName: "Appellate Court of Illinois",
    jurisdiction: "IL",
    courtLevel: "state_appellate",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T18:53:00.000Z",
    evidence: "successful_opinion_ingest>=15",
    target: 15,
    count: 15,
    checkpoint: "cl-opinion-11443051",
    nextAction: "complete",
  },
  massappct: {
    clCourtId: "massappct",
    nyayaCourtId: "st-ma-app",
    courtName: "Massachusetts Appeals Court",
    jurisdiction: "MA",
    courtLevel: "state_appellate",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T19:00:00.000Z",
    evidence: "successful_opinion_ingest>=15",
    target: 15,
    count: 15,
    checkpoint: "cl-opinion-11400840",
    nextAction: "complete",
  },

  // Gap courts — old CL ids proven 404 offline (wave2v-court-verify.txt); no replacement proven
  pacommwlth: {
    clCourtId: "pacommwlth",
    nyayaCourtId: "st-pa-comm",
    courtName: "Commonwealth Court of Pennsylvania",
    jurisdiction: "PA",
    courtLevel: "state_appellate",
    verificationStatus: "MAPPING_INVALID",
    invalidCandidateId: "pacommwlth",
    canonicalClId: null,
    ingestEnabled: false,
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence:
      "packages/research/corpus/reports/wave2v-court-verify.txt GET /courts/pacommwlth/ → 404; no alternate ID proven offline",
    target: 10,
    count: 0,
    checkpoint: null,
    nextAction: "NEEDS_SINGLE_VERIFICATION_AFTER_COOLDOWN_paced_courts_search",
  },
  njsuperct: {
    clCourtId: "njsuperct",
    nyayaCourtId: "st-nj-app",
    courtName: "Superior Court of New Jersey, Appellate Division",
    jurisdiction: "NJ",
    courtLevel: "state_appellate",
    verificationStatus: "MAPPING_INVALID",
    invalidCandidateId: "njsuperct",
    canonicalClId: null,
    ingestEnabled: false,
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence:
      "packages/research/corpus/reports/wave2v-court-verify.txt GET /courts/njsuperct/ → 404; no alternate ID proven offline",
    target: 15,
    count: 0,
    checkpoint: null,
    nextAction: "NEEDS_SINGLE_VERIFICATION_AFTER_COOLDOWN_paced_courts_search",
  },
  vacapp: {
    clCourtId: "vacapp",
    nyayaCourtId: "st-va-app",
    courtName: "Court of Appeals of Virginia",
    jurisdiction: "VA",
    courtLevel: "state_appellate",
    verificationStatus: "MAPPING_INVALID",
    invalidCandidateId: "vacapp",
    canonicalClId: null,
    ingestEnabled: false,
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence:
      "packages/research/corpus/reports/wave2v-court-verify.txt GET /courts/vacapp/ → 404; no alternate ID proven offline",
    target: 15,
    count: 0,
    checkpoint: null,
    nextAction: "NEEDS_SINGLE_VERIFICATION_AFTER_COOLDOWN_paced_courts_search",
  },

  // texapp — mapping valid; last run failed with 502
  texapp: {
    clCourtId: "texapp",
    nyayaCourtId: "st-tx-app",
    courtName: "Court of Appeals of Texas",
    jurisdiction: "TX",
    courtLevel: "state_appellate",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence:
      "wave2v-court-verify.txt /courts/texapp/ → 200 Court of Appeals of Texas; prior import count 4",
    transientError: "discover_http_502",
    target: 15,
    count: 4,
    checkpoint: "cl-opinion-9944747",
    nextAction: "TRANSIENT_RETRY",
  },

  // National highs verified offline via wave2v-court-verify.txt (200)
  la: {
    clCourtId: "la",
    nyayaCourtId: "st-la-high",
    courtName: "Supreme Court of Louisiana",
    jurisdiction: "LA",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence: "wave2v-court-verify.txt /courts/la/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  dc: {
    clCourtId: "dc",
    nyayaCourtId: "st-dc-high",
    courtName: "District of Columbia Court of Appeals",
    jurisdiction: "DC",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence: "wave2v-court-verify.txt /courts/dc/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  idaho: {
    clCourtId: "idaho",
    nyayaCourtId: "st-id-high",
    courtName: "Idaho Supreme Court",
    jurisdiction: "ID",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence: "wave2v-court-verify.txt /courts/idaho/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  mo: {
    clCourtId: "mo",
    nyayaCourtId: "st-mo-high",
    courtName: "Supreme Court of Missouri",
    jurisdiction: "MO",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence: "wave2v-court-verify.txt /courts/mo/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  miss: {
    clCourtId: "miss",
    nyayaCourtId: "st-ms-high",
    courtName: "Mississippi Supreme Court",
    jurisdiction: "MS",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence: "wave2v-court-verify.txt /courts/miss/ → 200",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  mont: {
    clCourtId: "mont",
    nyayaCourtId: "st-mt-high",
    courtName: "Montana Supreme Court",
    jurisdiction: "MT",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/mont/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  nd: {
    clCourtId: "nd",
    nyayaCourtId: "st-nd-high",
    courtName: "North Dakota Supreme Court",
    jurisdiction: "ND",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/nd/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  neb: {
    clCourtId: "neb",
    nyayaCourtId: "st-ne-high",
    courtName: "Nebraska Supreme Court",
    jurisdiction: "NE",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/neb/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  nh: {
    clCourtId: "nh",
    nyayaCourtId: "st-nh-high",
    courtName: "Supreme Court of New Hampshire",
    jurisdiction: "NH",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/nh/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  nm: {
    clCourtId: "nm",
    nyayaCourtId: "st-nm-high",
    courtName: "New Mexico Supreme Court",
    jurisdiction: "NM",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/nm/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  nev: {
    clCourtId: "nev",
    nyayaCourtId: "st-nv-high",
    courtName: "Nevada Supreme Court",
    jurisdiction: "NV",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/nev/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  okla: {
    clCourtId: "okla",
    nyayaCourtId: "st-ok-high",
    courtName: "Supreme Court of Oklahoma",
    jurisdiction: "OK",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/okla/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  sc: {
    clCourtId: "sc",
    nyayaCourtId: "st-sc-high",
    courtName: "Supreme Court of South Carolina",
    jurisdiction: "SC",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/sc/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  sd: {
    clCourtId: "sd",
    nyayaCourtId: "st-sd-high",
    courtName: "South Dakota Supreme Court",
    jurisdiction: "SD",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/sd/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  tenn: {
    clCourtId: "tenn",
    nyayaCourtId: "st-tn-high",
    courtName: "Tennessee Supreme Court",
    jurisdiction: "TN",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-21T21:53:00.000Z",
    evidence: "wave2y-national-verify.txt /courts/tenn/ → 200",
    target: 20,
    count: 20,
    nextAction: "skip_deepen_until_national_baseline",
  },
  utah: {
    clCourtId: "utah",
    nyayaCourtId: "st-ut-high",
    courtName: "Utah Supreme Court",
    jurisdiction: "UT",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/utah/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  vt: {
    clCourtId: "vt",
    nyayaCourtId: "st-vt-high",
    courtName: "Supreme Court of Vermont",
    jurisdiction: "VT",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/vt/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  wyo: {
    clCourtId: "wyo",
    nyayaCourtId: "st-wy-high",
    courtName: "Wyoming Supreme Court",
    jurisdiction: "WY",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/wyo/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  alaska: {
    clCourtId: "alaska",
    nyayaCourtId: "st-ak-high",
    courtName: "Alaska Supreme Court",
    jurisdiction: "AK",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/alaska/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  ala: {
    clCourtId: "ala",
    nyayaCourtId: "st-al-high",
    courtName: "Supreme Court of Alabama",
    jurisdiction: "AL",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/ala/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  ark: {
    clCourtId: "ark",
    nyayaCourtId: "st-ar-high",
    courtName: "Supreme Court of Arkansas",
    jurisdiction: "AR",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/ark/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  haw: {
    clCourtId: "haw",
    nyayaCourtId: "st-hi-high",
    courtName: "Hawaii Supreme Court",
    jurisdiction: "HI",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/haw/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  iowa: {
    clCourtId: "iowa",
    nyayaCourtId: "st-ia-high",
    courtName: "Supreme Court of Iowa",
    jurisdiction: "IA",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/iowa/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  kan: {
    clCourtId: "kan",
    nyayaCourtId: "st-ks-high",
    courtName: "Supreme Court of Kansas",
    jurisdiction: "KS",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/kan/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },
  ky: {
    clCourtId: "ky",
    nyayaCourtId: "st-ky-high",
    courtName: "Kentucky Supreme Court",
    jurisdiction: "KY",
    courtLevel: "state_high",
    verificationStatus: "VERIFIED",
    ingestEnabled: true,
    verifiedAt: "2026-09-22T21:40:00.000Z",
    evidence: "wave2ab-national-verify.txt /courts/ky/ → 200",
    target: 20,
    count: 0,
    nextAction: "national_high_sweep",
  },

  // DE intermediate — structure absent per wave2o prep
  de_intermediate: {
    clCourtId: "",
    nyayaCourtId: "",
    courtName: "Delaware intermediate appellate (none mapped)",
    jurisdiction: "DE",
    courtLevel: "state_appellate",
    verificationStatus: "MISSING",
    ingestEnabled: false,
    evidence: "wave2o-intermediate-appellate-prep.json structureExists:false",
    target: null,
    count: 0,
    nextAction: "skip_no_intermediate_structure",
  },
};

/**
 * @param {string} clCourt
 * @returns {CourtRegistryEntry|null}
 */
function getCourtEntry(clCourt) {
  const key = String(clCourt || "").toLowerCase();
  return REGISTRY[key] || null;
}

/**
 * @param {CourtRegistryEntry|null} entry
 */
function shouldSkipIngest(entry) {
  if (!entry) return { skip: true, reason: "MISSING_MAPPING" };
  if (!entry.ingestEnabled) return { skip: true, reason: entry.verificationStatus };
  if (entry.verificationStatus === "MAPPING_INVALID") {
    return { skip: true, reason: "MAPPING_INVALID" };
  }
  return { skip: false, reason: null };
}

/**
 * Classify HTTP outcome of a single paced /courts/{id}/ verification.
 * @param {number} status
 * @param {{ full_name?: string|null }} [body]
 */
function classifyCourtVerifyHttp(status, body) {
  if (status === 200) {
    return {
      verificationStatus: /** @type {VerifyStatus} */ ("VERIFIED"),
      ingestEnabled: true,
      canonicalName: body?.full_name || null,
      transient: false,
    };
  }
  if (status === 404) {
    return {
      verificationStatus: /** @type {VerifyStatus} */ ("MAPPING_INVALID"),
      ingestEnabled: false,
      canonicalName: null,
      transient: false,
    };
  }
  if (status === 502 || status === 503 || status === 504) {
    return {
      verificationStatus: /** @type {VerifyStatus} */ ("TRANSIENT_RETRY"),
      ingestEnabled: true,
      canonicalName: null,
      transient: true,
    };
  }
  if (status === 429) {
    return {
      verificationStatus: /** @type {VerifyStatus} */ ("TRANSIENT_RETRY"),
      ingestEnabled: false,
      canonicalName: null,
      transient: true,
      hardStop: true,
    };
  }
  return {
    verificationStatus: /** @type {VerifyStatus} */ ("NEEDS_SINGLE_VERIFICATION"),
    ingestEnabled: false,
    canonicalName: null,
    transient: false,
  };
}

/**
 * Whether a live /courts/{id}/ call is allowed (at most one for unverified/failed).
 * @param {CourtRegistryEntry|null} entry
 */
function needsLiveVerification(entry) {
  if (!entry) return true;
  if (entry.verificationStatus === "VERIFIED") return false;
  if (entry.verificationStatus === "MAPPING_INVALID") return false; // do not re-hit known-bad id
  if (entry.verificationStatus === "NEEDS_SINGLE_VERIFICATION") return true;
  if (entry.verificationStatus === "KNOWN_UNVERIFIED") return true;
  return false;
}

/**
 * Apply verification result into a mutable cache object (no network).
 * @param {Record<string, CourtRegistryEntry>} cache
 * @param {string} clCourt
 * @param {ReturnType<typeof classifyCourtVerifyHttp>} result
 * @param {string} [at]
 */
function applyVerificationResult(cache, clCourt, result, at = new Date().toISOString()) {
  const key = String(clCourt).toLowerCase();
  const prev = cache[key] || getCourtEntry(key) || {
    clCourtId: key,
    nyayaCourtId: "",
    courtName: "",
    jurisdiction: "",
    courtLevel: "",
    verificationStatus: "KNOWN_UNVERIFIED",
    ingestEnabled: false,
  };
  cache[key] = {
    ...prev,
    verificationStatus: result.verificationStatus,
    ingestEnabled: result.ingestEnabled,
    verifiedAt: at,
    evidence: `paced_/courts/${key}/_status_${result.verificationStatus}`,
    ...(result.canonicalName ? { courtName: result.canonicalName } : {}),
    ...(result.transient ? { transientError: `http_verify` } : {}),
  };
  return cache[key];
}

function listWave1IntermediatePlan() {
  return [
    "nyappdiv",
    "calctapp",
    "pasuperct",
    "pacommwlth",
    "njsuperct",
    "fladistctapp",
    "texapp",
    "illappct",
    "massappct",
    "vacapp",
  ].map((id) => {
    const e = getCourtEntry(id);
    return {
      clCourtId: id,
      ...(e || {}),
      skip: shouldSkipIngest(e).skip,
      skipReason: shouldSkipIngest(e).reason,
    };
  });
}

function nationalHighReadiness(
  ids = [
    "la", "dc", "idaho", "mo", "miss", "mont", "nd", "neb", "nh", "nm", "nev", "okla", "sc", "sd", "tenn",
    "utah", "vt", "wyo", "alaska", "ala", "ark", "haw", "iowa", "kan", "ky",
  ],
) {
  return ids.map((id) => {
    const e = getCourtEntry(id);
    if (!e) return { clCourtId: id, status: "MISSING" };
    return {
      clCourtId: id,
      courtName: e.courtName,
      nyayaCourtId: e.nyayaCourtId,
      status: e.verificationStatus,
      ingestEnabled: e.ingestEnabled,
      evidence: e.evidence,
    };
  });
}

module.exports = {
  REGISTRY,
  getCourtEntry,
  shouldSkipIngest,
  classifyCourtVerifyHttp,
  needsLiveVerification,
  applyVerificationResult,
  listWave1IntermediatePlan,
  nationalHighReadiness,
};
