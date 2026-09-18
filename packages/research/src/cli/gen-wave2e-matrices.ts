/**
 * Generate Wave 2E state regulation + court rules source matrices (52 jurisdictions).
 * Inputs: jurisdiction-sources.ts, wave2c/2d reports, state-regulation adapter configs.
 * No fabricated APIs; proprietary Lexis/Westlaw browse marked blocked_by_proprietary_browse.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WAVE1_STATE_REGULATION_CONFIGS } from "../corpus/adapters/state-regulation";
import { listJurisdictionSources } from "../corpus/jurisdiction-sources";

type PlatformFamily =
  | "legislative_reference_bureau"
  | "sos_portal"
  | "lis_revisor"
  | "jcar_html"
  | "mass_cms"
  | "westlaw_browse_contract"
  | "lexis_publisher_contract"
  | "custom_html"
  | "unknown";

type Format = "API" | "XML" | "JSON" | "HTML" | "PDF" | "mixed" | "unknown";
type Quality = "high" | "medium" | "low" | "unknown";
type Refresh = "high" | "medium" | "low";
type ImplStatus =
  | "ready"
  | "adapter_available"
  | "manual_or_unimplemented"
  | "blocked_by_proprietary_browse"
  | "source_unstable"
  | "terms_review_required";

type RegEntry = {
  jurisdiction: string;
  officialSourceOwner: string | null;
  canonicalSourceUrl: string | null;
  adminCodeTitle: string;
  platformFamily: PlatformFamily;
  format: Format;
  machineReadableQuality: Quality;
  citationStructure: string;
  currentnessMetadataAvailability: "source_date" | "partial" | "unknown" | "none";
  effectiveDateMetadataAvailability: "yes" | "partial" | "unknown" | "no";
  historicalVersionAvailability: "yes" | "partial" | "unknown" | "no";
  refreshFeasibility: Refresh;
  adapterFamily: "state_regulation" | null;
  implementationStatus: ImplStatus;
  notes?: string[];
};

type CourtEntry = {
  jurisdiction: string;
  officialCourtDomain: string | null;
  canonicalRulesUrl: string | null;
  civilProcedureAvailable: boolean;
  evidenceAvailable: boolean;
  appellateAvailable: boolean;
  highCourtProceduralAvailable: boolean;
  format: Format;
  citationExamples: string[];
  effectiveDateSupport: "yes" | "partial" | "unknown" | "no";
  adapterFeasibility: Refresh;
  implementationStatus: ImplStatus;
  notes: string[];
};

const ADMIN_CODE_TITLES: Record<string, string> = {
  US: "Code of Federal Regulations",
  AL: "Alabama Administrative Code",
  AK: "Alaska Administrative Code",
  AZ: "Arizona Administrative Code",
  AR: "Arkansas Administrative Code",
  CA: "California Code of Regulations",
  CO: "Colorado Code of Regulations",
  CT: "Connecticut Administrative Regulations",
  DE: "Delaware Administrative Code",
  FL: "Florida Administrative Code",
  GA: "Georgia Compiled Rules and Regulations",
  HI: "Hawaii Administrative Rules",
  ID: "Idaho Administrative Code",
  IL: "Illinois Administrative Code",
  IN: "Indiana Administrative Code and Rules",
  IA: "Iowa Administrative Code",
  KS: "Kansas Administrative Regulations",
  KY: "Kentucky Administrative Regulations",
  LA: "Louisiana Administrative Code",
  ME: "Maine Administrative Code",
  MD: "Code of Maryland Regulations",
  MA: "Code of Massachusetts Regulations",
  MI: "Michigan Administrative Code",
  MN: "Minnesota Administrative Rules",
  MS: "Mississippi Administrative Code",
  MO: "Missouri Code of State Regulations",
  MT: "Montana Administrative Rules",
  NE: "Nebraska Administrative Code",
  NV: "Nevada Administrative Code",
  NH: "New Hampshire Code of Administrative Rules",
  NJ: "New Jersey Administrative Code",
  NM: "New Mexico Administrative Code",
  NY: "New York Codes, Rules and Regulations",
  NC: "North Carolina Administrative Code",
  ND: "North Dakota Administrative Code",
  OH: "Ohio Administrative Code",
  OK: "Oklahoma Administrative Rules",
  OR: "Oregon Administrative Rules",
  PA: "Pennsylvania Code (Title 67 et seq.)",
  RI: "Rhode Island Administrative Code",
  SC: "South Carolina Code of Regulations",
  SD: "South Dakota Administrative Rules",
  TN: "Tennessee Compilation of Rules and Regulations",
  TX: "Texas Administrative Code",
  UT: "Utah Administrative Code",
  VT: "Vermont Administrative Rules",
  VA: "Virginia Administrative Code",
  WA: "Washington Administrative Code",
  WV: "West Virginia Code of State Rules",
  WI: "Wisconsin Administrative Code",
  WY: "Wyoming Administrative Rules",
  DC: "District of Columbia Municipal Regulations",
};

const CITATION_STRUCTURES: Record<string, string> = {
  US: "29 C.F.R. § 825.112",
  AL: "Ala. Admin. Code r. 660-X-6-.01",
  AK: "4 AAC 07.010",
  AZ: "Ariz. Admin. Code R18-4-215",
  AR: "005.01.22-001",
  CA: "Cal. Code Regs. tit. 2, § 11042",
  CO: "5 CCR 1007-2, Part 1",
  CT: "Conn. Agencies Regs. § 19a-36-A10",
  DE: "16 Del. Admin. Code § 4501.0",
  FL: "Fla. Admin. Code R. 60A-1.004",
  GA: "Ga. Comp. R. & Regs. r. 480-3-.02",
  HI: "Haw. Admin. Rules § 11-60.1-1",
  ID: "IDAPA 08.02.01.100",
  IL: "Ill. Admin. Code tit. 77, § 1000.10",
  IN: "675 IAC 12-6-1",
  IA: "Iowa Admin. Code r. 481-25.1",
  KS: "K.A.R. 28-4-135",
  KY: "902 KAR 2:020",
  LA: "La. Admin. Code tit. 51, § 101",
  ME: "01-001 C.M.R. ch. 1, § 1",
  MD: "COMAR 10.09.01.01",
  MA: "940 CMR 3.00",
  MI: "Mich. Admin. Code R 325.7001",
  MN: "Minn. R. 4620.0100",
  MS: "Miss. Admin. Code Pt. 100, r. 1.1",
  MO: "2 CSR 10-2.010",
  MT: "ARM 37.82.101",
  NE: "173 NAC 1",
  NV: "NAC 284.546",
  NH: "Env-A 100.01",
  NJ: "N.J. Admin. Code § 13:45A-1.1",
  NM: "N.M. Admin. Code § 18.104.22.168",
  NY: "19 N.Y.C.R.R. § 130-1.1",
  NC: "15A NCAC 18A .0101",
  ND: "N.D. Admin. Code § 33-04-01-01",
  OH: "Ohio Admin. Code 3701-9-01",
  OK: "OAC 310:675-1-2",
  OR: "OAR 411-015-0005",
  PA: "61 Pa. Code § 67.1",
  RI: "R.I. Code R. 05-000-001",
  SC: "S.C. Code Regs. 61-1",
  SD: "ARSD 44:09:01:01",
  TN: "Tenn. Comp. R. & Regs. 1200-03-01-.01",
  TX: "16 Tex. Admin. Code § 3.30",
  UT: "R432-100-1",
  VT: "Code Vt. R. 13 140 001",
  VA: "12 Va. Admin. Code § 5-421-460",
  WA: "WAC 388-112-0010",
  WV: "64 CSR 7",
  WI: "Wis. Admin. Code DHS 105.01",
  WY: "Wyo. Rules and Regulations HMD 001",
  DC: "DCMR Title 22, § 100",
};

/** Curated regulation overrides — only URLs/owners verified in wave2c/2d or jurisdiction-sources. */
const REG_OVERRIDES: Partial<Record<string, Partial<RegEntry>>> = {
  US: {
    officialSourceOwner: "Office of the Federal Register / GPO (eCFR)",
    canonicalSourceUrl: "https://www.ecfr.gov/",
    platformFamily: "unknown",
    format: "API",
    machineReadableQuality: "high",
    currentnessMetadataAvailability: "source_date",
    effectiveDateMetadataAvailability: "yes",
    historicalVersionAvailability: "partial",
    refreshFeasibility: "high",
    adapterFamily: null,
    implementationStatus: "ready",
    notes: ["ecfr adapter ready; public versioner API with as-of date metadata."],
  },
  AZ: {
    officialSourceOwner: "Arizona Secretary of State (Administrative Code)",
    canonicalSourceUrl: "https://apps.azsos.gov/public_services/CodeTitle.htm",
    platformFamily: "sos_portal",
    format: "HTML",
    machineReadableQuality: "low",
    currentnessMetadataAvailability: "unknown",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "low",
    adapterFamily: "state_regulation",
    implementationStatus: "manual_or_unimplemented",
  },
  CA: {
    officialSourceOwner: "California Office of Administrative Law (compiler); Thomson Reuters (contracted online browse)",
    canonicalSourceUrl: "https://oal.ca.gov/publications/ccr/",
    platformFamily: "westlaw_browse_contract",
    format: "mixed",
    machineReadableQuality: "low",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "partial",
    historicalVersionAvailability: "partial",
    refreshFeasibility: "low",
    adapterFamily: "state_regulation",
    implementationStatus: "blocked_by_proprietary_browse",
    notes: [
      "Full online CCR via govt.westlaw.com/calregs under state contract; OAL page is compiler landing only.",
      "Title 24 excluded from online CCR.",
    ],
  },
  DE: {
    officialSourceOwner: "Delaware Register of Regulations",
    canonicalSourceUrl: "https://regulations.delaware.gov/",
    platformFamily: "sos_portal",
    format: "HTML",
    machineReadableQuality: "medium",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "partial",
    historicalVersionAvailability: "partial",
    refreshFeasibility: "medium",
    adapterFamily: "state_regulation",
    implementationStatus: "adapter_available",
  },
  FL: {
    officialSourceOwner: "Florida Department of State (Florida Administrative Code & Register)",
    canonicalSourceUrl: "https://www.flrules.org/",
    platformFamily: "sos_portal",
    format: "HTML",
    machineReadableQuality: "medium",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "partial",
    historicalVersionAvailability: "partial",
    refreshFeasibility: "high",
    adapterFamily: "state_regulation",
    implementationStatus: "adapter_available",
  },
  IL: {
    officialSourceOwner: "Joint Committee on Administrative Rules (JCAR) / Illinois General Assembly",
    canonicalSourceUrl: "https://www.ilga.gov/commission/jcar/admincode/titles.html",
    platformFamily: "jcar_html",
    format: "HTML",
    machineReadableQuality: "medium",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "partial",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "medium",
    adapterFamily: "state_regulation",
    implementationStatus: "adapter_available",
  },
  MA: {
    officialSourceOwner: "Commonwealth of Massachusetts (Executive agencies; CMR on mass.gov)",
    canonicalSourceUrl: "https://www.mass.gov/lists/code-of-massachusetts-regulations-cmr-by-number",
    platformFamily: "mass_cms",
    format: "HTML",
    machineReadableQuality: "low",
    currentnessMetadataAvailability: "unknown",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "low",
    adapterFamily: "state_regulation",
    implementationStatus: "terms_review_required",
    notes: ["Automated HEAD returned 403 — likely bot filtering; prefer throttled manual snapshot."],
  },
  NJ: {
    officialSourceOwner: "New Jersey Office of Administrative Law (compiler); LexisNexis/Matthew Bender (official publisher)",
    canonicalSourceUrl: "https://www.nj.gov/oal/rules/accessp/",
    platformFamily: "lexis_publisher_contract",
    format: "HTML",
    machineReadableQuality: "low",
    currentnessMetadataAvailability: "unknown",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "low",
    adapterFamily: "state_regulation",
    implementationStatus: "blocked_by_proprietary_browse",
    notes: [
      "OAL directs public to Lexis hottopics mirror; site states online version is not the official Code.",
    ],
  },
  NY: {
    officialSourceOwner: "New York Department of State, Division of Administrative Rules (compiler); Thomson Reuters Westlaw (unofficial browse)",
    canonicalSourceUrl: "https://dos.ny.gov/division-administrative-rules",
    platformFamily: "westlaw_browse_contract",
    format: "mixed",
    machineReadableQuality: "low",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "partial",
    historicalVersionAvailability: "partial",
    refreshFeasibility: "low",
    adapterFamily: "state_regulation",
    implementationStatus: "blocked_by_proprietary_browse",
    notes: [
      "Searchable NYCRR text on govt.westlaw.com/nycrr labeled unofficial.",
      "Official State Register PDFs at dos.ny.gov are register-only, not full codified code.",
      "Registry URL www.dos.ny.gov/info/nycrr.html returns 404 (wave2d).",
    ],
  },
  PA: {
    officialSourceOwner: "Pennsylvania Legislative Reference Bureau (Pennsylvania Code and Bulletin)",
    canonicalSourceUrl: "https://www.pacodeandbulletin.gov/",
    platformFamily: "legislative_reference_bureau",
    format: "HTML",
    machineReadableQuality: "medium",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "partial",
    historicalVersionAvailability: "partial",
    refreshFeasibility: "high",
    adapterFamily: "state_regulation",
    implementationStatus: "adapter_available",
  },
  TX: {
    officialSourceOwner: "Texas Secretary of State (Texas Register & Texas Administrative Code)",
    canonicalSourceUrl: "https://www.sos.texas.gov/texreg/index.shtml",
    platformFamily: "sos_portal",
    format: "mixed",
    machineReadableQuality: "low",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "partial",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "medium",
    adapterFamily: "state_regulation",
    implementationStatus: "source_unstable",
    notes: [
      "Legacy readtac.cfm returned 401 on automated check; Appian portal migration adds session friction.",
    ],
  },
  VA: {
    officialSourceOwner: "Virginia General Assembly — Legislative Information System (LIS)",
    canonicalSourceUrl: "https://law.lis.virginia.gov/admincode/",
    platformFamily: "lis_revisor",
    format: "HTML",
    machineReadableQuality: "medium",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "partial",
    historicalVersionAvailability: "partial",
    refreshFeasibility: "high",
    adapterFamily: "state_regulation",
    implementationStatus: "adapter_available",
  },
  CT: {
    platformFamily: "lexis_publisher_contract",
    implementationStatus: "blocked_by_proprietary_browse",
    notes: ["Wave2d: official-publisher Lexis arrangement reported — verify before any ingestion."],
  },
  RI: {
    platformFamily: "lexis_publisher_contract",
    implementationStatus: "blocked_by_proprietary_browse",
    notes: ["Wave2d: official-publisher Lexis arrangement reported — verify before any ingestion."],
  },
  WV: {
    platformFamily: "lexis_publisher_contract",
    implementationStatus: "blocked_by_proprietary_browse",
    notes: ["Wave2d: official-publisher Lexis arrangement reported — verify before any ingestion."],
  },
  MN: {
    officialSourceOwner: "Minnesota Office of the Revisor of Statutes",
    canonicalSourceUrl: "https://www.revisor.mn.gov/rules/",
    platformFamily: "lis_revisor",
    notes: ["Wave2d LIS/revisor family example state."],
    format: "HTML",
    machineReadableQuality: "medium",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "medium",
    adapterFamily: "state_regulation",
    implementationStatus: "manual_or_unimplemented",
  },
  WI: {
    officialSourceOwner: "Wisconsin Legislative Reference Bureau",
    canonicalSourceUrl: "https://docs.legis.wisconsin.gov/code/admin_code",
    platformFamily: "lis_revisor",
    notes: ["Wave2d LIS/revisor family example state."],
    format: "HTML",
    machineReadableQuality: "medium",
    currentnessMetadataAvailability: "partial",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "medium",
    adapterFamily: "state_regulation",
    implementationStatus: "manual_or_unimplemented",
  },
  IN: {
    officialSourceOwner: "Indiana Legislative Services Agency",
    canonicalSourceUrl: "https://iga.in.gov/laws/administrative-rules",
    platformFamily: "lis_revisor",
    notes: ["Wave2d LIS/revisor family example state."],
    format: "HTML",
    machineReadableQuality: "medium",
    currentnessMetadataAvailability: "unknown",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "medium",
    adapterFamily: "state_regulation",
    implementationStatus: "manual_or_unimplemented",
  },
  GA: {
    officialSourceOwner: "Georgia Secretary of State (Rules and Regulations)",
    canonicalSourceUrl: "https://rules.sos.ga.gov/",
    platformFamily: "lis_revisor",
    notes: ["Wave2d LIS/revisor family example state."],
    format: "HTML",
    machineReadableQuality: "medium",
    currentnessMetadataAvailability: "unknown",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "medium",
    adapterFamily: "state_regulation",
    implementationStatus: "manual_or_unimplemented",
  },
  AR: {
    officialSourceOwner: "Arkansas Secretary of State",
    canonicalSourceUrl: "https://www.sos.arkansas.gov/rules-and-regulations/arkansas-administrative-code",
    platformFamily: "sos_portal",
    notes: ["Wave2d SOS portal family example state."],
    format: "HTML",
    machineReadableQuality: "low",
    currentnessMetadataAvailability: "unknown",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "low",
    adapterFamily: "state_regulation",
    implementationStatus: "manual_or_unimplemented",
  },
  KS: {
    officialSourceOwner: "Kansas Secretary of State",
    canonicalSourceUrl: "https://sos.ks.gov/publications/Regulations.html",
    platformFamily: "sos_portal",
    format: "HTML",
    machineReadableQuality: "low",
    currentnessMetadataAvailability: "unknown",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: "low",
    adapterFamily: "state_regulation",
    implementationStatus: "manual_or_unimplemented",
    notes: ["Wave2d SOS portal family example state; URL not spot-checked this session."],
  },
  ND: {
    platformFamily: "lis_revisor",
    implementationStatus: "manual_or_unimplemented",
    notes: ["Wave2d LIS/revisor family example state; official admin code URL not recorded in registry."],
  },
};

