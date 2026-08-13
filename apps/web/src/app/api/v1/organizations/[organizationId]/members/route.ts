import { eq } from "drizzle-orm";
import { memberships, roles, users } from "@nyayagrid/database";
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
      capability: "organization.manage",
    });

    const rows = await db
      .select({
        membershipId: memberships.id,
        status: memberships.status,
        roleKey: roles.key,
        roleName: roles.name,
        userId: users.id,
        email: users.email,
        name: users.name,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .innerJoin(roles, eq(memberships.roleId, roles.id))
      .where(eq(memberships.organizationId, organizationId));

    return jsonOk({ members: rows });
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

    // The token is returned exactly once — see @nyayagrid/auth's createOrganizationInvite. Prefer
    // POST /api/v1/organizations/[organizationId]/invites for new integrations; this endpoint is
    // kept for backward compatibility with existing member-invite callers.
    return jsonOk({ status: "invited", inviteId, token, expiresAt }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
