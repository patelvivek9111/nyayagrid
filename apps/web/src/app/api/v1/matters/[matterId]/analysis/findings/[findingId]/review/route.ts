import { reviewFindingSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { reviewFinding } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; findingId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, findingId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const body = reviewFindingSchema.parse(await request.json());
    const finding = await reviewFinding({
      db,
      organizationId: matter.organizationId,
      matterId,
      findingId,
      userId: user.id,
      action: body.action,
      note: body.note,
    });
    return jsonOk({ finding });
  } catch (error) {
    return handleRouteError(error);
  }
}
