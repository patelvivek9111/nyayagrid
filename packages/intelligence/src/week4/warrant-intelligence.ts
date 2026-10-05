import type { SourceProvenance } from "../legal/types";
import type { CoverageWarning } from "./types";

export type AffidavitAssertion = {
  id: string;
  text: string;
  sourceFactId: string | null;
  sourceDocumentId: string | null;
  provenance: SourceProvenance;
};

export type ProbableCauseFactMap = {
  assertion: AffidavitAssertion;
  sourceFact: { id: string; text: string; provenance: SourceProvenance } | null;
  corroboratingEvidenceIds: string[];
  contradictoryEvidenceIds: string[];
  issueIds: string[];
};

export type WarrantIntelligence = {
  assertions: AffidavitAssertion[];
  factMap: ProbableCauseFactMap[];
  nexus: string | null;
  staleness: string | null;
  scope: string | null;
  particularity: string | null;
  executionTiming: string | null;
  itemsSeized: string[];
  issues: string[];
  legalStandards: Array<{ id: string; ruleText: string; sourceCitation: string; sourceSpan: string; authorityId: string }>;
  authorities: Array<Record<string, unknown>>;
  missingFacts: string[];
  coverageWarnings: CoverageWarning[];
  validityConclusion: null;
};

export function buildWarrantIntelligence(params: {
  assertions: AffidavitAssertion[];
  facts: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  evidence: Array<{ id: string; text: string; relation?: string }>;
  scope?: string | null;
  issueDate?: string | null;
  executionDate?: string | null;
  seizedEvidenceIds?: string[];
  authorities?: Array<Record<string, unknown>>;
  legalStandards?: WarrantIntelligence["legalStandards"];
  missingFacts?: string[];
}): WarrantIntelligence {
  const factById = new Map(params.facts.map((fact) => [fact.id, fact]));
  const factMap: ProbableCauseFactMap[] = params.assertions.map((assertion) => {
    const sourceFact = assertion.sourceFactId ? (factById.get(assertion.sourceFactId) ?? null) : null;
    const snippet = assertion.text.toLowerCase().slice(0, 24);
    return {
      assertion,
      sourceFact,
      corroboratingEvidenceIds: params.evidence
        .filter((item) => item.relation === "SUPPORTS" && item.text.toLowerCase().includes(snippet))
        .map((item) => item.id),
      contradictoryEvidenceIds: params.evidence.filter((item) => item.relation === "CONTRADICTS").map((item) => item.id),
      issueIds: [],
    };
  });

  let staleness: string | null = null;
  if (params.issueDate && params.executionDate && params.executionDate < params.issueDate) {
    staleness = "Execution date is earlier than issue date in the record. Review source dates.";
  } else if (params.issueDate && !params.executionDate) {
    staleness = "Execution date is missing.";
  }

  const coverageWarnings: CoverageWarning[] = [];
  const unsourced = params.assertions.filter((assertion) => !assertion.sourceFactId);
  if (unsourced.length > 0) {
    coverageWarnings.push({
      code: "DOCUMENT_NOT_AVAILABLE",
      message: "One or more affidavit assertions lack a linked source fact.",
      relatedIds: unsourced.map((assertion) => assertion.id),
    });
  }

  return {
    assertions: params.assertions,
    factMap,
    nexus: params.assertions.length > 0 ? "Assertions are listed with sources. Nexus is not automatically decided." : null,
    staleness,
    scope: params.scope ?? null,
    particularity: params.scope ? "Scope text is present. Particularity is not automatically decided." : null,
    executionTiming: params.executionDate ?? null,
    itemsSeized: params.seizedEvidenceIds ?? [],
    issues: params.missingFacts?.length ? ["MISSING_FACTS"] : [],
    legalStandards: params.legalStandards ?? [],
    authorities: params.authorities ?? [],
    missingFacts: params.missingFacts ?? [],
    coverageWarnings,
    validityConclusion: null,
  };
}
