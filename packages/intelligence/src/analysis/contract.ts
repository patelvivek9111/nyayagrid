import { and, desc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  documentAnalyses,
  documentAnalysisItems,
  documentAnalysisSources,
  documentChunks,
  documents,
  redlineSuggestions,
} from "@nyayagrid/database";
import {
  createAIProviderFromEnv,
  buildContractAnalysisSystemPrompt,
  buildContractAnalysisUserPrompt,
  contractAnalysisSchema,
  CONTRACT_ANALYSIS_PROMPT_VERSION,
  buildRedlineSuggestionsSystemPrompt,
  buildRedlineSuggestionsUserPrompt,
  redlineSuggestionsSchema,
  REDLINE_SUGGESTIONS_PROMPT_VERSION,
  type AIProvider,
  type ProfessionalChunk,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { loadAuthorizedChunks } from "../provenance";
import { buildContractAnalysisIdempotencyKey } from "../draft/helpers";

async function loadVersionChunks(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentVersionId: string;
}): Promise<ProfessionalChunk[]> {
  const rows = await params.db
    .select()
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, params.organizationId),
        eq(documentChunks.matterId, params.matterId),
        eq(documentChunks.documentVersionId, params.documentVersionId),
      ),
    )
    .orderBy(documentChunks.chunkIndex);

  return rows.map((c) => ({
    chunkId: c.id,
    documentId: c.documentId,
    documentVersionId: c.documentVersionId,
    page: c.pageStart,
    segmentRef: c.segmentRef,
    content: c.content,
  }));
}

async function verifyDocumentInMatter(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
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
  return doc;
}

export async function analyzeContract(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  userId: string;
  ai?: AIProvider;
  force?: boolean;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const idempotencyKey = buildContractAnalysisIdempotencyKey(params.documentVersionId);

  const [existing] = await params.db
    .select()
    .from(documentAnalyses)
    .where(eq(documentAnalyses.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existing && !params.force) {
    const analysis = await getContractAnalysis({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      analysisId: existing.id,
    });
    return { skipped: true as const, analysis: analysis! };
  }

  const doc = await verifyDocumentInMatter({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentId: params.documentId,
  });

  const chunks = await loadVersionChunks({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentVersionId: params.documentVersionId,
  });

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "contract_analysis",
    messages: [
      { role: "system", content: buildContractAnalysisSystemPrompt() },
      {
        role: "user",
        content: buildContractAnalysisUserPrompt({
          documentTitle: doc.title,
          chunks,
        }),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = { summary: generation.text, items: [] };
  }
  const parsed = contractAnalysisSchema.parse(raw);

  const authorized = await loadAuthorizedChunks(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    chunkIds: parsed.items.flatMap((item) => item.sourceChunkIds),
  });

  let analysis = existing;
  if (!analysis) {
    const [created] = await params.db
      .insert(documentAnalyses)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        documentId: params.documentId,
        documentVersionId: params.documentVersionId,
        analysisType: "contract",
        summary: parsed.summary,
        status: "proposed",
        provider: generation.provider,
        model: generation.model,
        promptVersion: CONTRACT_ANALYSIS_PROMPT_VERSION,
        idempotencyKey,
        createdByUserId: params.userId,
      })
      .returning();
    analysis = created!;
  } else {
    const [updated] = await params.db
      .update(documentAnalyses)
      .set({
        summary: parsed.summary,
        status: "proposed",
        provider: generation.provider,
        model: generation.model,
        promptVersion: CONTRACT_ANALYSIS_PROMPT_VERSION,
        updatedAt: new Date(),
      })
      .where(eq(documentAnalyses.id, analysis.id))
      .returning();
    analysis = updated!;

    const oldItems = await params.db
      .select({ id: documentAnalysisItems.id })
      .from(documentAnalysisItems)
      .where(eq(documentAnalysisItems.analysisId, analysis.id));
    const oldItemIds = oldItems.map((i) => i.id);
    if (oldItemIds.length > 0) {
      await params.db
        .delete(documentAnalysisSources)
        .where(inArray(documentAnalysisSources.analysisItemId, oldItemIds));
      await params.db
        .delete(documentAnalysisItems)
        .where(inArray(documentAnalysisItems.id, oldItemIds));
    }
  }

  const createdItems = [];
  for (const item of parsed.items) {
    const validChunkIds = item.sourceChunkIds.filter((id) => authorized.has(id));
    if (validChunkIds.length === 0) continue;

    const [row] = await params.db
      .insert(documentAnalysisItems)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        analysisId: analysis.id,
        category: item.category,
        title: item.title,
        summary: item.explanation.slice(0, 500),
        originalText: item.originalText ?? null,
        explanation: item.explanation,
        attention: item.attention,
        status: "proposed",
        confidence: "medium",
      })
      .returning();

    for (const chunkId of validChunkIds) {
      const chunk = authorized.get(chunkId)!;
      await params.db.insert(documentAnalysisSources).values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        analysisItemId: row!.id,
        documentId: chunk.documentId,
        documentVersionId: chunk.documentVersionId,
        chunkId: chunk.chunkId,
        page: chunk.page,
        segmentRef: chunk.segmentRef,
        supportingText: chunk.content.slice(0, 400),
      });
    }
    createdItems.push(row!);
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "contract_analysis.completed",
    targetType: "document_analysis",
    targetId: analysis.id,
    metadata: { itemCount: createdItems.length, provider: generation.provider },
  });

  const full = await getContractAnalysis({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    analysisId: analysis.id,
  });

  return { skipped: false as const, analysis: full! };
}

