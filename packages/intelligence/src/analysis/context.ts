import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import {
  analysisFindingSources,
  analysisFindings,
  analysisRuns,
  documentAnalysisItems,
  documentAnalysisSources,
  documentComparisons,
  documentReviewStates,
} from "@nyayagrid/database";

export type AnalysisContextSource = {
  documentId: string;
  documentVersionId: string | null;
  chunkId: string | null;
  page: number | null;
  segmentRef: string | null;
  supportingText: string;
};

export type ReviewedAnalysisFinding = {
  id: string;
  findingType: string;
  title: string;
  explanation: string | null;
  attention: string | null;
  status: "reviewed";
  runType: string | null;
  sources: AnalysisContextSource[];
};

export type ReviewedContractAnalysisItem = {
  id: string;
  analysisId: string;
  category: string;
  title: string;
  explanation: string | null;
  status: "reviewed";
  sources: AnalysisContextSource[];
};

export type ProfessionalAnalysisContext = {
  reviewedFindings: ReviewedAnalysisFinding[];
  reviewedContractItems: ReviewedContractAnalysisItem[];
  /**
   * Residual: Compare B.2 summaries have no Analysis review status.
   * Left unchanged in Phase 6J. Not proposed Analysis items.
   */
  comparisonSummaries: Array<{
    id: string;
    documentAId: string;
    documentBId: string;
    summary: string | null;
  }>;
  /**
   * Residual: discovery review-state highlights (human privilege is authoritative).
   * Not proposed Analysis findings. Left unchanged in Phase 6J.
   */
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

export type AnalysisContextBuildInput = {
  findings?: Array<{
    id: string;
    analysisRunId: string;
    findingType: string;
    title: string;
    explanation: string | null;
    attention: string | null;
    status: string;
    reviewedAt?: Date | string | null;
    createdAt?: Date | string | null;
  }>;
  findingSources?: Array<{
    findingId: string;
    documentId: string;
    documentVersionId?: string | null;
    chunkId?: string | null;
    page?: number | null;
    segmentRef?: string | null;
    supportingText?: string | null;
  }>;
  findingRuns?: Array<{ id: string; runType: string | null }>;
  contractItems?: Array<{
    id: string;
    analysisId: string;
    category: string;
    title: string;
    explanation: string | null;
    status: string;
    reviewedAt?: Date | string | null;
    createdAt?: Date | string | null;
  }>;
  contractItemSources?: Array<{
    analysisItemId: string;
    documentId: string;
    documentVersionId?: string | null;
    chunkId?: string | null;
    page?: number | null;
    segmentRef?: string | null;
    supportingText?: string | null;
  }>;
  comparisons?: ProfessionalAnalysisContext["comparisonSummaries"];
  discoveryHighlights?: ProfessionalAnalysisContext["discoveryHighlights"];
  limit?: number;
};

function asTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : 0;
}

export function hasUsableAnalysisProvenance(source: AnalysisContextSource): boolean {
  return Boolean(source.documentId && source.chunkId);
}

function mapSource(row: {
  documentId: string;
  documentVersionId?: string | null;
  chunkId?: string | null;
  page?: number | null;
  segmentRef?: string | null;
  supportingText?: string | null;
}): AnalysisContextSource {
  return {
    documentId: row.documentId,
    documentVersionId: row.documentVersionId ?? null,
    chunkId: row.chunkId ?? null,
    page: row.page ?? null,
    segmentRef: row.segmentRef ?? null,
    supportingText: row.supportingText ?? "",
  };
}

/**
 * Safer Ask Nyaya rule: a reviewed Analysis row without a document+chunk
 * citation is excluded rather than injected as unsourced interpretation.
 */
function sourcedOnly<T extends { sources: AnalysisContextSource[] }>(rows: T[]): T[] {
  return rows
    .map((row) => ({
      ...row,
      sources: row.sources.filter(hasUsableAnalysisProvenance),
    }))
    .filter((row) => row.sources.length > 0);
}

/**
 * Build Ask Nyaya Analysis context from already-loaded rows.
 * Proposed and dismissed rows never become usable factual context.
 * The model-generated document_analyses.summary is never included.
 */
export function buildProfessionalAnalysisContext(
  input: AnalysisContextBuildInput,
): ProfessionalAnalysisContext {
  const limit = input.limit ?? 12;
  const runById = new Map((input.findingRuns ?? []).map((run) => [run.id, run]));
  const findingSources = input.findingSources ?? [];
  const itemSources = input.contractItemSources ?? [];

  const reviewedFindings = sourcedOnly(
    (input.findings ?? [])
      .filter((row) => row.status === "reviewed")
      .sort((a, b) => asTime(b.reviewedAt) - asTime(a.reviewedAt) || asTime(b.createdAt) - asTime(a.createdAt))
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        findingType: row.findingType,
        title: row.title,
        explanation: row.explanation,
        attention: row.attention,
        status: "reviewed" as const,
        runType: runById.get(row.analysisRunId)?.runType ?? null,
        sources: findingSources.filter((source) => source.findingId === row.id).map(mapSource),
      })),
  );

  const reviewedContractItems = sourcedOnly(
    (input.contractItems ?? [])
      .filter((row) => row.status === "reviewed")
      .sort((a, b) => asTime(b.reviewedAt) - asTime(a.reviewedAt) || asTime(b.createdAt) - asTime(a.createdAt))
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        analysisId: row.analysisId,
        category: row.category,
        title: row.title,
        explanation: row.explanation,
        status: "reviewed" as const,
        sources: itemSources
          .filter((source) => source.analysisItemId === row.id)
          .map(mapSource),
      })),
  );

  return {
    reviewedFindings,
    reviewedContractItems,
    comparisonSummaries: input.comparisons ?? [],
    discoveryHighlights: input.discoveryHighlights ?? [],
  };
}

