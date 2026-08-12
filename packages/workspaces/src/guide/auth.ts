import { and, eq } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import { guideDocuments, guideSituations } from "@nyayagrid/database";
import type { GuideDocument, GuideSituation } from "@nyayagrid/database";

/**
 * Guide is a single-user public workspace: there is no organization/matter membership model to
 * fall back on, so ownership is the entire authorization boundary. A user who is not the owner
 * gets exactly the same "not found" treatment as a nonexistent resource — we never leak existence.
 */
export class GuideAuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "Not found") {
    super(message);
    this.name = "GuideAuthorizationError";
  }
}

export async function assertGuideDocumentOwnership(
  db: Database,
  params: { documentId: string; userId: string },
): Promise<GuideDocument> {
  const [document] = await db
    .select()
    .from(guideDocuments)
    .where(and(eq(guideDocuments.id, params.documentId), eq(guideDocuments.userId, params.userId)))
    .limit(1);
  if (!document) {
    throw new GuideAuthorizationError("Guide document not found for this user");
  }
  return document;
}

export async function assertGuideSituationOwnership(
  db: Database,
  params: { situationId: string; userId: string },
): Promise<GuideSituation> {
  const [situation] = await db
    .select()
    .from(guideSituations)
    .where(
      and(eq(guideSituations.id, params.situationId), eq(guideSituations.userId, params.userId)),
    )
    .limit(1);
  if (!situation) {
    throw new GuideAuthorizationError("Guide situation not found for this user");
  }
  return situation;
}

/**
 * Pure ownership predicate, separated from the database read so the rule itself can be unit
 * tested without a live database connection and reused once a row has already been loaded.
 */
export function isGuideOwnedByUser(
  row: { userId?: string | null } | null | undefined,
  userId: string,
) {
  return Boolean(row && userId && row.userId === userId);
}

export function assertGuideOwnedByUser<T extends { userId?: string | null }>(
  row: T | null | undefined,
  userId: string,
): T {
  if (!isGuideOwnedByUser(row, userId)) throw new GuideAuthorizationError();
  return row as T;
}