const COURT_OVERRIDES: Partial<Record<string, Partial<CourtEntry>>> = {
  US: {
    canonicalRulesUrl: "https://www.uscourts.gov/rules-policies",
    civilProcedureAvailable: true,
    evidenceAvailable: true,
    appellateAvailable: true,
    highCourtProceduralAvailable: true,
    format: "HTML",
    citationExamples: ["Fed. R. Civ. P. 12(b)(6)", "Fed. R. Evid. 401", "Fed. R. App. P. 4(a)(1)(A)"],
    effectiveDateSupport: "yes",
    adapterFeasibility: "high",
    implementationStatus: "ready",
    notes: ["uscourts_rules adapter configured for federal rules entry points."],
  },
  CA: {
    canonicalRulesUrl: "https://www.courts.ca.gov/rules.htm",
    civilProcedureAvailable: true,
    evidenceAvailable: true,
    appellateAvailable: true,
    highCourtProceduralAvailable: true,
    format: "HTML",
    citationExamples: ["Cal. R. Ct. 3.110", "Cal. R. Ct. 8.204"],
    effectiveDateSupport: "partial",
    adapterFeasibility: "medium",
    implementationStatus: "manual_or_unimplemented",
    notes: ["Official judiciary rules hub; not yet wired to corpus adapter."],
  },
  FL: {
    canonicalRulesUrl: "https://www.flcourts.gov/Rules-Proc",
    civilProcedureAvailable: true,
    evidenceAvailable: true,
    appellateAvailable: true,
    highCourtProceduralAvailable: true,
    format: "HTML",
    citationExamples: ["Fla. R. Civ. P. 1.110", "Fla. R. App. P. 9.110"],
    effectiveDateSupport: "partial",
    adapterFeasibility: "high",
    implementationStatus: "manual_or_unimplemented",
    notes: ["Wave2d verified 200; central rules hub."],
  },
  NY: {
    canonicalRulesUrl: "https://ww2.nycourts.gov/rules/index.shtml",
    civilProcedureAvailable: true,
    evidenceAvailable: true,
    appellateAvailable: true,
    highCourtProceduralAvailable: true,
    format: "HTML",
    citationExamples: ["CPLR 3012(a)", "22 NYCRR § 202.5"],
    effectiveDateSupport: "partial",
    adapterFeasibility: "medium",
    implementationStatus: "manual_or_unimplemented",
    notes: ["Registry URL returned 403 on automated HEAD; likely valid in browser."],
  },
  PA: {
    canonicalRulesUrl:
      "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/231/chapter1/chap1toc.html",
    civilProcedureAvailable: true,
    evidenceAvailable: true,
    appellateAvailable: true,
    highCourtProceduralAvailable: true,
    format: "HTML",
    citationExamples: ["Pa.R.C.P. 1007", "Pa.R.A.P. 903", "Pa.R.E. 401"],
    effectiveDateSupport: "partial",
    adapterFeasibility: "high",
    implementationStatus: "adapter_available",
    notes: [
      "Court rules codified in Pa Code Title 231; registry pacourts.us/rules-and-procedures returns 404.",
    ],
  },
  VA: {
    canonicalRulesUrl: "https://www.vacourts.gov/courts/scv/rules",
    civilProcedureAvailable: true,
    evidenceAvailable: true,
    appellateAvailable: true,
    highCourtProceduralAvailable: true,
    format: "HTML",
    citationExamples: ["Va. Sup. Ct. R. 5:1", "Va. Code § 8.01-271.1"],
    effectiveDateSupport: "partial",
    adapterFeasibility: "high",
    implementationStatus: "manual_or_unimplemented",
    notes: ["Wave2d verified 200; trial rules on separate vacourts pages."],
  },
};