export function askNyayaAnalysisTitles(ctx: ProfessionalAnalysisContext): {
  proposed: string[];
  reviewed: string[];
} {
  return {
    proposed: [],
    reviewed: [
      ...ctx.reviewedContractItems.map((row) => row.title),
      ...ctx.reviewedFindings.map((row) => row.title),
    ],
  };
}

/**
 * Load matter-scoped professional analysis for Nyaya Q&A.
 *
 * Trust boundary: STORED ANALYSIS != REVIEWED ANALYSIS != VERIFIED EVIDENCE.
 * Only reviewed, sourced Analysis items/findings enter. Proposed summaries never enter.
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
              eq(analysisFindings.status, "reviewed"),
            ),
          )
          .orderBy(desc(analysisFindings.reviewedAt), desc(analysisFindings.createdAt))
          .limit(limit);

  const findingIds = findings.map((f) => f.id);
  const findingSourceRows =
    findingIds.length === 0
      ? []
      : await params.db
          .select()
          .from(analysisFindingSources)
          .where(inArray(analysisFindingSources.findingId, findingIds));

  const contractItems = await params.db
    .select()
    .from(documentAnalysisItems)
    .where(
      and(
        eq(documentAnalysisItems.organizationId, params.organizationId),
        eq(documentAnalysisItems.matterId, params.matterId),
        eq(documentAnalysisItems.status, "reviewed"),
      ),
    )
    .orderBy(desc(documentAnalysisItems.reviewedAt), desc(documentAnalysisItems.createdAt))
    .limit(limit);

  const itemIds = contractItems.map((item) => item.id);
  const itemSourceRows =
    itemIds.length === 0
      ? []
      : await params.db
          .select()
          .from(documentAnalysisSources)
          .where(inArray(documentAnalysisSources.analysisItemId, itemIds));

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

  return buildProfessionalAnalysisContext({
    findings,
    findingSources: findingSourceRows,
    findingRuns: runs.map((run) => ({ id: run.id, runType: run.runType })),
    contractItems,
    contractItemSources: itemSourceRows,
    comparisons: comparisons.map((c) => ({
      id: c.id,
      documentAId: c.documentAId,
      documentBId: c.documentBId,
      summary: c.summary,
    })),
    discoveryHighlights,
    limit,
  });
}

function formatSource(source: AnalysisContextSource): string {
  const parts = [
    `documentId=${source.documentId}`,
    source.documentVersionId ? `documentVersionId=${source.documentVersionId}` : null,
    source.chunkId ? `chunkId=${source.chunkId}` : null,
    source.page != null ? `page=${source.page}` : null,
    source.segmentRef ? `segmentRef=${source.segmentRef}` : null,
    source.supportingText
      ? `quote=${source.supportingText.replace(/\s+/g, " ").slice(0, 240)}`
      : null,
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * Format reviewed Analysis for Ask Nyaya.
 * Reviewed AI analysis is secondary interpretation; cited source documents remain the evidence.
 */
export function formatProfessionalAnalysisForPrompt(ctx: ProfessionalAnalysisContext): string {
  const lines: string[] = [];
  const hasReviewedAnalysis = ctx.reviewedContractItems.length > 0 || ctx.reviewedFindings.length > 0;

  if (hasReviewedAnalysis) {
    lines.push(
      "Reviewed AI analysis (secondary interpretation only). The cited source document remains the primary evidence. Do not treat this Analysis as a verified fact or as a substitute for the source text.",
    );
  }

  if (ctx.reviewedContractItems.length) {
    lines.push("Reviewed contract analysis:");
    for (const item of ctx.reviewedContractItems) {
      const finding = `${item.title}${item.explanation ? ` ${item.explanation}` : ""}`.trim();
      lines.push(
        `- [REVIEWED ANALYSIS] category=${item.category} finding=${finding.slice(0, 400)}`,
      );
      for (const source of item.sources) {
        lines.push(`  source=${formatSource(source)}`);
      }
    }
  }

  if (ctx.reviewedFindings.length) {
    lines.push("Reviewed analytical findings:");
    for (const finding of ctx.reviewedFindings) {
      const text = `${finding.title}${finding.explanation ? ` ${finding.explanation}` : ""}`.trim();
      lines.push(
        `- [REVIEWED ANALYSIS] type=${finding.findingType} run=${finding.runType ?? "n/a"} finding=${text.slice(0, 400)}`,
      );
      for (const source of finding.sources) {
        lines.push(`  source=${formatSource(source)}`);
      }
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
