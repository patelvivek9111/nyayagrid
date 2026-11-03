/**
 * Production-equivalent Nyaya Prosecution pipeline adapter for external validation.
 *
 * Routes via @nyayagrid/ai model-router v2 policy (Claude Opus 5.5 → Grok 4.7 FAIL_CLOSED;
 * routine GPT only when policy permits). Does not leak gold labels into prompts.
 */

import {
  planBenchmarkRoute,
  planHighStakesFallback,
  PINNED_BENCHMARK_MODEL_IDS,
  type BenchmarkRouteDecision,
  type AiGenerateRequest,
  type AiMessage,
} from "@nyayagrid/ai";

type FallbackReasonCode =
  "PRIMARY_TIMEOUT" | "PRIMARY_RATE_LIMIT" | "PRIMARY_PROVIDER_ERROR" | "FAIL_CLOSED";

function isIllegalHighStakesTarget(modelId: string): boolean {
  return (
    modelId === PINNED_BENCHMARK_MODEL_IDS.gpt || modelId === PINNED_BENCHMARK_MODEL_IDS.gemini
  );
}
import type { NormalizedTask } from "../schema/normalized-task.js";
import { executeAnthropicMessages } from "../providers/anthropic-live.js";
import { executeOpenAiResponses } from "../providers/openai-live.js";
import { executeXaiResponses } from "../providers/xai-live.js";
import type { LiveFetch, LiveProviderResult } from "../providers/live-types.js";
import { LiveProviderError, isRetryableLiveError } from "../providers/live-errors.js";
import { recordModelPin, type ModelPinRecord } from "./model-pin.js";
import type { TaskGroup } from "./constants.js";

export const PROSECUTION_PIPELINE_SYSTEM = [
  "PROSECUTION_EXTERNAL_VALIDATION — Nyaya Prosecution pipeline (draft work product).",
  "You assist a U.S. prosecution office on a legal analysis task.",
  "Never invent cases, citations, quotes, docket numbers, or statutes.",
  "Never issue guilt verdicts, probability-of-guilt scores, charging recommendations,",
  "plea recommendations, or final Brady/Giglio determinations.",
  "If authority or facts are insufficient, abstain explicitly.",
  "Answer using only the task input provided. Do not assume undisclosed gold labels.",
].join(" ");

export type PipelineRiskClass = "HIGH_STAKES_LEGAL" | "ROUTINE";

export type PipelineInvocationRecord = {
  logicalModel: string;
  requestedApiModel: string;
  servedModel: string | null;
  provider: string;
  riskTier: PipelineRiskClass;
  routingTier: number;
  routingReason: string;
  fallback: boolean;
  fallbackReason: FallbackReasonCode | null;
  substitution: boolean;
  modelPin: ModelPinRecord;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  providerRequestId: string | null;
  text: string;
  raw: unknown;
};

export type NyayaPipelineInvokeInput = {
  task: NormalizedTask;
  taskGroup: TaskGroup;
  riskClass: PipelineRiskClass;
  /** When true, never perform network I/O (tests / dry-run). */
  dryRun?: boolean;
  /** Injected completion for dry-run / tests. Must not see expectedAnswer. */
  mockComplete?: (prompt: { system: string; user: string; modelId: string }) => Promise<{
    text: string;
    servedModel?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
  }>;
  fetchImpl?: LiveFetch;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  xaiApiKey?: string;
  /** Allow Grok fallback only when primary fails with a policy-mapped reason. */
  allowPolicyFallback?: boolean;
  maxTokens?: number;
  estimateCostUsd?: (modelId: string, inputTokens: number, outputTokens: number) => number;
  actualCostUsd?: (modelId: string, inputTokens: number, outputTokens: number) => number;
};

function conversationToUserContent(task: NormalizedTask): string {
  if (task.conversation && task.conversation.length > 0) {
    return task.conversation.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n\n");
  }
  const input = task.input ?? {};
  // Never include expectedAnswer / gold fields.
  const {
    expectedAnswer: _e,
    answer: _a,
    label: _l,
    ground_truth: _g,
    ...safe
  } = input as Record<string, unknown> & {
    expectedAnswer?: unknown;
    answer?: unknown;
    label?: unknown;
    ground_truth?: unknown;
  };
  return typeof safe.text === "string"
    ? safe.text
    : typeof safe.question === "string"
      ? safe.question
      : JSON.stringify(safe);
}

