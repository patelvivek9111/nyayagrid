import { reviewAnalysisItemSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { reviewAnalysisItem } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; analysisId: string; itemId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, itemId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const body = reviewAnalysisItemSchema.parse(await request.json());
    const item = await reviewAnalysisItem({
      db,
      organizationId: matter.organizationId,
      matterId,
      itemId,
      userId: user.id,
      action: body.action,
    });
    return jsonOk({ item });
  } catch (error) {
    return handleRouteError(error);
  }
}
