import { deleteSavedItem } from "@nyayagrid/workspaces";
import { requireProfessorUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ itemId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { itemId } = await params;
    const { db, user } = await requireProfessorUser(request.headers);
    const result = await deleteSavedItem({ db, userId: user.id, itemId });
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
