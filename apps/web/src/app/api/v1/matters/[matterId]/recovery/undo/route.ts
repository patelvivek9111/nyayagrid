import { legalWorkUndoSchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { createLegalWorkEngine, requireLegalWorkAccess, workSessionId } from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = legalWorkUndoSchema.parse(await request.json());
    const objectType = body.objectType ?? "draft";
    const { organizationId, role } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType,
      mode: "restore",
    });
    const engine = createLegalWorkEngine(db);
    const result = await engine.undoLastAction({
      organizationId,
      matterId,
      actorUserId: user.id,
      role,
      scope: body.scope,
      objectType: body.objectType,
      objectId: body.objectId,
      sessionId: body.sessionId ?? workSessionId(request),
      idempotencyKey: body.idempotencyKey,
    });
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
