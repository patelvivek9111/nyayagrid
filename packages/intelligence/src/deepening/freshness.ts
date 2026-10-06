export type AnalysisFreshness = {
  stale: boolean;
  refreshRequired: boolean;
  newEvidenceIds: string[];
  removedEvidenceIds: string[];
  affectedIssueIds: string[];
  reason: string | null;
};

/**
 * Prior analysis stays current only when the evidence set and contradiction
 * set are unchanged. New or removed evidence, or a newly recognized
 * contradiction, marks affected issues for review.
 */
export function assessAnalysisFreshness(params: {
  priorEvidenceIds: string[];
  priorIssueEvidence: Array<{ issueId: string; evidenceIds: string[] }>;
  currentEvidenceIds: string[];
  newContradictionEvidenceIds?: string[];
}): AnalysisFreshness {
  const prior = new Set(params.priorEvidenceIds);
  const current = new Set(params.currentEvidenceIds);
  const newEvidenceIds = [...current].filter((id) => !prior.has(id));
  const removedEvidenceIds = [...prior].filter((id) => !current.has(id));
  const contradictionIds = params.newContradictionEvidenceIds ?? [];
  const affected = new Set<string>();
  const knownOnIssues = new Set(params.priorIssueEvidence.flatMap((issue) => issue.evidenceIds));
  const unscoped = [...newEvidenceIds, ...removedEvidenceIds].filter((id) => !knownOnIssues.has(id));
  for (const issue of params.priorIssueEvidence) {
    const touchesContradiction = issue.evidenceIds.some((id) => contradictionIds.includes(id));
    const touchesScopedChange = issue.evidenceIds.some(
      (id) => newEvidenceIds.includes(id) || removedEvidenceIds.includes(id),
    );
    if (touchesContradiction || touchesScopedChange) affected.add(issue.issueId);
  }
  const changed = newEvidenceIds.length > 0 || removedEvidenceIds.length > 0 || contradictionIds.length > 0;
  if (changed && (affected.size === 0 || unscoped.length > 0)) {
    for (const issue of params.priorIssueEvidence) affected.add(issue.issueId);
  }
  let reason: string | null = null;
  if (newEvidenceIds.length > 0) {
    reason = "New evidence arrived after the prior analysis. Prior conclusions are not current.";
  } else if (contradictionIds.length > 0) {
    reason = "A new contradiction touches the prior analysis. Affected issues need review.";
  } else if (removedEvidenceIds.length > 0) {
    reason = "Evidence left the record after the prior analysis. Prior conclusions are not current.";
  }
  return {
    stale: changed,
    refreshRequired: changed,
    newEvidenceIds,
    removedEvidenceIds,
    affectedIssueIds: [...affected],
    reason,
  };
}
