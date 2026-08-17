import { updateGuideEventSchema } from "@nyayagrid/validation";
import { editEvent } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ id: string; eventId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, eventId } = await params;
    const { db, user } = await requireGuideUser(request.headers);
    const body = updateGuideEventSchema.parse(await request.json());
    const event = await editEvent(db, { situationId: id, eventId, userId: user.id, input: body });
    return jsonOk({ event });
  } catch (error) {
    return handleRouteError(error);
  }
}
