import type { SourceProvenance } from "../legal/types";
import type { InvestigationGap, Weakness } from "./types";

export type CaseTheory = {
  workspace: "professional" | "prosecution";
  partyOrProsecutionTheory: string;
  keySupportingFacts: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  keySupportingEvidence: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  contraryEvidence: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  unsupportedAssumptions: Array<{ text: string; basisIds: string[] }>;
  weakElementsOrRequirements: Array<{ id: string; text: string; status: string }>;
  missingInvestigation: InvestigationGap[];
  legalIssues: Array<{ id: string; description: string }>;
  weaknesses: Weakness[];
  guiltConclusion: null;
};

export function buildCaseTheory(params: {
  workspace: "professional" | "prosecution";
  theory: string;
  supportingFacts: CaseTheory["keySupportingFacts"];
  supportingEvidence: CaseTheory["keySupportingEvidence"];
  contraryEvidence: CaseTheory["contraryEvidence"];
  weakItems: CaseTheory["weakElementsOrRequirements"];
  legalIssues: CaseTheory["legalIssues"];
  missingEvidence: Array<{ id: string; description: string; relatedRequirementId: string | null }>;
  witnessConflictKeys?: string[];
  proceduralIssueIds?: string[];
}): CaseTheory {
  const weaknesses: Weakness[] = [];
  for (const item of params.weakItems) {
    weaknesses.push({
      category: item.status === "CONFLICTED" ? "CONTRADICTORY_EVIDENCE" : "MISSING_ELEMENT",
      description: `${item.text} is ${item.status}.`,
      basisIds: [item.id],
      provenance: { extractionOrigin: "deterministic_fixture", humanEntered: false, sourceSpan: item.text },
    });
  }
  for (const missing of params.missingEvidence) {
    weaknesses.push({
      category: "EVIDENCE_GAP",
      description: missing.description,
      basisIds: [missing.id],
      provenance: { extractionOrigin: "deterministic_fixture", humanEntered: false, sourceSpan: missing.description },
    });
  }
  for (const key of params.witnessConflictKeys ?? []) {
    weaknesses.push({
      category: "WITNESS_CONFLICT",
      description: `Witness statements conflict on ${key}.`,
      basisIds: [key],
      provenance: { extractionOrigin: "deterministic_fixture", humanEntered: false, sourceSpan: key },
    });
  }
  for (const issueId of params.proceduralIssueIds ?? []) {
    weaknesses.push({
      category: "PROCEDURAL_ISSUE",
      description: `Procedural issue ${issueId} remains open.`,
      basisIds: [issueId],
      provenance: { extractionOrigin: "deterministic_fixture", humanEntered: false, sourceSpan: issueId },
    });
  }

  const missingInvestigation: InvestigationGap[] = params.missingEvidence.map((missing) => ({
    description: missing.description,
    relatedIssueId: params.legalIssues[0]?.id ?? null,
    relatedElementOrClaimId: missing.relatedRequirementId,
    whyNeeded: "The requirement or element lacks supporting evidence in the record.",
    existingEvidenceIds: params.supportingEvidence.map((item) => item.id),
    missingEvidenceIds: [missing.id],
    suggestedAction: "Identify and collect a source-linked record that addresses this gap.",
    priority: "high",
    sourceBasis: { extractionOrigin: "deterministic_fixture", humanEntered: false, sourceSpan: missing.description },
  }));

  return {
    workspace: params.workspace,
    partyOrProsecutionTheory: params.theory,
    keySupportingFacts: params.supportingFacts,
    keySupportingEvidence: params.supportingEvidence,
    contraryEvidence: params.contraryEvidence,
    unsupportedAssumptions: params.weakItems
      .filter((item) => item.status === "UNKNOWN" || item.status === "NO_EVIDENCE_FOUND")
      .map((item) => ({ text: `Assuming ${item.text} without evidence.`, basisIds: [item.id] })),
    weakElementsOrRequirements: params.weakItems,
    missingInvestigation,
    legalIssues: params.legalIssues,
    weaknesses,
    guiltConclusion: null,
  };
}
