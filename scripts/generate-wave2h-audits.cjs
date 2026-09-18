/**
 * Wave 2H — national matrices + Queue #2 gap register (deterministic, no CL / no paid DBs).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "packages/research/corpus/reports");
const at = new Date().toISOString();

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI",
  "SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","US",
];

const WAVE1 = ["CA","DE","FL","IL","MA","NJ","NY","PA","TX","VA"];
const THIN = ["AZ","CO","CT","GA","LA","MD","MI","NC","OH","WA","WI"];

const RULE_URLS = {
  US: { url: "https://www.uscourts.gov/rules-policies", class: "A_ready_structured", families: ["civil","evidence","appellate"] },
  AL: { url: "https://judicial.alabama.gov/rules", class: "C_manual_but_official", families: ["civil"] },
  AK: { url: "https://courts.alaska.gov/rules/", class: "C_manual_but_official", families: ["civil"] },
  AZ: { url: "https://www.azcourts.gov/rules", class: "B_ready_pdf", families: ["civil","evidence"] },
  AR: { url: "https://www.arcourts.gov/rules", class: "C_manual_but_official", families: ["civil"] },
  CA: { url: "https://www.courts.ca.gov/forms-rules/rules-court", class: "B_ready_pdf", families: ["civil","evidence","appellate"] },
  CO: { url: "https://www.courts.state.co.us/Courts/Supreme_Court/Rules", class: "C_manual_but_official", families: ["civil"] },
  CT: { url: "https://www.jud.ct.gov/Publications/PracticeBook/", class: "B_ready_pdf", families: ["civil","evidence"] },
  DE: { url: "https://courts.delaware.gov/rules/", class: "C_manual_but_official", families: ["civil"] },
  DC: { url: "https://www.dccourts.gov/superior-court/rules", class: "C_manual_but_official", families: ["civil"] },
  FL: { url: "https://www.floridabar.org/rules/rptoc/", class: "B_ready_pdf", families: ["civil","evidence","appellate"] },
  GA: { url: "https://www.gasupreme.us/rules/", class: "C_manual_but_official", families: ["civil"] },
  HI: { url: "https://www.courts.state.hi.us/", class: "C_manual_but_official", families: ["civil"] },
  ID: { url: "https://isc.idaho.gov/idaho-court-rules", class: "C_manual_but_official", families: ["civil"] },
  IL: { url: "https://www.illinoiscourts.gov/supreme-court-rules/", class: "B_ready_pdf", families: ["civil"] },
  IN: { url: "https://www.in.gov/courts/rules/", class: "C_manual_but_official", families: ["civil"] },
  IA: { url: "https://www.iowacourts.gov/for-the-public/court-rules", class: "C_manual_but_official", families: ["civil"] },
  KS: { url: "https://www.kscourts.org/Rules", class: "C_manual_but_official", families: ["civil"] },
  KY: { url: "https://www.kycourts.gov/", class: "C_manual_but_official", families: ["civil"] },
  LA: { url: "https://www.lasc.org/", class: "C_manual_but_official", families: ["civil"] },
  ME: { url: "https://www.courts.maine.gov/rules/", class: "C_manual_but_official", families: ["civil"] },
  MD: { url: "https://www.mdcourts.gov/lawlib/research/rules", class: "B_ready_pdf", families: ["civil","evidence"] },
  MA: { url: "https://www.mass.gov/guides/massachusetts-rules-of-court", class: "C_manual_but_official", families: ["civil"] },
  MI: { url: "https://www.courts.michigan.gov/rules-administration/", class: "C_manual_but_official", families: ["civil"] },
  MN: { url: "https://www.mncourts.gov/SupremeCourt/Court-Rules.aspx", class: "C_manual_but_official", families: ["civil"] },
  MS: { url: "https://courts.ms.gov/research/rules/", class: "C_manual_but_official", families: ["civil"] },
  MO: { url: "https://www.courts.mo.gov/page.jsp?id=667", class: "C_manual_but_official", families: ["civil"] },
  MT: { url: "https://courts.mt.gov/Courts/rules", class: "C_manual_but_official", families: ["civil"] },
  NE: { url: "https://supremecourt.nebraska.gov/supreme-court-rules", class: "C_manual_but_official", families: ["civil"] },
  NV: { url: "https://nvcourts.gov/supreme/rules/", class: "C_manual_but_official", families: ["civil"] },
  NH: { url: "https://www.courts.nh.gov/rules", class: "C_manual_but_official", families: ["civil"] },
  NJ: { url: "https://www.njcourts.gov/attorneys/rules-of-court", class: "B_ready_pdf", families: ["civil"] },
  NM: { url: "https://www.nmcourts.gov/", class: "C_manual_but_official", families: ["civil"] },
  NY: { url: "https://ww2.nycourts.gov/rules", class: "D_source_unstable", families: ["civil"] },
  NC: { url: "https://www.nccourts.gov/courts/supreme-court/supreme-court-rules", class: "C_manual_but_official", families: ["civil","evidence"] },
  ND: { url: "https://www.ndcourts.gov/legal-resources/rules", class: "C_manual_but_official", families: ["civil"] },
  OH: { url: "https://www.supremecourt.ohio.gov/ruleamendments/", class: "C_manual_but_official", families: ["civil"] },
  OK: { url: "https://www.oscn.net/applications/oscn/index.asp?ftdb=STOKRU&level=1", class: "C_manual_but_official", families: ["civil"] },
  OR: { url: "https://www.courts.oregon.gov/rules/", class: "C_manual_but_official", families: ["civil"] },
  PA: { url: "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/231/231toc.html", class: "A_ready_structured", families: ["civil","evidence","appellate"] },
  RI: { url: "https://www.courts.ri.gov/Courts/SupremeCourt/Pages/Rules.aspx", class: "C_manual_but_official", families: ["civil"] },
  SC: { url: "https://www.sccourts.org/courtOrders/displayRule.cfm", class: "C_manual_but_official", families: ["civil"] },
  SD: { url: "https://ujs.sd.gov/", class: "C_manual_but_official", families: ["civil"] },
  TN: { url: "https://www.tncourts.gov/rules", class: "C_manual_but_official", families: ["civil"] },
  TX: { url: "https://www.txcourts.gov/rules-forms/rules-standards/", class: "B_ready_pdf", families: ["civil","evidence","appellate"] },
  UT: { url: "https://www.utcourts.gov/rules/", class: "C_manual_but_official", families: ["civil"] },
  VT: { url: "https://www.vermontjudiciary.org/attorneys/rules", class: "C_manual_but_official", families: ["civil"] },
  VA: { url: "https://www.vacourts.gov/courts/scv/rulesofcourt.pdf", class: "B_ready_pdf", families: ["civil"] },
  WA: { url: "https://www.courts.wa.gov/court_rules/", class: "C_manual_but_official", families: ["civil"] },
  WV: { url: "http://www.courtswv.gov/legal-community/court-rules", class: "C_manual_but_official", families: ["civil"] },
  WI: { url: "https://www.wicourts.gov/supreme/sc_rules.jsp", class: "C_manual_but_official", families: ["civil","evidence"] },
  WY: { url: "https://www.courts.state.wy.us/court-rules/", class: "C_manual_but_official", families: ["civil"] },
};

/** Official public regulation sources — no Lexis/Westlaw. */
const REG_SOURCES = {
  US: { url: "https://www.ecfr.gov/", class: "A_ready_structured", platform: "ecfr", status: "ingested" },
  PA: { url: "https://www.pacodeandbulletin.gov/", class: "A_ready_structured", platform: "legislative_reference_bureau", status: "ingested" },
  FL: { url: "https://www.flrules.org/", class: "A_ready_structured", platform: "sos_portal", status: "ingested" },
  VA: { url: "https://law.lis.virginia.gov/admincode/", class: "A_ready_structured", platform: "lis_revisor", status: "ingested" },
  DE: { url: "https://regulations.delaware.gov/", class: "B_ready_pdf", platform: "sos_portal", status: "ingested" },
  IL: { url: "https://www.ilga.gov/commission/jcar/admincode/", class: "A_ready_structured", platform: "jcar_html", status: "ingested" },
  OH: { url: "https://codes.ohio.gov/ohio-administrative-code/", class: "A_ready_structured", platform: "custom_html", status: "ingested" },
  WA: { url: "https://app.leg.wa.gov/WAC/", class: "A_ready_structured", platform: "lis_revisor", status: "ingested" },
  CO: { url: "https://www.sos.state.co.us/CCR/", class: "B_ready_pdf", platform: "sos_portal", status: "ingested" },
  MI: { url: "https://www.michigan.gov/lara/", class: "C_manual_but_official", platform: "custom_html", status: "ingested" },
  MD: { url: "https://dsd.maryland.gov/Pages/COMARHome.aspx", class: "C_manual_but_official", platform: "custom_html", status: "ingested" },
  TX: { url: "https://www.sos.texas.gov/tac/", class: "B_ready_pdf", platform: "sos_portal", status: "ingested" },
  NC: { url: "https://www.oah.nc.gov/", class: "C_manual_but_official", platform: "custom_html", status: "ingested" },
  MN: { url: "https://www.revisor.mn.gov/rules/", class: "A_ready_structured", platform: "lis_revisor", status: "wave2h_ingested" },
  WI: { url: "https://docs.legis.wisconsin.gov/code/admin_code/", class: "A_ready_structured", platform: "lis_revisor", status: "wave2h_ingested" },
  GA: { url: "https://rules.sos.ga.gov/", class: "C_manual_but_official", platform: "sos_portal", status: "wave2h_ingested" },
  IN: { url: "http://iac.iga.in.gov/", class: "A_ready_structured", platform: "lis_revisor", status: "wave2h_ingested" },
  OR: { url: "https://secure.sos.state.or.us/oard/", class: "C_manual_but_official", platform: "sos_portal", status: "wave2h_ingested" },
  MA: { url: "https://www.mass.gov/code-of-massachusetts-regulations-cmr", class: "C_manual_but_official", platform: "custom_html", status: "public_source_engineering" },
  AZ: { url: "https://apps.azsos.gov/public_services/Title_20/", class: "C_manual_but_official", platform: "sos_portal", status: "public_source_engineering" },
  CA: { url: "https://oal.ca.gov/publications/ccr/", class: "E_proprietary_or_unstable", platform: "oal_ccr", status: "external_proprietary_limitation", notes: "Official CCR often via Westlaw/Lexis browse; public OAL mirrors fragmented." },
  NJ: { url: "https://www.nj.gov/oal/", class: "E_proprietary_or_unstable", platform: "none", status: "external_proprietary_limitation", notes: "N.J.A.C. public HTML incomplete vs proprietary publishers." },
  NY: { url: "https://dos.ny.gov/state-register", class: "D_source_unstable", platform: "dos_register", status: "public_source_engineering", notes: "NYCRR official compilation not stably machine-readable nationally." },
  CT: { url: "https://eregulations.ct.gov/", class: "D_source_unstable", platform: "eregulations", status: "public_source_engineering" },
  RI: { url: "https://rules.sos.ri.gov/", class: "C_manual_but_official", platform: "sos_portal", status: "public_source_engineering" },
  WV: { url: "https://apps.sos.wv.gov/adlaw/csr/", class: "C_manual_but_official", platform: "sos_portal", status: "public_source_engineering" },
};

