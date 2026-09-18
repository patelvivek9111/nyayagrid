/**
 * Deterministic statute subject-family classification for corpus depth audits.
 * No LLM — maps statuteTopic / practiceAreas / citation heuristics to a fixed bundle.
 */

export const STATUTE_SUBJECT_FAMILIES = [
  "limitations",
  "contracts_commercial",
  "corporations_business",
  "employment",
  "consumer_protection",
  "property_landlord_tenant",
  "civil_procedure_jurisdiction",
  "evidence",
  "privacy_data",
  "licensing_admin_procedure",
] as const;

export type StatuteSubjectFamily = (typeof STATUTE_SUBJECT_FAMILIES)[number];

export type SubjectCoverageStatus =
  | "covered"
  | "partial"
  | "absent"
  | "official_source_unavailable"
  | "source_blocked";

/** Minimum subjects for "meaningful statute breadth" (not a raw row count). */
export const MINIMUM_SUBJECT_BUNDLE_TARGET = 6;

const TOPIC_TO_FAMILY: Record<string, StatuteSubjectFamily> = {
  statute_of_limitations: "limitations",
  limitations_written_contract: "limitations",
  ucc_article_2_limitations: "limitations",
  statute_of_frauds: "contracts_commercial",
  ucc_merchantability: "contracts_commercial",
  ucc_warranty_disclaimer: "contracts_commercial",
  ucc_express_warranty: "contracts_commercial",
  implied_warranty: "contracts_commercial",
  contract: "contracts_commercial",
  commercial: "contracts_commercial",
  director_duties: "corporations_business",
  director_fiduciary_duties: "corporations_business",
  board_of_directors: "corporations_business",
  dgcl_board: "corporations_business",
  dgcl_certificate: "corporations_business",
  llc_liability: "corporations_business",
  corporation_purposes: "corporations_business",
  corporations: "corporations_business",
  wage_payment: "employment",
  wage_claims: "employment",
  wage_recovery: "employment",
  wage_deductions: "employment",
  minimum_wage: "employment",
  minimum_wage_policy: "employment",
  minimum_wage_definitions: "employment",
  overtime: "employment",
  unemployment_disqualification: "employment",
  workers_compensation: "employment",
  employment: "employment",
  consumer_protection: "consumer_protection",
  consumer: "consumer_protection",
  landlord_tenant: "property_landlord_tenant",
  residential_lease: "property_landlord_tenant",
  property: "property_landlord_tenant",
  eviction: "property_landlord_tenant",
  civil_procedure_pleadings: "civil_procedure_jurisdiction",
  motion_to_dismiss: "civil_procedure_jurisdiction",
  personal_jurisdiction: "civil_procedure_jurisdiction",
  venue: "civil_procedure_jurisdiction",
  long_arm: "civil_procedure_jurisdiction",
  procedure: "civil_procedure_jurisdiction",
  evidence_exclusion: "evidence",
  evidence_relevance: "evidence",
  evidence: "evidence",
  privacy: "privacy_data",
  data_breach: "privacy_data",
  data_security: "privacy_data",
  professional_licensing: "licensing_admin_procedure",
  administrative_procedure: "licensing_admin_procedure",
  apa: "licensing_admin_procedure",
  human_rights: "employment",
  scaffold_law: "employment",
  negligence: "civil_procedure_jurisdiction",
  comparative_fault: "civil_procedure_jurisdiction",
  comparative_negligence: "civil_procedure_jurisdiction",
  proportionate_responsibility: "civil_procedure_jurisdiction",
  medical_malpractice: "civil_procedure_jurisdiction",
};

const PRACTICE_AREA_TO_FAMILY: Record<string, StatuteSubjectFamily> = {
  contract: "contracts_commercial",
  commercial: "contracts_commercial",
  corporations: "corporations_business",
  employment: "employment",
  consumer: "consumer_protection",
  property: "property_landlord_tenant",
  procedure: "civil_procedure_jurisdiction",
  civil: "civil_procedure_jurisdiction",
  evidence: "evidence",
  privacy: "privacy_data",
  administrative: "licensing_admin_procedure",
};

