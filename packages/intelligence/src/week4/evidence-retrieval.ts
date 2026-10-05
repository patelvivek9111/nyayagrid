import type { SourceProvenance } from "../legal/types";
import type { EvidenceRelationLabel, QueryContext, RetrievedEvidenceItem } from "./types";

export type EvidenceCorpusItem = {
  id: string;
  organizationId: string;
  matterId?: string | null;
  criminalCaseId?: string | null;
  kind: string;
  text: string;
  documentId?: string | null;
  sourceLocation?: string | null;
  relatedIssueId?: string | null;
  relatedClaimOrChargeId?: string | null;
  relatedElementId?: string | null;
  /** Explicit stored relation only. Never inferred from similarity. */
  relation?: EvidenceRelationLabel | null;
  provenance: SourceProvenance;
};

function scoped(item: EvidenceCorpusItem, context: QueryContext): boolean {
  if (item.organizationId !== context.organizationId) return false;
  if (context.matterId && item.matterId && item.matterId !== context.matterId) return false;
  if (context.criminalCaseId && item.criminalCaseId && item.criminalCaseId !== context.criminalCaseId) return false;
  if (context.selectedDocuments?.length && item.documentId && !context.selectedDocuments.includes(item.documentId)) {
    return false;
  }
  if (context.selectedEvidence?.length && !context.selectedEvidence.includes(item.id)) return false;
  return true;
}

function relevance(query: string, text: string): number {
  const q = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  if (q.length === 0) return 0;
  const lower = text.toLowerCase();
  return q.filter((token) => lower.includes(token)).length / q.length;
}

export function retrieveMatterEvidence(params: {
  context: QueryContext;
  corpus: EvidenceCorpusItem[];
  limit?: number;
}): RetrievedEvidenceItem[] {
  const limit = params.limit ?? 20;
  const scored = params.corpus
    .filter((item) => scoped(item, params.context))
    .map((item) => {
      const score = relevance(params.context.userQuestion, item.text);
      const row: RetrievedEvidenceItem & { score: number } = {
        id: item.id,
        kind: item.kind,
        text: item.text,
        whyRelevant: score > 0 ? "Text overlap with the question or selected issue." : "Included by case/matter scope.",
        relatedIssueId: item.relatedIssueId ?? params.context.selectedLegalIssue ?? null,
        relatedClaimOrChargeId: item.relatedClaimOrChargeId ?? params.context.selectedCharge ?? null,
        relatedElementId: item.relatedElementId ?? params.context.selectedElement ?? null,
        relation: item.relation ?? "UNKNOWN_RELATION",
        documentId: item.documentId ?? null,
        sourceLocation: item.sourceLocation ?? null,
        confidence: score >= 0.5 ? "medium" : "low",
        provenance: item.provenance,
        organizationId: item.organizationId,
        matterId: item.matterId ?? null,
        criminalCaseId: item.criminalCaseId ?? null,
        score,
      };
      return row;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ score: _score, ...item }) => item);
}

export function splitEvidenceByRelation(items: RetrievedEvidenceItem[]): {
  supporting: RetrievedEvidenceItem[];
  contrary: RetrievedEvidenceItem[];
  unknown: RetrievedEvidenceItem[];
} {
  return {
    supporting: items.filter((item) => item.relation === "SUPPORTS"),
    contrary: items.filter((item) => item.relation === "CONTRADICTS"),
    unknown: items.filter((item) => item.relation === "UNKNOWN_RELATION" || item.relation === "NEUTRAL"),
  };
}

/** Security helper for tests: filters another tenant's rows before scoring. */
export function assertEvidenceTenantIsolation(
  items: RetrievedEvidenceItem[],
  organizationId: string,
): RetrievedEvidenceItem[] {
  return items.filter((item) => item.organizationId === organizationId);
}
