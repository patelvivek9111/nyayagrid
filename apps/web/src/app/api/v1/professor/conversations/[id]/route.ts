import { getConversation } from "@nyayagrid/workspaces";
import { requireProfessorUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireProfessorUser(request.headers);
    const { conversation, messages } = await getConversation(db, user.id, id);
    return jsonOk({ conversation, messages });
  } catch (error) {
    return handleRouteError(error);
  }
}
