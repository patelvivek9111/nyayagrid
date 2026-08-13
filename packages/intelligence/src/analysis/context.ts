import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import {
  analysisFindings,
  analysisRuns,
  documentAnalyses,
  documentAnalysisItems,
  documentComparisons,
  documentReviewStates,
} from "@nyayagrid/database";

export type ProfessionalAnalysisContext = {
  reviewedFindings: Array<{
    id: string;
    findingType: string;
    title: string;
    explanation: string | null;
    attention: string | null;
    status: string;
    runType: string | null;
  }>;
  proposedFindings: Array<{
    id: string;
    findingType: string;
    title: string;
    status: string;
    runType: string | null;
  }>;
  contractSummaries: Array<{
    id: string;
    documentId: string;
    summary: string | null;
    status: string;
    reviewedItemCount: number;
    proposedItemCount: number;
  }>;
  comparisonSummaries: Array<{
    id: string;
    documentAId: string;
    documentBId: string;
    summary: string | null;
  }>;
  discoveryHighlights: Array<{
    documentId: string;
    relevance: string;
    privilege: string;
    responsiveness: string;
    important: boolean;
    humanPrivilegeFinal: boolean;
    aiPrivilege: string | null;
  }>;
};

/**
 * Load matter-scoped professional analysis for Nyaya Q&A.
 * Reviewed findings may be treated as usable context; proposed items must be labeled.
 */
export async function loadProfessionalAnalysisContext(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  question?: string;
  limit?: number;
}): Promise<ProfessionalAnalysisContext> {
  const limit = params.limit ?? 12;

  const runs = await params.db
    .select()
    .from(analysisRuns)
    .where(
      and(
        eq(analysisRuns.organizationId, params.organizationId),
        eq(analysisRuns.matterId, params.matterId),
      ),
    )
    .orderBy(desc(analysisRuns.createdAt))
    .limit(40);

  const runIds = runs.map((r) => r.id);
  const runById = new Map(runs.map((r) => [r.id, r]));

  const findings =
    runIds.length === 0
      ? []
      : await params.db
          .select()
          .from(analysisFindings)
          .where(
            and(
              eq(analysisFindings.organizationId, params.organizationId),
              eq(analysisFindings.matterId, params.matterId),
              inArray(analysisFindings.analysisRunId, runIds),
              inArray(analysisFindings.status, ["proposed", "reviewed"]),
            ),
          )
          .orderBy(desc(analysisFindings.createdAt))
          .limit(limit * 2);

  const reviewedFindings = findings
    .filter((f) => f.status === "reviewed")
    .slice(0, limit)
    .map((f) => ({
      id: f.id,
      findingType: f.findingType,
      title: f.title,
      explanation: f.explanation,
      attention: f.attention,
      status: f.status,
      runType: runById.get(f.analysisRunId)?.runType ?? null,
    }));

  const proposedFindings = findings
    .filter((f) => f.status === "proposed")
    .slice(0, Math.min(6, limit))
    .map((f) => ({
      id: f.id,
      findingType: f.findingType,
      title: f.title,
      status: f.status,
      runType: runById.get(f.analysisRunId)?.runType ?? null,
    }));

  const analyses = await params.db
    .select()
    .from(documentAnalyses)
    .where(
      and(
        eq(documentAnalyses.organizationId, params.organizationId),
        eq(documentAnalyses.matterId, params.matterId),
      ),
    )
    .orderBy(desc(documentAnalyses.createdAt))
    .limit(8);

  const analysisIds = analyses.map((a) => a.id);
  const items =
    analysisIds.length === 0
      ? []
      : await params.db
          .select()
          .from(documentAnalysisItems)
          .where(inArray(documentAnalysisItems.analysisId, analysisIds));

  const contractSummaries = analyses.map((a) => {
    const related = items.filter((i) => i.analysisId === a.id);
    return {
      id: a.id,
      documentId: a.documentId,
      summary: a.summary,
      status: a.status,
      reviewedItemCount: related.filter((i) => i.status === "reviewed").length,
      proposedItemCount: related.filter((i) => i.status === "proposed").length,
    };
  });

  const comparisons = await params.db
    .select()
    .from(documentComparisons)
    .where(
      and(
        eq(documentComparisons.organizationId, params.organizationId),
        eq(documentComparisons.matterId, params.matterId),
      ),
    )
    .orderBy(desc(documentComparisons.createdAt))
    .limit(6);

  const comparisonSummaries = comparisons.map((c) => ({
    id: c.id,
    documentAId: c.documentAId,
    documentBId: c.documentBId,
    summary: c.summary,
  }));

  const reviews = await params.db
    .select()
    .from(documentReviewStates)
    .where(
      and(
        eq(documentReviewStates.organizationId, params.organizationId),
        eq(documentReviewStates.matterId, params.matterId),
      ),
    )
    .limit(40);

  const discoveryHighlights = reviews
    .filter(
      (r) =>
        r.important ||
        r.privilege !== "unknown" ||
        r.aiPrivilege != null ||
        r.relevance === "relevant" ||
        r.responsiveness === "responsive",
    )
    .slice(0, limit)
    .map((r) => ({
      documentId: r.documentId,
      relevance: r.relevance,
      privilege: r.privilege,
      responsiveness: r.responsiveness,
      important: r.important,
      humanPrivilegeFinal: r.humanPrivilegeFinal,
      aiPrivilege: r.aiPrivilege,
    }));

  return {
    reviewedFindings,
    proposedFindings,
    contractSummaries,
    comparisonSummaries,
    discoveryHighlights,
  };
}

