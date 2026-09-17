/**
 * Canonical jurisdiction → primary-law source registry for corpus expansion.
 * URLs are well-known official entry points; null means not confidently published here.
 */

export const FEDERAL_JURISDICTION_CODE = "US" as const;

export type JurisdictionSourceType = "federal" | "state" | "district";

export type ImporterStatus = "ready" | "configured" | "planned" | "unavailable";

export type CoverageStatus =
  | "no_corpus"
  | "seed_corpus"
  | "limited_corpus"
  | "broader_corpus";

export type JurisdictionSourceRecord = {
  code: string;
  displayName: string;
  type: JurisdictionSourceType;
  highestCourtName: string;
  intermediateAppellateNote: string | null;
  officialLegislatureUrl: string | null;
  officialJudiciaryUrl: string | null;
  officialRegulationUrl: string | null;
  officialCourtRulesUrl: string | null;
  importerStatus: ImporterStatus;
  coverageStatus: CoverageStatus;
  caseSourceAdapters: string[];
  statuteSourceAdapters: string[];
  regulationSourceAdapters: string[];
  courtRulesSourceAdapters: string[];
  notes: string[];
};

const WAVE1 = new Set(["CA", "DE", "FL", "IL", "MA", "NJ", "NY", "PA", "TX", "VA"]);
const WAVE2 = new Set(["OH", "GA", "NC", "WA", "CO", "AZ", "MI", "MD", "CT", "WI"]);

function importerFor(code: string): ImporterStatus {
  if (code === FEDERAL_JURISDICTION_CODE) return "ready";
  if (WAVE1.has(code) || WAVE2.has(code)) return "configured";
  return "planned";
}

function coverageFor(code: string): CoverageStatus {
  if (code === FEDERAL_JURISDICTION_CODE || WAVE1.has(code)) return "limited_corpus";
  return "seed_corpus";
}

function stateAdapters(code: string): Pick<
  JurisdictionSourceRecord,
  | "caseSourceAdapters"
  | "statuteSourceAdapters"
  | "regulationSourceAdapters"
  | "courtRulesSourceAdapters"
> {
  const status = importerFor(code);
  if (status === "configured") {
    return {
      caseSourceAdapters: ["courtlistener"],
      statuteSourceAdapters: ["state_statute"],
      regulationSourceAdapters: [],
      courtRulesSourceAdapters: [],
    };
  }
  return {
    caseSourceAdapters: ["courtlistener"],
    statuteSourceAdapters: ["state_statute"],
    regulationSourceAdapters: [],
    courtRulesSourceAdapters: [],
  };
}

function state(
  code: string,
  displayName: string,
  opts: {
    type?: JurisdictionSourceType;
    highestCourtName: string;
    intermediateAppellateNote?: string | null;
    officialLegislatureUrl?: string | null;
    officialJudiciaryUrl?: string | null;
    officialRegulationUrl?: string | null;
    officialCourtRulesUrl?: string | null;
    notes?: string[];
  },
): JurisdictionSourceRecord {
  const adapters = stateAdapters(code);
  return {
    code,
    displayName,
    type: opts.type ?? "state",
    highestCourtName: opts.highestCourtName,
    intermediateAppellateNote: opts.intermediateAppellateNote ?? null,
    officialLegislatureUrl: opts.officialLegislatureUrl ?? null,
    officialJudiciaryUrl: opts.officialJudiciaryUrl ?? null,
    officialRegulationUrl: opts.officialRegulationUrl ?? null,
    officialCourtRulesUrl: opts.officialCourtRulesUrl ?? null,
    importerStatus: importerFor(code),
    coverageStatus: coverageFor(code),
    ...adapters,
    notes: [
      "Curated shallow seed/expansion bundle present; not full primary-law coverage.",
      ...(opts.notes ?? []),
    ],
  };
}

/**
 * Ordered US + 50 states + DC. Codes are USPS (plus US for federal).
 */
