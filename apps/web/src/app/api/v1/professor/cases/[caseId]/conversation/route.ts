import {
  getConversation,
  getOrCreateCaseConversation,
} from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ caseId: string }> };

/**
 * Persistent case-room thread. Reuses the one conversation scoped to this case for this user.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    const { db, user } = await requireUser(request.headers);
    const conversation = await getOrCreateCaseConversation({
      db,
      userId: user.id,
      caseId,
    });
    const detail = await getConversation(db, user.id, conversation.id);
    return jsonOk(detail);
  } catch (error) {
    return handleRouteError(error);
  }
}
