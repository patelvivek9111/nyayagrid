import { reviewTimelineEventSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { reviewTimelineEvent } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; eventId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, eventId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const body = reviewTimelineEventSchema.parse(await request.json());
    const event = await reviewTimelineEvent({
      db,
      organizationId: matter.organizationId,
      matterId,
      eventId,
      userId: user.id,
      action: body.action,
      rejectionReason: body.rejectionReason,
      edits: body.edits,
    });
    return jsonOk({ event });
  } catch (error) {
    return handleRouteError(error);
  }
}
