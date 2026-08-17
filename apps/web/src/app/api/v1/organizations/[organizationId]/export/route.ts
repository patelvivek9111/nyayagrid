import { exportOrganizationData } from "@nyayagrid/platform";
import { requireCapability } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "compliance.manage",
    });
    const exported = await exportOrganizationData({
      db,
      organizationId,
      userId: user.id,
    });
    return jsonOk(exported, {
      headers: {
        "Content-Disposition": `attachment; filename="nyayagrid-org-export-${organizationId.slice(0, 8)}.json"`,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
