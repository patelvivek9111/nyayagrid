import { cancelAgentRun, getAgentRun } from "@nyayagrid/agents";
import { cancelAgentRunSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; runId: string }> };

/** Cancels a run in progress. Terminal runs are returned unchanged rather than erroring. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, runId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });

    const existing = await getAgentRun({ db, organizationId: matter.organizationId, runId });
    if (!existing || existing.run.matterId !== matterId) {
      return jsonError("NOT_FOUND", "Agent run not found", 404);
    }

    const raw = await request.text();
    const body = cancelAgentRunSchema.parse(raw ? JSON.parse(raw) : {});
    const run = await cancelAgentRun({
      db,
      organizationId: matter.organizationId,
      runId,
      userId: user.id,
      reason: body.reason,
    });

    return jsonOk({ run });
  } catch (error) {
    return handleRouteError(error);
  }
}
