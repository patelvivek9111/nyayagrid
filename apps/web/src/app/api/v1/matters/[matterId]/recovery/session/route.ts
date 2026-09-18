import { legalWorkSessionSchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { createLegalWorkEngine, requireLegalWorkAccess } from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = legalWorkSessionSchema.parse(await request.json().catch(() => ({})));
    const { organizationId } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType: "draft",
      mode: "restore",
    });
    const engine = createLegalWorkEngine(db);
    const session = await engine.startSession({
      organizationId,
      matterId,
      actorUserId: user.id,
      reason: body.reason,
    });
    return jsonOk({ session }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
