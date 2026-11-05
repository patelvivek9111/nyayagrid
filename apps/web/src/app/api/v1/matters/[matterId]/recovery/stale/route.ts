import { legalWorkHistoryQuerySchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { createLegalWorkEngine, requireLegalWorkAccess } from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const objectType = url.searchParams.get("objectType");
    const objectId = url.searchParams.get("objectId");
    const query = objectType && objectId ? legalWorkHistoryQuerySchema.parse({ objectType, objectId }) : null;
    const { organizationId } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType: query?.objectType ?? "draft",
      mode: "view",
    });
    const engine = createLegalWorkEngine(db);
    const markers = await engine.listStaleMarkers({
      organizationId,
      matterId,
      objectType: query?.objectType,
      objectId: query?.objectId,
    });
    return jsonOk({ markers });
  } catch (error) {
    return handleRouteError(error);
  }
}
