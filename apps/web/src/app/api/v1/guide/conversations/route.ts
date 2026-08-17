import { desc, eq, guideConversations } from "@nyayagrid/database";
import { createGuideConversationRequestSchema } from "@nyayagrid/validation";
import { createGuideConversation } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

/**
 * Nyaya Guide conversations. Single-user public workspace: `requireUser` is the whole
 * authorization boundary, and every row read here is filtered by `userId`.
 */
export async function GET(request: Request) {
  try {
    const { db, user } = await requireGuideUser(request.headers);
    const conversations = await db
      .select()
      .from(guideConversations)
      .where(eq(guideConversations.userId, user.id))
      .orderBy(desc(guideConversations.updatedAt));
    return jsonOk({ conversations });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireGuideUser(request.headers);
    const body = createGuideConversationRequestSchema.parse(await request.json().catch(() => ({})));
    const conversation = await createGuideConversation(db, user.id, body);
    return jsonOk({ conversation }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
