import { and, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { legalAuthorityChunks, researchNotes } from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { getResearchSession } from "./sessions";

export type ResearchNote = typeof researchNotes.$inferSelect;

export type ResearchNoteOrigin = "manual" | "ai";

const MAX_NOTE_CHARS = 20000;

/**
 * Create a research note. Origin is recorded verbatim so an AI-authored note can never be
 * presented later as attorney-written work product.
 */
export async function createResearchNote(params: {
  db: Database;
  organizationId: string;
  userId: string;
  origin: ResearchNoteOrigin;
  content: string;
  sessionId?: string | null;
  matterId?: string | null;
  authorityId?: string | null;
  authorityChunkId?: string | null;
}): Promise<ResearchNote> {
  const content = params.content.trim();
  if (!content) throw new Error("Research note content is required");
  if (params.origin !== "manual" && params.origin !== "ai") {
    throw new Error("Research note origin must be manual or ai");
  }

  if (params.sessionId) {
    const session = await getResearchSession({
      db: params.db,
      organizationId: params.organizationId,
      sessionId: params.sessionId,
    });
    if (!session) throw new Error("Research session not found in organization scope");
  }

  if (params.authorityChunkId) {
    const [chunk] = await params.db
      .select({
        id: legalAuthorityChunks.id,
        authorityId: legalAuthorityChunks.authorityId,
      })
      .from(legalAuthorityChunks)
      .where(eq(legalAuthorityChunks.id, params.authorityChunkId))
      .limit(1);
    if (!chunk) throw new Error("Authority chunk not found in corpus");
    if (params.authorityId && chunk.authorityId !== params.authorityId) {
      throw new Error("Authority chunk does not belong to the referenced authority");
    }
  }

  const [note] = await params.db
    .insert(researchNotes)
    .values({
      organizationId: params.organizationId,
      sessionId: params.sessionId ?? null,
      matterId: params.matterId ?? null,
      authorityId: params.authorityId ?? null,
      authorityChunkId: params.authorityChunkId ?? null,
      content: content.slice(0, MAX_NOTE_CHARS),
      origin: params.origin,
      createdByUserId: params.userId,
    })
    .returning();
  if (!note) throw new Error("Failed to create research note");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId ?? null,
    action: "research_note.created",
    targetType: "research_note",
    targetId: note.id,
    metadata: {
      origin: params.origin,
      sessionId: params.sessionId ?? null,
      authorityId: params.authorityId ?? null,
      contentChars: content.length,
    },
  });

  return note;
}

/** Convenience wrapper that cannot be called with a non-manual origin. */
export async function createManualResearchNote(
  params: Omit<Parameters<typeof createResearchNote>[0], "origin">,
): Promise<ResearchNote> {
  return createResearchNote({ ...params, origin: "manual" });
}

export async function listResearchNotes(params: {
  db: Database;
  organizationId: string;
  sessionId?: string;
  matterId?: string;
  authorityId?: string;
  origin?: ResearchNoteOrigin;
  limit?: number;
}): Promise<ResearchNote[]> {
  const conditions = [eq(researchNotes.organizationId, params.organizationId)];
  if (params.sessionId) conditions.push(eq(researchNotes.sessionId, params.sessionId));
  if (params.matterId) conditions.push(eq(researchNotes.matterId, params.matterId));
  if (params.authorityId) conditions.push(eq(researchNotes.authorityId, params.authorityId));
  if (params.origin) conditions.push(eq(researchNotes.origin, params.origin));

  return params.db
    .select()
    .from(researchNotes)
    .where(and(...conditions))
    .orderBy(desc(researchNotes.createdAt))
    .limit(params.limit ?? 100);
}
