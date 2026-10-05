import type { AuthorityRetrievalContext, RetrievedAuthorityHit, RetrievedLegalStandard } from "../legal/retrieval";
import { decomposeQuestion } from "./decompose";
import { retrieveMatterEvidence, splitEvidenceByRelation, type EvidenceCorpusItem } from "./evidence-retrieval";
import { legalCoverageWarnings, rankLegalAuthoritiesExplainable } from "./hybrid-rank";
import { buildCaseTheory } from "./case-theory";
import type {
  CoverageWarning,
  LawEvidenceBundle,
  QueryContext,
  StructuredAnswerContext,
} from "./types";

export type ClaimMatrixRow = {
  claimOrDefenseId: string;
  label: string;
  requirementId: string;
  requirementText: string;
  supportingEvidence: Array<{ id: string; text: string }>;
  contraryEvidence: Array<{ id: string; text: string }>;
  missingEvidence: Array<{ id: string; description: string }>;
  governingAuthorities: Array<{ authorityId: string; status: string; citation: string | null }>;
  status: string;
  provenance: { sourceSpan: string | null; documentId?: string | null };
};

export function buildClaimMatrix(rows: ClaimMatrixRow[]): ClaimMatrixRow[] {
  return rows;
}

export function buildLawEvidenceBundle(params: {
  context: QueryContext;
  evidenceCorpus: EvidenceCorpusItem[];
  authorityHits: RetrievedAuthorityHit[];
  standards?: RetrievedLegalStandard[];
  contraryAuthorityIds?: string[];
  facts?: Array<{ id: string; text: string; provenance: LawEvidenceBundle["supportingFacts"][number]["provenance"] }>;
  requirements?: LawEvidenceBundle["requirements"];
  missingEvidence?: LawEvidenceBundle["missingEvidence"];
  treatment?: LawEvidenceBundle["treatment"];
}): LawEvidenceBundle {
  const decomposed = decomposeQuestion(params.context);
  const evidence = retrieveMatterEvidence({ context: params.context, corpus: params.evidenceCorpus });
  const split = splitEvidenceByRelation(evidence);
  const retrievalContext: AuthorityRetrievalContext = {
    questionJurisdiction:
      decomposed.issues[0]?.jurisdiction ??
      (params.context.issueType === "FEDERAL_STATUTORY" || params.context.issueType === "FEDERAL_CONSTITUTIONAL"
        ? "US"
        : params.context.jurisdiction),
    forumCourtId: params.context.forumCourt ?? null,
    issueType: decomposed.issues[0]?.issueType ?? params.context.issueType ?? "UNKNOWN",
    subjectMatter: params.context.subjectMatter ?? (params.context.criminalCaseId ? "criminal" : "civil"),
    standards: params.standards,
    contraryAuthorityIds: params.contraryAuthorityIds,
  };
  const ranked = rankLegalAuthoritiesExplainable({
    query: params.context.userQuestion,
    hits: params.authorityHits,
    context: retrievalContext,
  });
  const coverageWarnings: CoverageWarning[] = [
    ...legalCoverageWarnings(ranked),
    ...ranked.flatMap((hit) => hit.coverageWarnings),
  ];
  if (!params.context.jurisdiction && !params.context.forumCourt) {
    coverageWarnings.push({
      code: "JURISDICTION_METADATA_MISSING",
      message: "Jurisdiction or forum court is missing from the query context.",
      relatedIds: [],
    });
  }
  if (split.supporting.length === 0) {
    coverageWarnings.push({
      code: "NO_SUPPORTING_EVIDENCE_FOUND",
      message: "No explicitly supporting evidence was found for this question.",
      relatedIds: [],
    });
  }
  if (split.contrary.length === 0) {
    coverageWarnings.push({
      code: "NO_CONTRARY_EVIDENCE_FOUND",
      message: "No explicitly contrary evidence was found for this question.",
      relatedIds: [],
    });
  }
  for (const missing of params.missingEvidence ?? []) {
    coverageWarnings.push({
      code: "ELEMENT_EVIDENCE_GAP",
      message: missing.description,
      relatedIds: [missing.id],
    });
  }

  const bindingAuthorities = ranked.filter((hit) => hit.authorityStatus === "BINDING");
  const persuasiveAuthorities = ranked.filter((hit) => hit.authorityStatus === "PERSUASIVE");
  const contraryAuthorities = ranked.filter((hit) => hit.issueRelation === "CONTRARY");
  const legalStandards = (params.standards ?? []).map((standard) => ({
    ...standard,
    provenance: {
      authorityId: standard.authorityId,
      sourceSpan: standard.sourceSpan,
      extractionOrigin: "source_metadata" as const,
      humanEntered: false,
    },
  }));

  const theory = buildCaseTheory({
    workspace: params.context.criminalCaseId ? "prosecution" : "professional",
    theory: decomposed.issues[0]?.description ?? params.context.userQuestion,
    supportingFacts: params.facts ?? [],
    supportingEvidence: split.supporting.map((item) => ({
      id: item.id,
      text: item.text,
      provenance: item.provenance,
    })),
    contraryEvidence: split.contrary.map((item) => ({
      id: item.id,
      text: item.text,
      provenance: item.provenance,
    })),
    weakItems: (params.requirements ?? [])
      .filter((row) => row.status !== "SUPPORTED")
      .map((row) => ({ id: row.id, text: row.text, status: row.status })),
    legalIssues: decomposed.issues.map((issue, index) => ({
      id: `issue-${index + 1}`,
      description: issue.description,
    })),
    missingEvidence: params.missingEvidence ?? [],
  });

  const sourceMap = [
    ...split.supporting.map((item) => ({ id: item.id, sourceType: "evidence", provenance: item.provenance })),
    ...split.contrary.map((item) => ({ id: item.id, sourceType: "evidence", provenance: item.provenance })),
    ...legalStandards.map((standard) => ({
      id: standard.id,
      sourceType: "legal_standard",
      provenance: standard.provenance,
    })),
    ...ranked.map((hit) => ({
      id: hit.authorityId,
      sourceType: "authority",
      provenance: {
        authorityId: hit.authorityId,
        sourceSpan: hit.snippet ?? hit.citation ?? null,
        extractionOrigin: "source_metadata" as const,
        humanEntered: false,
      },
    })),
  ];

  return {
    question: params.context.userQuestion,
    queryContext: params.context,
    issues: decomposed.issues,
    legalStandards,
    requirements: params.requirements ?? [],
    supportingFacts: params.facts ?? [],
    supportingEvidence: split.supporting,
    contraryFacts: [],
    contraryEvidence: split.contrary,
    missingEvidence: params.missingEvidence ?? [],
    bindingAuthorities,
    persuasiveAuthorities,
    contraryAuthorities,
    treatment: params.treatment ?? [],
    coverageWarnings,
    weaknesses: theory.weaknesses,
    investigationGaps: theory.missingInvestigation,
    guiltConclusion: null,
    sourceMap,
  };
}

