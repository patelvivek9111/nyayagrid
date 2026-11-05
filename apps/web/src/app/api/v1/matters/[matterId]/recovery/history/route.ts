import { legalWorkHistoryQuerySchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { createLegalWorkEngine, requireLegalWorkAccess, snapshotIfNeeded } from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const query = legalWorkHistoryQuerySchema.parse({
      objectType: url.searchParams.get("objectType"),
      objectId: url.searchParams.get("objectId"),
    });
    const { organizationId, role } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType: query.objectType,
      mode: "view",
    });
    await snapshotIfNeeded(db, {
      organizationId,
      matterId,
      actorUserId: user.id,
      objectType: query.objectType,
      objectId: query.objectId,
    });
    const engine = createLegalWorkEngine(db);
    const history = await engine.getVersionHistory({
      organizationId,
      matterId,
      objectType: query.objectType,
      objectId: query.objectId,
      role,
    });
    return jsonOk(history);
  } catch (error) {
    return handleRouteError(error);
  }
}
