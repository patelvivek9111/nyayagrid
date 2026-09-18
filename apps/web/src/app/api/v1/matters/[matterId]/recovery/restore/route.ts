import { legalWorkRestoreSchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import {
  requireLegalWorkAccess,
  restoreLegalWorkVersion,
  workSessionId,
} from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = legalWorkRestoreSchema.parse(await request.json());
    const { organizationId, role } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType: body.objectType,
      mode: "restore",
    });
    const result = await restoreLegalWorkVersion(db, {
      organizationId,
      matterId,
      actorUserId: user.id,
      objectType: body.objectType,
      objectId: body.objectId,
      targetVersionId: body.targetVersionId,
      mode: body.restoreAsNewVersion === false ? "undo" : "as_new_version",
      expectedCurrentVersionId: body.expectedCurrentVersionId,
      restoreApprovals: body.restoreApprovals,
      reason: body.reason,
      sessionId: body.sessionId ?? workSessionId(request),
      idempotencyKey: body.idempotencyKey,
      role,
    });
    return jsonOk(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
