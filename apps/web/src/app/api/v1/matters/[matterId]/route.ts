import { and, desc, eq } from "drizzle-orm";
import { aiArtifacts, clients, documents, matters, notes, tasks } from "@nyayagrid/database";
import { updateMatterSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import {
  getLatestMatterSummary,
  getReviewQueueCounts,
  listVerifiedOverviewIntelligence,
} from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, matter.clientId))
      .limit(1);
    const recentDocuments = await db
      .select()
      .from(documents)
      .where(
        and(eq(documents.matterId, matterId), eq(documents.organizationId, matter.organizationId)),
      )
      .orderBy(desc(documents.createdAt))
      .limit(5);
    const recentNotes = await db
      .select()
      .from(notes)
      .where(and(eq(notes.matterId, matterId), eq(notes.organizationId, matter.organizationId)))
      .orderBy(desc(notes.createdAt))
      .limit(5);
    const openTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.matterId, matterId),
          eq(tasks.organizationId, matter.organizationId),
          eq(tasks.status, "open"),
        ),
      )
      .orderBy(desc(tasks.createdAt))
      .limit(10);
    const recentArtifacts = await db
      .select()
      .from(aiArtifacts)
      .where(
        and(
          eq(aiArtifacts.matterId, matterId),
          eq(aiArtifacts.organizationId, matter.organizationId),
        ),
      )
      .orderBy(desc(aiArtifacts.createdAt))
      .limit(5);

    const [verified, reviewCounts, summary] = await Promise.all([
      listVerifiedOverviewIntelligence({
        db,
        organizationId: matter.organizationId,
        matterId,
      }),
      getReviewQueueCounts({
        db,
        organizationId: matter.organizationId,
        matterId,
      }),
      getLatestMatterSummary({
        db,
        organizationId: matter.organizationId,
        matterId,
      }),
    ]);

    return jsonOk({
      matter,
      client,
      recentDocuments,
      recentNotes,
      openTasks,
      recentArtifacts,
      verified,
      reviewCounts,
      summary,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    const body = updateMatterSchema.parse(await request.json());
    const [updated] = await db
      .update(matters)
      .set({
        ...body,
        closedAt:
          body.status === "closed" || body.status === "archived" ? new Date() : matter.closedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(matters.id, matterId), eq(matters.organizationId, matter.organizationId)))
      .returning();
    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "matter.updated",
      targetType: "matter",
      targetId: matterId,
      metadata: { status: body.status },
    });
    return jsonOk({ matter: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
