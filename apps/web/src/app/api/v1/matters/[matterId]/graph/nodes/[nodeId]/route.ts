import { requireMatterAccess } from "@nyayagrid/permissions";
import { getGraphNeighborhood } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; nodeId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, nodeId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const neighborhood = await getGraphNeighborhood({
      db,
      organizationId: matter.organizationId,
      matterId,
      nodeId,
    });
    if (!neighborhood) return jsonError("NOT_FOUND", "Graph node not found", 404);
    return jsonOk(neighborhood);
  } catch (error) {
    return handleRouteError(error);
  }
}
