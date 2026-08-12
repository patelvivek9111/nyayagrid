import { requireMatterAccess } from "@nyayagrid/permissions";
import { listFindings } from "@nyayagrid/intelligence";
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
    const findings = await listFindings({
      db,
      organizationId: matter.organizationId,
      matterId,
      runType: url.searchParams.get("runType") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      findingType: url.searchParams.get("findingType") ?? undefined,
      documentId: url.searchParams.get("documentId") ?? undefined,
      includeSources: url.searchParams.get("includeSources") !== "false",
    });
    return jsonOk({ findings });
  } catch (error) {
    return handleRouteError(error);
  }
}
