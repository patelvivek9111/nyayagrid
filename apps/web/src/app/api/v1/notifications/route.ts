import { and, desc, eq } from "drizzle-orm";
import { notifications } from "@nyayagrid/database";
import { requireCapability } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (!organizationId) return jsonError("VALIDATION_ERROR", "organizationId required", 400);

    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "matters.view",
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, user.id)))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    return jsonOk({ notifications: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}
