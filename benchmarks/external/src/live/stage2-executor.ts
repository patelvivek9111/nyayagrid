/**
 * Stage-2 finalist executor: gpt-6.1-sol vs grok-4.7 only.
 * Reuses Stage-1 clients, cache, budget, resume, license, RAG retrieval.
 * No Stage-3 auto-escalation. No provider fallback.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadPrbenchParquet, normalizePrbenchRow } from "../adapters/prbench.js";
import { loadLegalBenchTaskDir } from "../adapters/legalbench.js";
import { loadLegalBenchRagBenchmarkFile } from "../adapters/legalbench-rag.js";
import { loadCurrentPricingTable } from "../cost/estimator.js";
import {
  assertCommercialEvalAllowed,
  isCommercialInternalEvalOk,
  loadRagSourceLicense,
} from "../license/firewall.js";
import { getCacheDir } from "../paths.js";
import { executeAnthropicMessages } from "../providers/anthropic-live.js";
import { isRetryableLiveError, LiveProviderError } from "../providers/live-errors.js";
import { executeOpenAiResponses } from "../providers/openai-live.js";
import type { LiveFetch, LiveProviderId, LiveProviderResult } from "../providers/live-types.js";
import { executeXaiResponses } from "../providers/xai-live.js";
import {
  hashRetrievalConfig,
  loadCorpusDocuments,
  retrieveTopKDocuments,
} from "../retrieval/lexical.js";
import type { NormalizedTask } from "../schema/normalized-task.js";
import { scoreLegalBenchExact } from "../scorers/legalbench-exact.js";
import { documentHit, topKDocumentRecall } from "../scorers/rag-metrics.js";
import { assertLivePaidExecutionAuthorized } from "./authorization.js";
import {
  applyPersistedSpend,
  assertNextCallWithinBudget,
  BudgetLimitError,
  recordSpend,
  remainingBudgetUsd,
  type BudgetState,
} from "./budget.js";
import { buildCacheKey, contentHashFromText } from "./cache-key.js";
import { resolveBatchSize } from "./batch.js";
import { parseConcurrency } from "./concurrency.js";
import { calculateActualCostUsd, worstCaseCostForBudgetGate } from "./cost-accounting.js";
import { assessContextFit, assertNoSilentTruncate } from "./context-fit.js";
import { isJudgeCacheHit, readJudgeCache } from "./judge-cache.js";
import { loadExternalBenchLocalEnv } from "./load-local-env.js";
import { assertManifestImmutable, hashRunConfig, loadRunManifest } from "./manifest.js";
import { assertSameModelPinned } from "./no-fallback.js";
import { persistPaidCallImmediately, type PersistedPaidCallRecord } from "./persistence.js";
import {
  assertWithinProviderCaps,
  emptyProviderSpend,
  parseProviderCaps,
  recordProviderSpend,
  type ProviderCapsConfig,
  type ProviderId,
  type ProviderSpendState,
} from "./provider-caps.js";
import { isResponseCacheHit, readResponseCache } from "./response-cache.js";
import { computeBackoffMs, UnknownCompletionError } from "./retry.js";
import { assertNoAutoEscalation } from "./stage-gate.js";
import {
  LEGALBENCH_REV,
  PRBENCH_REV,
  RAG_REV,
  STAGE2_JUDGE_A,
  STAGE2_JUDGE_B,
  STAGE2_RESPONSE_MODELS,
  type Stage2ResponseModelId,
  type Stage2SuitePlan,
} from "./stage2-task-planner.js";

const SCHEMA_VERSION = 1;

const MODEL_PROVIDER: Record<Stage2ResponseModelId, LiveProviderId> = {
  "gpt-6.1-sol": "openai",
  "grok-4.7": "xai",
};

const CONTEXT_WINDOWS: Record<Stage2ResponseModelId, number> = {
  "gpt-6.1-sol": 1_050_000,
  "grok-4.7": 2_000_000,
};

export type Stage2ExecutorDeps = {
  fetchImpl?: LiveFetch;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  xaiApiKey?: string;
  sleep?: (ms: number) => Promise<void>;
  prbenchTasks?: NormalizedTask[];
  legalbenchTasks?: NormalizedTask[];
  ragTaskIds?: string[];
  responseModels?: readonly Stage2ResponseModelId[];
  skipRag?: boolean;
  bypassAuthForTests?: boolean;
  maxCostUsdForTests?: number;
  /** Inject suite for tests (avoids registry IO). */
  suiteOverride?: Stage2SuitePlan;
};

