import { saveDraftVersionSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { saveDraftVersion } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

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
    const body = saveDraftVersionSchema.parse(await request.json());
    const version = await saveDraftVersion({
      db,
      organizationId: matter.organizationId,
      matterId,
      draftId,
      userId: user.id,
      content: body.content,
      changeSummary: body.changeSummary,
    });
    return jsonOk({ version }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
