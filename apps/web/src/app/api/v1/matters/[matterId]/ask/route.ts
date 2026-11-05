import { askOrTaskSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { NyayaOrchestrator } from "@nyayagrid/agents";
import type { Database } from "@nyayagrid/database";
import type { AskStreamListener, SourceScope } from "@nyayagrid/ai";
import { isFeatureEnabled, recordUsage } from "@nyayagrid/platform";
import {
  askRunKey,
  beginAskRun,
  createAskSseResponse,
  endAskRun,
  mergeAbortSignals,
} from "@nyayagrid/search";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
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
  executionStrategy?: "auto" | "fast" | "deep";
  modelId?: string;
  sourceScope?: SourceScope;
  signal?: AbortSignal;
  onEvent?: AskStreamListener;
  continueToken?: string;
}) {
  const conversationKey = params.conversationId?.trim() || "pending";
  const runKey = askRunKey({
    organizationId: params.organizationId,
    matterId: params.matterId,
    conversationId: conversationKey,
    userId: params.userId,
  });
  const runController = beginAskRun(runKey);
  try {
    const result = await askNyayaAboutMatter({
      db: params.db,
      retriever: getRetriever(),
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
      question: params.question,
      conversationId: params.conversationId,
      ai: getAI(),
      embeddings: getEmbeddings(),
      executionStrategy: params.executionStrategy,
      modelId: params.modelId,
      sourceScope: params.sourceScope ?? "case",
      signal: mergeAbortSignals(params.signal, runController.signal),
      onEvent: params.onEvent,
      continueToken: params.continueToken,
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
        sourceScope: result.sourceScope ?? params.sourceScope ?? "case",
      },
    });

    return result;
  } finally {
    endAskRun(runKey, runController);
  }
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
    const agentsOn = isFeatureEnabled("agents");
    if (mode === "task" && !agentsOn) {
      assertFeatureEnabled("agents");
    }
    const mayCreateRun = agentsOn && mode !== "ask";
    const sourceScope: SourceScope = body.sourceScope ?? "case";
    const wantsStream =
      body.stream === true ||
      (request.headers.get("accept") ?? "").includes("text/event-stream");

    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: mayCreateRun && execute ? "edit" : "read",
      capability: mayCreateRun && execute ? "matters.edit" : "matters.view",
    });

    if (mayCreateRun) {
      const agentLimited = await enforceRateLimit(request, {
        endpointClass: "agent_run",
        organizationId: matter.organizationId,
        userId: user.id,
      });
      if (agentLimited) return agentLimited;
    }

    if (mode === "ask" || !agentsOn) {
      if (wantsStream) {
        return createAskSseResponse(async (emit) => {
          await answerDirectly({
            db,
            organizationId: matter.organizationId,
            matterId,
            userId: user.id,
            question: body.question,
            conversationId: body.conversationId,
            executionStrategy: body.executionStrategy,
            modelId: body.modelId,
            sourceScope,
            signal: request.signal,
            onEvent: emit,
            continueToken: body.continueToken,
          });
        });
      }
      const qa = await answerDirectly({
        db,
        organizationId: matter.organizationId,
        matterId,
        userId: user.id,
        question: body.question,
        conversationId: body.conversationId,
        executionStrategy: body.executionStrategy,
        modelId: body.modelId,
        sourceScope,
        signal: request.signal,
        continueToken: body.continueToken,
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
      if (wantsStream) {
        return createAskSseResponse(async (emit) => {
          await answerDirectly({
            db,
            organizationId: matter.organizationId,
            matterId,
            userId: user.id,
            question: body.question,
            conversationId: body.conversationId,
            executionStrategy: body.executionStrategy,
            modelId: body.modelId,
            sourceScope,
            signal: request.signal,
            onEvent: emit,
            continueToken: body.continueToken,
          });
        });
      }
      const qa = await answerDirectly({
        db,
        organizationId: matter.organizationId,
        matterId,
        userId: user.id,
        question: body.question,
        conversationId: body.conversationId,
        executionStrategy: body.executionStrategy,
        modelId: body.modelId,
        sourceScope,
        signal: request.signal,
        continueToken: body.continueToken,
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
