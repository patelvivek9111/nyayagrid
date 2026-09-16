import { getMembershipCapabilities } from "@nyayagrid/permissions";
import { summarizeOrganizationUsage, type UsagePeriodKey } from "@nyayagrid/platform";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ organizationId: string }> };

function parsePeriod(value: string | null): UsagePeriodKey {
  return value === "previous" ? "previous" : "current";
}

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

    const url = new URL(request.url);
    const period = parsePeriod(url.searchParams.get("period"));
    const canSeeFirm = membership.capabilities.has("organization.manage");
    const requestedScope = url.searchParams.get("scope");
    const scope = canSeeFirm && requestedScope !== "me" ? "organization" : "personal";

    const summary = await summarizeOrganizationUsage(db, {
      organizationId,
      period,
      userId: scope === "personal" ? user.id : undefined,
      includeMemberBreakdown: scope === "organization",
    });

    const payload =
      scope === "organization"
        ? {
            ...summary,
            canViewOrganizationUsage: canSeeFirm,
          }
        : {
            period: summary.period,
            completeness: summary.completeness,
            scope: summary.scope,
            canViewOrganizationUsage: canSeeFirm,
            ai: summary.ai,
          };

    return jsonOk(payload);
  } catch (error) {
    return handleRouteError(error);
  }
}