export type Stage2RunSummary = {
  status: "STAGE2_COMPLETE" | "STAGE2_PARTIAL" | "STAGE2_BUDGET_STOP" | "STAGE2_BLOCKED";
  runId: string;
  configHash: string;
  paidCalls: number;
  cacheHits: number;
  ragGenerationCalls: 0;
  progress: {
    runId: string;
    completedResponses: number;
    plannedResponses: number;
    completedJudges: number;
    plannedJudges: number;
    ragEvaluations: number;
    plannedRag: number;
    cacheHits: number;
    paidCalls: number;
    failuresByProvider: Record<string, number>;
    responseSpendUsd: number;
    judgeSpendUsd: number;
    retriesUsd: number;
    totalSpendUsd: number;
    remainingBudgetUsd: number;
    updatedAt: string;
  };
  cost: {
    authorizedUsd: number;
    openaiResponsesUsd: number;
    xaiResponsesUsd: number;
    anthropicJudgeUsd: number;
    openaiJudgeUsd: number;
    retriesUsd: number;
    totalUsd: number;
    remainingUsd: number;
  };
  stage3Started: false;
  courtListener: 0;
  valuesPrinted: false;
  note?: string;
};

function hashObj(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
function parseArgValue(argv: readonly string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1] ?? null;
    if (argv[i]?.startsWith(`${name}=`)) return argv[i]!.slice(name.length + 1) || null;
  }
  return null;
}

function buildUserPrompt(task: NormalizedTask): string {
  const conversation =
    task.conversation?.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n\n") ??
    JSON.stringify(task.input ?? {});
  const docs =
    task.supportingDocuments
      ?.slice(0, 4)
      .map((d) => `DOCUMENT ${d.documentId}:\n${(d.text ?? "").slice(0, 6000)}`)
      .join("\n\n") ?? "";
  return [
    "You are assisting with a legal analysis benchmark task.",
    "Answer carefully using only the provided conversation and documents.",
    "Do not invent authorities or facts.",
    "",
    "CONVERSATION:",
    conversation,
    docs ? `\nSUPPORTING DOCUMENTS:\n${docs}` : "",
  ].join("\n");
}

function buildJudgePrompt(task: NormalizedTask, responseText: string): string {
  const criteria =
    task.rubric?.criteria
      ?.map((c, i) => `${i + 1}. [${c.id ?? "c"}] weight=${c.weight ?? 1}: ${c.description ?? ""}`)
      .join("\n") ?? "(no criteria)";
  return [
    "You are an independent legal-benchmark judge.",
    "Score the ASSISTANT RESPONSE against the RUBRIC on a 0.0–1.0 scale.",
    'Return ONLY JSON: {"score": number, "rationale": string}',
    "Do not rewrite the answer. Do not invent facts.",
    "",
    "RUBRIC:",
    criteria,
    "",
    "ASSISTANT RESPONSE:",
    responseText.slice(0, 12000),
  ].join("\n");
}

function parseJudgeScore(text: string): number {
  const trimmed = text.trim();
  const fence = trimmed.match(/\{[\s\S]*\}/);
  const jsonText = fence?.[0] ?? trimmed;
  try {
    const parsed = JSON.parse(jsonText) as { score?: unknown };
    const score = Number(parsed.score);
    if (Number.isFinite(score)) return Math.min(1, Math.max(0, score));
  } catch {
    /* fall through */
  }
  const m = trimmed.match(/"score"\s*:\s*([0-9]*\.?[0-9]+)/);
  if (m?.[1]) {
    const score = Number(m[1]);
    if (Number.isFinite(score)) return Math.min(1, Math.max(0, score));
  }
  throw new Error("Judge output missing parseable score");
}

function responseSettings(modelId: Stage2ResponseModelId): unknown {
  if (modelId === "gpt-6.1-sol") {
    return { effort: "high", service_tier: "default", max_output_tokens: 4096 };
  }
  return { effort: "high", max_output_tokens: 4096 };
}

async function withRetries<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  maxRetries = 2,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof LiveProviderError && err.code === "UNKNOWN_COMPLETION") {
        throw new UnknownCompletionError(err.message);
      }
      if (!isRetryableLiveError(err) || attempt >= maxRetries) throw err;
      await sleep(computeBackoffMs(attempt));
      attempt += 1;
    }
  }
}

async function loadPrbenchTasks(ids: string[]): Promise<NormalizedTask[]> {
  const parquet = path.join(
    getCacheDir(),
    "prbench",
    PRBENCH_REV,
    "data",
    "legal_hard-00000-of-00001.parquet",
  );
  if (!existsSync(parquet)) throw new Error(`PRBench parquet missing: ${parquet}`);
  const rows = await loadPrbenchParquet(parquet);
  const wanted = new Set(ids);
  return rows
    .map((row) => normalizePrbenchRow(row, { split: "legal_hard", hard: true }))
    .filter((t) => wanted.has(t.taskId));
}

