import { reviewDeadlineSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { reviewDeadlineCandidate } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; deadlineId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, deadlineId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const body = reviewDeadlineSchema.parse(await request.json());
    const deadline = await reviewDeadlineCandidate({
      db,
      organizationId: matter.organizationId,
      matterId,
      deadlineId,
      userId: user.id,
      action: body.action,
      rejectionReason: body.rejectionReason,
      edits: body.edits,
    });
    return jsonOk({ deadline });
  } catch (error) {
    return handleRouteError(error);
  }
}