/** Strip any accidental gold leakage from supporting docs (defensive). */
function supportingDocsBlock(task: NormalizedTask): string {
  const docs = task.supportingDocuments ?? [];
  if (docs.length === 0) return "";
  return [
    "",
    "SUPPORTING DOCUMENTS (task-supplied only):",
    ...docs.slice(0, 6).map((d) => `DOCUMENT ${d.documentId}:\n${(d.text ?? "").slice(0, 8000)}`),
  ].join("\n");
}

export function classifyProsecutionExternalRisk(
  task: NormalizedTask,
  taskGroup: TaskGroup,
): PipelineRiskClass {
  const upstream = String(task.metadata?.upstreamTask ?? task.taskType ?? "").toLowerCase();
  if (task.benchmarkId === "legalcitebench") return "HIGH_STAKES_LEGAL";
  if (
    taskGroup === "CITATION_RELIABILITY" ||
    taskGroup === "US_EVIDENCE_REASONING" ||
    taskGroup === "US_AUTHORITY_VERIFICATION" ||
    taskGroup === "US_PRECEDENT_FACT_CHECKING" ||
    taskGroup === "ABSTENTION" ||
    taskGroup === "SOURCE_FIDELITY"
  ) {
    if (upstream.startsWith("citation_prediction")) return "ROUTINE";
    return "HIGH_STAKES_LEGAL";
  }
  if (upstream.startsWith("citation_prediction")) return "ROUTINE";
  return "HIGH_STAKES_LEGAL";
}

export function buildProsecutionPipelineRequest(input: {
  task: NormalizedTask;
  riskClass: PipelineRiskClass;
}): AiGenerateRequest {
  const user = [
    `Benchmark task type: ${String(taskTypeLabel(input.task))}`,
    `Task id: ${input.task.taskId}`,
    "",
    "TASK INPUT:",
    conversationToUserContent(input.task),
    supportingDocsBlock(input.task),
    "",
    "Respond with the required answer for this legal task.",
    "If you cannot ground the answer, abstain.",
  ].join("\n");

  const messages: AiMessage[] = [
    { role: "system", content: PROSECUTION_PIPELINE_SYSTEM },
    { role: "user", content: user },
  ];

  return {
    messages,
    routing: {
      subsystem: "prosecution",
      highStakesLegal: input.riskClass === "HIGH_STAKES_LEGAL",
      benchmarkTaskCategory:
        input.riskClass === "HIGH_STAKES_LEGAL" ? "HARD_LEGAL_REASONING" : "STRUCTURED_EXTRACTION",
      riskSignals:
        input.riskClass === "HIGH_STAKES_LEGAL"
          ? ["unsupported_proposition", "uncertain_currentness"]
          : undefined,
    },
  };
}

function taskTypeLabel(task: NormalizedTask): string {
  return String(
    task.metadata?.upstreamTask ??
      task.metadata?.citationTaskType ??
      task.taskType ??
      task.benchmarkId,
  );
}

export function planProsecutionPipelineRoute(input: {
  task: NormalizedTask;
  riskClass: PipelineRiskClass;
}): BenchmarkRouteDecision {
  const request = buildProsecutionPipelineRequest(input);
  const plan = planBenchmarkRoute({
    request,
    highStakesLegal: input.riskClass === "HIGH_STAKES_LEGAL",
    taskCategory:
      input.riskClass === "HIGH_STAKES_LEGAL" ? "HARD_LEGAL_REASONING" : "STRUCTURED_EXTRACTION",
  });

  // Fail closed: never select GPT/Gemini for high-stakes.
  if (plan.decision.highStakesLegal) {
    const id = plan.decision.selectedModelId;
    if (isIllegalHighStakesTarget(id)) {
      throw new Error(`ROUTING_BLOCKED: illegal high-stakes selection ${id}`);
    }
    if (plan.decision.fallbackModelId && isIllegalHighStakesTarget(plan.decision.fallbackModelId)) {
      throw new Error(
        `ROUTING_BLOCKED: illegal high-stakes fallback target ${plan.decision.fallbackModelId}`,
      );
    }
  }
  return plan.decision;
}

