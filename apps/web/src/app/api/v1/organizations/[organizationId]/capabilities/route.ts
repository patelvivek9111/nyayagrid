import { requireCapability } from "@nyayagrid/permissions";
import type { Capability } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const url = new URL(request.url);
    const capability = url.searchParams.get("capability") as Capability | null;
    if (!capability) {
      return jsonError("VALIDATION_ERROR", "capability query param required", 400);
    }

    const { db, user } = await requireUser(request.headers);
    const membership = await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability,
    });

    return jsonOk({
      allowed: true,
      roleKey: membership.roleKey,
      capability,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
