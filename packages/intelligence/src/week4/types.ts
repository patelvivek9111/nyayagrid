import type { LegalIssueType } from "@nyayagrid/jurisdiction";
import type { SourceProvenance } from "../legal/types";

export type WorkspaceType = "professional" | "prosecution" | "student" | "public";

export type QueryContext = {
  organizationId: string;
  workspaceType: WorkspaceType;
  matterId?: string | null;
  criminalCaseId?: string | null;
  jurisdiction?: string | null;
  forumCourt?: string | null;
  issueType?: LegalIssueType | null;
  userQuestion: string;
  selectedDocuments?: string[];
  selectedEvidence?: string[];
  selectedCharge?: string | null;
  selectedElement?: string | null;
  selectedLegalIssue?: string | null;
  timeContext?: string | null;
  userRole?: string | null;
  coverageConstraints?: string[];
  subjectMatter?: "criminal" | "civil" | "general" | null;
};

export type DecomposedQuestion = {
  question: string;
  issues: Array<{
    issueType: LegalIssueType;
    description: string;
    jurisdiction: string | null;
    forumCourt: string | null;
    relatedClaimsOrCharges: string[];
    relatedFactIds: string[];
    relatedEvidenceIds: string[];
    legalResearchQuery: string;
    authorityRequirements: string[];
    confidence: "high" | "medium" | "low";
    missingContext: string[];
  }>;
  factualSubquestions: string[];
  evidentiarySubquestions: string[];
  legalResearchSubquestions: string[];
  jurisdictionRequirements: string[];
  missingContext: string[];
};

export type EvidenceRelationLabel = "SUPPORTS" | "CONTRADICTS" | "NEUTRAL" | "UNKNOWN_RELATION";

export type RetrievedEvidenceItem = {
  id: string;
  kind: string;
  text: string;
  whyRelevant: string;
  relatedIssueId: string | null;
  relatedClaimOrChargeId: string | null;
  relatedElementId: string | null;
  relation: EvidenceRelationLabel;
  documentId: string | null;
  sourceLocation: string | null;
  confidence: "high" | "medium" | "low";
  provenance: SourceProvenance;
  organizationId: string;
  matterId: string | null;
  criminalCaseId: string | null;
};

export type RetrievalScoreBreakdown = {
  semanticScore: number;
  lexicalScore: number;
  authorityContribution: number;
  citationContribution: number;
  jurisdictionFilter: "pass" | "fail" | "unknown";
  currentnessAdjustment: number;
  issueMatchContribution: number;
  finalScore: number;
};

export type CoverageWarningCode =
  | "NO_BINDING_AUTHORITY"
  | "ONLY_OUT_OF_JURISDICTION"
  | "ONLY_OLD_AUTHORITY"
  | "CURRENTNESS_UNCERTAIN"
  | "KEY_CITATION_TARGET_ABSENT"
  | "NO_SUPPORTING_EVIDENCE_FOUND"
  | "NO_CONTRARY_EVIDENCE_FOUND"
  | "ELEMENT_EVIDENCE_GAP"
  | "DOCUMENT_NOT_AVAILABLE"
  | "WITNESS_SOURCE_MISSING"
  | "TIMELINE_CONFLICT"
  | "JURISDICTION_METADATA_MISSING"
  | "CORPUS_COVERAGE_INCOMPLETE"
  | "TREATMENT_UNAVAILABLE";

export type CoverageWarning = {
  code: CoverageWarningCode;
  message: string;
  relatedIds: string[];
};

export type WeaknessCategory =
  | "EVIDENCE_GAP"
  | "CONTRADICTORY_EVIDENCE"
  | "WITNESS_CONFLICT"
  | "AUTHORITY_CONFLICT"
  | "JURISDICTION_UNCERTAINTY"
  | "MISSING_ELEMENT"
  | "PROCEDURAL_ISSUE"
  | "CURRENTNESS_UNCERTAIN"
  | "DISCOVERY_GAP"
  | "SOURCE_MISSING"
  | "UNKNOWN";

