import { and, asc, eq, guideConversations, guideMessages } from "@nyayagrid/database";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireGuideUser(request.headers);
    const [conversation] = await db
      .select()
      .from(guideConversations)
      .where(and(eq(guideConversations.id, id), eq(guideConversations.userId, user.id)))
      .limit(1);
    if (!conversation) return jsonError("NOT_FOUND", "Guide conversation not found", 404);

    const messages = await db
      .select()
      .from(guideMessages)
      .where(and(eq(guideMessages.conversationId, id), eq(guideMessages.userId, user.id)))
      .orderBy(asc(guideMessages.createdAt));

    return jsonOk({ conversation, messages });
  } catch (error) {
    return handleRouteError(error);
  }
}
