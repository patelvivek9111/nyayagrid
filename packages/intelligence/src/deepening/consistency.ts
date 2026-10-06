import type { LongFormAnalysis, WholeMatterAnalysis } from "./whole-matter";

const FORBIDDEN = /\b(GUILTY|NOT_GUILTY|LIAR|UNTRUTHFUL|DECEPTIVE)\b/;

export type ConsistencyResult = {
  consistent: boolean;
  conflicts: string[];
};

/**
 * Checks that overview issues, analysis, long-form sections, the claim or
 * element matrix, and theory evidence do not assign the same item opposite
 * roles without recording both.
 */
export function checkWholeMatterConsistency(params: {
  analysis: WholeMatterAnalysis;
  longForm: LongFormAnalysis;
  primaryIssueDescription: string;
  overviewIssueIds?: string[];
  matrixRows: Array<{
    id: string;
    supportingEvidenceIds: string[];
    contraryEvidenceIds: string[];
  }>;
  theorySupportingIds: string[];
  theoryContraryIds: string[];
}): ConsistencyResult {
  const conflicts: string[] = [];
  const primary = params.analysis.issues[0];
  if (!primary) conflicts.push("Analysis has no issues.");
  else if (primary.description !== params.primaryIssueDescription) {
    conflicts.push("Primary issue description does not match the decomposed question.");
  }
  if (params.analysis.guiltConclusion !== null || params.analysis.outcomeConclusion !== null) {
    conflicts.push("Analysis carries a decisive conclusion.");
  }
  if (params.analysis.decisiveConclusion !== null) conflicts.push("Analysis carries a decisive conclusion.");
  if (params.longForm.guiltConclusion !== null || params.longForm.outcomeConclusion !== null) {
    conflicts.push("Long-form analysis carries a decisive conclusion.");
  }
  const blob = `${params.longForm.shortAnswer}\n${params.longForm.sections.map((section) => section.body).join("\n")}`;
  if (FORBIDDEN.test(blob)) conflicts.push("Long-form text uses a forbidden conclusion label.");

  const analysisIssueIds = new Set(params.analysis.issues.map((issue) => issue.issueId));
  for (const section of params.longForm.sections) {
    if (section.issueId && !analysisIssueIds.has(section.issueId)) {
      conflicts.push(`Long-form section ${section.heading} cites an unknown issue.`);
    }
  }
  for (const issue of params.analysis.issues) {
    if (!params.longForm.sections.some((section) => section.issueId === issue.issueId)) {
      conflicts.push(`Issue ${issue.issueId} is missing from the long-form analysis.`);
    }
    const both = issue.supportingEvidenceIds.filter((id) => issue.contraryEvidenceIds.includes(id));
    if (both.length > 0) conflicts.push(`Evidence ${both.join(", ")} is both supporting and contrary on ${issue.issueId}.`);
  }

  if (params.overviewIssueIds) {
    for (const issueId of params.analysis.issues.map((issue) => issue.issueId)) {
      if (!params.overviewIssueIds.includes(issueId)) {
        conflicts.push(`Issue ${issueId} is missing from the overview issue list.`);
      }
    }
  }

  const support = new Set(params.analysis.issues.flatMap((issue) => issue.supportingEvidenceIds));
  const contrary = new Set(params.analysis.issues.flatMap((issue) => issue.contraryEvidenceIds));
  for (const row of params.matrixRows) {
    for (const id of row.supportingEvidenceIds) {
      if (contrary.has(id) && !support.has(id)) {
        conflicts.push(`Matrix ${row.id} treats ${id} as support while analysis treats it only as contrary.`);
      }
    }
    for (const id of row.contraryEvidenceIds) {
      if (support.has(id) && !contrary.has(id)) {
        conflicts.push(`Matrix ${row.id} treats ${id} as contrary while analysis treats it only as support.`);
      }
    }
  }
  for (const id of params.theorySupportingIds) {
    if (contrary.has(id) && !support.has(id)) {
      conflicts.push(`Theory support ${id} is only contrary in the analysis.`);
    }
  }
  for (const id of params.theoryContraryIds) {
    if (support.has(id) && !contrary.has(id)) {
      conflicts.push(`Theory contrary ${id} is only supporting in the analysis.`);
    }
  }

  return { consistent: conflicts.length === 0, conflicts };
}