export type Weakness = {
  category: WeaknessCategory;
  description: string;
  basisIds: string[];
  provenance: SourceProvenance;
};

export type InvestigationGap = {
  description: string;
  relatedIssueId: string | null;
  relatedElementOrClaimId: string | null;
  whyNeeded: string;
  existingEvidenceIds: string[];
  missingEvidenceIds: string[];
  suggestedAction: string;
  priority: "high" | "medium" | "low";
  sourceBasis: SourceProvenance;
};

export type LawEvidenceBundle = {
  question: string;
  queryContext: QueryContext;
  issues: DecomposedQuestion["issues"];
  legalStandards: Array<{
    id: string;
    authorityId: string;
    ruleText: string;
    sourceSpan: string;
    sourceCitation: string;
    provenance: SourceProvenance;
  }>;
  requirements: Array<{
    id: string;
    text: string;
    claimOrChargeId: string;
    status: string;
  }>;
  supportingFacts: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  supportingEvidence: RetrievedEvidenceItem[];
  contraryFacts: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  contraryEvidence: RetrievedEvidenceItem[];
  missingEvidence: Array<{ id: string; description: string; relatedRequirementId: string | null }>;
  bindingAuthorities: Array<Record<string, unknown>>;
  persuasiveAuthorities: Array<Record<string, unknown>>;
  contraryAuthorities: Array<Record<string, unknown>>;
  treatment: Array<{ authorityId: string; label: string; verification: string }>;
  coverageWarnings: CoverageWarning[];
  weaknesses: Weakness[];
  investigationGaps: InvestigationGap[];
  guiltConclusion: null;
  sourceMap: Array<{ id: string; sourceType: string; provenance: SourceProvenance }>;
};

export type StructuredAnswerContext = {
  QUESTION: string;
  ISSUES: DecomposedQuestion["issues"];
  FACTS: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  EVIDENCE_FOR: RetrievedEvidenceItem[];
  EVIDENCE_AGAINST: RetrievedEvidenceItem[];
  MISSING_EVIDENCE: LawEvidenceBundle["missingEvidence"];
  LEGAL_STANDARDS: LawEvidenceBundle["legalStandards"];
  BINDING_AUTHORITY: LawEvidenceBundle["bindingAuthorities"];
  PERSUASIVE_AUTHORITY: LawEvidenceBundle["persuasiveAuthorities"];
  CONTRARY_AUTHORITY: LawEvidenceBundle["contraryAuthorities"];
  TREATMENT: LawEvidenceBundle["treatment"];
  COVERAGE_WARNINGS: CoverageWarning[];
  SOURCE_MAP: LawEvidenceBundle["sourceMap"];
  GUILT_CONCLUSION: null;
};

export const WEEK4_AUDIT = {
  EXISTING: [
    "AuthorityHybridRetriever",
    "PostgresHybridRetriever",
    "evaluateAuthorityStatus",
    "annotateRetrievedAuthorities",
    "matter facts/entities/timeline/graph",
    "evidence matrix",
    "Ask Nyaya",
    "prosecution domain and Elements Matrix",
    "notifications table",
    "tasks/deadlines",
  ],
  EXTEND: [
    "labelResearchHits score explainability",
    "Elements Matrix retrieval awareness",
    "prosecution overview discovery dashboard",
    "Ask Nyaya structured week4 context",
    "chain-of-custody structured transfers in jsonb",
  ],
  NEW: [
    "QueryContext",
    "question decomposition",
    "law-evidence join bundle",
    "claim matrix",
    "case theory / weaknesses / investigation gaps",
    "witness intelligence",
    "discovery dashboard",
    "warrant probable-cause map",
    "coverage warnings",
  ],
  VALIDATE: ["Agency", "Officer", "Subpoena", "Motion", "Hearing", "Disposition"],
  DEFER_LATER_WEEK: [
    "exhaustive treatment classification",
    "LLM-authored decomposition in production",
    "corpus growth",
    "CMS visual polish",
  ],
} as const;
