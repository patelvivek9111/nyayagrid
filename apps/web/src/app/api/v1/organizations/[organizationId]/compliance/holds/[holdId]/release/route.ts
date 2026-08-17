import { requireCapability } from "@nyayagrid/permissions";
import { releaseLegalHold } from "@nyayagrid/platform";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ organizationId: string; holdId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { organizationId, holdId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "compliance.manage",
    });
    const hold = await releaseLegalHold({
      db,
      organizationId,
      holdId,
      userId: user.id,
    });
    return jsonOk({ hold });
  } catch (error) {
    return handleRouteError(error);
  }
}