export async function listContractAnalyses(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId?: string;
}) {
  const conditions = [
    eq(documentAnalyses.organizationId, params.organizationId),
    eq(documentAnalyses.matterId, params.matterId),
    eq(documentAnalyses.analysisType, "contract"),
  ];
  if (params.documentId) {
    conditions.push(eq(documentAnalyses.documentId, params.documentId));
  }
  return params.db
    .select()
    .from(documentAnalyses)
    .where(and(...conditions))
    .orderBy(desc(documentAnalyses.updatedAt));
}

export async function getContractAnalysis(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  analysisId: string;
}) {
  const [analysis] = await params.db
    .select()
    .from(documentAnalyses)
    .where(
      and(
        eq(documentAnalyses.id, params.analysisId),
        eq(documentAnalyses.organizationId, params.organizationId),
        eq(documentAnalyses.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!analysis) return null;

  const items = await params.db
    .select()
    .from(documentAnalysisItems)
    .where(eq(documentAnalysisItems.analysisId, analysis.id))
    .orderBy(documentAnalysisItems.createdAt);

  const itemIds = items.map((i) => i.id);
  const sources =
    itemIds.length === 0
      ? []
      : await params.db
          .select()
          .from(documentAnalysisSources)
          .where(inArray(documentAnalysisSources.analysisItemId, itemIds));

  return {
    analysis,
    items: items.map((item) => ({
      ...item,
      sources: sources.filter((s) => s.analysisItemId === item.id),
    })),
  };
}

export async function reviewAnalysisItem(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  itemId: string;
  userId: string;
  action: "reviewed" | "dismissed";
}) {
  const now = new Date();
  const [updated] = await params.db
    .update(documentAnalysisItems)
    .set({
      status: params.action,
      reviewedByUserId: params.userId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(documentAnalysisItems.id, params.itemId),
        eq(documentAnalysisItems.organizationId, params.organizationId),
        eq(documentAnalysisItems.matterId, params.matterId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Analysis item not found in matter scope");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: `contract_analysis_item.${params.action}`,
    targetType: "document_analysis_item",
    targetId: params.itemId,
  });

  return updated;
}

export async function generateRedlineSuggestions(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  analysisId: string;
  userId: string;
  focus?: string;
  ai?: AIProvider;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const analysisResult = await getContractAnalysis({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    analysisId: params.analysisId,
  });
  if (!analysisResult) throw new Error("Contract analysis not found");

  const { analysis } = analysisResult;
  const doc = await verifyDocumentInMatter({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentId: analysis.documentId,
  });

  const chunks = await loadVersionChunks({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentVersionId: analysis.documentVersionId,
  });

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "redline_suggestions",
    messages: [
      { role: "system", content: buildRedlineSuggestionsSystemPrompt() },
      {
        role: "user",
        content: buildRedlineSuggestionsUserPrompt({
          documentTitle: doc.title,
          focus: params.focus,
          chunks,
        }),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = { suggestions: [] };
  }
  const parsed = redlineSuggestionsSchema.parse(raw);

  const authorized = await loadAuthorizedChunks(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    chunkIds: parsed.suggestions.map((s) => s.chunkId).filter((id): id is string => Boolean(id)),
  });

  const created = [];
  for (const suggestion of parsed.suggestions) {
    const chunkId =
      suggestion.chunkId && authorized.has(suggestion.chunkId) ? suggestion.chunkId : null;
    const [row] = await params.db
      .insert(redlineSuggestions)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        analysisId: analysis.id,
        documentId: analysis.documentId,
        documentVersionId: analysis.documentVersionId,
        currentClause: suggestion.currentClause,
        proposedClause: suggestion.proposedClause,
        reason: suggestion.reason,
        issue: suggestion.issue ?? null,
        status: "proposed",
        chunkId,
        createdByUserId: params.userId,
      })
      .returning();
    created.push(row!);
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "redline_suggestions.generated",
    targetType: "document_analysis",
    targetId: analysis.id,
    metadata: {
      count: created.length,
      provider: generation.provider,
      promptVersion: REDLINE_SUGGESTIONS_PROMPT_VERSION,
    },
  });

  return { suggestions: created, provider: generation.provider, model: generation.model };
}

export async function reviewRedlineSuggestion(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  suggestionId: string;
  userId: string;
  status: "accepted" | "rejected";
}) {
  const now = new Date();
  const [updated] = await params.db
    .update(redlineSuggestions)
    .set({
      status: params.status,
      reviewedByUserId: params.userId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(redlineSuggestions.id, params.suggestionId),
        eq(redlineSuggestions.organizationId, params.organizationId),
        eq(redlineSuggestions.matterId, params.matterId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Redline suggestion not found in matter scope");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: `redline_suggestion.${params.status}`,
    targetType: "redline_suggestion",
    targetId: params.suggestionId,
  });

  return updated;
}

export async function listRedlineSuggestions(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  analysisId?: string;
}) {
  const conditions = [
    eq(redlineSuggestions.organizationId, params.organizationId),
    eq(redlineSuggestions.matterId, params.matterId),
  ];
  if (params.analysisId) {
    conditions.push(eq(redlineSuggestions.analysisId, params.analysisId));
  }
  return params.db
    .select()
    .from(redlineSuggestions)
    .where(and(...conditions))
    .orderBy(desc(redlineSuggestions.createdAt));
}
