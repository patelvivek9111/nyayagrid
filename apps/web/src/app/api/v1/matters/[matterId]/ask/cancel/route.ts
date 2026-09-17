import { cancelAskStreamSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { askRunKey, cancelAskRun } from "@nyayagrid/search";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ matterId: string }> };

/**
 * Soft-cancel streaming Ask generation while keeping the SSE response open
 * long enough to deliver generation_stopped + continue_available.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const limited = await enforceRateLimit(request, {
      endpointClass: "ask_nyaya",
      userId: user.id,
    });
    if (limited) return limited;

    const body = cancelAskStreamSchema.parse(await request.json());
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const key = askRunKey({
      organizationId: matter.organizationId,
      matterId,
      conversationId: body.conversationId,
      userId: user.id,
    });
    const cancelled = cancelAskRun(key);
    return jsonOk({ cancelled });
  } catch (error) {
    return handleRouteError(error);
  }
}
