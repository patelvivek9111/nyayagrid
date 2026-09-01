import { createStudentConversationSchema } from "@nyayagrid/validation";
import { createConversation, listConversations } from "@nyayagrid/workspaces";
import { requireProfessorUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

/**
 * Nyaya Professor conversations. User-scoped only: no organizationId/matterId is ever accepted
 * or read here, and every call is authorized by `requireUser` alone.
 */
export async function GET(request: Request) {
  try {
    const { db, user } = await requireProfessorUser(request.headers);
    const conversations = await listConversations(db, user.id);
    return jsonOk({ conversations });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireProfessorUser(request.headers);
    const body = createStudentConversationSchema.parse(await request.json().catch(() => ({})));
    const conversation = await createConversation({
      db,
      userId: user.id,
      title: body.title?.trim() || "New conversation",
      explanationLevel: body.explanationLevel,
      caseId: body.caseId,
    });
    return jsonOk({ conversation }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
