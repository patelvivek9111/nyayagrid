import type { Database } from "@nyayagrid/database";
import {
  AuthorizationError,
  listAuthorizedMatterIds,
  requireCapability,
  requireMatterAccess,
} from "@nyayagrid/permissions";
import { getResearchSession, type ResearchSession } from "@nyayagrid/research";

export async function requireResearchRunCapability(
  db: Database,
  params: { userId: string; organizationId: string },
) {
  return requireCapability(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    capability: "research.run",
  });
}

export async function requireResearchMatterAccess(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string },
) {
  const { matter } = await requireMatterAccess(db, {
    userId: params.userId,
    matterId: params.matterId,
    minAccess: "read",
    capability: "research.run",
  });
  if (matter.organizationId !== params.organizationId) {
    throw new AuthorizationError("Matter not found");
  }
  return matter;
}

export async function requireResearchSessionAccess(
  db: Database,
  params: { userId: string; organizationId: string; sessionId: string },
): Promise<ResearchSession | null> {
  await requireResearchRunCapability(db, params);
  const session = await getResearchSession({
    db,
    organizationId: params.organizationId,
    sessionId: params.sessionId,
  });
  if (!session) return null;
  if (session.matterId) {
    await requireResearchMatterAccess(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: session.matterId,
    });
  }
  return session;
}

export async function authorizedMatterIdsForResearch(
  db: Database,
  params: { userId: string; organizationId: string },
) {
  return listAuthorizedMatterIds(db, params);
}
