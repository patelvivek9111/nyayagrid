import { restoreDraftVersionSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { getDraftWithVersions, restoreDraftVersion } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; draftId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, draftId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "drafts.create",
    });
    const body = restoreDraftVersionSchema.parse(await request.json());

    const existing = await getDraftWithVersions({
      db,
      organizationId: matter.organizationId,
      matterId,
      draftId,
    });
    if (!existing) return jsonError("NOT_FOUND", "Draft not found", 404);
    const source = existing.versions.find((v) => v.id === body.versionId);
    if (!source) return jsonError("NOT_FOUND", "Draft version not found", 404);

    const version = await restoreDraftVersion({
      db,
      organizationId: matter.organizationId,
      matterId,
      draftId,
      versionNumber: source.versionNumber,
      userId: user.id,
    });
    return jsonOk({ version }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
