import { createGraphEdgeSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { createManualGraphEdge } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const body = createGraphEdgeSchema.parse(await request.json());
    const edge = await createManualGraphEdge({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      ...body,
    });
    return jsonOk({ edge }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
