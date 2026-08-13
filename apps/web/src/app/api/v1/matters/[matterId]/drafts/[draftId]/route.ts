import { requireMatterAccess } from "@nyayagrid/permissions";
import { getDraftWithVersions, updateDraftStatus } from "@nyayagrid/intelligence";
import { updateDraftStatusSchema } from "@nyayagrid/validation";
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

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { matterId, draftId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "drafts.create",
    });
    const body = updateDraftStatusSchema.parse(await request.json());
    const draft = await updateDraftStatus({
      db,
      organizationId: matter.organizationId,
      matterId,
      draftId,
      userId: user.id,
      status: body.status,
    });
    return jsonOk({ draft });
  } catch (error) {
    return handleRouteError(error);
  }
}
