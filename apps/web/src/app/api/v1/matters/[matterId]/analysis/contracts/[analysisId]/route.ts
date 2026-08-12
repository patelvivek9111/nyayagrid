import { requireMatterAccess } from "@nyayagrid/permissions";
import { getContractAnalysis } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; analysisId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, analysisId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const result = await getContractAnalysis({
      db,
      organizationId: matter.organizationId,
      matterId,
      analysisId,
    });
    if (!result) return jsonError("NOT_FOUND", "Contract analysis not found", 404);
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
