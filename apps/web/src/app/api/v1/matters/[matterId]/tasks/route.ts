import { and, desc, eq } from "drizzle-orm";
import { tasks } from "@nyayagrid/database";
import { createTaskSchema, updateTaskSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
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
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.matterId, matterId), eq(tasks.organizationId, matter.organizationId)))
      .orderBy(desc(tasks.createdAt));
    return jsonOk({ tasks: rows });
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
    const body = createTaskSchema.parse(await request.json());
    const [task] = await db
      .insert(tasks)
      .values({
        organizationId: matter.organizationId,
        matterId,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority ?? "medium",
        assignedToUserId: body.assignedToUserId ?? user.id,
        createdByUserId: user.id,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        sourceArtifactId: body.sourceArtifactId ?? null,
        sourceNoteId: body.sourceNoteId ?? null,
      })
      .returning();

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "task.created",
      targetType: "task",
      targetId: task!.id,
    });

    return jsonOk({ task }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
