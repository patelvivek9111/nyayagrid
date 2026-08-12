import { requireMatterAccess } from "@nyayagrid/permissions";
import { getReviewQueueCounts, listProposedIntelligence } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const [counts, proposed] = await Promise.all([
      getReviewQueueCounts({
        db,
        organizationId: matter.organizationId,
        matterId,
      }),
      listProposedIntelligence({
        db,
        organizationId: matter.organizationId,
        matterId,
      }),
    ]);
    return jsonOk({ counts, ...proposed });
  } catch (error) {
    return handleRouteError(error);
  }
}
