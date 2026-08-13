import { requireMatterAccess } from "@nyayagrid/permissions";
import { listMatterDeadlines } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const url = new URL(request.url);
    const deadlines = await listMatterDeadlines({
      db,
      organizationId: matter.organizationId,
      matterId,
      status: url.searchParams.get("status"),
    });
    return jsonOk({ deadlines });
  } catch (error) {
    return handleRouteError(error);
  }
}
