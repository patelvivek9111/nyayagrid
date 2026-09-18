import { legalWorkSessionRestoreSchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { createLegalWorkEngine, requireLegalWorkAccess } from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = legalWorkSessionRestoreSchema.parse(await request.json());
    const { organizationId, role } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType: "draft",
      mode: "restore",
    });
    const engine = createLegalWorkEngine(db);
    const preview = await engine.previewSessionRestore({
      organizationId,
      matterId,
      actorUserId: user.id,
      sessionId: body.sessionId,
      role,
    });
    return jsonOk(preview);
  } catch (error) {
    return handleRouteError(error);
  }
}
