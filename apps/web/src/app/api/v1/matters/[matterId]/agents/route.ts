import { runAgentTaskSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { NyayaOrchestrator } from "@nyayagrid/agents";
import { agentRuns, and, desc, eq } from "@nyayagrid/database";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAgentBudgetsFromEnv, getAI, getEmbeddings, getRetriever } from "@/lib/infra";
import { enforceRateLimit } from "@/lib/rate-limit";
import { askNyayaAboutMatter } from "@/server/nyaya";

type Params = { params: Promise<{ matterId: string }> };

/**
 * Starts a Nyaya agent run (or answers directly when the orchestrator classifies the goal as a
 * simple question). Execute defaults to true, so plan-only calls must pass `execute: false`
 * explicitly — that distinction also decides which capability the caller needs.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    assertFeatureEnabled("agents");
    const body = runAgentTaskSchema.parse(await request.json());
    const execute = body.execute !== false;

    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: execute ? "edit" : "read",
      capability: execute ? "matters.edit" : "matters.view",
    });
    const limited = await enforceRateLimit(request, {
      endpointClass: "agent_run",
      organizationId: matter.organizationId,
      userId: user.id,
    });
    if (limited) return limited;

    const orchestrator = new NyayaOrchestrator();
    const outcome = await orchestrator.runTask({
      db,
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      goal: body.goal,
      execute,
      budgets: getAgentBudgetsFromEnv(),
      ai: getAI(),
      embeddings: getEmbeddings(),
    });

    if (outcome.mode === "qa") {
      const qa = await askNyayaAboutMatter({
        db,
        retriever: getRetriever(),
        organizationId: matter.organizationId,
        matterId,
        userId: user.id,
        question: body.goal,
        conversationId: body.conversationId,
        ai: getAI(),
      });
      return jsonOk(
        { mode: "qa", intent: outcome.intent, reason: outcome.reason, qa },
        { status: 201 },
      );
    }

    return jsonOk(
      {
        mode: "task",
        intent: outcome.intent,
        run: outcome.run,
        userFacingPlan: outcome.userFacingPlan,
        executed: outcome.executed,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Lists the matter's most recent agent runs, newest first. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    assertFeatureEnabled("agents");
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.trunc(requestedLimit), 100)
        : 20;

    const runs = await db
      .select()
      .from(agentRuns)
      .where(
        and(eq(agentRuns.organizationId, matter.organizationId), eq(agentRuns.matterId, matterId)),
      )
      .orderBy(desc(agentRuns.createdAt))
      .limit(limit);

    return jsonOk({ runs });
  } catch (error) {
    return handleRouteError(error);
  }
}