function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function defaultReg(code: string, registryUrl: string | null): RegEntry {
  const hasAdapterConfig = code in WAVE1_STATE_REGULATION_CONFIGS;
  return {
    jurisdiction: code,
    officialSourceOwner: null,
    canonicalSourceUrl: registryUrl,
    adminCodeTitle: ADMIN_CODE_TITLES[code] ?? `${code} Administrative Code`,
    platformFamily: registryUrl ? "custom_html" : "unknown",
    format: registryUrl ? "HTML" : "unknown",
    machineReadableQuality: "unknown",
    citationStructure: CITATION_STRUCTURES[code] ?? `${code} admin. code (format varies)`,
    currentnessMetadataAvailability: "unknown",
    effectiveDateMetadataAvailability: "unknown",
    historicalVersionAvailability: "unknown",
    refreshFeasibility: registryUrl ? "low" : "low",
    adapterFamily: hasAdapterConfig ? "state_regulation" : null,
    implementationStatus: registryUrl ? "manual_or_unimplemented" : "manual_or_unimplemented",
    notes: registryUrl
      ? ["Official regulation URL in jurisdiction-sources registry; not yet triaged in wave2d."]
      : ["No official regulation URL recorded in jurisdiction-sources registry."],
  };
}

function buildRegEntry(code: string, registryUrl: string | null): RegEntry {
  const base = defaultReg(code, registryUrl);
  const override = REG_OVERRIDES[code];
  if (!override) return base;
  return {
    ...base,
    ...override,
    jurisdiction: code,
    adminCodeTitle: override.adminCodeTitle ?? base.adminCodeTitle,
    citationStructure: override.citationStructure ?? base.citationStructure,
    notes: [...(base.notes ?? []), ...(override.notes ?? [])],
  };
}

