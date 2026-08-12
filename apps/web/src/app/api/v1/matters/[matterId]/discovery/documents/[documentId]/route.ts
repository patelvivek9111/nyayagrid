import { updateDiscoveryReviewSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { updateDiscoveryReview } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; documentId: string }> };

async function handleUpdate(request: Request, { params }: Params) {
  try {
    const { matterId, documentId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    const body = updateDiscoveryReviewSchema.parse(await request.json());
    const reviewState = await updateDiscoveryReview({
      db,
      organizationId: matter.organizationId,
      matterId,
      documentId,
      userId: user.id,
      ...body,
    });
    return jsonOk({ reviewState });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, ctx: Params) {
  return handleUpdate(request, ctx);
}

export async function POST(request: Request, ctx: Params) {
  return handleUpdate(request, ctx);
}
