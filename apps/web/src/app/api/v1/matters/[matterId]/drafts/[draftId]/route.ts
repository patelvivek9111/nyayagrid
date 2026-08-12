import { requireMatterAccess } from "@nyayagrid/permissions";
import { getDraftWithVersions } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; draftId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, draftId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const result = await getDraftWithVersions({
      db,
      organizationId: matter.organizationId,
      matterId,
      draftId,
    });
    if (!result) return jsonError("NOT_FOUND", "Draft not found", 404);
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
