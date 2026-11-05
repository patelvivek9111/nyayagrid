import { AuthorizationError, requireMatterAccess } from "@nyayagrid/permissions";
import { exportMatterAuditLog } from "@nyayagrid/platform";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter, membership } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    if (
      !membership.capabilities.has("audit.view") &&
      !membership.capabilities.has("matters.edit") &&
      !membership.capabilities.has("organization.manage")
    ) {
      throw new AuthorizationError("Audit export requires audit.view or matters.edit");
    }

    const exported = await exportMatterAuditLog({
      db,
      organizationId: matter.organizationId,
      matterId,
    });

    return jsonOk(exported, {
      headers: {
        "Content-Disposition": `attachment; filename="nyayagrid-audit-${matterId.slice(0, 8)}.json"`,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
