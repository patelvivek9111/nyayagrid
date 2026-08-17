import { eq } from "drizzle-orm";
import { timeEntries } from "@nyayagrid/database";
import { reviewTimeEntrySchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ entryId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { entryId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = reviewTimeEntrySchema.parse(await request.json());

    const [existing] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId)).limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Time entry not found", 404);

    await requireMatterAccess(db, {
      userId: user.id,
      matterId: existing.matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });

    if (existing.status !== "suggested") {
      return jsonError("CONFLICT", "Only suggested entries can be posted or rejected", 409);
    }

    const nextStatus = body.action === "post" ? "posted" : "rejected";
    const [entry] = await db
      .update(timeEntries)
      .set({
        status: nextStatus,
        postedAt: body.action === "post" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, entryId))
      .returning();

    await writeAuditEvent(db, {
      organizationId: existing.organizationId,
      actorUserId: user.id,
      matterId: existing.matterId,
      action: body.action === "post" ? "time_entry.posted" : "time_entry.rejected",
      targetType: "time_entry",
      targetId: entryId,
    });

    return jsonOk({ entry });
  } catch (error) {
    return handleRouteError(error);
  }
}