export function formatProfessionalAnalysisForPrompt(ctx: ProfessionalAnalysisContext): string {
  const lines: string[] = [];

  if (ctx.contractSummaries.length) {
    lines.push("Reviewed/available contract analyses:");
    for (const a of ctx.contractSummaries) {
      lines.push(
        `- analysisId=${a.id} documentId=${a.documentId} status=${a.status} reviewedItems=${a.reviewedItemCount} proposedItems=${a.proposedItemCount} summary=${(a.summary ?? "").slice(0, 400)}`,
      );
    }
  }

  if (ctx.comparisonSummaries.length) {
    lines.push("Document comparisons:");
    for (const c of ctx.comparisonSummaries) {
      lines.push(
        `- comparisonId=${c.id} A=${c.documentAId} B=${c.documentBId} summary=${(c.summary ?? "").slice(0, 400)}`,
      );
    }
  }

  if (ctx.reviewedFindings.length) {
    lines.push("Reviewed analytical findings (may use as structured context):");
    for (const f of ctx.reviewedFindings) {
      lines.push(
        `- [REVIEWED] type=${f.findingType} run=${f.runType ?? "n/a"} title=${f.title} explanation=${(f.explanation ?? "").slice(0, 300)}`,
      );
    }
  }

  if (ctx.proposedFindings.length) {
    lines.push(
      "Proposed (UNREVIEWED) analytical findings — label clearly if referenced; do not treat as verified facts:",
    );
    for (const f of ctx.proposedFindings) {
      lines.push(
        `- [PROPOSED/UNREVIEWED] type=${f.findingType} run=${f.runType ?? "n/a"} title=${f.title}`,
      );
    }
  }

  if (ctx.discoveryHighlights.length) {
    lines.push(
      "Discovery review highlights (human privilege final is authoritative; AI privilege is proposal only):",
    );
    for (const d of ctx.discoveryHighlights) {
      lines.push(
        `- documentId=${d.documentId} relevance=${d.relevance} privilege=${d.privilege} humanPrivilegeFinal=${d.humanPrivilegeFinal} aiPrivilege=${d.aiPrivilege ?? "null"} responsive=${d.responsiveness} important=${d.important}`,
      );
    }
  }

  return lines.join("\n");
}