function defaultCourt(code: string, judiciaryUrl: string | null, rulesUrl: string | null): CourtEntry {
  return {
    jurisdiction: code,
    officialCourtDomain: domainFromUrl(judiciaryUrl),
    canonicalRulesUrl: rulesUrl,
    civilProcedureAvailable: false,
    evidenceAvailable: false,
    appellateAvailable: false,
    highCourtProceduralAvailable: false,
    format: rulesUrl ? "HTML" : "unknown",
    citationExamples: [],
    effectiveDateSupport: "unknown",
    adapterFeasibility: rulesUrl ? "low" : "low",
    implementationStatus: rulesUrl ? "manual_or_unimplemented" : "manual_or_unimplemented",
    notes: rulesUrl
      ? ["Official court rules URL in registry; not yet triaged for adapter feasibility."]
      : ["No official court rules URL recorded; judiciary portal may host rules separately."],
  };
}

function buildCourtEntry(
  code: string,
  judiciaryUrl: string | null,
  rulesUrl: string | null,
): CourtEntry {
  const base = defaultCourt(code, judiciaryUrl, rulesUrl);
  const override = COURT_OVERRIDES[code];
  if (!override) return base;
  return {
    ...base,
    ...override,
    jurisdiction: code,
    officialCourtDomain: override.officialCourtDomain ?? base.officialCourtDomain,
    notes: [...(base.notes ?? []), ...(override.notes ?? [])],
  };
}

