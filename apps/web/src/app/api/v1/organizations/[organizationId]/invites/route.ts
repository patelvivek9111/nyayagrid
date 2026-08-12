import { listOrganizationInvites } from "@nyayagrid/auth";
import { inviteMembershipSchema } from "@nyayagrid/validation";
import { requireCapability } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { inviteMemberByRoleKey } from "@/lib/invites";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "members.invite",
    });

    const invites = await listOrganizationInvites(db, { organizationId });
    return jsonOk({ invites });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "members.invite",
    });

    const body = inviteMembershipSchema.parse(await request.json());
    const { inviteId, token, expiresAt } = await inviteMemberByRoleKey({
      db,
      organizationId,
      email: body.email,
      roleKey: body.roleKey,
      invitedByUserId: user.id,
    });

    // The token is returned exactly once, here — it cannot be recovered from the database
    // afterward (only its hash is stored). Callers must deliver it now (email and/or this
    // response) or revoke and re-invite.
    return jsonOk({ inviteId, token, expiresAt }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
