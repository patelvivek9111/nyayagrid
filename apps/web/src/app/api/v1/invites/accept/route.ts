import { acceptOrganizationInvite } from "@nyayagrid/auth";
import { acceptOrganizationInviteSchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

/**
 * Accepts an organization invite for the currently authenticated user. No organization capability
 * check applies here by design — the caller isn't a member yet; the invite token itself, proven
 * unexpired/unrevoked/unaccepted inside `acceptOrganizationInvite`, is the entire authorization.
 */
export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = acceptOrganizationInviteSchema.parse(await request.json());

    const result = await acceptOrganizationInvite({ db, token: body.token, userId: user.id });

    return jsonOk({
      organizationId: result.organizationId,
      roleId: result.roleId,
      membershipId: result.membershipId,
      membershipCreated: result.membershipCreated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