/** Official case-law sources independent of CourtListener — audit only. */
const CASE_SOURCES = {
  US_SCOTUS: {
    jurisdiction: "US",
    court: "SCOTUS",
    opinionsUrl: "https://www.supremecourt.gov/opinions/opinions.aspx",
    bulk: "https://www.supremecourt.gov/opinions/USReports.aspx",
    rss: null,
    format: "HTML/PDF",
    class: "B_structured_recent_opinions",
    historicalDepth: "slip + bound volumes; not full machine bulk",
    adapterFamily: "scotus_slip_opinions",
    feasibility: "prototype_candidate",
  },
  US_CA: {
    jurisdiction: "US",
    court: "federal_circuits",
    opinionsUrl: "https://www.uscourts.gov/court-website-links",
    bulk: null,
    rss: "per-circuit RSS/Atom often available",
    format: "HTML/PDF",
    class: "C_pdf_archive",
    historicalDepth: "varies by circuit; no single national bulk",
    adapterFamily: "circuit_rss_family",
    feasibility: "prototype_candidate_rss_only",
  },
};

for (const code of STATES.filter((s) => s !== "US")) {
  const judiciary = RULE_URLS[code]?.url?.replace(/\/rules.*$/i, "/") || null;
  CASE_SOURCES[code] = {
    jurisdiction: code,
    court: "state_high_court",
    opinionsUrl: judiciary,
    bulk: null,
    rss: "unknown_per_state",
    format: "HTML/PDF",
    class: judiciary ? "C_pdf_archive" : "F_no_practical_source",
    historicalDepth: "official recent opinions; historical bulk rare",
    adapterFamily: "state_judiciary_cms",
    feasibility: "audit_only_no_mass_scraper",
  };
}

