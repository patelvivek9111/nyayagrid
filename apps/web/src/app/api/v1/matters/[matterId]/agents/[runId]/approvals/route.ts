import { getAgentRun, listPendingApprovals } from "@nyayagrid/agents";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; runId: string }> };

/** Pending approvals blocking this run, most recent first. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, runId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const existing = await getAgentRun({ db, organizationId: matter.organizationId, runId });
    if (!existing || existing.run.matterId !== matterId) {
      return jsonError("NOT_FOUND", "Agent run not found", 404);
    }

    const approvals = await listPendingApprovals({
      db,
      organizationId: matter.organizationId,
      runId,
      matterId,
    });

    return jsonOk({ approvals });
  } catch (error) {
    return handleRouteError(error);
  }
}
