import { reviewMatterEntitySchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { reviewMatterEntity } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; entityId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, entityId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const body = reviewMatterEntitySchema.parse(await request.json());
    const entity = await reviewMatterEntity({
      db,
      organizationId: matter.organizationId,
      matterId,
      entityId,
      userId: user.id,
      action: body.action,
      rejectionReason: body.rejectionReason,
      edits: body.edits,
    });
    return jsonOk({ entity });
  } catch (error) {
    return handleRouteError(error);
  }
}