// Known stronger official case hubs
Object.assign(CASE_SOURCES.CA, { opinionsUrl: "https://www.courts.ca.gov/opinions.htm", class: "B_structured_recent_opinions", feasibility: "prototype_candidate" });
Object.assign(CASE_SOURCES.NY, { opinionsUrl: "https://www.nycourts.gov/reporter/", class: "B_structured_recent_opinions", adapterFamily: "ny_slip_opinion_service", feasibility: "prototype_candidate" });
Object.assign(CASE_SOURCES.TX, { opinionsUrl: "https://search.txcourts.gov/CaseSearch.aspx", class: "D_manual_only", feasibility: "search_ui_fragile" });
Object.assign(CASE_SOURCES.FL, { opinionsUrl: "https://www.floridasupremecourt.org/Opinions", class: "C_pdf_archive", feasibility: "bounded_possible" });
Object.assign(CASE_SOURCES.IL, { opinionsUrl: "https://www.illinoiscourts.gov/courts/appellate-court/oral-arguments-opinions/", class: "C_pdf_archive", feasibility: "bounded_possible" });
Object.assign(CASE_SOURCES.MA, { opinionsUrl: "https://www.mass.gov/service-details/massachusetts-court-system-opinions", class: "C_pdf_archive", feasibility: "bounded_possible" });
Object.assign(CASE_SOURCES.PA, { opinionsUrl: "https://www.pacourts.us/courts/supreme-court/court-opinions", class: "C_pdf_archive", feasibility: "bounded_possible" });
Object.assign(CASE_SOURCES.NJ, { opinionsUrl: "https://www.njcourts.gov/attorneys/opinions", class: "C_pdf_archive", feasibility: "bounded_possible" });
Object.assign(CASE_SOURCES.DE, { opinionsUrl: "https://courts.delaware.gov/opinions/", class: "C_pdf_archive", feasibility: "bounded_possible" });
Object.assign(CASE_SOURCES.VA, { opinionsUrl: "https://www.vacourts.gov/opinions/opnscvwp.html", class: "C_pdf_archive", feasibility: "bounded_possible" });

