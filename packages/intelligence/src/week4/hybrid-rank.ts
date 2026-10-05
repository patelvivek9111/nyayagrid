import {
  annotateRetrievedAuthorities,
  authorityStatusRankContribution,
  mapCurrentness,
  precedentRankContribution,
  type AuthorityRetrievalContext,
  type RetrievedAuthorityHit,
} from "../legal/retrieval";
import type { CoverageWarning, RetrievalScoreBreakdown } from "./types";

export type ExplainableAuthorityHit = RetrievedAuthorityHit & {
  authorityStatus: string;
  reasonCode: string;
  currentnessConsideration: string;
  abstention: string | null;
  issueRelation: string;
  legalStandard: unknown;
  treatmentDisplay: string;
  scoreBreakdown: RetrievalScoreBreakdown;
  adjustedScore: number;
  coverageWarnings: CoverageWarning[];
};

function lexicalOverlap(query: string, text: string): number {
  const q = new Set(query.toLowerCase().split(/\W+/).filter((t) => t.length > 2));
  if (q.size === 0) return 0;
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  let hits = 0;
  for (const token of tokens) if (q.has(token)) hits += 1;
  return Math.min(1, hits / q.size);
}

export function rankLegalAuthoritiesExplainable(params: {
  query: string;
  hits: RetrievedAuthorityHit[];
  context: AuthorityRetrievalContext;
  semanticScores?: Record<string, number>;
  lexicalScores?: Record<string, number>;
}): ExplainableAuthorityHit[] {
  const annotated = annotateRetrievedAuthorities(params.hits, params.context, {
    applyStatusRank: (params.context.issueType ?? "UNKNOWN") !== "UNKNOWN",
  });
  return annotated.map((hit) => {
    const semantic = params.semanticScores?.[hit.authorityId] ?? hit.score;
    const lexical =
      params.lexicalScores?.[hit.authorityId] ??
      lexicalOverlap(params.query, `${hit.title ?? ""} ${hit.citation ?? ""} ${hit.snippet ?? ""}`);
    const authorityContribution = authorityStatusRankContribution(hit.authorityStatus);
    const citationContribution = hit.precedentRankContribution;
    const currentnessAdjustment =
      mapCurrentness(hit.currentnessStatus) === "superseded"
        ? -0.2
        : mapCurrentness(hit.currentnessStatus) === "historical"
          ? -0.05
          : 0;
    const issueMatchContribution = hit.issueRelation === "CONTROLLING" || hit.issueRelation === "BINDING_RELEVANT" ? 0.05 : 0;
    const jurisdictionFilter =
      hit.authorityStatus === "OUT_OF_JURISDICTION"
        ? ("fail" as const)
        : hit.authorityStatus === "UNKNOWN"
          ? ("unknown" as const)
          : ("pass" as const);
    const finalScore =
      semantic * 0.55 +
      lexical * 0.2 +
      authorityContribution +
      citationContribution +
      currentnessAdjustment +
      issueMatchContribution;
    const coverageWarnings: CoverageWarning[] = [];
    if (mapCurrentness(hit.currentnessStatus) === "unknown") {
      coverageWarnings.push({
        code: "CURRENTNESS_UNCERTAIN",
        message: "Currentness metadata is unknown for this authority.",
        relatedIds: [hit.authorityId],
      });
    }
    if (hit.treatmentDisplay === "TREATMENT_UNVERIFIED" || hit.treatmentDisplay === "absent") {
      coverageWarnings.push({
        code: "TREATMENT_UNAVAILABLE",
        message: "Verified treatment is unavailable.",
        relatedIds: [hit.authorityId],
      });
    }
    return {
      ...hit,
      adjustedScore: finalScore,
      scoreBreakdown: {
        semanticScore: semantic,
        lexicalScore: lexical,
        authorityContribution,
        citationContribution,
        jurisdictionFilter,
        currentnessAdjustment,
        issueMatchContribution,
        finalScore,
      },
      coverageWarnings,
    };
  }).sort((a, b) => b.adjustedScore - a.adjustedScore);
}

export function legalCoverageWarnings(hits: ExplainableAuthorityHit[]): CoverageWarning[] {
  const warnings: CoverageWarning[] = [];
  if (hits.length === 0) {
    warnings.push({
      code: "NO_BINDING_AUTHORITY",
      message: "No authorities were retrieved for this issue.",
      relatedIds: [],
    });
    return warnings;
  }
  if (!hits.some((hit) => hit.authorityStatus === "BINDING")) {
    warnings.push({
      code: "NO_BINDING_AUTHORITY",
      message: "No binding authority was found for the supplied jurisdiction and issue.",
      relatedIds: hits.map((hit) => hit.authorityId),
    });
  }
  if (hits.every((hit) => hit.authorityStatus === "OUT_OF_JURISDICTION")) {
    warnings.push({
      code: "ONLY_OUT_OF_JURISDICTION",
      message: "Retrieved authorities are out of jurisdiction.",
      relatedIds: hits.map((hit) => hit.authorityId),
    });
  }
  if (hits.every((hit) => mapCurrentness(hit.currentnessStatus) === "historical" || mapCurrentness(hit.currentnessStatus) === "superseded")) {
    warnings.push({
      code: "ONLY_OLD_AUTHORITY",
      message: "Only historical or superseded authorities were retrieved.",
      relatedIds: hits.map((hit) => hit.authorityId),
    });
  }
  return warnings;
}

export { precedentRankContribution };