function countBy<T extends string>(items: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const item of items) {
    out[item] = (out[item] ?? 0) + 1;
  }
  return out;
}

function regMdTable(entries: RegEntry[]): string[] {
  return [
    `| Code | Status | Platform | Format | URL |`,
    `| --- | --- | --- | --- | --- |`,
    ...entries.map((e) => {
      const url = e.canonicalSourceUrl ? `[link](${e.canonicalSourceUrl})` : "—";
      return `| ${e.jurisdiction} | ${e.implementationStatus} | ${e.platformFamily} | ${e.format} | ${url} |`;
    }),
  ];
}

function courtMdTable(entries: CourtEntry[]): string[] {
  return [
    `| Code | Status | Domain | Rules URL | Civil | Evid | App | High Ct |`,
    `| --- | --- | --- | --- | ---: | ---: | ---: | ---: |`,
    ...entries.map((e) => {
      const url = e.canonicalRulesUrl ? `[link](${e.canonicalRulesUrl})` : "—";
      const yn = (v: boolean) => (v ? "Y" : "—");
      return `| ${e.jurisdiction} | ${e.implementationStatus} | ${e.officialCourtDomain ?? "—"} | ${url} | ${yn(e.civilProcedureAvailable)} | ${yn(e.evidenceAvailable)} | ${yn(e.appellateAvailable)} | ${yn(e.highCourtProceduralAvailable)} |`;
    }),
  ];
}

