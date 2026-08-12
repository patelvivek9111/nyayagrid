import { and, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { researchSessions } from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";

export type ResearchSession = typeof researchSessions.$inferSelect;

export type CreateResearchSessionParams = {
  db: Database;
  organizationId: string;
  userId: string;
  matterId?: string | null;
  title: string;
  jurisdictionFilters?: string[];
  authorityTypeFilters?: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
};

const MAX_TITLE_CHARS = 300;

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Research session title is required");
  return trimmed.slice(0, MAX_TITLE_CHARS);
}

export async function createResearchSession(
  params: CreateResearchSessionParams,
): Promise<ResearchSession> {
  const [session] = await params.db
    .insert(researchSessions)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId ?? null,
      createdByUserId: params.userId,
      title: normalizeTitle(params.title),
      jurisdictionFilters: params.jurisdictionFilters ?? [],
      authorityTypeFilters: params.authorityTypeFilters ?? [],
      dateFrom: params.dateFrom ?? null,
      dateTo: params.dateTo ?? null,
    })
    .returning();
  if (!session) throw new Error("Failed to create research session");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId ?? null,
    action: "research_session.created",
    targetType: "research_session",
    targetId: session.id,
    metadata: {
      matterScoped: Boolean(params.matterId),
      jurisdictionFilterCount: session.jurisdictionFilters?.length ?? 0,
      authorityTypeFilterCount: session.authorityTypeFilters?.length ?? 0,
    },
  });

  return session;
}

export async function listResearchSessions(params: {
  db: Database;
  organizationId: string;
  userId?: string;
  matterId?: string;
  status?: "active" | "archived";
  limit?: number;
}): Promise<ResearchSession[]> {
  const conditions = [eq(researchSessions.organizationId, params.organizationId)];
  if (params.userId) conditions.push(eq(researchSessions.createdByUserId, params.userId));
  if (params.matterId) conditions.push(eq(researchSessions.matterId, params.matterId));
  if (params.status) conditions.push(eq(researchSessions.status, params.status));

  return params.db
    .select()
    .from(researchSessions)
    .where(and(...conditions))
    .orderBy(desc(researchSessions.updatedAt))
    .limit(params.limit ?? 50);
}

/** Organization scope is enforced here so a session id from another tenant reads as missing. */
export async function getResearchSession(params: {
  db: Database;
  organizationId: string;
  sessionId: string;
}): Promise<ResearchSession | null> {
  const [session] = await params.db
    .select()
    .from(researchSessions)
    .where(
      and(
        eq(researchSessions.id, params.sessionId),
        eq(researchSessions.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  return session ?? null;
}

export async function archiveResearchSession(params: {
  db: Database;
  organizationId: string;
  sessionId: string;
  userId: string;
}): Promise<ResearchSession> {
  const existing = await getResearchSession(params);
  if (!existing) throw new Error("Research session not found in organization scope");

  const [updated] = await params.db
    .update(researchSessions)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(researchSessions.id, params.sessionId),
        eq(researchSessions.organizationId, params.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Failed to archive research session");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: updated.matterId,
    action: "research_session.archived",
    targetType: "research_session",
    targetId: updated.id,
  });

  return updated;
}

/**
 * Resolve the session a research run belongs to, creating an ad-hoc one when the caller did not
 * supply a session. research_queries requires a session, so every query stays attributable.
 */
export async function ensureResearchSession(params: {
  db: Database;
  organizationId: string;
  userId: string;
  sessionId?: string | null;
  matterId?: string | null;
  title: string;
  jurisdictionFilters?: string[];
  authorityTypeFilters?: string[];
}): Promise<ResearchSession> {
  if (params.sessionId) {
    const session = await getResearchSession({
      db: params.db,
      organizationId: params.organizationId,
      sessionId: params.sessionId,
    });
    if (!session) throw new Error("Research session not found in organization scope");
    if (params.matterId && session.matterId && session.matterId !== params.matterId) {
      throw new Error("Research session belongs to a different matter");
    }
    return session;
  }
  return createResearchSession({
    db: params.db,
    organizationId: params.organizationId,
    userId: params.userId,
    matterId: params.matterId ?? null,
    title: params.title,
    jurisdictionFilters: params.jurisdictionFilters,
    authorityTypeFilters: params.authorityTypeFilters,
  });
}
