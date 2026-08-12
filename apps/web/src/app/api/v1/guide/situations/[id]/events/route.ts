import { addGuideEventSchema } from "@nyayagrid/validation";
import { addSituationEvent } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/** Every event added here is `user_provided` by construction — Guide never fabricates one. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = addGuideEventSchema.parse(await request.json());
    const event = await addSituationEvent(db, { situationId: id, userId: user.id, input: body });
    return jsonOk({ event }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