async function callProvider(input: {
  modelId: string;
  messages: AiMessage[];
  fetchImpl?: LiveFetch;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  xaiApiKey?: string;
  maxTokens: number;
}): Promise<LiveProviderResult> {
  const userContent = input.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
  const system =
    input.messages.find((m) => m.role === "system")?.content ?? PROSECUTION_PIPELINE_SYSTEM;

  if (input.modelId === "claude-opus-5-5") {
    if (!input.anthropicApiKey) throw new Error("PROVIDER_FAILURE: missing ANTHROPIC_API_KEY");
    return executeAnthropicMessages(
      { apiKey: input.anthropicApiKey, fetchImpl: input.fetchImpl },
      {
        model: "claude-opus-5-5",
        messages: [{ role: "user", content: `${system}\n\n${userContent}` }],
        effort: "high",
        maxTokens: input.maxTokens,
      },
    );
  }
  if (input.modelId === "grok-4.7") {
    if (!input.xaiApiKey) throw new Error("PROVIDER_FAILURE: missing XAI_API_KEY");
    return executeXaiResponses(
      { apiKey: input.xaiApiKey, fetchImpl: input.fetchImpl },
      {
        model: "grok-4.7",
        input: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        effort: "high",
        maxOutputTokens: input.maxTokens,
      },
    );
  }
  if (input.modelId === "gpt-6.1-sol") {
    if (!input.openaiApiKey) throw new Error("PROVIDER_FAILURE: missing OPENAI_API_KEY");
    return executeOpenAiResponses(
      { apiKey: input.openaiApiKey, fetchImpl: input.fetchImpl },
      {
        model: "gpt-6.1-sol",
        input: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        effort: "medium",
        maxOutputTokens: input.maxTokens,
      },
    );
  }
  throw new Error(`ROUTING_BLOCKED: unsupported model for prosecution live path: ${input.modelId}`);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Invoke the Nyaya Prosecution pipeline for one external benchmark example.
 * Gold labels must never appear in prompts (enforced by buildProsecutionPipelineRequest).
 */
export async function invokeNyayaProsecutionPipeline(
  input: NyayaPipelineInvokeInput,
): Promise<PipelineInvocationRecord> {
  const riskClass = input.riskClass;
  const request = buildProsecutionPipelineRequest({ task: input.task, riskClass });
  const decision = planProsecutionPipelineRoute({ task: input.task, riskClass });

  const primaryModel = decision.selectedModelId;
  // Defensive: structured gold field names must never appear in prompts.
  // Short labels like "yes"/"overruled" may legitimately appear inside task input text.
  const userMsg = request.messages.find((m) => m.role === "user")?.content ?? "";
  if (/\bexpectedAnswer\b|\bground_truth\b/i.test(userMsg)) {
    throw new Error("SYSTEM_ERROR: gold field name leaked into pipeline prompt");
  }

  const maxTokens = input.maxTokens ?? 1024;
  const est = input.estimateCostUsd ?? ((_m: string, _i: number, _o: number) => 0);
  const act = input.actualCostUsd ?? ((_m: string, _i: number, _o: number) => 0);

  const promptText = request.messages.map((m) => m.content).join("\n");
  if (input.dryRun || input.mockComplete) {
    const mock = input.mockComplete
      ? await input.mockComplete({
          system: PROSECUTION_PIPELINE_SYSTEM,
          user: request.messages.find((m) => m.role === "user")?.content ?? "",
          modelId: primaryModel,
        })
      : {
          text: "[DRY_RUN_NO_PROVIDER]",
          servedModel: primaryModel,
          provider: decision.selectedProvider,
          inputTokens: estimateTokens(promptText),
          outputTokens: 16,
        };
    const pin = recordModelPin({
      logicalModel: primaryModel,
      requestedApiModel: primaryModel,
      servedModel: mock.servedModel ?? primaryModel,
    });
    const inTok = mock.inputTokens ?? estimateTokens(promptText);
    const outTok = mock.outputTokens ?? estimateTokens(mock.text);
    return {
      logicalModel: primaryModel,
      requestedApiModel: primaryModel,
      servedModel: pin.servedModel,
      provider: mock.provider ?? decision.selectedProvider,
      riskTier: riskClass,
      routingTier: decision.routingTier,
      routingReason: decision.routingReason,
      fallback: false,
      fallbackReason: null,
      substitution: pin.adapterSubstitution,
      modelPin: pin,
      inputTokens: inTok,
      outputTokens: outTok,
      estimatedCostUsd: est(primaryModel, inTok, outTok),
      actualCostUsd: 0,
      providerRequestId: null,
      text: mock.text,
      raw: { dryRun: true },
    };
  }

  let usedFallback = false;
  let fallbackReason: FallbackReasonCode | null = null;
  let result: LiveProviderResult;
  let requestedModel = primaryModel;

  try {
    result = await callProvider({
      modelId: primaryModel,
      messages: request.messages,
      fetchImpl: input.fetchImpl,
      openaiApiKey: input.openaiApiKey,
      anthropicApiKey: input.anthropicApiKey,
      xaiApiKey: input.xaiApiKey,
      maxTokens,
    });
  } catch (err) {
    const live = err instanceof LiveProviderError ? err : null;
    const canFallback =
      input.allowPolicyFallback !== false &&
      decision.highStakesLegal &&
      decision.fallbackModelId === PINNED_BENCHMARK_MODEL_IDS.grok &&
      live != null &&
      isRetryableLiveError(live);

    if (!canFallback) {
      throw err;
    }

    const failureCode =
      live.code === "RATE_LIMIT"
        ? "rate_limit"
        : live.code === "TIMEOUT_PRE_DISPATCH" || live.code === "TIMEOUT_POST_DISPATCH_UNKNOWN"
          ? "timeout"
          : "provider_error";
    const fb = planHighStakesFallback({
      decision,
      primaryFailedModelId: primaryModel,
      failureCode,
    });
    if (!fb.allowed || !fb.toModelId || fb.toModelId !== PINNED_BENCHMARK_MODEL_IDS.grok) {
      throw new Error(`ROUTING_BLOCKED: fallback refused (${fb.reasonCode})`);
    }
    if (isIllegalHighStakesTarget(fb.toModelId)) {
      throw new Error(`ROUTING_BLOCKED: illegal fallback to ${fb.toModelId}`);
    }

    usedFallback = true;
    fallbackReason =
      failureCode === "rate_limit"
        ? "PRIMARY_RATE_LIMIT"
        : failureCode === "timeout"
          ? "PRIMARY_TIMEOUT"
          : "PRIMARY_PROVIDER_ERROR";
    requestedModel = fb.toModelId;
    result = await callProvider({
      modelId: fb.toModelId,
      messages: request.messages,
      fetchImpl: input.fetchImpl,
      openaiApiKey: input.openaiApiKey,
      anthropicApiKey: input.anthropicApiKey,
      xaiApiKey: input.xaiApiKey,
      maxTokens,
    });
  }

  const pin = recordModelPin({
    logicalModel: primaryModel,
    requestedApiModel: requestedModel,
    servedModel: result.exactModelId,
    providerResponseModel: result.exactModelId,
  });

  // Routine GPT pin: substitutions must be explicit, never silent.
  if (
    riskClass === "ROUTINE" &&
    primaryModel === PINNED_BENCHMARK_MODEL_IDS.gpt &&
    pin.pinStatus === "SUBSTITUTED_FORBIDDEN"
  ) {
    // Allowed to continue but marked; caller scores separately.
  }

  if (
    riskClass === "HIGH_STAKES_LEGAL" &&
    (result.exactModelId === PINNED_BENCHMARK_MODEL_IDS.gpt ||
      result.exactModelId === PINNED_BENCHMARK_MODEL_IDS.gemini ||
      result.exactModelId.startsWith("gpt-") ||
      result.exactModelId.startsWith("gemini-"))
  ) {
    throw new Error(`ROUTING_BLOCKED: high-stakes served forbidden model ${result.exactModelId}`);
  }

  const inTok = result.usage.inputTokens;
  const outTok = result.usage.outputTokens;
  return {
    logicalModel: primaryModel,
    requestedApiModel: requestedModel,
    servedModel: result.exactModelId,
    provider: result.provider,
    riskTier: riskClass,
    routingTier: decision.routingTier,
    routingReason: decision.routingReason,
    fallback: usedFallback,
    fallbackReason,
    substitution: pin.adapterSubstitution,
    modelPin: pin,
    inputTokens: inTok,
    outputTokens: outTok,
    estimatedCostUsd: est(requestedModel, inTok, outTok),
    actualCostUsd: act(result.exactModelId, inTok, outTok),
    providerRequestId: result.providerRequestId,
    text: result.text,
    raw: result.raw,
  };
}