async function main() {
  const registry = listJurisdictionSources();
  const regEntries = registry.map((src) =>
    buildRegEntry(src.code, src.officialRegulationUrl),
  );
  const courtEntries = registry.map((src) =>
    buildCourtEntry(src.code, src.officialJudiciaryUrl, src.officialCourtRulesUrl),
  );

  const regSummary = {
    jurisdictionCount: regEntries.length,
    implementationStatus: countBy(regEntries.map((e) => e.implementationStatus)),
    platformFamily: countBy(regEntries.map((e) => e.platformFamily)),
    withCanonicalUrl: regEntries.filter((e) => e.canonicalSourceUrl).length,
    adapterAvailable: regEntries.filter((e) => e.implementationStatus === "adapter_available").length,
  };

  const courtSummary = {
    jurisdictionCount: courtEntries.length,
    implementationStatus: countBy(courtEntries.map((e) => e.implementationStatus)),
    withCanonicalRulesUrl: courtEntries.filter((e) => e.canonicalRulesUrl).length,
    tractableRulesSets: courtEntries.filter(
      (e) =>
        e.civilProcedureAvailable &&
        e.evidenceAvailable &&
        e.appellateAvailable &&
        e.highCourtProceduralAvailable,
    ).length,
  };

  const generatedAt = new Date().toISOString();
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../corpus/reports");
  await mkdir(outDir, { recursive: true });

  const regJson = {
    generatedAt,
    phase: "50S-WAVE-2E",
    matrixType: "state_regulation_source",
    methodology: [
      "Primary inputs: jurisdiction-sources.ts, wave2c-regulation-source-registry.json, wave2d-state-reg-triage.json, state-regulation.ts WAVE1 configs.",
      "Wave-1 CA/MA/NJ/NY/TX: prefer official compilers; Westlaw/Lexis browse-only → blocked_by_proprietary_browse.",
      "No public APIs assumed or invented.",
    ],
    summary: regSummary,
    entries: regEntries,
  };

  const courtJson = {
    generatedAt,
    phase: "50S-WAVE-2E",
    matrixType: "court_rules_source",
    methodology: [
      "Primary inputs: jurisdiction-sources.ts officialJudiciaryUrl / officialCourtRulesUrl, wave2d courtRulesTractable.",
      "Availability flags set only where official rules hub verified or codified in known platform (e.g., PA Title 231).",
    ],
    summary: courtSummary,
    entries: courtEntries,
  };

  const cadenceJson = {
    generatedAt,
    phase: "50S-WAVE-2E",
    policyType: "refresh_cadence",
    notes: [
      "Conservative defaults for NyayaGrid corpus refresh scheduling.",
      "Interval days are minimum spacing between automated refresh attempts; manual-only has no scheduler.",
    ],
    classes: {
      regulatory_frequent: {
        intervalDays: 7,
        appliesTo: ["US eCFR", "States with adapter_available and high refreshFeasibility"],
        notes:
          "Federal eCFR updates continuously; weekly check balances freshness vs. API load. State regs with stable HTML adapters may use 14-day override per jurisdiction.",
      },
      statute_periodic: {
        intervalDays: 90,
        appliesTo: ["State statutes via state_statute adapter", "USC House viewer snapshots"],
        notes:
          "Session-law-driven; quarterly refresh unless jurisdiction signals mid-session codification update.",
      },
      court_rules_periodic: {
        intervalDays: 180,
        appliesTo: ["Federal US Courts rules", "State court rules with official HTML hubs"],
        notes:
          "Rules amend less frequently than regulations; semi-annual check unless court order amends tracked rule set.",
      },
      constitution_static: {
        intervalDays: 365,
        appliesTo: ["State and federal constitutional provisions in seed corpus"],
        notes: "Amendments are rare; annual verification sufficient unless amendment ballot pending.",
      },
      manual_only: {
        intervalDays: null,
        appliesTo: [
          "blocked_by_proprietary_browse (Lexis/Westlaw)",
          "terms_review_required (mass.gov CMS)",
          "source_unstable (TX TAC transition)",
          "Jurisdictions without canonical official URL",
        ],
        notes:
          "No automated refresh; human-curated snapshot or licensed source required before re-ingest.",
      },
    },
  };

  const regJsonPath = join(outDir, "wave2e-state-reg-source-matrix.json");
  const regMdPath = join(outDir, "wave2e-state-reg-source-matrix.md");
  const courtJsonPath = join(outDir, "wave2e-court-rules-source-matrix.json");
  const courtMdPath = join(outDir, "wave2e-court-rules-source-matrix.md");
  const cadencePath = join(outDir, "wave2e-refresh-cadence-policy.json");

  await writeFile(regJsonPath, `${JSON.stringify(regJson, null, 2)}\n`, "utf-8");
  await writeFile(courtJsonPath, `${JSON.stringify(courtJson, null, 2)}\n`, "utf-8");
  await writeFile(cadencePath, `${JSON.stringify(cadenceJson, null, 2)}\n`, "utf-8");

  const regMd = [
    `# Wave 2E — State Regulation Source Matrix`,
    ``,
    `Phase: **50S-WAVE-2E** | Jurisdictions: **${regSummary.jurisdictionCount}** (US + 50 states + DC)`,
    ``,
    `Generated: ${generatedAt}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Count |`,
    `| --- | ---: |`,
    `| With canonical URL | ${regSummary.withCanonicalUrl} |`,
    `| adapter_available | ${regSummary.adapterAvailable} |`,
    ...Object.entries(regSummary.implementationStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `| implementationStatus: ${k} | ${v} |`),
    ``,
    `### platformFamily counts`,
    ``,
    `| Platform | Count |`,
    `| --- | ---: |`,
    ...Object.entries(regSummary.platformFamily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `| ${k} | ${v} |`),
    ``,
    `## Honest limits`,
    ``,
    `- Only US eCFR is \`ready\`; five Wave-1 states have \`adapter_available\` configs in state-regulation.ts.`,
    `- CA, NJ, NY blocked by proprietary Lexis/Westlaw browse contracts.`,
    `- Many states lack a recorded official regulation URL — not triaged beyond registry.`,
    ``,
    `## Matrix`,
    ``,
    ...regMdTable(regEntries),
    ``,
  ].join("\n");

  const courtMd = [
    `# Wave 2E — Court Rules Source Matrix`,
    ``,
    `Phase: **50S-WAVE-2E** | Jurisdictions: **${courtSummary.jurisdictionCount}**`,
    ``,
    `Generated: ${generatedAt}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Count |`,
    `| --- | ---: |`,
    `| With canonical rules URL | ${courtSummary.withCanonicalRulesUrl} |`,
    `| Full rules set flagged available | ${courtSummary.tractableRulesSets} |`,
    ...Object.entries(courtSummary.implementationStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `| implementationStatus: ${k} | ${v} |`),
    ``,
    `## Honest limits`,
    ``,
    `- Federal US Courts rules adapter is \`ready\`; PA rules share Pa Code platform (\`adapter_available\`).`,
    `- Most states: rules URL not recorded or not triaged; availability flags default false.`,
    ``,
    `## Matrix`,
    ``,
    ...courtMdTable(courtEntries),
    ``,
  ].join("\n");

  await writeFile(regMdPath, regMd, "utf-8");
  await writeFile(courtMdPath, courtMd, "utf-8");

  console.log(JSON.stringify({ regSummary, courtSummary, paths: [regJsonPath, regMdPath, courtJsonPath, courtMdPath, cadencePath] }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
