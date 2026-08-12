import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@nyayagrid/database";
import {
  guideSituations,
  guideSituationEvents,
  guideSituationDocuments,
} from "@nyayagrid/database";
import type {
  GuideSituation,
  GuideSituationDocument,
  GuideSituationEvent,
} from "@nyayagrid/database";
import { assertGuideDocumentOwnership, assertGuideSituationOwnership } from "./auth";

export const createSituationInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
  issueCategory: z.string().trim().max(120).optional().nullable(),
  desiredOutcome: z.string().max(2000).optional().nullable(),
});

export type CreateSituationInput = z.infer<typeof createSituationInputSchema>;

export async function createSituation(
  db: Database,
  userId: string,
  input: CreateSituationInput,
): Promise<GuideSituation> {
  const parsed = createSituationInputSchema.parse(input);
  const [situation] = await db
    .insert(guideSituations)
    .values({
      userId,
      title: parsed.title,
      jurisdiction: parsed.jurisdiction ?? null,
      issueCategory: parsed.issueCategory ?? null,
      desiredOutcome: parsed.desiredOutcome ?? null,
    })
    .returning();
  if (!situation) throw new Error("Failed to create guide situation");
  return situation;
}

export const updateSituationInputSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
  issueCategory: z.string().trim().max(120).optional().nullable(),
  desiredOutcome: z.string().max(2000).optional().nullable(),
});

export type UpdateSituationInput = z.infer<typeof updateSituationInputSchema>;

export async function updateSituation(
  db: Database,
  params: { situationId: string; userId: string; input: UpdateSituationInput },
): Promise<GuideSituation> {
  await assertGuideSituationOwnership(db, params);
  const parsed = updateSituationInputSchema.parse(params.input);
  const [updated] = await db
    .update(guideSituations)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(guideSituations.id, params.situationId))
    .returning();
  if (!updated) throw new Error("Failed to update guide situation");
  return updated;
}

export const situationEventInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  eventDate: z.string().optional().nullable(),
  eventDateEnd: z.string().optional().nullable(),
  guideDocumentId: z.string().uuid().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

export type SituationEventInput = z.infer<typeof situationEventInputSchema>;

/** Every event is user_provided by construction — Guide never fabricates a situation event. */
export async function addSituationEvent(
  db: Database,
  params: { situationId: string; userId: string; input: SituationEventInput },
): Promise<GuideSituationEvent> {
  await assertGuideSituationOwnership(db, params);
  const parsed = situationEventInputSchema.parse(params.input);
  if (parsed.guideDocumentId) {
    await assertGuideDocumentOwnership(db, {
      documentId: parsed.guideDocumentId,
      userId: params.userId,
    });
  }
  const [event] = await db
    .insert(guideSituationEvents)
    .values({
      situationId: params.situationId,
      userId: params.userId,
      title: parsed.title,
      description: parsed.description ?? null,
      eventDate: parsed.eventDate ?? null,
      eventDateEnd: parsed.eventDateEnd ?? null,
      guideDocumentId: parsed.guideDocumentId ?? null,
      sortOrder: parsed.sortOrder ?? 0,
      sourceLabel: "user_provided",
    })
    .returning();
  if (!event) throw new Error("Failed to add guide situation event");
  return event;
}

export async function listSituationEvents(
  db: Database,
  params: { situationId: string; userId: string },
): Promise<GuideSituationEvent[]> {
  await assertGuideSituationOwnership(db, params);
  return db
    .select()
    .from(guideSituationEvents)
    .where(eq(guideSituationEvents.situationId, params.situationId))
    .orderBy(desc(guideSituationEvents.eventDate));
}

export async function editEvent(
  db: Database,
  params: {
    situationId: string;
    eventId: string;
    userId: string;
    input: Partial<SituationEventInput>;
  },
): Promise<GuideSituationEvent> {
  await assertGuideSituationOwnership(db, params);
  const parsed = situationEventInputSchema.partial().parse(params.input);
  const [existing] = await db
    .select()
    .from(guideSituationEvents)
    .where(
      and(
        eq(guideSituationEvents.id, params.eventId),
        eq(guideSituationEvents.situationId, params.situationId),
        eq(guideSituationEvents.userId, params.userId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Guide situation event not found for this user");

  const [updated] = await db
    .update(guideSituationEvents)
    .set({
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description ?? null } : {}),
      ...(parsed.eventDate !== undefined ? { eventDate: parsed.eventDate ?? null } : {}),
      ...(parsed.eventDateEnd !== undefined ? { eventDateEnd: parsed.eventDateEnd ?? null } : {}),
      ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(eq(guideSituationEvents.id, params.eventId))
    .returning();
  if (!updated) throw new Error("Failed to edit guide situation event");
  return updated;
}

/** Links a document to a situation — both must already be owned by the same user. */
export async function linkDocument(
  db: Database,
  params: { situationId: string; documentId: string; userId: string },
): Promise<GuideSituationDocument> {
  await assertGuideSituationOwnership(db, params);
  await assertGuideDocumentOwnership(db, params);

  const [existing] = await db
    .select()
    .from(guideSituationDocuments)
    .where(
      and(
        eq(guideSituationDocuments.situationId, params.situationId),
        eq(guideSituationDocuments.guideDocumentId, params.documentId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [link] = await db
    .insert(guideSituationDocuments)
    .values({
      situationId: params.situationId,
      guideDocumentId: params.documentId,
      userId: params.userId,
    })
    .returning();
  if (!link) throw new Error("Failed to link document to guide situation");
  return link;
}