function loadLegalbenchTasks(ids: string[]): NormalizedTask[] {
  const root = path.join(getCacheDir(), "legalbench", LEGALBENCH_REV, "tasks");
  const out: NormalizedTask[] = [];
  for (const taskId of ids) {
    const [taskName, split, index] = taskId.split("::");
    if (!taskName || !split) continue;
    const dir = path.join(root, taskName);
    if (!existsSync(dir)) continue;
    const tasks = loadLegalBenchTaskDir(dir, taskName, [split as "train" | "test"]);
    const match =
      tasks.find((t) => t.taskId === taskId) ??
      (index !== undefined ? tasks.find((t) => t.taskId.endsWith(`::${index}`)) : undefined);
    if (match) out.push(match);
  }
  return out;
}

function providerCapKey(provider: LiveProviderId): ProviderId {
  return provider;
}

function writeProgress(runId: string, progress: Stage2RunSummary["progress"]): void {
  writeFileSync(
    path.join(getCacheDir(), "runs", runId, "stage2-progress.json"),
    `${JSON.stringify(progress, null, 2)}\n`,
    "utf8",
  );
}

export async function runStage2Finalists(input: {
  argv?: readonly string[];
  deps?: Stage2ExecutorDeps;
}): Promise<Stage2RunSummary> {
  loadExternalBenchLocalEnv();
  assertNoAutoEscalation();
  const argv = input.argv ?? process.argv;
  const deps = input.deps ?? {};
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let maxCostUsd: number;
  if (deps.bypassAuthForTests) {
    maxCostUsd = deps.maxCostUsdForTests ?? 75;
  } else {
    const auth = assertLivePaidExecutionAuthorized({ argv });
    maxCostUsd = auth.maxCostUsd;
  }

  const runIdArg = parseArgValue(argv, "--run-id");
  if (!runIdArg) throw new Error("Missing --run-id");
  const runId = runIdArg;

  const manifest = loadRunManifest(runId);
  const fullConfigPath = path.join(getCacheDir(), "runs", runId, "full-config.json");
  if (!existsSync(fullConfigPath)) {
    throw new Error(`Missing frozen full-config.json for run ${runId}`);
  }
  const fullConfig = JSON.parse(readFileSync(fullConfigPath, "utf8")) as Record<string, unknown>;
  const configHash = hashRunConfig(fullConfig);
  assertManifestImmutable(runId, configHash);
  if (manifest.configHash !== configHash) {
    throw new Error("REFUSE RESUME: config hash mismatch");
  }
  if (fullConfig.stage !== 2) {
    throw new Error("Stage-2 executor requires frozen stage=2 config");
  }

  const openaiKey = deps.openaiApiKey ?? process.env.OPENAI_API_KEY?.trim();
  const anthropicKey = deps.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
  const xaiKey = deps.xaiApiKey ?? process.env.XAI_API_KEY?.trim();
  // Google must not be used in Stage 2 even if present.
  if (!openaiKey || !anthropicKey || !xaiKey) {
    return {
      status: "STAGE2_BLOCKED",
      runId,
      configHash,
      paidCalls: 0,
      cacheHits: 0,
      ragGenerationCalls: 0,
      progress: {
        runId,
        completedResponses: 0,
        plannedResponses: 0,
        completedJudges: 0,
        plannedJudges: 0,
        ragEvaluations: 0,
        plannedRag: 0,
        cacheHits: 0,
        paidCalls: 0,
        failuresByProvider: {},
        responseSpendUsd: 0,
        judgeSpendUsd: 0,
        retriesUsd: 0,
        totalSpendUsd: 0,
        remainingBudgetUsd: maxCostUsd,
        updatedAt: new Date().toISOString(),
      },
      cost: {
        authorizedUsd: maxCostUsd,
        openaiResponsesUsd: 0,
        xaiResponsesUsd: 0,
        anthropicJudgeUsd: 0,
        openaiJudgeUsd: 0,
        retriesUsd: 0,
        totalUsd: 0,
        remainingUsd: maxCostUsd,
      },
      stage3Started: false,
      courtListener: 0,
      valuesPrinted: false,
      note: "credentials_missing",
    };
  }

  const suite =
    deps.suiteOverride ??
    (fullConfig.suite as Stage2SuitePlan | undefined) ??
    (JSON.parse(
      readFileSync(path.join(getCacheDir(), "runs", runId, "stage2-suite.json"), "utf8"),
    ) as Stage2SuitePlan);

  const models = deps.responseModels ?? STAGE2_RESPONSE_MODELS;
  for (const m of models) {
    if (m !== "gpt-6.1-sol" && m !== "grok-4.7") {
      throw new Error(`Stage-2 forbids response model ${m}`);
    }
  }

  const prbenchTasks =
    deps.prbenchTasks ?? (await loadPrbenchTasks(suite.upstream_ids.prbench_legal_hard));
  const legalbenchTasks =
    deps.legalbenchTasks ?? loadLegalbenchTasks(suite.upstream_ids.legalbench);
  const ragIds = deps.ragTaskIds ?? suite.upstream_ids.legalbench_rag;

  const plannedResponses = (prbenchTasks.length + legalbenchTasks.length) * models.length;
  const plannedJudges = prbenchTasks.length * models.length * 2;
  const plannedRag = deps.skipRag ? 0 : ragIds.length;

  const pricing = loadCurrentPricingTable();
  const parsedCaps = parseProviderCaps(argv);
  // Frozen Stage-2 subcaps (registry/stage2-budget.json); global $55 remains authoritative.
  const providerCaps: ProviderCapsConfig = {
    ...parsedCaps,
    openai: { maxDollars: parsedCaps.openai?.maxDollars ?? 13 },
    anthropic: { maxDollars: parsedCaps.anthropic?.maxDollars ?? 18 },
    google: { maxDollars: 0 },
    xai: { maxDollars: parsedCaps.xai?.maxDollars ?? 11 },
    maxJudgeDollars: parsedCaps.maxJudgeDollars ?? 35,
  };

  let budget: BudgetState = { maxUsd: maxCostUsd, spentUsd: 0 };
  const providerSpend: Record<ProviderId, ProviderSpendState> = {
    openai: emptyProviderSpend(),
    anthropic: emptyProviderSpend(),
    google: emptyProviderSpend(),
    xai: emptyProviderSpend(),
    judge: emptyProviderSpend(),
  };

  let paidCalls = 0;
  let cacheHits = 0;
  let completedResponses = 0;
  let completedJudges = 0;
  let ragEvaluations = 0;
  let responseSpendUsd = 0;
  let judgeSpendUsd = 0;
  const retriesUsd = 0;
  const costByBucket = {
    openaiResponsesUsd: 0,
    xaiResponsesUsd: 0,
    anthropicJudgeUsd: 0,
    openaiJudgeUsd: 0,
  };
  const failuresByProvider: Record<string, number> = {};
  let runStatus: Stage2RunSummary["status"] = "STAGE2_COMPLETE";
  let note: string | undefined;

  const systemPrompt =
    "You are NyayaGrid external-bench Stage-2. Produce a careful legal analysis response.";
  // Balanced hard-stop is serial-only: concurrency>1 would let the other finalist continue after AUTH_ERROR.
  const requestedConcurrency = parseConcurrency(argv, 1);
  void requestedConcurrency;
  const batchSize = resolveBatchSize(argv, 5);
  const accountedResponseKeys = new Set<string>();
  const accountedJudgeKeys = new Set<string>();

  const bumpFailure = (provider: string) => {
    failuresByProvider[provider] = (failuresByProvider[provider] ?? 0) + 1;
  };

  const persistProgress = () => {
    writeProgress(runId, {
      runId,
      completedResponses,
      plannedResponses,
      completedJudges,
      plannedJudges,
      ragEvaluations,
      plannedRag,
      cacheHits,
      paidCalls,
      failuresByProvider: { ...failuresByProvider },
      responseSpendUsd,
      judgeSpendUsd,
      retriesUsd,
      totalSpendUsd: budget.spentUsd,
      remainingBudgetUsd: remainingBudgetUsd(budget),
      updatedAt: new Date().toISOString(),
    });
  };

  async function callResponseModel(
    modelId: Stage2ResponseModelId,
    prompt: string,
  ): Promise<LiveProviderResult> {
    const clientOpts = { fetchImpl: deps.fetchImpl };
    if (modelId === "gpt-6.1-sol") {
      const result = await executeOpenAiResponses(
        { ...clientOpts, apiKey: openaiKey! },
        {
          model: "gpt-6.1-sol",
          effort: "high",
          maxOutputTokens: 4096,
          input: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        },
      );
      assertSameModelPinned(modelId, result.exactModelId);
      return result;
    }
    const result = await executeXaiResponses(
      { ...clientOpts, apiKey: xaiKey! },
      {
        model: "grok-4.7",
        effort: "high",
        maxOutputTokens: 4096,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      },
    );
    assertSameModelPinned(modelId, result.exactModelId);
    return result;
  }

  type WorkItem = {
    benchmarkId: "prbench" | "legalbench";
    task: NormalizedTask;
    modelId: Stage2ResponseModelId;
  };
  // Interleave finalists per task so GPT/Grok stay matched (authorization §15).
  const work: WorkItem[] = [];
  for (const task of prbenchTasks) {
    for (const modelId of models) work.push({ benchmarkId: "prbench", task, modelId });
  }
  for (const task of legalbenchTasks) {
    for (const modelId of models) work.push({ benchmarkId: "legalbench", task, modelId });
  }

  async function processOne(item: WorkItem, cacheOnly: boolean): Promise<void> {
    const { task, modelId, benchmarkId } = item;
    const provider = MODEL_PROVIDER[modelId];
    const license = assertCommercialEvalAllowed(task, "production-selection");
    if (!license.allowed) {
      bumpFailure(provider);
      return;
    }

    const userPrompt = buildUserPrompt(task);
    const settings = responseSettings(modelId);
    const settingsHash = hashObj(settings);
    const promptHashes = [contentHashFromText(systemPrompt), contentHashFromText(userPrompt)];
    const contentHash = contentHashFromText(userPrompt);
    const responseKey = buildCacheKey({
      revision: benchmarkId === "prbench" ? PRBENCH_REV : LEGALBENCH_REV,
      taskId: `${task.taskId}::${modelId}`,
      contentHash,
      provider,
      modelId,
      settingsHash,
      promptHashes,
      schemaVersion: SCHEMA_VERSION,
      kind: "response",
    });

    let responseText = "";
    let responseResult: LiveProviderResult | null = null;

    if (isResponseCacheHit(runId, responseKey)) {
      const cached = readResponseCache(runId, responseKey) as unknown as PersistedPaidCallRecord & {
        structuredParsedResponse?: { text?: string };
      };
      responseText =
        cached.structuredParsedResponse?.text ??
        (typeof (cached.response as { text?: string } | undefined)?.text === "string"
          ? (cached.response as { text: string }).text
          : "");
      if (!accountedResponseKeys.has(responseKey)) {
        const responseCost = Number(cached.costEstimateUsd ?? 0) || 0;
        budget = applyPersistedSpend(budget, responseCost);
        responseSpendUsd += responseCost;
        if (provider === "openai") costByBucket.openaiResponsesUsd += responseCost;
        if (provider === "xai") costByBucket.xaiResponsesUsd += responseCost;
        providerSpend[providerCapKey(provider)] = recordProviderSpend(
          providerSpend[providerCapKey(provider)],
          {
            calls: 1,
            tokens: (cached.inputTokens ?? 0) + (cached.outputTokens ?? 0),
            dollars: responseCost,
          },
        );
        completedResponses += 1;
        accountedResponseKeys.add(responseKey);
        cacheHits += 1;
      }
      responseResult = {
        provider,
        exactModelId: modelId,
        text: responseText,
        raw: cached.response,
        usage: {
          inputTokens: cached.inputTokens ?? 0,
          outputTokens: cached.outputTokens ?? 0,
        },
        latencyMs: cached.latencyMs ?? 0,
        providerRequestId: cached.providerRequestId ?? null,
        finishReason: "cached",
        completionStatus: "success",
      };
    } else if (cacheOnly) {
      return;
    } else {
      const estimatedInput = estimateTokens(systemPrompt + userPrompt);
      const fit = assessContextFit({
        inputTokensEstimate: estimatedInput,
        maxOutputTokens: 4096,
        contextWindow: CONTEXT_WINDOWS[modelId],
      });
      try {
        assertNoSilentTruncate(fit);
      } catch {
        bumpFailure(provider);
        return;
      }
      if (fit === "INELIGIBLE") {
        bumpFailure(provider);
        return;
      }
      const worst = worstCaseCostForBudgetGate({
        modelId,
        estimatedInputTokens: estimatedInput,
        maxOutputTokens: 4096,
        bucket: "models",
        pricingTable: pricing,
      });
      try {
        assertNextCallWithinBudget(budget, worst);
        assertWithinProviderCaps({
          provider: providerCapKey(provider),
          caps: providerCaps,
          spend: providerSpend[providerCapKey(provider)],
          nextDollarsWorstCase: worst,
        });
      } catch (err) {
        if (err instanceof BudgetLimitError) {
          runStatus = "STAGE2_BUDGET_STOP";
          note = err.message;
          throw err;
        }
        bumpFailure(provider);
        return;
      }

      try {
        responseResult = await withRetries(() => callResponseModel(modelId, userPrompt), sleep);
        paidCalls += 1;
        const actual = calculateActualCostUsd({
          modelId,
          inputTokens: responseResult.usage.inputTokens,
          outputTokens: responseResult.usage.outputTokens,
          thinkingTokens: responseResult.usage.thinkingTokens,
          cachedInputTokens: responseResult.usage.cachedInputTokens,
          bucket: "models",
          pricingTable: pricing,
        });
        budget = recordSpend(budget, actual);
        providerSpend[providerCapKey(provider)] = recordProviderSpend(
          providerSpend[providerCapKey(provider)],
          {
            calls: 1,
            tokens: responseResult.usage.inputTokens + responseResult.usage.outputTokens,
            dollars: actual,
          },
        );
        responseSpendUsd += actual;
        if (provider === "openai") costByBucket.openaiResponsesUsd += actual;
        if (provider === "xai") costByBucket.xaiResponsesUsd += actual;
        responseText = responseResult.text;
        persistPaidCallImmediately({
          runId,
          benchmarkId,
          taskId: `${task.taskId}::${modelId}`,
          provider,
          exactModelId: modelId,
          modelConfiguration: settings,
          promptVersionHash: promptHashes[0]!,
          datasetRevision: benchmarkId === "prbench" ? PRBENCH_REV : LEGALBENCH_REV,
          inputHash: contentHash,
          response: responseResult.raw,
          structuredParsedResponse: {
            text: responseText,
            ...(benchmarkId === "legalbench"
              ? scoreLegalBenchExact({
                  modelOutput: responseText,
                  expectedAnswer: task.expectedAnswer,
                })
              : {}),
          },
          usage: responseResult.usage,
          inputTokens: responseResult.usage.inputTokens,
          outputTokens: responseResult.usage.outputTokens,
          latencyMs: responseResult.latencyMs,
          providerRequestId: responseResult.providerRequestId,
          timestamp: new Date().toISOString(),
          attemptNumber: 1,
          costEstimateUsd: actual,
          completionStatus: "success",
          cacheKey: responseKey,
          kind: "response",
        });
        accountedResponseKeys.add(responseKey);
        completedResponses += 1;
      } catch (err) {
        bumpFailure(provider);
        if (err instanceof BudgetLimitError) {
          runStatus = "STAGE2_BUDGET_STOP";
          note = err.message;
          throw err;
        }
        if (err instanceof UnknownCompletionError) {
          runStatus = "STAGE2_PARTIAL";
          note = err.message;
          return;
        }
        // Hard billing/auth stop: do not run the other finalist alone (authorization §6–8).
        if (err instanceof LiveProviderError && err.code === "AUTH_ERROR") {
          runStatus = "STAGE2_BLOCKED";
          note =
            provider === "openai"
              ? `STAGE2_BLOCKED_OPENAI_BILLING: ${err.message}`
              : provider === "xai"
                ? `STAGE2_BLOCKED_PROVIDER_ACCESS: ${err.message}`
                : `STAGE2_BLOCKED_PROVIDER_ACCESS: ${err.message}`;
          throw err;
        }
        runStatus = "STAGE2_PARTIAL";
        note = err instanceof Error ? err.message : String(err);
        return;
      }
    }

    if (benchmarkId !== "prbench" || !responseText || !responseResult) return;

    const responseHash = contentHashFromText(responseText);
    const judgePrompt = buildJudgePrompt(task, responseText);
    const judgePromptHash = contentHashFromText(judgePrompt);

    async function runJudge(label: "A" | "B"): Promise<void> {
      const judgeProvider = label === "A" ? "anthropic" : "openai";
      const judgeModel = label === "A" ? STAGE2_JUDGE_A : STAGE2_JUDGE_B;
      const sameProvider =
        (label === "A" && provider === "anthropic") || (label === "B" && provider === "openai");
      const settingsJ =
        label === "A"
          ? { thinking: { type: "adaptive" }, effort: "medium", max_tokens: 2048 }
          : { reasoning: { effort: "medium" }, max_output_tokens: 2048 };
      const judgeKey = buildCacheKey({
        revision: PRBENCH_REV,
        taskId: `${task.taskId}::${modelId}::judge_${label}`,
        contentHash: responseHash,
        provider: judgeProvider,
        modelId: judgeModel,
        settingsHash: hashObj(settingsJ),
        promptHashes: [judgePromptHash],
        schemaVersion: SCHEMA_VERSION,
        kind: "judge",
      });

      if (isJudgeCacheHit(runId, judgeKey)) {
        if (!accountedJudgeKeys.has(judgeKey)) {
          const cached = readJudgeCache(runId, judgeKey) as unknown as PersistedPaidCallRecord;
          const cachedCost = Number(cached.costEstimateUsd ?? 0) || 0;
          budget = applyPersistedSpend(budget, cachedCost);
          judgeSpendUsd += cachedCost;
          if (label === "A") costByBucket.anthropicJudgeUsd += cachedCost;
          else costByBucket.openaiJudgeUsd += cachedCost;
          providerSpend.judge = recordProviderSpend(providerSpend.judge, {
            calls: 1,
            tokens: (cached.inputTokens ?? 0) + (cached.outputTokens ?? 0),
            dollars: cachedCost,
          });
          completedJudges += 1;
          accountedJudgeKeys.add(judgeKey);
          cacheHits += 1;
        }
        return;
      }

      if (cacheOnly) return;

      const estimatedInput = estimateTokens(judgePrompt);
      const worst = worstCaseCostForBudgetGate({
        modelId: judgeModel,
        estimatedInputTokens: estimatedInput,
        maxOutputTokens: 2048,
        bucket: "judgeModels",
        pricingTable: pricing,
      });
      assertNextCallWithinBudget(budget, worst);
      assertWithinProviderCaps({
        provider: "judge",
        caps: providerCaps,
        spend: providerSpend.judge,
        nextDollarsWorstCase: worst,
        isJudge: true,
      });

      const result = await withRetries(async () => {
        if (label === "A") {
          return executeAnthropicMessages(
            { apiKey: anthropicKey!, fetchImpl: deps.fetchImpl },
            {
              model: STAGE2_JUDGE_A,
              effort: "medium",
              maxTokens: 2048,
              messages: [{ role: "user", content: judgePrompt }],
            },
          );
        }
        return executeOpenAiResponses(
          { apiKey: openaiKey!, fetchImpl: deps.fetchImpl },
          {
            model: STAGE2_JUDGE_B,
            effort: "medium",
            maxOutputTokens: 2048,
            input: [{ role: "user", content: judgePrompt }],
          },
        );
      }, sleep);
      paidCalls += 1;
      const score = parseJudgeScore(result.text);
      const actual = calculateActualCostUsd({
        modelId: judgeModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        bucket: "judgeModels",
        pricingTable: pricing,
      });
      budget = recordSpend(budget, actual);
      providerSpend.judge = recordProviderSpend(providerSpend.judge, {
        calls: 1,
        tokens: result.usage.inputTokens + result.usage.outputTokens,
        dollars: actual,
      });
      judgeSpendUsd += actual;
      if (label === "A") costByBucket.anthropicJudgeUsd += actual;
      else costByBucket.openaiJudgeUsd += actual;

      persistPaidCallImmediately({
        runId,
        benchmarkId: "prbench",
        taskId: `${task.taskId}::${modelId}::judge_${label}`,
        provider: judgeProvider,
        exactModelId: judgeModel,
        modelConfiguration: settingsJ,
        promptVersionHash: judgePromptHash,
        datasetRevision: PRBENCH_REV,
        inputHash: responseHash,
        response: result.raw,
        structuredParsedResponse: {
          score,
          text: result.text,
          same_provider_judge: sameProvider,
        },
        usage: result.usage,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: result.latencyMs,
        providerRequestId: result.providerRequestId,
        timestamp: new Date().toISOString(),
        attemptNumber: 1,
        costEstimateUsd: actual,
        completionStatus: "success",
        cacheKey: judgeKey,
        kind: "judge",
      });
      accountedJudgeKeys.add(judgeKey);
      completedJudges += 1;
    }

    try {
      await runJudge("A");
    } catch (err) {
      bumpFailure("anthropic");
      if (err instanceof LiveProviderError && err.code === "AUTH_ERROR") {
        runStatus = "STAGE2_BLOCKED";
        note = `STAGE2_BLOCKED_PROVIDER_ACCESS: Judge A ${err.message}`;
        throw err;
      }
      runStatus = err instanceof BudgetLimitError ? "STAGE2_BUDGET_STOP" : "STAGE2_PARTIAL";
      note = err instanceof Error ? err.message : String(err);
      if (err instanceof BudgetLimitError) throw err;
    }
    try {
      await runJudge("B");
    } catch (err) {
      bumpFailure("openai");
      if (err instanceof LiveProviderError && err.code === "AUTH_ERROR") {
        runStatus = "STAGE2_BLOCKED";
        note = `STAGE2_BLOCKED_OPENAI_BILLING: Judge B ${err.message}`;
        throw err;
      }
      runStatus = err instanceof BudgetLimitError ? "STAGE2_BUDGET_STOP" : "STAGE2_PARTIAL";
      note = err instanceof Error ? err.message : String(err);
      if (err instanceof BudgetLimitError) throw err;
    }
  }

  const emitCheckpoint = () => {
    persistProgress();
    console.error(
      JSON.stringify({
        checkpoint: true,
        runId,
        completedResponses,
        plannedResponses,
        completedJudges,
        plannedJudges,
        ragEvaluations,
        plannedRag,
        cacheHits,
        paidCalls,
        totalSpendUsd: Number(budget.spentUsd.toFixed(4)),
        remainingBudgetUsd: Number(remainingBudgetUsd(budget).toFixed(4)),
        failuresByProvider: { ...failuresByProvider },
      }),
    );
  };

  // Pass 1: account every cache hit first so AUTH hard-stop cannot wipe prior spend.
  for (const item of work) {
    await processOne(item, true);
  }
  emitCheckpoint();

  try {
    // Pass 2: serial paid execution; first AUTH_ERROR / budget stop aborts immediately.
    let sinceCheckpoint = 0;
    for (const item of work) {
      await processOne(item, false);
      sinceCheckpoint += 1;
      if (sinceCheckpoint >= batchSize) {
        emitCheckpoint();
        sinceCheckpoint = 0;
      }
    }
    if (sinceCheckpoint > 0) emitCheckpoint();
  } catch (err) {
    if (err instanceof BudgetLimitError) {
      runStatus = "STAGE2_BUDGET_STOP";
      note = err.message;
    } else if (err instanceof LiveProviderError && err.code === "AUTH_ERROR") {
      runStatus = "STAGE2_BLOCKED";
      if (!note?.startsWith("STAGE2_BLOCKED")) {
        note = `STAGE2_BLOCKED_PROVIDER_ACCESS: ${err.message}`;
      }
    } else {
      runStatus = "STAGE2_PARTIAL";
      note = err instanceof Error ? err.message : String(err);
    }
  }

  if (!deps.skipRag) {
    const ragRoot = path.join(getCacheDir(), "legalbench-rag", RAG_REV);
    const benchmarksDir = path.join(ragRoot, "benchmarks");
    const corpusDir = path.join(ragRoot, "corpus");
    const bySource = new Map<string, ReturnType<typeof loadLegalBenchRagBenchmarkFile>>();
    for (const source of ["cuad", "maud", "contractnli"] as const) {
      const file = path.join(benchmarksDir, `${source}.json`);
      if (!existsSync(file)) continue;
      if (!isCommercialInternalEvalOk(loadRagSourceLicense(source))) continue;
      bySource.set(source, loadLegalBenchRagBenchmarkFile(file, source));
    }
    const docsBySource = new Map<string, ReturnType<typeof loadCorpusDocuments>>();
    for (const source of bySource.keys()) {
      docsBySource.set(source, loadCorpusDocuments(corpusDir, source));
    }
    const k = 5;
    let docHits = 0;
    let recallSum = 0;
    const perQuery: Array<{ taskId: string; source: string; docHit: boolean; recallAtK: number }> =
      [];
    for (const taskId of ragIds) {
      const [source, indexStr] = taskId.split("::");
      if (!source || indexStr === undefined || source === "privacy_qa") continue;
      if (!isCommercialInternalEvalOk(loadRagSourceLicense(source))) continue;
      const tasks = bySource.get(source);
      const docs = docsBySource.get(source) ?? [];
      if (!tasks) continue;
      const idx = Number(indexStr);
      const task = tasks.find((t) => t.taskId === taskId) ?? tasks[idx];
      if (!task) continue;
      const query =
        typeof task.input === "object" && task.input && "query" in task.input
          ? String((task.input as { query: string }).query)
          : (task.conversation?.[0]?.content ?? "");
      const goldDocs = [
        ...new Set(
          (task.goldEvidence ?? [])
            .map((g) => g.documentId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ];
      const goldNorm = goldDocs.map((g) => (g.includes("/") ? g : `${source}/${g}`));
      const retrieved = retrieveTopKDocuments(query, docs, k);
      const hit = documentHit(retrieved, goldNorm);
      const recall = topKDocumentRecall(retrieved, goldNorm, k);
      if (hit) docHits += 1;
      recallSum += recall;
      perQuery.push({ taskId, source, docHit: hit, recallAtK: recall });
      ragEvaluations += 1;
    }
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "rag-retrieval-results.json"),
      `${JSON.stringify(
        {
          implementation: "REFERENCE_LEXICAL_BASELINE",
          retrievalConfigHash: hashRetrievalConfig(),
          queries: ragEvaluations,
          documentHitRate: ragEvaluations ? docHits / ragEvaluations : 0,
          meanRecallAtK: ragEvaluations ? recallSum / ragEvaluations : 0,
          generationCalls: 0,
          perQuery,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  persistProgress();
  if (
    runStatus === "STAGE2_COMPLETE" &&
    (completedResponses < plannedResponses || completedJudges < plannedJudges)
  ) {
    runStatus = "STAGE2_PARTIAL";
  }

  const summary: Stage2RunSummary = {
    status: runStatus,
    runId,
    configHash,
    paidCalls,
    cacheHits,
    ragGenerationCalls: 0,
    progress: {
      runId,
      completedResponses,
      plannedResponses,
      completedJudges,
      plannedJudges,
      ragEvaluations,
      plannedRag,
      cacheHits,
      paidCalls,
      failuresByProvider,
      responseSpendUsd,
      judgeSpendUsd,
      retriesUsd,
      totalSpendUsd: budget.spentUsd,
      remainingBudgetUsd: remainingBudgetUsd(budget),
      updatedAt: new Date().toISOString(),
    },
    cost: {
      authorizedUsd: maxCostUsd,
      ...costByBucket,
      retriesUsd,
      totalUsd: budget.spentUsd,
      remainingUsd: remainingBudgetUsd(budget),
    },
    stage3Started: false,
    courtListener: 0,
    valuesPrinted: false,
    note,
  };
  writeFileSync(
    path.join(getCacheDir(), "runs", runId, "stage2-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  return summary;
}
