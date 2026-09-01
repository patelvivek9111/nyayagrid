import { getAgentRun } from "@nyayagrid/agents";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; runId: string }> };

/** Full run detail: steps, tool calls, artifacts (with provenance) and approvals. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, runId } = await params;
    const { db, user } = await requireUser(request.headers);
    assertFeatureEnabled("agents");
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const detail = await getAgentRun({ db, organizationId: matter.organizationId, runId });
    if (!detail || detail.run.matterId !== matterId) {
      return jsonError("NOT_FOUND", "Agent run not found", 404);
    }

    return jsonOk(detail);
  } catch (error) {
    return handleRouteError(error);
  }
}