export function classifyStatuteTopic(topic: string | null | undefined): StatuteSubjectFamily | null {
  if (!topic) return null;
  const key = topic.trim().toLowerCase().replace(/\s+/g, "_");
  if (TOPIC_TO_FAMILY[key]) return TOPIC_TO_FAMILY[key];
  for (const [prefix, family] of Object.entries(TOPIC_TO_FAMILY)) {
    if (key.includes(prefix) || prefix.includes(key)) return family;
  }
  if (/limit/.test(key)) return "limitations";
  if (/ucc|warranty|contract|merchant/.test(key)) return "contracts_commercial";
  if (/corp|director|llc|shareholder/.test(key)) return "corporations_business";
  if (/wage|employ|overtime|unemploy|labor/.test(key)) return "employment";
  if (/consumer|deceptive|unfair.?trade/.test(key)) return "consumer_protection";
  if (/landlord|tenant|lease|evict|property|real.?estat/.test(key)) return "property_landlord_tenant";
  if (/jurisdict|venue|plead|dismiss|procedure|negligen|fault/.test(key)) {
    return "civil_procedure_jurisdiction";
  }
  if (/eviden|hearsay|privilege/.test(key)) return "evidence";
  if (/privacy|breach|personal.?data|gdpr|ccpa/.test(key)) return "privacy_data";
  if (/licens|admin.?proc|apa|board.?of/.test(key)) return "licensing_admin_procedure";
  return null;
}

export function classifyStatuteAuthority(params: {
  statuteTopic?: string | null;
  practiceAreas?: string[] | null;
  citation?: string | null;
  title?: string | null;
}): StatuteSubjectFamily | null {
  const fromTopic = classifyStatuteTopic(params.statuteTopic);
  if (fromTopic) return fromTopic;
  for (const area of params.practiceAreas ?? []) {
    const key = area.trim().toLowerCase();
    if (PRACTICE_AREA_TO_FAMILY[key]) return PRACTICE_AREA_TO_FAMILY[key];
  }
  const blob = `${params.citation ?? ""} ${params.title ?? ""}`.toLowerCase();
  return classifyStatuteTopic(blob.replace(/[^a-z0-9]+/g, "_"));
}

export type JurisdictionSubjectCoverage = {
  jurisdiction: string;
  families: Record<StatuteSubjectFamily, SubjectCoverageStatus>;
  coveredCount: number;
  partialCount: number;
  absentCount: number;
  meetsMinimumBundle: boolean;
};

export function buildSubjectCoverage(params: {
  jurisdiction: string;
  familyHits: Partial<Record<StatuteSubjectFamily, number>>;
  blockedFamilies?: StatuteSubjectFamily[];
  unavailableFamilies?: StatuteSubjectFamily[];
}): JurisdictionSubjectCoverage {
  const families = {} as Record<StatuteSubjectFamily, SubjectCoverageStatus>;
  let coveredCount = 0;
  let partialCount = 0;
  let absentCount = 0;
  const blocked = new Set(params.blockedFamilies ?? []);
  const unavailable = new Set(params.unavailableFamilies ?? []);

  for (const family of STATUTE_SUBJECT_FAMILIES) {
    if (blocked.has(family)) {
      families[family] = "source_blocked";
      continue;
    }
    if (unavailable.has(family)) {
      families[family] = "official_source_unavailable";
      continue;
    }
    const n = params.familyHits[family] ?? 0;
    if (n >= 2) {
      families[family] = "covered";
      coveredCount += 1;
    } else if (n === 1) {
      families[family] = "partial";
      partialCount += 1;
    } else {
      families[family] = "absent";
      absentCount += 1;
    }
  }

  const meaningful = coveredCount + partialCount;
  return {
    jurisdiction: params.jurisdiction,
    families,
    coveredCount,
    partialCount,
    absentCount,
    meetsMinimumBundle: meaningful >= MINIMUM_SUBJECT_BUNDLE_TARGET,
  };
}
