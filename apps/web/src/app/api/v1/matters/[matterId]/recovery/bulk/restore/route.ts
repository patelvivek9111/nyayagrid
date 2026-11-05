import { legalWorkBulkRestoreSchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { createLegalWorkEngine, requireLegalWorkAccess } from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = legalWorkBulkRestoreSchema.parse(await request.json());
    const { organizationId, role } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType: "evidence_review",
      mode: "bulk",
    });
    const engine = createLegalWorkEngine(db);
    const result = await engine.restoreBulkAction({
      organizationId,
      matterId,
      actorUserId: user.id,
      checkpointId: body.checkpointId,
      role,
      idempotencyKey: body.idempotencyKey,
    });
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
