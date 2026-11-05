import { legalWorkCheckpointSchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { createLegalWorkEngine, requireLegalWorkAccess, workSessionId } from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = legalWorkCheckpointSchema.parse(await request.json());
    const { organizationId } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType: body.objects[0]!.objectType,
      mode: "bulk",
    });
    const engine = createLegalWorkEngine(db);
    const result = await engine.createCheckpoint({
      organizationId,
      matterId,
      actorUserId: user.id,
      kind: body.kind,
      reason: body.reason,
      sessionId: body.sessionId ?? workSessionId(request),
      objects: body.objects,
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