export function toStructuredAnswerContext(bundle: LawEvidenceBundle): StructuredAnswerContext {
  return {
    QUESTION: bundle.question,
    ISSUES: bundle.issues,
    FACTS: [...bundle.supportingFacts, ...bundle.contraryFacts],
    EVIDENCE_FOR: bundle.supportingEvidence,
    EVIDENCE_AGAINST: bundle.contraryEvidence,
    MISSING_EVIDENCE: bundle.missingEvidence,
    LEGAL_STANDARDS: bundle.legalStandards,
    BINDING_AUTHORITY: bundle.bindingAuthorities,
    PERSUASIVE_AUTHORITY: bundle.persuasiveAuthorities,
    CONTRARY_AUTHORITY: bundle.contraryAuthorities,
    TREATMENT: bundle.treatment,
    COVERAGE_WARNINGS: bundle.coverageWarnings,
    SOURCE_MAP: bundle.sourceMap,
    GUILT_CONCLUSION: null,
  };
}

export function buildRetrievalAwareElementsMatrix(params: {
  matrix: Array<{
    chargeId: string;
    offenseName: string;
    elementId: string;
    elementText: string;
    status: string;
    supportingEvidenceIds: string[];
    contraryEvidenceIds: string[];
    uncertainEvidenceIds: string[];
    missingEvidenceIds: string[];
    humanReviewStatus: string;
    provenance: LawEvidenceBundle["supportingEvidence"][number]["provenance"];
  }>;
  authorities: Array<{
    authorityId: string;
    status: string;
    reasonCode: string;
    citation: string | null;
    issueRelation?: string;
  }>;
  standards: RetrievedLegalStandard[];
}): Array<Record<string, unknown>> {
  const binding = params.authorities.filter((item) => item.status === "BINDING");
  const persuasive = params.authorities.filter((item) => item.status === "PERSUASIVE");
  const contrary = params.authorities.filter((item) => item.issueRelation === "CONTRARY");
  return params.matrix.map((row) => {
    const standard = params.standards[0];
    return {
      ...row,
      legalSource: standard?.sourceCitation ?? null,
      legalStandard: standard
        ? {
            id: standard.id,
            ruleText: standard.ruleText,
            sourceSpan: standard.sourceSpan,
            sourceCitation: standard.sourceCitation,
            authorityId: standard.authorityId,
          }
        : "STANDARD_NOT_EXTRACTED",
      bindingAuthorities: binding,
      persuasiveAuthorities: persuasive,
      contraryAuthorities: contrary,
      sourceCitations: [
        ...(standard ? [standard.sourceCitation] : []),
        ...binding.map((item) => item.citation).filter(Boolean),
      ],
      guiltConclusion: null,
    };
  });
}
