import { reviewGraphEdgeSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { reviewGraphEdge } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; edgeId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, edgeId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const body = reviewGraphEdgeSchema.parse(await request.json());
    const edge = await reviewGraphEdge({
      db,
      organizationId: matter.organizationId,
      matterId,
      edgeId,
      userId: user.id,
      action: body.action,
      rejectionReason: body.rejectionReason,
      edits: body.edits,
    });
    return jsonOk({ edge });
  } catch (error) {
    return handleRouteError(error);
  }
}
