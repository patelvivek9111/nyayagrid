import { and, eq } from "drizzle-orm";
import { tasks } from "@nyayagrid/database";
import { updateTaskSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; taskId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { matterId, taskId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    const body = updateTaskSchema.parse(await request.json());
    const [existing] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.matterId, matterId),
          eq(tasks.organizationId, matter.organizationId),
        ),
      )
      .limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Task not found", 404);

    const nextStatus = body.status;
    const [updated] = await db
      .update(tasks)
      .set({
        title: body.title ?? existing.title,
        description: body.description === undefined ? existing.description : body.description,
        status: nextStatus ?? existing.status,
        priority: body.priority ?? existing.priority,
        assignedToUserId:
          body.assignedToUserId === undefined ? existing.assignedToUserId : body.assignedToUserId,
        dueAt: body.dueAt === undefined ? existing.dueAt : body.dueAt ? new Date(body.dueAt) : null,
        completedAt:
          nextStatus === "completed" ? new Date() : nextStatus ? null : existing.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))
      .returning();

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "task.updated",
      targetType: "task",
      targetId: taskId,
      metadata: { status: body.status },
    });

    return jsonOk({ task: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
