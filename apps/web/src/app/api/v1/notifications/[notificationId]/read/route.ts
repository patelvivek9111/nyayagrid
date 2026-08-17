import { and, eq } from "drizzle-orm";
import { notifications } from "@nyayagrid/database";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ notificationId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { notificationId } = await params;
    const { db, user } = await requireUser(request.headers);
    const [existing] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)))
      .limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Notification not found", 404);

    const [row] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, notificationId))
      .returning();

    return jsonOk({ notification: row });
  } catch (error) {
    return handleRouteError(error);
  }
}
