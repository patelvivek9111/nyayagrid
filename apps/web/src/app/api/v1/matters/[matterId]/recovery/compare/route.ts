import { legalWorkCompareSchema } from "@nyayagrid/validation";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { createLegalWorkEngine, requireLegalWorkAccess } from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = legalWorkCompareSchema.parse(await request.json());
    const { organizationId, role } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType: body.objectType,
      mode: "view",
    });
    const engine = createLegalWorkEngine(db);
    const diff = await engine.compareVersions({
      organizationId,
      matterId,
      objectType: body.objectType,
      objectId: body.objectId,
      fromVersionId: body.fromVersionId,
      toVersionId: body.toVersionId,
      role,
    });
    return jsonOk(diff);
  } catch (error) {
    return handleRouteError(error);
  }
}
