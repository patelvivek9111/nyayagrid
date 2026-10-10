import { loadWholeMatterIntelligence } from "@nyayagrid/intelligence";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

/**
 * Whole-matter intelligence convergence read model (Deepening Pass 7).
 * Derived from existing domain loaders — no separate persistence.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const whole = await loadWholeMatterIntelligence(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
    });

    return jsonOk({
      matterId,
      organizationId: matter.organizationId,
      whole,
      liabilityConclusion: null,
      outcomeConclusion: null,
      predictiveOutcome: null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
