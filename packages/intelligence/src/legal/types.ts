import type { AbstentionCode, AuthorityStatusClassification } from "@nyayagrid/jurisdiction";

export const LEGAL_STANDARD_TYPES = [
  "RULE",
  "ELEMENT_TEST",
  "MULTI_FACTOR_TEST",
  "BURDEN",
  "EXCEPTION",
  "DEFENSE",
  "STANDARD_OF_REVIEW",
  "PROCEDURAL_REQUIREMENT",
  "REMEDY_RULE",
  "EVIDENTIARY_STANDARD",
  "CONSTITUTIONAL_STANDARD",
  "UNKNOWN",
] as const;
export type LegalStandardType = (typeof LEGAL_STANDARD_TYPES)[number];

export const LEGAL_STANDARD_STATUSES = ["canonical", "unknown", "needs_review"] as const;
export type LegalStandardStatus = (typeof LEGAL_STANDARD_STATUSES)[number];

export const ISSUE_AUTHORITY_RELATIONS = [
  "CONTROLLING",
  "BINDING_RELEVANT",
  "PERSUASIVE_RELEVANT",
  "CONTRARY",
  "DISTINGUISHABLE",
  "BACKGROUND",
  "UNKNOWN",
] as const;
export type IssueAuthorityRelation = (typeof ISSUE_AUTHORITY_RELATIONS)[number];

export const TREATMENT_LABELS = [
  "FOLLOWED",
  "DISTINGUISHED",
  "CRITICIZED",
  "LIMITED",
  "OVERRULED",
  "SUPERSEDED",
  "QUESTIONED",
  "NOTED",
  "UNKNOWN",
] as const;
export type TreatmentLabel = (typeof TREATMENT_LABELS)[number];

export const TREATMENT_VERIFICATION = ["verified", "unknown", "needs_review"] as const;
export type TreatmentVerification = (typeof TREATMENT_VERIFICATION)[number];

export const CONFLICT_TYPES = [
  "RULE_CONFLICT",
  "FACTUAL_DISTINCTION",
  "JURISDICTIONAL_DIFFERENCE",
  "TEMPORAL_DIFFERENCE",
  "PROCEDURAL_DIFFERENCE",
  "TREATMENT_CONFLICT",
  "UNKNOWN",
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export const EXTRACTION_ORIGINS = [
  "human",
  "import",
  "deterministic_fixture",
  "source_metadata",
] as const;
export type ExtractionOrigin = (typeof EXTRACTION_ORIGINS)[number];

export type SourceProvenance = {
  documentId?: string | null;
  authorityId?: string | null;
  sourceSpan?: string | null;
  sourcePage?: number | null;
  section?: string | null;
  extractionOrigin?: ExtractionOrigin | null;
  humanEntered?: boolean;
};

export type LegalStandard = {
  id: string;
  authorityId: string | null;
  issueId: string | null;
  ruleText: string;
  standardType: LegalStandardType;
  elements: string[];
  factors: string[];
  exceptions: string[];
  burdens: string[];
  standardOfReview: string | null;
  proceduralPosture: string | null;
  remedies: string[];
  effectiveContext: string | null;
  sourceSpan: string | null;
  sourcePage: number | null;
  sourceCitation: string | null;
  confidence: "high" | "medium" | "low";
  status: LegalStandardStatus;
  provenance: SourceProvenance;
};

export type LegalIssue = {
  id: string;
  issueType: string;
  jurisdiction: string | null;
  matterId: string | null;
  caseId: string | null;
  description: string;
  relatedFactIds: string[];
  relatedEvidenceIds: string[];
  authorityIds: string[];
  standardIds: string[];
  conflictIds: string[];
  status: string;
  confidence: "high" | "medium" | "low";
  provenance: SourceProvenance;
};

export type IssueAuthorityLink = {
  issueId: string;
  authorityId: string;
  relation: IssueAuthorityRelation;
  authorityStatus: AuthorityStatusClassification | null;
  provenance: SourceProvenance;
};

export type TreatmentRelationship = {
  sourceAuthorityId: string;
  targetAuthorityId: string;
  treatment: TreatmentLabel;
  evidenceSpan: string | null;
  sourcePage: number | null;
  confidence: "high" | "medium" | "low";
  verificationStatus: TreatmentVerification;
  authoritativeMetadata: boolean;
  provenance: SourceProvenance;
};

export type AuthorityConflict = {
  id: string;
  authorityA: string;
  authorityB: string;
  issueId: string | null;
  conflictType: ConflictType;
  explanation: string;
  supportingSourceSpans: string[];
  confidence: "high" | "medium" | "low";
  status: "recorded" | "unknown" | "needs_review";
  provenance: SourceProvenance;
};

export type AbstentionResult = {
  abstention: AbstentionCode;
  reason: string;
};

/**
 * Civil claim elements and criminal charge elements share this shape.
 * They stay in separate stores. Prosecution status never includes a guilt verdict.
 */
export const SHARED_REQUIREMENT_ABSTRACTION = {
  decision: "SHARE_SHAPE_KEEP_STORES_SEPARATE",
  shape: [
    "LEGAL_THEORY",
    "REQUIREMENT",
    "SUPPORTING_EVIDENCE",
    "CONTRARY_EVIDENCE",
    "MISSING_EVIDENCE",
    "AUTHORITY",
  ],
  rationale:
    "One law-to-evidence shape serves private matters and criminal cases. Separate stores keep prosecution records out of civil matter facts and keep element status free of guilt verdicts.",
} as const;

export type LawToEvidenceRecord = {
  issue: LegalIssue;
  standard: LegalStandard | AbstentionResult;
  requirement: string;
  facts: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  supportingEvidence: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  contraryEvidence: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  missingEvidence: string[];
  authorities: IssueAuthorityLink[];
  analysisState: "structured" | "abstained";
  guiltConclusion: null;
};
