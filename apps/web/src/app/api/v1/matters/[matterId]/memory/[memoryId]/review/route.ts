import { reviewMatterMemorySchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { reviewMatterMemory } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; memoryId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, memoryId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const body = reviewMatterMemorySchema.parse(await request.json());
    const memory = await reviewMatterMemory({
      db,
      organizationId: matter.organizationId,
      matterId,
      memoryId,
      userId: user.id,
      action: body.action,
      rejectionReason: body.rejectionReason,
      edits: body.edits,
    });
    return jsonOk({ memory });
  } catch (error) {
    return handleRouteError(error);
  }
}
