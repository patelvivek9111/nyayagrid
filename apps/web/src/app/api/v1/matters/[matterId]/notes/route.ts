import { and, desc, eq } from "drizzle-orm";
import { aiArtifacts, notes } from "@nyayagrid/database";
import { createManualNoteSchema, saveNyayaNoteSchema, updateNoteSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { trackLiveChange } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

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
    const rows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.matterId, matterId), eq(notes.organizationId, matter.organizationId)))
      .orderBy(desc(notes.createdAt));
    return jsonOk({ notes: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    const json = await request.json();

    if (json?.artifactId) {
      const body = saveNyayaNoteSchema.parse(json);
      const [artifact] = await db
        .select()
        .from(aiArtifacts)
        .where(
          and(
            eq(aiArtifacts.id, body.artifactId),
            eq(aiArtifacts.matterId, matterId),
            eq(aiArtifacts.organizationId, matter.organizationId),
          ),
        )
        .limit(1);
      if (!artifact) return jsonError("NOT_FOUND", "AI artifact not found in matter", 404);

      const [note] = await db
        .insert(notes)
        .values({
          organizationId: matter.organizationId,
          matterId,
          title: body.title ?? `Nyaya answer: ${artifact.question.slice(0, 80)}`,
          content: artifact.answer,
          origin: "nyaya",
          aiArtifactId: artifact.id,
          citations: artifact.citations ?? [],
          createdByUserId: user.id,
        })
        .returning();

      await writeAuditEvent(db, {
        organizationId: matter.organizationId,
        actorUserId: user.id,
        matterId,
        action: "note.saved_from_nyaya",
        targetType: "note",
        targetId: note!.id,
        metadata: { artifactId: artifact.id },
      });
      await trackLiveChange(db, {
        organizationId: matter.organizationId,
        matterId,
        actorUserId: user.id,
        objectType: "note",
        objectId: note!.id,
        operation: "create",
        source: "ai",
      });

      return jsonOk({ note }, { status: 201 });
    }

    const body = createManualNoteSchema.parse(json);
    const [note] = await db
      .insert(notes)
      .values({
        organizationId: matter.organizationId,
        matterId,
        title: body.title,
        content: body.content,
        origin: "user",
        createdByUserId: user.id,
      })
      .returning();

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "note.created",
      targetType: "note",
      targetId: note!.id,
    });
    await trackLiveChange(db, {
      organizationId: matter.organizationId,
      matterId,
      actorUserId: user.id,
      objectType: "note",
      objectId: note!.id,
      operation: "create",
      source: "user",
    });

    return jsonOk({ note }, { status: 201 });
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
    const url = new URL(request.url);
    const noteId = url.searchParams.get("noteId");
    if (!noteId) return jsonError("VALIDATION_ERROR", "noteId is required", 400);
    const body = updateNoteSchema.parse(await request.json());
    const [existing] = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.id, noteId),
          eq(notes.matterId, matterId),
          eq(notes.organizationId, matter.organizationId),
        ),
      )
      .limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Note not found", 404);
    const [updated] = await db
      .update(notes)
      .set({
        title: body.title ?? existing.title,
        content: body.content ?? existing.content,
        updatedAt: new Date(),
      })
      .where(eq(notes.id, noteId))
      .returning();
    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "note.updated",
      targetType: "note",
      targetId: noteId,
    });
    await trackLiveChange(db, {
      organizationId: matter.organizationId,
      matterId,
      actorUserId: user.id,
      objectType: "note",
      objectId: noteId,
      operation: "update",
      source: "user",
      expectedVersionId: body.expectedVersionId,
    });
    return jsonOk({ note: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
