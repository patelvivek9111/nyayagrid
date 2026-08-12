import { requireMatterAccess } from "@nyayagrid/permissions";
import { getDocumentComparison } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; comparisonId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, comparisonId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const result = await getDocumentComparison({
      db,
      organizationId: matter.organizationId,
      matterId,
      comparisonId,
    });
    if (!result) return jsonError("NOT_FOUND", "Comparison not found", 404);
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
