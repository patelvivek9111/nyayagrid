import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import {
  aiArtifacts,
  clients,
  documents,
  drafts,
  matterMembers,
  matterMemories,
  matters,
  notes,
  tasks,
  users,
} from "@nyayagrid/database";
import { updateMatterSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import {
  getLatestMatterSummary,
  getReviewQueueCounts,
  listVerifiedOverviewIntelligence,
} from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import {
  applyMatterJurisdictionInput,
  existingJurisdictionFromMatter,
  jurisdictionColumnsFromNormalized,
  jurisdictionInputFromBody,
  resolveMatterJurisdictionContext,
  uiJurisdictionContract,
} from "@nyayagrid/jurisdiction";

type Params = { params: Promise<{ matterId: string }> };

function personLabel(row: { name: string | null; email: string } | null | undefined) {
  if (!row) return null;
  return row.name?.trim() || row.email;
}

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
    const [
      clientRows,
      recentDocuments,
      recentNotes,
      openTasks,
      recentArtifacts,
      verified,
      reviewCounts,
      summary,
      teamRows,
      createdByRows,
      openQuestionRows,
      recentDrafts,
    ] = await Promise.all([
      db.select().from(clients).where(eq(clients.id, matter.clientId)).limit(1),
      db
        .select({
          id: documents.id,
          title: documents.title,
          processingState: documents.processingState,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .where(
          and(
            eq(documents.matterId, matterId),
            eq(documents.organizationId, matter.organizationId),
          ),
        )
        .orderBy(desc(documents.createdAt))
        .limit(5),
      db
        .select({
          id: notes.id,
          title: notes.title,
          content: notes.content,
          origin: notes.origin,
          createdAt: notes.createdAt,
        })
        .from(notes)
        .where(and(eq(notes.matterId, matterId), eq(notes.organizationId, matter.organizationId)))
        .orderBy(desc(notes.createdAt))
        .limit(5),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.matterId, matterId),
            eq(tasks.organizationId, matter.organizationId),
            inArray(tasks.status, ["open", "in_progress"]),
          ),
        )
        .orderBy(desc(tasks.createdAt))
        .limit(10),
      db
        .select({
          id: aiArtifacts.id,
          artifactType: aiArtifacts.artifactType,
          question: aiArtifacts.question,
          evidenceState: aiArtifacts.evidenceState,
          createdAt: aiArtifacts.createdAt,
        })
        .from(aiArtifacts)
        .where(
          and(
            eq(aiArtifacts.matterId, matterId),
            eq(aiArtifacts.organizationId, matter.organizationId),
          ),
        )
        .orderBy(desc(aiArtifacts.createdAt))
        .limit(5),
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
      db
        .select({
          id: matterMembers.id,
          userId: matterMembers.userId,
          access: matterMembers.access,
          name: users.name,
          email: users.email,
        })
        .from(matterMembers)
        .innerJoin(users, eq(users.id, matterMembers.userId))
        .where(
          and(
            eq(matterMembers.matterId, matterId),
            eq(matterMembers.organizationId, matter.organizationId),
          ),
        ),
      matter.createdByUserId
        ? db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, matter.createdByUserId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select({
          id: matterMemories.id,
          title: matterMemories.title,
          content: matterMemories.content,
          status: matterMemories.status,
          memoryType: matterMemories.memoryType,
        })
        .from(matterMemories)
        .where(
          and(
            eq(matterMemories.matterId, matterId),
            eq(matterMemories.organizationId, matter.organizationId),
            inArray(matterMemories.status, ["proposed", "approved", "edited_and_approved"]),
            isNull(matterMemories.supersededBy),
            or(
              eq(matterMemories.memoryType, "factual_caveat"),
              like(matterMemories.title, "%?%"),
              like(matterMemories.content, "%?%"),
            ),
          ),
        )
        .orderBy(desc(matterMemories.updatedAt))
        .limit(8),
      db
        .select({
          id: drafts.id,
          title: drafts.title,
          status: drafts.status,
          aiGenerated: drafts.aiGenerated,
          updatedAt: drafts.updatedAt,
        })
        .from(drafts)
        .where(and(eq(drafts.matterId, matterId), eq(drafts.organizationId, matter.organizationId)))
        .orderBy(desc(drafts.updatedAt))
        .limit(5),
    ]);

    const createdBy = createdByRows[0] ?? null;
    const team = teamRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      access: row.access,
      displayName: personLabel(row) ?? row.email,
    }));
    const recentActivity = [
      ...recentDocuments.map((d) => ({
        id: d.id,
        kind: "document" as const,
        title: d.title,
        at: d.createdAt,
      })),
      ...recentNotes.map((n) => ({
        id: n.id,
        kind: "note" as const,
        title: n.title,
        at: n.createdAt,
      })),
      ...recentArtifacts.map((a) => ({
        id: a.id,
        kind: "artifact" as const,
        title: a.question.slice(0, 80),
        at: a.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 8);

    const jurisdictionContext = await resolveMatterJurisdictionContext({
      db,
      organizationId: matter.organizationId,
      matterId,
    });

    return jsonOk({
      matter,
      jurisdictionContext: jurisdictionContext
        ? uiJurisdictionContract(jurisdictionContext)
        : null,
      client: clientRows[0] ?? null,
      recentDocuments,
      recentNotes,
      openTasks,
      recentArtifacts,
      recentDrafts,
      verified,
      reviewCounts,
      summary,
      team,
      responsibleLawyer: createdBy
        ? { id: createdBy.id, displayName: personLabel(createdBy) ?? createdBy.email }
        : null,
      openQuestions: openQuestionRows,
      recentActivity,
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
    const jurisdiction = jurisdictionColumnsFromNormalized(
      applyMatterJurisdictionInput(
        jurisdictionInputFromBody(body),
        existingJurisdictionFromMatter(matter),
      ),
    );
    const [updated] = await db
      .update(matters)
      .set({
        title: body.title ?? matter.title,
        description: body.description === undefined ? matter.description : body.description,
        status: body.status ?? matter.status,
        matterNumber: body.matterNumber ?? matter.matterNumber,
        ...jurisdiction,
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
      metadata: {
        status: body.status,
        primaryState: updated?.primaryState ?? null,
        courtId: updated?.courtId ?? null,
        forumType: updated?.forumType ?? null,
        governingLawState: updated?.governingLawState ?? null,
        asOfDate: updated?.asOfDate ?? null,
        choiceOfLawStatus: updated?.choiceOfLawStatus ?? null,
      },
    });
    const jurisdictionContext = updated
      ? await resolveMatterJurisdictionContext({
          db,
          organizationId: matter.organizationId,
          matterId,
        })
      : null;
    return jsonOk({
      matter: updated,
      jurisdictionContext: jurisdictionContext ? uiJurisdictionContract(jurisdictionContext) : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
