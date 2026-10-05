import {
  evaluateAuthorityStatus,
  type AuthorityCurrentness,
  type AuthorityStatusClassification,
  type LegalIssueType,
} from "@nyayagrid/jurisdiction";
import type { IssueAuthorityRelation, SourceProvenance } from "./types";

/** Hierarchy is a tie-break. It cannot overturn a meaningful relevance gap. */
export const AUTHORITY_STATUS_RANK_CAP = 0.15;

export type RetrievedAuthorityHit = {
  authorityId: string;
  citation?: string | null;
  title?: string | null;
  court?: string | null;
  courtId?: string | null;
  jurisdiction?: string | null;
  authorityType?: string | null;
  decisionDate?: string | null;
  score: number;
  currentnessStatus?: string | null;
  canonicalSourceUrl?: string | null;
  snippet?: string | null;
};

export type RetrievedLegalStandard = {
  id: string;
  authorityId: string;
  ruleText: string;
  sourceSpan: string;
  sourceCitation: string;
};

export type RetrievedTreatment = {
  authorityId: string;
  label: string;
  verification: "verified" | "unknown" | "needs_review";
};

export type AuthorityRetrievalContext = {
  questionJurisdiction?: string | null;
  forumCourtId?: string | null;
  issueType?: LegalIssueType | null;
  subjectMatter?: "criminal" | "civil" | "general" | null;
  asOfDate?: string | null;
  /** Inbound citation counts. Capped so volume cannot outrank issue relevance. */
  precedentInbound?: Record<string, number>;
  citedByControllingIds?: string[];
  treatments?: RetrievedTreatment[];
  standards?: RetrievedLegalStandard[];
  contraryAuthorityIds?: string[];
  distinguishableAuthorityIds?: string[];
};

export type AuthorityRetrievalAnnotation = {
  authorityStatus: AuthorityStatusClassification;
  reasonCode: string;
  explanation: string;
  courtRelationship: string;
  jurisdictionRelationship: string;
  currentnessConsideration: string;
  authorityConfidence: "high" | "medium" | "low";
  abstention: string | null;
  statusRankContribution: number;
  precedentRankContribution: number;
  treatmentDisplay: "verified" | "TREATMENT_UNVERIFIED" | "absent";
  treatmentLabel: string | null;
  legalStandard:
    | {
        id: string;
        authorityId: string;
        ruleText: string;
        sourceSpan: string;
        sourceCitation: string;
      }
    | "STANDARD_NOT_EXTRACTED";
  issueRelation: IssueAuthorityRelation;
  adjustedScore: number;
};

export function mapCurrentness(value: string | null | undefined): AuthorityCurrentness {
  if (value === "superseded") return "superseded";
  if (value === "historical") return "historical";
  if (value === "current" || value === "current_as_of_source_date" || value === "current_verified_from_source") {
    return "current";
  }
  return "unknown";
}

export function authorityStatusRankContribution(classification: AuthorityStatusClassification): number {
  switch (classification) {
    case "BINDING":
      return 0.12;
    case "PERSUASIVE":
      return 0.04;
    case "OUT_OF_JURISDICTION":
      return -0.08;
    default:
      return 0;
  }
}

export function precedentRankContribution(inbound: number, citedByControlling: boolean): number {
  const fromVolume = Math.min(0.02, Math.max(0, inbound) * 0.001);
  const fromControllingCite = citedByControlling ? 0.01 : 0;
  return Math.min(0.02, fromVolume + fromControllingCite);
}

export function relationForRetrievedAuthority(params: {
  classification: AuthorityStatusClassification;
  onIssue: boolean;
  contrary?: boolean;
  distinguishable?: boolean;
}): IssueAuthorityRelation {
  if (params.contrary) return "CONTRARY";
  if (params.distinguishable) return "DISTINGUISHABLE";
  if (params.classification === "BINDING" && params.onIssue) return "CONTROLLING";
  if (params.classification === "BINDING") return "BINDING_RELEVANT";
  if (params.classification === "PERSUASIVE" && params.onIssue) return "PERSUASIVE_RELEVANT";
  if (params.classification === "PERSUASIVE" || params.classification === "NONCONTROLLING" || params.classification === "OUT_OF_JURISDICTION") {
    return "BACKGROUND";
  }
  return "UNKNOWN";
}

function questionJurisdictionFor(context: AuthorityRetrievalContext): string | null {
  if (context.questionJurisdiction?.trim()) return context.questionJurisdiction.trim();
  const issue = context.issueType ?? "UNKNOWN";
  if (issue === "FEDERAL_CONSTITUTIONAL" || issue === "FEDERAL_STATUTORY" || issue === "SPECIALIZED_FEDERAL") {
    return "US";
  }
  return null;
}

