import { getAgentRun, NyayaOrchestrator } from "@nyayagrid/agents";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { getAI, getEmbeddings } from "@/lib/infra";

type Params = { params: Promise<{ matterId: string; runId: string }> };

/**
 * Executes or continues a planned/paused run. Re-entrant: steps already completed are skipped,
 * so calling this again after an approval is granted resumes rather than repeats work.
 */
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

    const orchestrator = new NyayaOrchestrator();
    const detail = await orchestrator.resumeRun({
      db,
      organizationId: matter.organizationId,
      userId: user.id,
      runId,
      ai: getAI(),
      embeddings: getEmbeddings(),
    });

    return jsonOk(detail);
  } catch (error) {
    return handleRouteError(error);
  }
}
