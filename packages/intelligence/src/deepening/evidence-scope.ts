export type ScopedEvidence = {
  id: string;
  relatedDefendantIds: string[];
};

export type DefendantEvidencePartition = {
  jointEvidenceIds: string[];
  unassignedEvidenceIds: string[];
  byDefendant: Array<{
    defendantId: string;
    displayName: string;
    specificEvidenceIds: string[];
    jointEvidenceIds: string[];
  }>;
};

/**
 * Splits evidence into joint, defendant-specific, and unassigned sets.
 * Unknown defendant ids are ignored. An item with two or more known defendants
 * is joint. An item with one known defendant is specific to that person.
 */
export function partitionEvidenceByDefendant(params: {
  defendants: Array<{ id: string; displayName: string }>;
  evidence: ScopedEvidence[];
}): DefendantEvidencePartition {
  const known = new Map(params.defendants.map((defendant) => [defendant.id, defendant.displayName]));
  const jointEvidenceIds: string[] = [];
  const unassignedEvidenceIds: string[] = [];
  const specific = new Map<string, string[]>();
  const jointByDefendant = new Map<string, string[]>();
  for (const defendant of params.defendants) {
    specific.set(defendant.id, []);
    jointByDefendant.set(defendant.id, []);
  }

  for (const item of params.evidence) {
    const related = [...new Set(item.relatedDefendantIds.filter((id) => known.has(id)))];
    if (related.length === 0) {
      unassignedEvidenceIds.push(item.id);
      continue;
    }
    if (related.length === 1) {
      specific.get(related[0]!)!.push(item.id);
      continue;
    }
    jointEvidenceIds.push(item.id);
    for (const defendantId of related) jointByDefendant.get(defendantId)!.push(item.id);
  }

  return {
    jointEvidenceIds,
    unassignedEvidenceIds,
    byDefendant: params.defendants.map((defendant) => ({
      defendantId: defendant.id,
      displayName: defendant.displayName,
      specificEvidenceIds: specific.get(defendant.id) ?? [],
      jointEvidenceIds: jointByDefendant.get(defendant.id) ?? [],
    })),
  };
}

export type SeparatedCaseIssue = {
  id: string;
  kind: "charge" | "procedure" | "element_gap";
  label: string;
  status: string | null;
  defendantId: string | null;
};

/** Keeps charges, procedure issues, and element gaps as separate open issues. */
export function separateProsecutionCaseIssues(params: {
  charges: Array<{
    id: string;
    offenseName: string;
    countNumber?: string | null;
    status?: string | null;
    defendantId?: string | null;
  }>;
  procedureIssues: Array<{ id: string; issueType: string; status?: string | null }>;
  elementGaps: Array<{ id: string; elementText: string; status: string }>;
}): SeparatedCaseIssue[] {
  const charges: SeparatedCaseIssue[] = params.charges.map((charge) => ({
    id: charge.id,
    kind: "charge",
    label: `Count ${charge.countNumber ?? "?"}: ${charge.offenseName}`,
    status: charge.status ?? null,
    defendantId: charge.defendantId ?? null,
  }));
  const procedure: SeparatedCaseIssue[] = params.procedureIssues.map((issue) => ({
    id: issue.id,
    kind: "procedure",
    label: issue.issueType,
    status: issue.status ?? null,
    defendantId: null,
  }));
  const gaps: SeparatedCaseIssue[] = params.elementGaps.map((gap) => ({
    id: gap.id,
    kind: "element_gap",
    label: gap.elementText,
    status: gap.status,
    defendantId: null,
  }));
  return [...charges, ...procedure, ...gaps];
}
