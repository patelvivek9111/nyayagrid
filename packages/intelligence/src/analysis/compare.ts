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
  buildComparisonIdempotencyKey,
  computeParagraphDiffs,
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

async function summarizeComparisonChanges(params: {
  ai: AIProvider;
  documentATitle: string;
  documentBTitle: string;
  changes: DiffChange[];
}): Promise<{ summary: string; provider: string; model: string } | null> {
  if (params.changes.length === 0) {
    return {
      summary: "No substantive differences detected between the compared document versions.",
      provider: params.ai.name,
      model: "n/a",
    };
  }

  const changeDigest = params.changes
    .slice(0, 20)
    .map(
      (c) =>
        `- ${c.changeType}: ${c.oldText?.slice(0, 120) ?? "(none)"} -> ${c.newText?.slice(0, 120) ?? "(none)"}`,
    )
    .join("\n");

  const generation = await params.ai.generate({
    temperature: 0,
    schemaName: "document_comparison_summary",
    messages: [
      {
        role: "system",
        content:
          "Summarize substantive document version differences for a lawyer. Return JSON only: {summary:string}. Do not invent changes.",
      },
      {
        role: "user",
        content: [
          `Document A: ${params.documentATitle}`,
          `Document B: ${params.documentBTitle}`,
          "Detected changes:",
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

  return { summary, provider: generation.provider, model: generation.model };
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
    return { comparison: existing, changes, skipped: true as const };
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

  if (params.includeAiSummary !== false) {
    const ai = params.ai ?? createAIProviderFromEnv();
    const aiSummary = await summarizeComparisonChanges({
      ai,
      documentATitle: sideA.document.title,
      documentBTitle: sideB.document.title,
      changes: diffs,
    });
    if (aiSummary) {
      summary = aiSummary.summary;
      provider = aiSummary.provider;
      model = aiSummary.model;
    }
  } else if (diffs.length === 0) {
    summary = "No substantive differences detected between the compared document versions.";
  } else {
    summary = `${diffs.length} paragraph-level change(s) detected between document versions.`;
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
    metadata: { changeCount: createdChanges.length },
  });

  return { comparison: comparison!, changes: createdChanges, skipped: false as const };
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

  return { comparison, changes };
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

  return comparisons.map((comparison) => ({
    comparison,
    changes: changes.filter((c) => c.comparisonId === comparison.id),
  }));
}

export {
  buildComparisonIdempotencyKey,
  computeParagraphDiffs,
  splitParagraphs,
} from "../draft/helpers";