const ruleMatrix = {
  generatedAt: at,
  phase: "50S-WAVE-2H",
  matrixType: "court_rules_source_national",
  classificationLegend: ["A_ready_structured","B_ready_pdf","C_manual_but_official","D_source_unstable","E_proprietary_only","F_not_found"],
  entries: STATES.map((j) => {
    const row = RULE_URLS[j] || { url: null, class: "F_not_found", families: [] };
    return {
      jurisdiction: j,
      officialSourceUrl: row.url,
      civilProcedure: row.families.includes("civil"),
      evidence: row.families.includes("evidence"),
      appellate: row.families.includes("appellate"),
      class: row.class,
      format: row.class === "A_ready_structured" ? "HTML/XML" : row.class === "B_ready_pdf" ? "PDF" : "HTML/PDF",
      ingestionFeasibility: row.class.startsWith("A") || row.class.startsWith("B") ? "high" : row.class.startsWith("C") ? "medium" : "low",
      wave2hCuratedImport: ["AL","AK","AR","HI","ID","IA","KS","KY","LA","ME","MS","MO","MT","NE","NV","NH","NM","ND","OK","RI","SC","SD","TN","UT","VT","WV","WY","DC"].includes(j),
    };
  }),
};

const regMatrix = {
  generatedAt: at,
  phase: "50S-WAVE-2H",
  matrixType: "state_regulation_source_national",
  platformFamilies: ["legislative_reference_bureau","sos_portal","lis_revisor","jcar_html","custom_html","ecfr","oal_ccr","dos_register","eregulations"],
  entries: STATES.map((j) => {
    const row = REG_SOURCES[j];
    if (!row) {
      return {
        jurisdiction: j,
        class: "C_manual_but_official",
        status: "public_source_engineering",
        officialUrl: null,
        platformFamily: null,
        notes: "Official admin code likely exists via SOS/legislature; not yet adapter-configured.",
      };
    }
    return {
      jurisdiction: j,
      class: row.class,
      status: row.status,
      officialUrl: row.url,
      platformFamily: row.platform,
      notes: row.notes || null,
    };
  }),
};

