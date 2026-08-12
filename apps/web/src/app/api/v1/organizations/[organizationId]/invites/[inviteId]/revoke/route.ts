import { revokeOrganizationInvite } from "@nyayagrid/auth";
import { requireCapability } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ organizationId: string; inviteId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { organizationId, inviteId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "members.invite",
    });

    const invite = await revokeOrganizationInvite({
      db,
      organizationId,
      inviteId,
      revokedByUserId: user.id,
    });

    return jsonOk({ invite });
  } catch (error) {
    return handleRouteError(error);
  }
}
