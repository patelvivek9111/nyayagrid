import { and, asc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  documentChunks,
  documentComparisons,
  documentComparisonChanges,
  documents,
} from "@nyayagrid/database";
import { createAIProviderFromEnv, type AIProvider } from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import {
  applyComparisonSummaryAlignmentPolicy,
  buildComparisonIdempotencyKey,
  computeParagraphDiffs,
  scoreComparisonSummaryAgainstDiffs,
  type ComparisonSummaryScore,
  type DiffChange,
} from "../draft/helpers";

async function verifyDocumentVersionInMatter(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
}) {
  const [doc] = await params.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, params.documentId),
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!doc) throw new Error("Document not found in matter scope");

  const chunks = await params.db
    .select()
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, params.organizationId),
        eq(documentChunks.matterId, params.matterId),
        eq(documentChunks.documentId, params.documentId),
        eq(documentChunks.documentVersionId, params.documentVersionId),
      ),
    )
    .orderBy(asc(documentChunks.chunkIndex));

  return { document: doc, chunks };
}

function concatenateChunkText(chunks: Array<{ content: string }>): string {
  return chunks
    .map((c) => c.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

export async function generateComparisonSummaryFromDiffs(params: {
  ai: AIProvider;
  documentATitle: string;
  documentBTitle: string;
  changes: DiffChange[];
}): Promise<{
  summary: string;
  provider: string;
  model: string;
  summaryScore: ComparisonSummaryScore;
} | null> {
  if (params.changes.length === 0) {
    const summary = "No substantive differences detected between the compared document versions.";
    return {
      summary,
      provider: params.ai.name,
      model: "n/a",
      summaryScore: scoreComparisonSummaryAgainstDiffs(summary, params.changes),
    };
  }

  const changeDigest = params.changes
    .slice(0, 20)
    .map(
      (c) =>
        `- ${c.changeType}/${c.attention}: ${c.oldText?.slice(0, 120) ?? "(none)"} -> ${c.newText?.slice(0, 120) ?? "(none)"}`,
    )
    .join("\n");

  const generation = await params.ai.generate({
    temperature: 0,
    schemaName: "document_comparison_summary",
    messages: [
      {
        role: "system",
        content:
          "Summarize substantive document version differences for a lawyer. Return JSON only: {summary:string}. Use ONLY the detected changes listed. Do not invent clauses, parties, or changes absent from the digest.",
      },
      {
        role: "user",
        content: [
          `Document A: ${params.documentATitle}`,
          `Document B: ${params.documentBTitle}`,
          "Detected changes (authoritative):",
          changeDigest,
        ].join("\n"),
      },
    ],
  });

  let summary = "Document versions differ; review the detected changes.";
  try {
    const parsed = JSON.parse(generation.text) as { summary?: string };
    if (parsed.summary?.trim()) summary = parsed.summary.trim();
  } catch {
    if (generation.text.trim()) summary = generation.text.trim();
  }

  const aligned = applyComparisonSummaryAlignmentPolicy(summary, params.changes);
  return {
    summary: aligned.summary,
    provider: generation.provider,
    model: generation.model,
    summaryScore: aligned.score,
  };
}

export async function compareDocuments(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentAId: string;
  versionAId: string;
  documentBId: string;
  versionBId: string;
  userId: string;
  ai?: AIProvider;
  includeAiSummary?: boolean;
}) {
  const idempotencyKey = buildComparisonIdempotencyKey(params.versionAId, params.versionBId);

  const [existing] = await params.db
    .select()
    .from(documentComparisons)
    .where(eq(documentComparisons.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existing) {
    const changes = await params.db
      .select()
      .from(documentComparisonChanges)
      .where(eq(documentComparisonChanges.comparisonId, existing.id))
      .orderBy(documentComparisonChanges.createdAt);
    const diffLike: DiffChange[] = changes.map((c) => ({
      changeType: c.changeType as DiffChange["changeType"],
      locationA: c.locationA,
      locationB: c.locationB,
      oldText: c.oldText,
      newText: c.newText,
      attention: c.attention as DiffChange["attention"],
    }));
    return {
      comparison: existing,
      changes,
      skipped: true as const,
      summaryScore: scoreComparisonSummaryAgainstDiffs(existing.summary ?? "", diffLike),
    };
  }

  const sideA = await verifyDocumentVersionInMatter({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentId: params.documentAId,
    documentVersionId: params.versionAId,
  });
  const sideB = await verifyDocumentVersionInMatter({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentId: params.documentBId,
    documentVersionId: params.versionBId,
  });

  const textA = concatenateChunkText(sideA.chunks);
  const textB = concatenateChunkText(sideB.chunks);
  const diffs = computeParagraphDiffs(textA, textB);

  let summary: string | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  let summaryScore: ComparisonSummaryScore = scoreComparisonSummaryAgainstDiffs("", diffs);

  if (params.includeAiSummary !== false) {
    const ai = params.ai ?? createAIProviderFromEnv();
    const aiSummary = await generateComparisonSummaryFromDiffs({
      ai,
      documentATitle: sideA.document.title,
      documentBTitle: sideB.document.title,
      changes: diffs,
    });
    if (aiSummary) {
      summary = aiSummary.summary;
      provider = aiSummary.provider;
      model = aiSummary.model;
      summaryScore = aiSummary.summaryScore;
    }
  } else if (diffs.length === 0) {
    summary = "No substantive differences detected between the compared document versions.";
    summaryScore = scoreComparisonSummaryAgainstDiffs(summary, diffs);
  } else {
    summary = `${diffs.length} paragraph-level change(s) detected between document versions.`;
    const aligned = applyComparisonSummaryAlignmentPolicy(summary, diffs);
    summary = aligned.summary;
    summaryScore = aligned.score;
  }

  const [comparison] = await params.db
    .insert(documentComparisons)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      documentAId: params.documentAId,
      documentAVersionId: params.versionAId,
      documentBId: params.documentBId,
      documentBVersionId: params.versionBId,
      summary,
      idempotencyKey,
      provider,
      model,
      createdByUserId: params.userId,
    })
    .returning();

  const createdChanges = [];
  for (const diff of diffs) {
    const [row] = await params.db
      .insert(documentComparisonChanges)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        comparisonId: comparison!.id,
        changeType: diff.changeType,
        locationA: diff.locationA,
        locationB: diff.locationB,
        oldText: diff.oldText,
        newText: diff.newText,
        explanation: null,
        attention: diff.attention,
      })
      .returning();
    createdChanges.push(row!);
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "document_comparison.completed",
    targetType: "document_comparison",
    targetId: comparison!.id,
    metadata: {
      changeCount: createdChanges.length,
      summaryAlignment: summaryScore.alignment,
      summaryScore: summaryScore.score,
      unsupportedClaimCount: summaryScore.unsupportedClaims.length,
    },
  });

  return {
    comparison: comparison!,
    changes: createdChanges,
    skipped: false as const,
    summaryScore,
  };
}

