import { reviewMatterFactSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { reviewMatterFact } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; factId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, factId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const body = reviewMatterFactSchema.parse(await request.json());
    const fact = await reviewMatterFact({
      db,
      organizationId: matter.organizationId,
      matterId,
      factId,
      userId: user.id,
      action: body.action,
      rejectionReason: body.rejectionReason,
      edits: body.edits,
    });
    return jsonOk({ fact });
  } catch (error) {
    return handleRouteError(error);
  }
}
