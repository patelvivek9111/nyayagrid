import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

/** Lightweight matter metadata for shared tab chrome — avoids the full overview payload. */
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
    return jsonOk({
      matter: {
        id: matter.id,
        title: matter.title,
        matterNumber: matter.matterNumber,
        status: matter.status,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