export function annotateRetrievedAuthorities<T extends RetrievedAuthorityHit>(
  hits: T[],
  context: AuthorityRetrievalContext,
  options: { applyStatusRank?: boolean } = {},
): Array<T & AuthorityRetrievalAnnotation> {
  const issueType = context.issueType ?? "UNKNOWN";
  const question = questionJurisdictionFor(context);
  const bestScore = hits.reduce((best, hit) => Math.max(best, hit.score), 0);
  const standards = new Map((context.standards ?? []).map((standard) => [standard.authorityId, standard]));
  const treatments = new Map((context.treatments ?? []).map((treatment) => [treatment.authorityId, treatment]));
  const contrary = new Set(context.contraryAuthorityIds ?? []);
  const distinguishable = new Set(context.distinguishableAuthorityIds ?? []);
  const controllingCites = new Set(context.citedByControllingIds ?? []);

  const annotated = hits.map((hit) => {
    const status = evaluateAuthorityStatus({
      questionJurisdiction: question,
      forumCourtId: context.forumCourtId ?? null,
      issueType,
      subjectMatter: context.subjectMatter ?? null,
      authorityCourtId: hit.courtId ?? null,
      authorityType: hit.authorityType ?? "case",
      authorityJurisdiction: hit.jurisdiction ?? null,
      authorityDate: hit.decisionDate ?? null,
      asOfDate: context.asOfDate ?? null,
      currentness: mapCurrentness(hit.currentnessStatus),
      sourceMetadata: {
        authorityId: hit.authorityId,
        citation: hit.citation ?? null,
        sourceUrl: hit.canonicalSourceUrl ?? null,
      },
    });
    const onIssue = hit.score >= bestScore - 0.15;
    const treatment = treatments.get(hit.authorityId);
    const verified = treatment?.verification === "verified";
    const standard = standards.get(hit.authorityId);
    const statusRank = options.applyStatusRank ? authorityStatusRankContribution(status.classification) : 0;
    const precedentRank = options.applyStatusRank
      ? precedentRankContribution(context.precedentInbound?.[hit.authorityId] ?? 0, controllingCites.has(hit.authorityId))
      : 0;
    if (Math.abs(statusRank) > AUTHORITY_STATUS_RANK_CAP) {
      throw new Error("Authority status rank contribution exceeded its cap.");
    }
    return {
      ...hit,
      authorityStatus: status.classification,
      reasonCode: status.reasonCode,
      explanation: status.explanation,
      courtRelationship: status.courtRelationship,
      jurisdictionRelationship: status.jurisdictionRelationship,
      currentnessConsideration: status.currentnessConsideration,
      authorityConfidence: status.confidence,
      abstention: status.abstention,
      statusRankContribution: statusRank,
      precedentRankContribution: precedentRank,
      treatmentDisplay: verified ? ("verified" as const) : treatment ? ("TREATMENT_UNVERIFIED" as const) : ("absent" as const),
      treatmentLabel: verified ? treatment.label : null,
      legalStandard: standard
        ? {
            id: standard.id,
            authorityId: standard.authorityId,
            ruleText: standard.ruleText,
            sourceSpan: standard.sourceSpan,
            sourceCitation: standard.sourceCitation,
          }
        : ("STANDARD_NOT_EXTRACTED" as const),
      issueRelation: relationForRetrievedAuthority({
        classification: status.classification,
        onIssue,
        contrary: contrary.has(hit.authorityId),
        distinguishable: distinguishable.has(hit.authorityId),
      }),
      adjustedScore: hit.score + statusRank + precedentRank,
    };
  });

  if (!options.applyStatusRank) return annotated;
  return [...annotated].sort((left, right) => right.adjustedScore - left.adjustedScore);
}

export function buildIssueRetrievalContext(issue: {
  description: string;
  jurisdiction?: string | null;
  issueType: LegalIssueType;
  forumCourtId?: string | null;
  legalTheory?: string | null;
  subjectMatter?: "criminal" | "civil" | "general" | null;
}): AuthorityRetrievalContext & { query: string } {
  const federal =
    issue.issueType === "FEDERAL_CONSTITUTIONAL" ||
    issue.issueType === "FEDERAL_STATUTORY" ||
    issue.issueType === "SPECIALIZED_FEDERAL";
  return {
    questionJurisdiction: federal ? "US" : (issue.jurisdiction ?? null),
    forumCourtId: issue.forumCourtId ?? null,
    issueType: issue.issueType,
    subjectMatter: issue.subjectMatter ?? null,
    query: [issue.legalTheory, issue.description].filter(Boolean).join(" ").trim(),
  };
}

export const RETRIEVAL_OUTPUT_FIELDS = [
  "authorityId",
  "citation",
  "court",
  "courtId",
  "jurisdiction",
  "decisionDate",
  "authorityStatus",
  "reasonCode",
  "currentnessConsideration",
  "issueRelation",
  "score",
  "adjustedScore",
  "statusRankContribution",
  "precedentRankContribution",
  "canonicalSourceUrl",
  "legalStandard",
  "treatmentDisplay",
] as const;

export function retrievalProvenance(hit: { authorityId: string; citation?: string | null; snippet?: string | null }): SourceProvenance {
  return {
    authorityId: hit.authorityId,
    sourceSpan: hit.snippet ?? hit.citation ?? null,
    extractionOrigin: "source_metadata",
    humanEntered: false,
  };
}
