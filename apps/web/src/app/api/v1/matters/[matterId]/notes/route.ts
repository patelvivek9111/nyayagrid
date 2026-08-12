import { and, desc, eq } from "drizzle-orm";
import { aiArtifacts, notes } from "@nyayagrid/database";
import { saveNyayaNoteSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
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
    const body = saveNyayaNoteSchema.parse(await request.json());
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

    return jsonOk({ note }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
