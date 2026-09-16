import { eq } from "drizzle-orm";
import { organizations } from "@nyayagrid/database";
import { getMembershipCapabilities } from "@nyayagrid/permissions";
import { designPartnerPlanPresentation } from "@nyayagrid/platform";
import { requireUser } from "@/lib/auth";
import { clerkHostedUserProfileUrl } from "@/lib/auth-return";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { roleLabel } from "@/lib/firm-workspace-ux";

type Params = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    const membership = await getMembershipCapabilities(db, {
      userId: user.id,
      organizationId,
    });
    if (!membership) {
      return jsonError("FORBIDDEN", "You do not have access to this workspace.", 403);
    }

    const [organization] = await db
      .select({ name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) {
      return jsonError("NOT_FOUND", "Workspace not found.", 404);
    }

    const caps = membership.capabilities;
    return jsonOk({
      profile: {
        name: user.name,
        email: user.email,
      },
      organization: {
        name: organization.name,
        slug: organization.slug,
      },
      membership: {
        roleKey: membership.roleKey,
        roleName: roleLabel(membership.roleKey),
      },
      permissions: {
        manageOrganization: caps.has("organization.manage"),
        inviteMembers: caps.has("members.invite"),
        manageCompliance: caps.has("compliance.manage"),
        editMatters: caps.has("matters.edit"),
      },
      security: {
        profileUrl: clerkHostedUserProfileUrl(),
      },
      plan: designPartnerPlanPresentation(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
