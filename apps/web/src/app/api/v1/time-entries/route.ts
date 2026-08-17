import { and, desc, eq } from "drizzle-orm";
import { timeEntries } from "@nyayagrid/database";
import { createTimeEntrySchema } from "@nyayagrid/validation";
import { requireCapability, requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    const matterId = url.searchParams.get("matterId");
    if (!organizationId) return jsonError("VALIDATION_ERROR", "organizationId required", 400);

    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "matters.edit",
    });

    if (matterId) {
      await requireMatterAccess(db, {
        userId: user.id,
        matterId,
        minAccess: "read",
        capability: "matters.view",
      });
    }

    const rows = await db
      .select()
      .from(timeEntries)
      .where(
        matterId
          ? and(eq(timeEntries.organizationId, organizationId), eq(timeEntries.matterId, matterId))
          : eq(timeEntries.organizationId, organizationId),
      )
      .orderBy(desc(timeEntries.createdAt));

    return jsonOk({ entries: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createTimeEntrySchema.parse(await request.json());
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId: body.matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    if (matter.organizationId !== body.organizationId) {
      return jsonError("FORBIDDEN", "Matter is not in this organization", 403);
    }

    const [entry] = await db
      .insert(timeEntries)
      .values({
        organizationId: matter.organizationId,
        matterId: body.matterId,
        userId: user.id,
        source: body.source ?? "manual",
        status: "suggested",
        description: body.description,
        minutes: body.minutes,
        conversationId: body.conversationId ?? null,
        draftId: body.draftId ?? null,
      })
      .returning();

    await writeAuditEvent(db, {
      organizationId: body.organizationId,
      actorUserId: user.id,
      matterId: body.matterId,
      action: "time_entry.created",
      targetType: "time_entry",
      targetId: entry!.id,
    });

    return jsonOk({ entry }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
