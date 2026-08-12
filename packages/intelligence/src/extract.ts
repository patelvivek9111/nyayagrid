import { and, eq, inArray, isNull } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  documentChunks,
  documentIntelligenceRuns,
  documents,
  timelineEvents,
  timelineEventSources,
  matterFacts,
  matterFactSources,
  matterEntities,
  entityAliases,
  entityRoles,
  entitySources,
  deadlineCandidates,
  deadlineCandidateSources,
} from "@nyayagrid/database";
import {
  createAIProviderFromEnv,
  buildMatterIntelligenceSystemPrompt,
  buildMatterIntelligenceUserPrompt,
  matterIntelligenceExtractionSchema,
  MATTER_INTELLIGENCE_PROMPT_VERSION,
  type AIProvider,
  type ExtractionChunk,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { buildTimelineDedupeKey, findDuplicateTimelineEvent } from "./dedupe";
import {
  loadAuthorizedChunks,
  normalizeEntityName,
  parseOptionalDate,
  resolveValidatedSources,
} from "./provenance";

export const INTELLIGENCE_RUN_KIND = "matter_intelligence_v1";

export async function extractMatterIntelligenceForDocument(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  userId?: string | null;
  ai?: AIProvider;
  force?: boolean;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const idempotencyKey = `${INTELLIGENCE_RUN_KIND}:${params.documentVersionId}`;

  const [existingRun] = await params.db
    .select()
    .from(documentIntelligenceRuns)
    .where(eq(documentIntelligenceRuns.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingRun && existingRun.status === "completed" && !params.force) {
    return {
      skipped: true as const,
      run: existingRun,
      message: "Extraction already completed for document version",
    };
  }

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
  if (!doc || doc.processingState !== "ready") {
    throw new Error("Document must be ready before matter intelligence extraction");
  }

  let run = existingRun;
  if (!run) {
    const [created] = await params.db
      .insert(documentIntelligenceRuns)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        documentId: params.documentId,
        documentVersionId: params.documentVersionId,
        runKind: INTELLIGENCE_RUN_KIND,
        status: "running",
        idempotencyKey,
        promptVersion: MATTER_INTELLIGENCE_PROMPT_VERSION,
        createdByUserId: params.userId ?? null,
      })
      .returning();
    run = created!;
  } else {
    const [updated] = await params.db
      .update(documentIntelligenceRuns)
      .set({
        status: "running",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(documentIntelligenceRuns.id, run.id))
      .returning();
    run = updated!;
  }

  try {
    const chunks = await params.db
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

    const extractionChunks: ExtractionChunk[] = chunks.map((c) => ({
      chunkId: c.id,
      documentId: c.documentId,
      documentVersionId: c.documentVersionId,
      page: c.pageStart,
      segmentRef: c.segmentRef,
      content: c.content,
    }));

    const generation = await ai.generate({
      temperature: 0,
      schemaName: "matter_intelligence_extraction",
      messages: [
        { role: "system", content: buildMatterIntelligenceSystemPrompt() },
        { role: "user", content: buildMatterIntelligenceUserPrompt(extractionChunks) },
      ],
    });

    let raw: unknown;
    try {
      raw = JSON.parse(generation.text);
    } catch {
      raw = { timelineEvents: [], facts: [], entities: [], deadlines: [] };
    }
    const parsed = matterIntelligenceExtractionSchema.parse(raw);

    const allChunkIds = [
      ...parsed.timelineEvents.flatMap((e) => e.sourceChunkIds),
      ...parsed.facts.flatMap((f) => f.sourceChunkIds),
      ...parsed.entities.flatMap((e) => e.sourceChunkIds),
      ...parsed.deadlines.flatMap((d) => d.sourceChunkIds),
    ];
    const authorized = await loadAuthorizedChunks(params.db, {
      organizationId: params.organizationId,
      matterId: params.matterId,
      chunkIds: allChunkIds,
    });

    const existingEvents = await params.db
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.organizationId, params.organizationId),
          eq(timelineEvents.matterId, params.matterId),
          inArray(timelineEvents.status, ["proposed", "approved", "edited_and_approved"]),
        ),
      );

    let createdEvents = 0;
    let mergedEvents = 0;
    let rejectedNoSource = 0;
    let createdFacts = 0;
    let createdEntities = 0;
    let createdDeadlines = 0;

    for (const proposal of parsed.timelineEvents) {
      const sources = resolveValidatedSources({
        organizationId: params.organizationId,
        matterId: params.matterId,
        sourceChunkIds: proposal.sourceChunkIds,
        sourceQuotes: proposal.sourceQuotes,
        authorized,
      });
      if (sources.length === 0) {
        rejectedNoSource += 1;
        continue;
      }
      const eventDate = parseOptionalDate(proposal.eventDate);
      const eventDateEnd = parseOptionalDate(proposal.eventDateEnd);
      const duplicate = findDuplicateTimelineEvent(
        {
          eventType: proposal.eventType,
          title: proposal.title,
          description: proposal.description,
          eventDate,
          actors: proposal.actors,
        },
        existingEvents.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          title: e.title,
          description: e.description,
          eventDate: e.eventDate,
          actors: (e.actors as string[] | null) ?? [],
          status: e.status,
        })),
      );

      if (duplicate?.id) {
        for (const source of sources) {
          await params.db
            .insert(timelineEventSources)
            .values({
              ...source,
              timelineEventId: duplicate.id,
            })
            .onConflictDoNothing();
        }
        mergedEvents += 1;
        continue;
      }

      const [event] = await params.db
        .insert(timelineEvents)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          title: proposal.title,
          description: proposal.description || null,
          eventType: proposal.eventType,
          eventDate,
          eventDateEnd,
          datePrecision: proposal.datePrecision,
          status: "proposed",
          confidence: proposal.confidence,
          origin: "ai",
          actors: proposal.actors,
          uncertaintyNotes: proposal.uncertaintyNotes ?? null,
          dedupeKey: buildTimelineDedupeKey({
            eventType: proposal.eventType,
            eventDate,
            title: proposal.title,
          }),
          extractionRunId: run.id,
          createdByUserId: params.userId ?? null,
        })
        .returning();

      for (const source of sources) {
        await params.db.insert(timelineEventSources).values({
          ...source,
          timelineEventId: event!.id,
        });
      }
      existingEvents.push(event!);
      createdEvents += 1;
    }

    for (const proposal of parsed.facts) {
      const sources = resolveValidatedSources({
        organizationId: params.organizationId,
        matterId: params.matterId,
        sourceChunkIds: proposal.sourceChunkIds,
        sourceQuotes: proposal.sourceQuotes,
        authorized,
      });
      if (sources.length === 0) {
        rejectedNoSource += 1;
        continue;
      }

      const [existingFact] = await params.db
        .select()
        .from(matterFacts)
        .where(
          and(
            eq(matterFacts.organizationId, params.organizationId),
            eq(matterFacts.matterId, params.matterId),
            eq(matterFacts.factKey, proposal.factKey),
            eq(matterFacts.value, proposal.value),
            inArray(matterFacts.status, ["proposed", "approved", "edited_and_approved"]),
          ),
        )
        .limit(1);

      if (existingFact) {
        for (const source of sources) {
          await params.db
            .insert(matterFactSources)
            .values({ ...source, matterFactId: existingFact.id })
            .onConflictDoNothing();
        }
        continue;
      }

      const [fact] = await params.db
        .insert(matterFacts)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          factKey: proposal.factKey,
          label: proposal.label,
          value: proposal.value,
          normalizedValue: proposal.normalizedValue ?? null,
          status: "proposed",
          confidence: proposal.confidence,
          origin: "ai",
          uncertaintyNotes: proposal.uncertaintyNotes ?? null,
          extractionRunId: run.id,
          createdByUserId: params.userId ?? null,
        })
        .returning();
      for (const source of sources) {
        await params.db.insert(matterFactSources).values({
          ...source,
          matterFactId: fact!.id,
        });
      }
      createdFacts += 1;
    }

    for (const proposal of parsed.entities) {
      const sources = resolveValidatedSources({
        organizationId: params.organizationId,
        matterId: params.matterId,
        sourceChunkIds: proposal.sourceChunkIds,
        sourceQuotes: proposal.sourceQuotes,
        authorized,
      });
      if (sources.length === 0) {
        rejectedNoSource += 1;
        continue;
      }
      const normalized = normalizeEntityName(proposal.displayName);
      const [existingEntity] = await params.db
        .select()
        .from(matterEntities)
        .where(
          and(
            eq(matterEntities.organizationId, params.organizationId),
            eq(matterEntities.matterId, params.matterId),
            eq(matterEntities.normalizedName, normalized),
            isNull(matterEntities.mergedIntoEntityId),
            inArray(matterEntities.status, ["proposed", "approved", "edited_and_approved"]),
          ),
        )
        .limit(1);

      let entityId = existingEntity?.id;
      if (!entityId) {
        const [entity] = await params.db
          .insert(matterEntities)
          .values({
            organizationId: params.organizationId,
            matterId: params.matterId,
            entityType: proposal.entityType,
            displayName: proposal.displayName,
            normalizedName: normalized,
            description: proposal.description ?? null,
            status: "proposed",
            confidence: proposal.confidence,
            origin: "ai",
            extractionRunId: run.id,
            createdByUserId: params.userId ?? null,
          })
          .returning();
        entityId = entity!.id;
        createdEntities += 1;
      }

      for (const alias of proposal.aliases) {
        await params.db
          .insert(entityAliases)
          .values({
            organizationId: params.organizationId,
            matterId: params.matterId,
            entityId: entityId!,
            alias,
          })
          .onConflictDoNothing();
      }
      for (const role of proposal.roles) {
        await params.db
          .insert(entityRoles)
          .values({
            organizationId: params.organizationId,
            matterId: params.matterId,
            entityId: entityId!,
            role,
            status: "proposed",
          })
          .onConflictDoNothing();
      }
      for (const source of sources) {
        await params.db
          .insert(entitySources)
          .values({ ...source, entityId: entityId! })
          .onConflictDoNothing();
      }
    }

    for (const proposal of parsed.deadlines) {
      const sources = resolveValidatedSources({
        organizationId: params.organizationId,
        matterId: params.matterId,
        sourceChunkIds: proposal.sourceChunkIds,
        sourceQuotes: proposal.sourceQuotes,
        authorized,
      });
      if (sources.length === 0) {
        rejectedNoSource += 1;
        continue;
      }
      const dueAt = parseOptionalDate(proposal.dueAt);
      const dueAtEnd = parseOptionalDate(proposal.dueAtEnd);
      const [existingDeadline] = await params.db
        .select()
        .from(deadlineCandidates)
        .where(
          and(
            eq(deadlineCandidates.organizationId, params.organizationId),
            eq(deadlineCandidates.matterId, params.matterId),
            eq(deadlineCandidates.title, proposal.title),
            inArray(deadlineCandidates.status, ["proposed", "approved", "edited_and_approved"]),
          ),
        )
        .limit(1);
      if (existingDeadline) {
        for (const source of sources) {
          await params.db
            .insert(deadlineCandidateSources)
            .values({ ...source, deadlineCandidateId: existingDeadline.id })
            .onConflictDoNothing();
        }
        continue;
      }
      const [deadline] = await params.db
        .insert(deadlineCandidates)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          title: proposal.title,
          description: proposal.description ?? null,
          dueAt,
          dueAtEnd,
          datePrecision: proposal.datePrecision,
          dateKind: proposal.dateKind,
          timezone: proposal.timezone ?? null,
          status: "proposed",
          confidence: proposal.confidence,
          origin: "ai",
          uncertaintyNotes: proposal.uncertaintyNotes ?? null,
          extractionRunId: run.id,
          createdByUserId: params.userId ?? null,
        })
        .returning();
      for (const source of sources) {
        await params.db.insert(deadlineCandidateSources).values({
          ...source,
          deadlineCandidateId: deadline!.id,
        });
      }
      createdDeadlines += 1;
    }

    const stats = {
      createdEvents,
      mergedEvents,
      createdFacts,
      createdEntities,
      createdDeadlines,
      rejectedNoSource,
      chunkCount: chunks.length,
    };

    const [completed] = await params.db
      .update(documentIntelligenceRuns)
      .set({
        status: "completed",
        provider: generation.provider,
        model: generation.model,
        promptVersion: MATTER_INTELLIGENCE_PROMPT_VERSION,
        stats,
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(documentIntelligenceRuns.id, run.id))
      .returning();

    await writeAuditEvent(params.db, {
      organizationId: params.organizationId,
      actorUserId: params.userId ?? null,
      matterId: params.matterId,
      action: "matter_intelligence.extracted",
      targetType: "document_version",
      targetId: params.documentVersionId,
      metadata: { runId: run.id, ...stats },
    });

    return { skipped: false as const, run: completed!, stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed";
    await params.db
      .update(documentIntelligenceRuns)
      .set({
        status: "failed",
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(documentIntelligenceRuns.id, run.id));
    throw error;
  }
}

export async function extractMatterIntelligenceForReadyDocuments(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId?: string | null;
  ai?: AIProvider;
  documentVersionId?: string;
}) {
  const readyDocs = await params.db
    .select({
      documentId: documents.id,
    })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
        eq(documents.processingState, "ready"),
      ),
    );

  const results = [];
  for (const doc of readyDocs) {
    const versions = await params.db.query.documentVersions.findMany({
      where: (table, ops) =>
        ops.and(
          ops.eq(table.documentId, doc.documentId),
          ops.eq(table.organizationId, params.organizationId),
        ),
      orderBy: (table, ops) => [ops.desc(table.versionNumber)],
      limit: 1,
    });
    const version = versions[0];
    if (!version) continue;
    if (params.documentVersionId && version.id !== params.documentVersionId) continue;
    const result = await extractMatterIntelligenceForDocument({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      documentId: doc.documentId,
      documentVersionId: version.id,
      userId: params.userId,
      ai: params.ai,
    });
    results.push(result);
  }
  return results;
}