const caseMatrix = {
  generatedAt: at,
  phase: "50S-WAVE-2H",
  matrixType: "official_case_source_audit",
  note: "Audit only. No CourtListener. No mass scrapers. Adapter prototypes deferred unless reusable family is stable.",
  reusablePlatforms: [
    { family: "scotus_slip_opinions", class: "B_structured_recent_opinions", buildNow: false, reason: "Stable official site; still per-opinion HTML/PDF — prefer CL for historical depth when available." },
    { family: "circuit_rss_family", class: "B_structured_recent_opinions", buildNow: false, reason: "RSS shapes differ by circuit; needs shared feed normalizer before ingestion." },
    { family: "ny_slip_opinion_service", class: "B_structured_recent_opinions", buildNow: false, reason: "Official NY reporter/slip service is structured but Terms/ToS and pagination need legal/ops review." },
    { family: "state_judiciary_cms", class: "C_pdf_archive", buildNow: false, reason: "CMS fragmentation; Wave 2H will not ship 50 scrapers." },
  ],
  adaptersBuilt: [],
  casesImported: 0,
  entries: Object.values(CASE_SOURCES),
};

const gapRegister = {
  generatedAt: at,
  phase: "50S-WAVE-2H",
  queue: 2,
  purpose: "Authoritative remaining blockers for Queue #2 close — Wave 2H PASS does not close #2.",
  byCategory: {
    INTERNALLY_SOLVABLE_NOW: [
      "Continue curated statute subject fills for residual licensing/admin holes where official code is clear.",
      "Expand evidence/appellate rule families for jurisdictions that only have Civ.P. Rule 12/56 curated.",
      "Connect more lis_revisor/sos_portal regulation configs (MA, AZ, RI, WV) via curated snapshots.",
      "Refresh/currentness backfill for newly imported rows after staging import.",
      "National deterministic retrieval suite after import (exact cite + jurisdiction isolation).",
    ],
    WAITING_FOR_COURTLISTENER: [
      "Case depth to meet broader_corpus (>=20 cases including high-court/appellate) for all Wave-1 and national jurisdictions.",
      "Federal deepen: CA11, CADC, CAFC, CA7, CA10 resume checkpoints.",
      "Wave-1 state high-court/appellate case deepen: CA, DE, FL, IL, MA, NJ, NY, PA, TX, VA.",
      "Citation resolve targets currently A_target_absent for many reporter cites without CL.",
    ],
    PUBLIC_SOURCE_ENGINEERING: [
      "NYCRR / NY DOS register stable section ingestion.",
      "CT eRegulations structured harvest.",
      "CA OAL CCR public mirror strategy without proprietary browse wrappers.",
      "Official case RSS normalizer family (circuits + SCOTUS slip) before bounded ingestion.",
      "Per-state evidence/appellate rule PDF parsers beyond curated Civ.P. snapshots.",
    ],
    EXTERNAL_PROPRIETARY_LIMITATION: [
      "CA CCR complete official text often gated behind commercial publishers.",
      "NJ administrative code complete official machine text incomplete vs Lexis/Westlaw.",
      "Some state admin codes lack stable public section URLs suitable for refresh hashing.",
    ],
    NO_RELIABLE_PUBLIC_SOURCE: [
      "No jurisdiction with zero official judiciary presence recorded; residual F_not_found reserved for unverified territories only.",
      "Historical full-text case bulk for most states without CL/PACER-class feeds remains unavailable from official free sources.",
    ],
  },
  byJurisdiction: Object.fromEntries(
    STATES.map((j) => {
      const reg = REG_SOURCES[j];
      const rule = RULE_URLS[j];
      const gaps = [];
      if (!reg || reg.status === "public_source_engineering") gaps.push("PUBLIC_SOURCE_ENGINEERING:regulations");
      if (reg && (reg.status === "external_proprietary_limitation" || reg.class?.startsWith("E"))) {
        gaps.push("EXTERNAL_PROPRIETARY_LIMITATION:regulations");
      }
      if (WAVE1.includes(j) || j === "US") gaps.push("WAITING_FOR_COURTLISTENER:case_depth");
      if (THIN.includes(j)) gaps.push("INTERNALLY_SOLVABLE_NOW:verify_subject_bundle_after_import");
      if (rule?.class === "D_source_unstable") gaps.push("PUBLIC_SOURCE_ENGINEERING:court_rules");
      return [j, gaps.length ? gaps : ["INTERNALLY_SOLVABLE_NOW:deepen_only"]];
    }),
  ),
  broaderCorpus: {
    countExpected: 0,
    dominantBlocker: "B_requires_courtlistener",
    criteriaUnchanged: true,
    note: "Criteria not lowered. Case depth remains the hard gate.",
  },
};

