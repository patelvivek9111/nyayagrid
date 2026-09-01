export const JURISDICTION_MODES = [
  "state",
  "federal",
  "multi_jurisdiction",
  "unknown",
] as const;
export type JurisdictionMode = (typeof JURISDICTION_MODES)[number];

export const FORUM_TYPES = ["state", "federal", "administrative", "other"] as const;
export type ForumType = (typeof FORUM_TYPES)[number];

export const CHOICE_OF_LAW_STATUSES = [
  "none_known",
  "possible",
  "stated",
  "disputed",
  "unknown",
] as const;
export type ChoiceOfLawStatus = (typeof CHOICE_OF_LAW_STATUSES)[number];

export const AUTHORITY_RELATIONSHIPS = [
  "controlling",
  "persuasive",
  "out_of_jurisdiction",
  "unknown",
] as const;
export type AuthorityRelationship = (typeof AUTHORITY_RELATIONSHIPS)[number];

export const COURT_LEVELS = [
  "scotus",
  "circuit",
  "district",
  "state_high",
  "state_appellate",
  "state_trial",
  "administrative",
  "other",
  "unknown",
] as const;
export type CourtLevel = (typeof COURT_LEVELS)[number];

export const COVERAGE_STATUSES = ["supported", "limited", "unvalidated"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const TEMPORAL_APPLICABILITY = ["applicable", "inapplicable", "unknown"] as const;
export type TemporalApplicability = (typeof TEMPORAL_APPLICABILITY)[number];

export const JURISDICTION_SOURCES = ["user_metadata", "legacy_unstructured"] as const;
export type JurisdictionSource = (typeof JURISDICTION_SOURCES)[number];

export type RelatedJurisdiction = {
  stateCode?: string | null;
  courtId?: string | null;
};

export type UsState = {
  code: string;
  name: string;
  aliases: string[];
};

export type CourtRecord = {
  id: string;
  name: string;
  shortName: string;
  jurisdictionType: "federal" | "state" | "administrative" | "other";
  state: string | null;
  level: CourtLevel;
  federalCircuit: string | null;
  active: boolean;
  aliases: string[];
};

export type MatterJurisdictionInput = {
  forumType?: ForumType | null;
  primaryState?: string | null;
  courtId?: string | null;
  governingLawState?: string | null;
  choiceOfLawStatus?: ChoiceOfLawStatus | null;
  asOfDate?: string | null;
  relatedJurisdictions?: RelatedJurisdiction[] | null;
  practiceArea?: string | null;
  /** Must match the selected district when both are provided. */
  federalCircuit?: string | null;
  /** Legacy display strings; preserved, never treated as verified governing law. */
  jurisdiction?: string | null;
  court?: string | null;
};

export type MatterJurisdictionContext = {
  matterId: string;
  organizationId: string;
  jurisdictionMode: JurisdictionMode;
  forumType: ForumType | null;
  primaryState: string | null;
  courtId: string | null;
  courtName: string | null;
  federalDistrict: string | null;
  federalCircuit: string | null;
  practiceArea: string | null;
  asOfDate: string | null;
  governingLawState: string | null;
  choiceOfLawStatus: ChoiceOfLawStatus;
  relatedJurisdictions: RelatedJurisdiction[];
  source: JurisdictionSource;
  /** Original free-text fields. Never discarded. */
  legacyJurisdiction: string | null;
  legacyCourt: string | null;
  /** Coverage of the primary state + practice area. Defaults UNVALIDATED. */
  coverage: CoverageStatus;
  coverageByPracticeArea: boolean;
  /** True when forum and governing-law state differ. */
  choiceOfLawDistinctFromForum: boolean;
  summary: string;
  /** Lawyer-facing metadata block. Not Case evidence. */
  promptBlock: string;
};

export type AuthorityJurisdictionMetadata = {
  authorityType?: string | null;
  jurisdiction?: string | null;
  court?: string | null;
  courtId?: string | null;
  authorityState?: string | null;
  federalCircuit?: string | null;
  courtLevel?: CourtLevel | string | null;
  decisionDate?: string | null;
  effectiveStart?: string | null;
  effectiveEnd?: string | null;
};

export type AuthorityRelationshipResult = {
  relationship: AuthorityRelationship;
  reason: string;
};

export class InvalidJurisdictionError extends Error {
  readonly code = "INVALID_JURISDICTION";
  constructor(message: string) {
    super(message);
    this.name = "InvalidJurisdictionError";
  }
}
