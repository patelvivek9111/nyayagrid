import { cancelAskStreamSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { askRunKey, cancelAskRun } from "@nyayagrid/search";
import { requireUser } from "@/lib/auth";
import { assertProfessionalCommandCenterAccess } from "@/lib/command-center-guest-policy";
import { handleRouteError, jsonOk } from "@/lib/http";
import { beginRouteCorrelation } from "@/lib/request-correlation";
import { enforceRateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ matterId: string }> };

/**
 * Soft-cancel streaming Ask generation while keeping the SSE response open
 * long enough to deliver generation_stopped + continue_available.
 * Cancellation is process-local (singleInstance=true); multi-instance is not claimed.
 */
export async function POST(request: Request, { params }: Params) {
  const corr = beginRouteCorrelation(request, "api.ask.cancel");
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const limited = await enforceRateLimit(request, {
      endpointClass: "ask_nyaya",
      userId: user.id,
    });
    if (limited) return corr.attach(limited);

    const body = cancelAskStreamSchema.parse(await request.json());
    const { matter, membership } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    assertProfessionalCommandCenterAccess(membership.roleKey);

    const key = askRunKey({
      organizationId: matter.organizationId,
      matterId,
      conversationId: body.conversationId,
      userId: user.id,
    });
    const cancelled = cancelAskRun(key);
    corr.log.info("ask.cancel", {
      route: "ask.cancel",
      matterId,
      conversationId: body.conversationId,
      cancelled,
      singleInstance: true,
      durationMs: corr.elapsedMs(),
      outcome: cancelled ? "cancelled" : "not_active",
    });
    return corr.attach(jsonOk({ cancelled, singleInstance: true }));
  } catch (error) {
    corr.log.warn("ask.cancel.error", {
      route: "ask.cancel",
      durationMs: corr.elapsedMs(),
      outcome: "error",
    });
    return corr.attach(handleRouteError(error));
  }
}