const refreshPolicy = {
  generatedAt: at,
  phase: "50S-WAVE-2H",
  sourceFamilies: {
    us_primary_corpus_bundles: { refreshJob: "bundle_reimport_hash_skip", connected: true },
    ecfr: { refreshJob: "ecfr_periodic", connected: true },
    usc: { refreshJob: "usc_periodic", connected: true },
    state_statute_curated: { refreshJob: "statute_periodic", connected: true },
    state_regulation_wave1: { refreshJob: "regulation_periodic", connected: true },
    state_regulation_wave2h: { refreshJob: "regulation_periodic", connected: true, note: "MN/WI/GA/IN/OR configs added; refresh via hash-skip reimport" },
    court_rules_curated: { refreshJob: "court_rules_periodic", connected: true },
    courtlistener: { refreshJob: "courtlistener_resume", connected: false, blocked: "cooldown_unavailable" },
  },
};

fs.writeFileSync(path.join(outDir, "wave2h-court-rules-source-matrix.json"), JSON.stringify(ruleMatrix, null, 2));
fs.writeFileSync(path.join(outDir, "wave2h-state-reg-source-matrix.json"), JSON.stringify(regMatrix, null, 2));
fs.writeFileSync(path.join(outDir, "wave2h-official-case-source-audit.json"), JSON.stringify(caseMatrix, null, 2));
fs.writeFileSync(path.join(outDir, "wave2h-queue2-gap-register.json"), JSON.stringify(gapRegister, null, 2));
fs.writeFileSync(path.join(outDir, "wave2h-refresh-coverage.json"), JSON.stringify(refreshPolicy, null, 2));

const md = [
  "# Wave 2H Queue #2 Gap Register",
  "",
  `Generated: ${at}`,
  "",
  "## INTERNALLY_SOLVABLE_NOW",
  ...gapRegister.byCategory.INTERNALLY_SOLVABLE_NOW.map((x) => `- ${x}`),
  "",
  "## WAITING_FOR_COURTLISTENER",
  ...gapRegister.byCategory.WAITING_FOR_COURTLISTENER.map((x) => `- ${x}`),
  "",
  "## PUBLIC_SOURCE_ENGINEERING",
  ...gapRegister.byCategory.PUBLIC_SOURCE_ENGINEERING.map((x) => `- ${x}`),
  "",
  "## EXTERNAL_PROPRIETARY_LIMITATION",
  ...gapRegister.byCategory.EXTERNAL_PROPRIETARY_LIMITATION.map((x) => `- ${x}`),
  "",
  "## NO_RELIABLE_PUBLIC_SOURCE",
  ...gapRegister.byCategory.NO_RELIABLE_PUBLIC_SOURCE.map((x) => `- ${x}`),
  "",
  "Queue #2 remains open. Transition to #3 is NOT allowed.",
  "",
].join("\n");
fs.writeFileSync(path.join(outDir, "wave2h-queue2-gap-register.md"), md);

console.log(JSON.stringify({
  ok: true,
  ruleEntries: ruleMatrix.entries.length,
  regEntries: regMatrix.entries.length,
  caseEntries: caseMatrix.entries.length,
  adaptersBuilt: 0,
}));
