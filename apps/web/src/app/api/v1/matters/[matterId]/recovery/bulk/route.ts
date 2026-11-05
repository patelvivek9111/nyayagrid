import { legalWorkBulkMutateSchema } from "@nyayagrid/validation";
import { runBulkLegalWorkMutations } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { requireLegalWorkAccess, workSessionId } from "@/server/legal-work";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = legalWorkBulkMutateSchema.parse(await request.json());
    const { organizationId } = await requireLegalWorkAccess({
      db,
      userId: user.id,
      matterId,
      objectType: body.operations[0]!.objectType,
      mode: "bulk",
    });
    const result = await runBulkLegalWorkMutations({
      db,
      organizationId,
      matterId,
      actorUserId: user.id,
      reason: body.reason,
      sessionId: body.sessionId ?? workSessionId(request),
      operations: body.operations,
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
