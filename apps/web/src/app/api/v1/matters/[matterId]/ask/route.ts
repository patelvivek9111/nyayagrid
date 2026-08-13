import { askOrTaskSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { NyayaOrchestrator } from "@nyayagrid/agents";
import type { Database } from "@nyayagrid/database";
import { recordUsage } from "@nyayagrid/platform";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAgentBudgetsFromEnv, getAI, getEmbeddings, getRetriever } from "@/lib/infra";
import { enforceRateLimit } from "@/lib/rate-limit";
import { askNyayaAboutMatter } from "@/server/nyaya";

type Params = { params: Promise<{ matterId: string }> };

async function answerDirectly(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  question: string;
  conversationId?: string | null;
}) {
  const startedAt = Date.now();
  const result = await askNyayaAboutMatter({
    db: params.db,
    retriever: getRetriever(),
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    question: params.question,
    conversationId: params.conversationId,
    ai: getAI(),
  });

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "nyaya.ask",
    targetType: "ai_artifact",
    targetId: result.artifact?.id,
    metadata: {
      evidenceState: result.answer.evidenceState,
      retrievedCount: result.retrieved.length,
      provider: result.artifact?.provider,
    },
  });

  // Token counts are 0 for the mock provider; a real provider's usage is captured by
  // askNyayaAboutMatter's underlying AIProvider.generate() call and reflected on the artifact.
  await recordUsage(params.db, {
    organizationId: params.organizationId,
    userId: params.userId,
    matterId: params.matterId,
    feature: "nyaya.ask",
    provider: result.artifact?.provider ?? "unknown",
    model: result.artifact?.model ?? "unknown",
    latencyMs: Date.now() - startedAt,
    success: result.answer.evidenceState !== "insufficient",
    metadata: { evidenceState: result.answer.evidenceState },
  });

  return result;
}

/**
 * Ask-or-task entry point. `mode: "ask"` always answers directly (the classic Nyaya Q&A path).
 * `mode: "task"` always creates an agent run. `mode: "auto"` (default) classifies the goal first
 * and only escalates to a run when the request is not a simple question — this keeps single
 * questions cheap while still routing multi-step requests to the orchestrator.
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

    const body = askOrTaskSchema.parse(await request.json());
    const mode = body.mode ?? "auto";
    const execute = body.execute !== false;
    const mayCreateRun = mode !== "ask";

    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: mayCreateRun && execute ? "edit" : "read",
      capability: mayCreateRun && execute ? "matters.edit" : "matters.view",
    });

    if (mode === "ask") {
      const qa = await answerDirectly({
        db,
        organizationId: matter.organizationId,
        matterId,
        userId: user.id,
        question: body.question,
        conversationId: body.conversationId,
      });
      return jsonOk({ mode: "qa", qa });
    }

    const orchestrator = new NyayaOrchestrator();
    const outcome = await orchestrator.runTask({
      db,
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      goal: body.question,
      ...(mode === "task" ? { mode: "task" as const } : {}),
      execute,
      budgets: getAgentBudgetsFromEnv(),
      ai: getAI(),
      embeddings: getEmbeddings(),
    });

    if (outcome.mode === "qa") {
      const qa = await answerDirectly({
        db,
        organizationId: matter.organizationId,
        matterId,
        userId: user.id,
        question: body.question,
        conversationId: body.conversationId,
      });
      return jsonOk({ mode: "qa", intent: outcome.intent, qa });
    }

    // Agent path: record one usage event per generated artifact (each step may call the model
    // independently). Tokens aren't tracked per-artifact yet, so this records provider/model only.
    for (const artifact of outcome.run.artifacts) {
      if (!artifact.provider || !artifact.model) continue;
      await recordUsage(db, {
        organizationId: matter.organizationId,
        userId: user.id,
        matterId,
        feature: `agent.${artifact.artifactType}`,
        provider: artifact.provider,
        model: artifact.model,
        metadata: { runId: outcome.run.run.id, artifactId: artifact.id },
      });
    }

    return jsonOk({
      mode: "task",
      intent: outcome.intent,
      run: outcome.run,
      userFacingPlan: outcome.userFacingPlan,
      executed: outcome.executed,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