export const JURISDICTION_SOURCE_REGISTRY: readonly JurisdictionSourceRecord[] = [
  {
    code: FEDERAL_JURISDICTION_CODE,
    displayName: "United States (Federal)",
    type: "federal",
    highestCourtName: "Supreme Court of the United States",
    intermediateAppellateNote: "U.S. Courts of Appeals (regional circuits)",
    officialLegislatureUrl: "https://uscode.house.gov/",
    officialJudiciaryUrl: "https://www.supremecourt.gov/",
    officialRegulationUrl: "https://www.ecfr.gov/",
    officialCourtRulesUrl: "https://www.uscourts.gov/rules-policies",
    importerStatus: "ready",
    coverageStatus: "limited_corpus",
    caseSourceAdapters: ["courtlistener"],
    statuteSourceAdapters: ["usc_house"],
    regulationSourceAdapters: ["ecfr"],
    courtRulesSourceAdapters: ["uscourts_rules"],
    notes: [
      "Federal adapters ready for USC (House), eCFR, CourtListener, and US Courts rules entry points.",
      "Seed/limited corpus only — not comprehensive federal coverage.",
    ],
  },
  state("AL", "Alabama", {
    highestCourtName: "Supreme Court of Alabama",
    intermediateAppellateNote: "Alabama Court of Civil Appeals; Court of Criminal Appeals",
    officialLegislatureUrl: "https://alison.legislature.state.al.us/",
    officialJudiciaryUrl: "https://judicial.alabama.gov/",
  }),
  state("AK", "Alaska", {
    highestCourtName: "Alaska Supreme Court",
    intermediateAppellateNote: "Alaska Court of Appeals",
    officialLegislatureUrl: "https://www.akleg.gov/",
    officialJudiciaryUrl: "https://courts.alaska.gov/",
  }),
  state("AZ", "Arizona", {
    highestCourtName: "Arizona Supreme Court",
    intermediateAppellateNote: "Arizona Court of Appeals",
    officialLegislatureUrl: "https://www.azleg.gov/",
    officialJudiciaryUrl: "https://www.azcourts.gov/",
    officialRegulationUrl: "https://apps.azsos.gov/public_services/CodeTitle.htm",
  }),
  state("AR", "Arkansas", {
    highestCourtName: "Arkansas Supreme Court",
    intermediateAppellateNote: "Arkansas Court of Appeals",
    officialLegislatureUrl: "https://www.arkleg.state.ar.us/",
    officialJudiciaryUrl: "https://www.arcourts.gov/",
  }),
  state("CA", "California", {
    highestCourtName: "Supreme Court of California",
    intermediateAppellateNote: "California Courts of Appeal",
    officialLegislatureUrl: "https://leginfo.legislature.ca.gov/",
    officialJudiciaryUrl: "https://www.courts.ca.gov/",
    officialRegulationUrl: "https://oal.ca.gov/publications/ccr/",
    officialCourtRulesUrl: "https://www.courts.ca.gov/rules.htm",
  }),
  state("CO", "Colorado", {
    highestCourtName: "Colorado Supreme Court",
    intermediateAppellateNote: "Colorado Court of Appeals",
    officialLegislatureUrl: "https://leg.colorado.gov/",
    officialJudiciaryUrl: "https://www.courts.state.co.us/",
  }),
  state("CT", "Connecticut", {
    highestCourtName: "Connecticut Supreme Court",
    intermediateAppellateNote: "Connecticut Appellate Court",
    officialLegislatureUrl: "https://www.cga.ct.gov/",
    officialJudiciaryUrl: "https://www.jud.ct.gov/",
  }),
  state("DE", "Delaware", {
    highestCourtName: "Supreme Court of Delaware",
    intermediateAppellateNote: null,
    officialLegislatureUrl: "https://delcode.delaware.gov/",
    officialJudiciaryUrl: "https://courts.delaware.gov/",
    notes: ["Delaware has no general intermediate appellate court of last resort below the Supreme Court."],
  }),
  state("FL", "Florida", {
    highestCourtName: "Supreme Court of Florida",
    intermediateAppellateNote: "Florida District Courts of Appeal",
    officialLegislatureUrl: "https://www.flsenate.gov/Laws/Statutes",
    officialJudiciaryUrl: "https://www.flcourts.gov/",
    officialRegulationUrl: "https://www.flrules.org/",
  }),
  state("GA", "Georgia", {
    highestCourtName: "Supreme Court of Georgia",
    intermediateAppellateNote: "Court of Appeals of Georgia",
    officialLegislatureUrl: "https://www.legis.ga.gov/",
    officialJudiciaryUrl: "https://www.gasupreme.us/",
  }),
  state("HI", "Hawaii", {
    highestCourtName: "Supreme Court of Hawaii",
    intermediateAppellateNote: "Hawaii Intermediate Court of Appeals",
    officialLegislatureUrl: "https://www.capitol.hawaii.gov/",
    officialJudiciaryUrl: "https://www.courts.state.hi.us/",
  }),
  state("ID", "Idaho", {
    highestCourtName: "Idaho Supreme Court",
    intermediateAppellateNote: "Idaho Court of Appeals",
    officialLegislatureUrl: "https://legislature.idaho.gov/",
    officialJudiciaryUrl: "https://isc.idaho.gov/",
  }),
  state("IL", "Illinois", {
    highestCourtName: "Supreme Court of Illinois",
    intermediateAppellateNote: "Appellate Court of Illinois",
    officialLegislatureUrl: "https://www.ilga.gov/",
    officialJudiciaryUrl: "https://www.illinoiscourts.gov/",
  }),
  state("IN", "Indiana", {
    highestCourtName: "Indiana Supreme Court",
    intermediateAppellateNote: "Indiana Court of Appeals",
    officialLegislatureUrl: "https://iga.in.gov/",
    officialJudiciaryUrl: "https://www.in.gov/courts/",
  }),
  state("IA", "Iowa", {
    highestCourtName: "Iowa Supreme Court",
    intermediateAppellateNote: "Iowa Court of Appeals",
    officialLegislatureUrl: "https://www.legis.iowa.gov/",
    officialJudiciaryUrl: "https://www.iowacourts.gov/",
  }),
  state("KS", "Kansas", {
    highestCourtName: "Kansas Supreme Court",
    intermediateAppellateNote: "Kansas Court of Appeals",
    officialLegislatureUrl: "https://www.kslegislature.gov/",
    officialJudiciaryUrl: "https://www.kscourts.gov/",
  }),
  state("KY", "Kentucky", {
    highestCourtName: "Kentucky Supreme Court",
    intermediateAppellateNote: "Kentucky Court of Appeals",
    officialLegislatureUrl: "https://legislature.ky.gov/",
    officialJudiciaryUrl: "https://kycourts.gov/",
  }),
  state("LA", "Louisiana", {
    highestCourtName: "Louisiana Supreme Court",
    intermediateAppellateNote: "Louisiana Circuit Courts of Appeal",
    officialLegislatureUrl: "https://www.legis.la.gov/",
    officialJudiciaryUrl: "https://www.lasc.org/",
  }),
  state("ME", "Maine", {
    highestCourtName: "Maine Supreme Judicial Court",
    intermediateAppellateNote: null,
    officialLegislatureUrl: "https://legislature.maine.gov/",
    officialJudiciaryUrl: "https://www.courts.maine.gov/",
  }),
  state("MD", "Maryland", {
    highestCourtName: "Supreme Court of Maryland",
    intermediateAppellateNote: "Appellate Court of Maryland",
    officialLegislatureUrl: "https://mgaleg.maryland.gov/",
    officialJudiciaryUrl: "https://www.mdcourts.gov/",
  }),
  state("MA", "Massachusetts", {
    highestCourtName: "Massachusetts Supreme Judicial Court",
    intermediateAppellateNote: "Massachusetts Appeals Court",
    officialLegislatureUrl: "https://malegislature.gov/Laws/GeneralLaws",
    officialJudiciaryUrl: "https://www.mass.gov/orgs/massachusetts-court-system",
  }),
  state("MI", "Michigan", {
    highestCourtName: "Michigan Supreme Court",
    intermediateAppellateNote: "Michigan Court of Appeals",
    officialLegislatureUrl: "https://www.legislature.mi.gov/",
    officialJudiciaryUrl: "https://www.courts.michigan.gov/",
  }),
  state("MN", "Minnesota", {
    highestCourtName: "Minnesota Supreme Court",
    intermediateAppellateNote: "Minnesota Court of Appeals",
    officialLegislatureUrl: "https://www.revisor.mn.gov/statutes/",
    officialJudiciaryUrl: "https://www.mncourts.gov/",
  }),
  state("MS", "Mississippi", {
    highestCourtName: "Supreme Court of Mississippi",
    intermediateAppellateNote: "Mississippi Court of Appeals",
    officialLegislatureUrl: "https://www.legislature.ms.gov/",
    officialJudiciaryUrl: "https://courts.ms.gov/",
  }),
  state("MO", "Missouri", {
    highestCourtName: "Supreme Court of Missouri",
    intermediateAppellateNote: "Missouri Court of Appeals",
    officialLegislatureUrl: "https://www.mo.gov/government/legislative/",
    officialJudiciaryUrl: "https://www.courts.mo.gov/",
  }),
  state("MT", "Montana", {
    highestCourtName: "Montana Supreme Court",
    intermediateAppellateNote: null,
    officialLegislatureUrl: "https://leg.mt.gov/",
    officialJudiciaryUrl: "https://courts.mt.gov/",
  }),
  state("NE", "Nebraska", {
    highestCourtName: "Nebraska Supreme Court",
    intermediateAppellateNote: "Nebraska Court of Appeals",
    officialLegislatureUrl: "https://nebraskalegislature.gov/",
    officialJudiciaryUrl: "https://supremecourt.nebraska.gov/",
  }),
  state("NV", "Nevada", {
    highestCourtName: "Supreme Court of Nevada",
    intermediateAppellateNote: "Nevada Court of Appeals",
    officialLegislatureUrl: "https://www.leg.state.nv.us/",
    officialJudiciaryUrl: "https://nvcourts.gov/",
  }),
  state("NH", "New Hampshire", {
    highestCourtName: "New Hampshire Supreme Court",
    intermediateAppellateNote: null,
    officialLegislatureUrl: "https://www.gencourt.state.nh.us/",
    officialJudiciaryUrl: "https://www.courts.nh.gov/",
  }),
  state("NJ", "New Jersey", {
    highestCourtName: "Supreme Court of New Jersey",
    intermediateAppellateNote: "Appellate Division of the Superior Court of New Jersey",
    officialLegislatureUrl: "https://www.njleg.state.nj.us/",
    officialJudiciaryUrl: "https://www.njcourts.gov/",
  }),
  state("NM", "New Mexico", {
    highestCourtName: "New Mexico Supreme Court",
    intermediateAppellateNote: "New Mexico Court of Appeals",
    officialLegislatureUrl: "https://www.nmlegis.gov/",
    officialJudiciaryUrl: "https://www.nmcourts.gov/",
  }),
  state("NY", "New York", {
    highestCourtName: "New York Court of Appeals",
    intermediateAppellateNote: "Appellate Division of the Supreme Court of the State of New York",
    officialLegislatureUrl: "https://public.leginfo.state.ny.us/",
    officialJudiciaryUrl: "https://www.nycourts.gov/",
    officialRegulationUrl: "https://www.dos.ny.gov/info/nycrr.html",
    officialCourtRulesUrl: "https://ww2.nycourts.gov/rules/index.shtml",
  }),
  state("NC", "North Carolina", {
    highestCourtName: "Supreme Court of North Carolina",
    intermediateAppellateNote: "North Carolina Court of Appeals",
    officialLegislatureUrl: "https://www.ncleg.gov/",
    officialJudiciaryUrl: "https://www.nccourts.gov/",
  }),
  state("ND", "North Dakota", {
    highestCourtName: "North Dakota Supreme Court",
    intermediateAppellateNote: "North Dakota Court of Appeals",
    officialLegislatureUrl: "https://www.ndlegis.gov/",
    officialJudiciaryUrl: "https://www.ndcourts.gov/",
  }),
  state("OH", "Ohio", {
    highestCourtName: "Supreme Court of Ohio",
    intermediateAppellateNote: "Ohio District Courts of Appeals",
    officialLegislatureUrl: "https://www.legislature.ohio.gov/",
    officialJudiciaryUrl: "https://www.supremecourt.ohio.gov/",
  }),
  state("OK", "Oklahoma", {
    highestCourtName: "Oklahoma Supreme Court",
    intermediateAppellateNote: "Oklahoma Court of Civil Appeals; Court of Criminal Appeals",
    officialLegislatureUrl: "https://www.oklegislature.gov/",
    officialJudiciaryUrl: "https://www.oscn.net/",
  }),
  state("OR", "Oregon", {
    highestCourtName: "Oregon Supreme Court",
    intermediateAppellateNote: "Oregon Court of Appeals",
    officialLegislatureUrl: "https://www.oregonlegislature.gov/",
    officialJudiciaryUrl: "https://www.courts.oregon.gov/",
  }),
  state("PA", "Pennsylvania", {
    highestCourtName: "Supreme Court of Pennsylvania",
    intermediateAppellateNote: "Superior Court of Pennsylvania; Commonwealth Court of Pennsylvania",
    officialLegislatureUrl: "https://www.legis.state.pa.us/",
    officialJudiciaryUrl: "https://www.pacourts.us/",
    officialCourtRulesUrl: "https://www.pacourts.us/rules-and-procedures",
  }),
  state("RI", "Rhode Island", {
    highestCourtName: "Rhode Island Supreme Court",
    intermediateAppellateNote: null,
    officialLegislatureUrl: "https://www.rilegislature.gov/",
    officialJudiciaryUrl: "https://www.courts.ri.gov/",
  }),
  state("SC", "South Carolina", {
    highestCourtName: "South Carolina Supreme Court",
    intermediateAppellateNote: "South Carolina Court of Appeals",
    officialLegislatureUrl: "https://www.scstatehouse.gov/",
    officialJudiciaryUrl: "https://www.sccourts.org/",
  }),
  state("SD", "South Dakota", {
    highestCourtName: "South Dakota Supreme Court",
    intermediateAppellateNote: null,
    officialLegislatureUrl: "https://sdlegislature.gov/",
    officialJudiciaryUrl: "https://ujs.sd.gov/",
  }),
  state("TN", "Tennessee", {
    highestCourtName: "Tennessee Supreme Court",
    intermediateAppellateNote: "Tennessee Court of Appeals; Court of Criminal Appeals",
    officialLegislatureUrl: "https://www.capitol.tn.gov/",
    officialJudiciaryUrl: "https://www.tncourts.gov/",
  }),
  state("TX", "Texas", {
    highestCourtName: "Supreme Court of Texas",
    intermediateAppellateNote: "Texas Courts of Appeals; Court of Criminal Appeals (criminal last resort)",
    officialLegislatureUrl: "https://statutes.capitol.texas.gov/",
    officialJudiciaryUrl: "https://www.txcourts.gov/",
  }),
  state("UT", "Utah", {
    highestCourtName: "Utah Supreme Court",
    intermediateAppellateNote: "Utah Court of Appeals",
    officialLegislatureUrl: "https://le.utah.gov/",
    officialJudiciaryUrl: "https://www.utcourts.gov/",
  }),
  state("VT", "Vermont", {
    highestCourtName: "Vermont Supreme Court",
    intermediateAppellateNote: null,
    officialLegislatureUrl: "https://legislature.vermont.gov/",
    officialJudiciaryUrl: "https://www.vermontjudiciary.org/",
  }),
  state("VA", "Virginia", {
    highestCourtName: "Supreme Court of Virginia",
    intermediateAppellateNote: "Court of Appeals of Virginia",
    officialLegislatureUrl: "https://law.lis.virginia.gov/",
    officialJudiciaryUrl: "https://www.vacourts.gov/",
  }),
  state("WA", "Washington", {
    highestCourtName: "Washington Supreme Court",
    intermediateAppellateNote: "Washington Court of Appeals",
    officialLegislatureUrl: "https://app.leg.wa.gov/RCW/",
    officialJudiciaryUrl: "https://www.courts.wa.gov/",
  }),
  state("WV", "West Virginia", {
    highestCourtName: "Supreme Court of Appeals of West Virginia",
    intermediateAppellateNote: "Intermediate Court of Appeals of West Virginia",
    officialLegislatureUrl: "https://www.wvlegislature.gov/",
    officialJudiciaryUrl: "https://www.courtswv.gov/",
  }),
  state("WI", "Wisconsin", {
    highestCourtName: "Wisconsin Supreme Court",
    intermediateAppellateNote: "Wisconsin Court of Appeals",
    officialLegislatureUrl: "https://docs.legis.wisconsin.gov/statutes",
    officialJudiciaryUrl: "https://www.wicourts.gov/",
  }),
  state("WY", "Wyoming", {
    highestCourtName: "Wyoming Supreme Court",
    intermediateAppellateNote: null,
    officialLegislatureUrl: "https://www.wyoleg.gov/",
    officialJudiciaryUrl: "https://www.courts.state.wy.us/",
  }),
  state("DC", "District of Columbia", {
    type: "district",
    highestCourtName: "District of Columbia Court of Appeals",
    intermediateAppellateNote: null,
    officialLegislatureUrl: "https://code.dccouncil.gov/",
    officialJudiciaryUrl: "https://www.dccourts.gov/",
  }),
] as const;

const BY_CODE = new Map(
  JURISDICTION_SOURCE_REGISTRY.map((row) => [row.code.toUpperCase(), row]),
);

export function getJurisdictionSource(code: string): JurisdictionSourceRecord | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

export function listJurisdictionSources(): JurisdictionSourceRecord[] {
  return [...JURISDICTION_SOURCE_REGISTRY];
}