export async function getDocumentComparison(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  comparisonId: string;
}) {
  const [comparison] = await params.db
    .select()
    .from(documentComparisons)
    .where(
      and(
        eq(documentComparisons.id, params.comparisonId),
        eq(documentComparisons.organizationId, params.organizationId),
        eq(documentComparisons.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!comparison) return null;

  const changes = await params.db
    .select()
    .from(documentComparisonChanges)
    .where(eq(documentComparisonChanges.comparisonId, comparison.id))
    .orderBy(documentComparisonChanges.createdAt);

  const diffLike: DiffChange[] = changes.map((c) => ({
    changeType: c.changeType as DiffChange["changeType"],
    locationA: c.locationA,
    locationB: c.locationB,
    oldText: c.oldText,
    newText: c.newText,
    attention: c.attention as DiffChange["attention"],
  }));

  return {
    comparison,
    changes,
    summaryScore: scoreComparisonSummaryAgainstDiffs(comparison.summary ?? "", diffLike),
  };
}

export async function listDocumentComparisons(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  const comparisons = await params.db
    .select()
    .from(documentComparisons)
    .where(
      and(
        eq(documentComparisons.organizationId, params.organizationId),
        eq(documentComparisons.matterId, params.matterId),
      ),
    )
    .orderBy(documentComparisons.createdAt);

  if (comparisons.length === 0) return [];

  const comparisonIds = comparisons.map((c) => c.id);
  const changes = await params.db
    .select()
    .from(documentComparisonChanges)
    .where(inArray(documentComparisonChanges.comparisonId, comparisonIds));

  return comparisons.map((comparison) => {
    const rowChanges = changes.filter((c) => c.comparisonId === comparison.id);
    const diffLike: DiffChange[] = rowChanges.map((c) => ({
      changeType: c.changeType as DiffChange["changeType"],
      locationA: c.locationA,
      locationB: c.locationB,
      oldText: c.oldText,
      newText: c.newText,
      attention: c.attention as DiffChange["attention"],
    }));
    return {
      comparison,
      changes: rowChanges,
      summaryScore: scoreComparisonSummaryAgainstDiffs(comparison.summary ?? "", diffLike),
    };
  });
}

export {
  applyComparisonSummaryAlignmentPolicy,
  buildComparisonIdempotencyKey,
  computeParagraphDiffs,
  scoreComparisonSummaryAgainstDiffs,
  splitParagraphs,
} from "../draft/helpers";
export type { ComparisonSummaryScore, ComparisonSummaryAlignment } from "../draft/helpers";
