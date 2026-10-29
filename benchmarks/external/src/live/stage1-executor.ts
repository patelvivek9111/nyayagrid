/**
 * Stage-1 multi-provider screening executor.
 * Cache-first, budget-gated, persist-immediately, no Stage-2 escalation, no fallback.
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
import { getCacheDir, getRegistryDir } from "../paths.js";
import { executeAnthropicMessages } from "../providers/anthropic-live.js";
import { executeGeminiInteractions } from "../providers/gemini-live.js";
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
import { resolveBatchSize, chunk } from "./batch.js";
import { parseConcurrency, mapWithConcurrency } from "./concurrency.js";
import {
  calculateActualCostUsd,
  costUsdFromPersistedUsage,
  worstCaseCostForBudgetGate,
} from "./cost-accounting.js";
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

export const STAGE1_RESPONSE_MODELS = [
  "gpt-6.1-sol",
  "claude-opus-5-5",
  "gemini-4-argon",
  "grok-4.7",
] as const;

export type Stage1ResponseModelId = (typeof STAGE1_RESPONSE_MODELS)[number];

const JUDGE_A_MODEL = "claude-sonnet-5-5" as const;
const JUDGE_B_MODEL = "gpt-6.1-sol" as const;
const PRBENCH_REV = "01947c6ef913df518e6e52626a7b29f132b12d4f";
const LEGALBENCH_REV = "b46bf4ffae90524b2b72aaa30e7745fe9db64481";
const RAG_REV = "2b9c248bc8179ef0908fd6ba01d50b156facd48b";
const SCHEMA_VERSION = 1;

const MODEL_PROVIDER: Record<Stage1ResponseModelId, LiveProviderId> = {
  "gpt-6.1-sol": "openai",
  "claude-opus-5-5": "anthropic",
  "gemini-4-argon": "google",
  "grok-4.7": "xai",
};

const CONTEXT_WINDOWS: Record<Stage1ResponseModelId, number> = {
  "gpt-6.1-sol": 1_050_000,
  "claude-opus-5-5": 1_000_000,
  "gemini-4-argon": 1_048_576,
  "grok-4.7": 2_000_000,
};

export type Stage1TaskStatus =
  | "SUCCESS"
  | "CACHE_HIT"
  | "AUTH_ERROR"
  | "RATE_LIMIT"
  | "TEMPORARY_PROVIDER_ERROR"
  | "TRANSPORT_ERROR"
  | "MODEL_NOT_FOUND"
  | "BAD_REQUEST"
  | "CONTEXT_OVERFLOW"
  | "REFUSAL"
  | "UNKNOWN_COMPLETION"
  | "BUDGET_STOP"
  | "LICENSE_BLOCKED"
  | "PRECHECK_FAILURE"
  | "NON_RETRYABLE_PROVIDER_ERROR"
  | "FAILED";

export type Stage1ExecutorDeps = {
  fetchImpl?: LiveFetch;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  xaiApiKey?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Test-only subset overrides. */
  prbenchTasks?: NormalizedTask[];
  legalbenchTasks?: NormalizedTask[];
  ragTaskIds?: string[];
  responseModels?: readonly Stage1ResponseModelId[];
  skipRag?: boolean;
  /** When set, skip live authorization argv checks (tests inject). */
  bypassAuthForTests?: boolean;
  maxCostUsdForTests?: number;
  /**
   * Challenger-screen / corrected Claude completion allowance.
   * Default remains 4096 for historical Stage-1 semantics.
   */
  claudeMaxTokens?: number;
  /** Optional Gemini output override (default 4096). */
  geminiMaxOutputTokens?: number;
  /**
   * When true, only require API keys for selected response models + judges
   * (OpenAI + Anthropic). Used by challenger screen (no xAI required).
   */
  requireOnlySelectedProviderKeys?: boolean;
  /** Interleave models per task (Claude N then Gemini N) for balanced spend. */
  interleaveModelsPerTask?: boolean;
  /** Absolute hard ceiling for --max-cost-usd (default 25 Stage-1). */
  maxCostUsdCeiling?: number;
};

export type Stage1ProgressSnapshot = {
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

export type Stage1RunSummary = {
  status: "STAGE1_COMPLETE" | "STAGE1_PARTIAL" | "STAGE1_BUDGET_STOP" | "STAGE1_BLOCKED";
  runId: string;
  configHash: string;
  paidCalls: number;
  cacheHits: number;
  ragGenerationCalls: 0;
  progress: Stage1ProgressSnapshot;
  cost: {
    authorizedUsd: number;
    openaiResponsesUsd: number;
    anthropicResponsesUsd: number;
    googleResponsesUsd: number;
    xaiResponsesUsd: number;
    anthropicJudgeUsd: number;
    openaiJudgeUsd: number;
    retriesUsd: number;
    totalUsd: number;
    remainingUsd: number;
  };
  stage2Started: false;
  courtListener: 0;
  valuesPrinted: false;
  note?: string;
};

type ScreeningSuite = {
  upstream_ids: {
    prbench_legal_hard: string[];
    legalbench: string[];
    legalbench_rag: string[];
  };
  actual: { prbenchHard: number; legalbench: number; legalbenchRag: number };
};

function parseArgValue(argv: readonly string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1] ?? null;
    if (argv[i]?.startsWith(`${name}=`)) return argv[i]!.slice(name.length + 1) || null;
  }
  return null;
}

function hashObj(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
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

function responseSettings(
  modelId: Stage1ResponseModelId,
  limits: { claudeMaxTokens: number; geminiMaxOutputTokens: number },
): unknown {
  switch (modelId) {
    case "gpt-6.1-sol":
      return { effort: "high", service_tier: "default", max_output_tokens: 4096 };
    case "claude-opus-5-5":
      return {
        thinking: { type: "adaptive" },
        effort: "high",
        max_tokens: limits.claudeMaxTokens,
      };
    case "gemini-4-argon":
      return {
        thinking_level: "high",
        max_output_tokens: limits.geminiMaxOutputTokens,
      };
    case "grok-4.7":
      return { effort: "high", max_output_tokens: 4096 };
  }
}

function classifyTaskError(err: unknown): Stage1TaskStatus {
  if (err instanceof BudgetLimitError) return "BUDGET_STOP";
  if (err instanceof UnknownCompletionError) return "UNKNOWN_COMPLETION";
  if (err instanceof LiveProviderError) {
    switch (err.code) {
      case "AUTH_ERROR":
        return "AUTH_ERROR";
      case "RATE_LIMIT":
        return "RATE_LIMIT";
      case "TEMPORARY_PROVIDER_ERROR":
        return "TEMPORARY_PROVIDER_ERROR";
      case "TRANSPORT_ERROR":
        return "TRANSPORT_ERROR";
      case "MODEL_NOT_FOUND":
        return "MODEL_NOT_FOUND";
      case "BAD_REQUEST":
        return "BAD_REQUEST";
      case "CONTEXT_OVERFLOW":
        return "CONTEXT_OVERFLOW";
      case "CONTENT_FILTER_OR_REFUSAL":
        return "REFUSAL";
      case "UNKNOWN_COMPLETION":
        return "UNKNOWN_COMPLETION";
      default:
        return "NON_RETRYABLE_PROVIDER_ERROR";
    }
  }
  return "FAILED";
}

async function withRetries<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  maxRetries = 2,
): Promise<T> {
  let attempt = 0;
  while (true) {
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

function writeProgress(runId: string, progress: Stage1ProgressSnapshot): void {
  writeFileSync(
    path.join(getCacheDir(), "runs", runId, "stage1-progress.json"),
    `${JSON.stringify(progress, null, 2)}\n`,
    "utf8",
  );
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

export async function runStage1Screening(input: {
  argv?: readonly string[];
  deps?: Stage1ExecutorDeps;
}): Promise<Stage1RunSummary> {
  loadExternalBenchLocalEnv();
  assertNoAutoEscalation();
  const argv = input.argv ?? process.argv;
  const deps = input.deps ?? {};
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let maxCostUsd: number;
  if (deps.bypassAuthForTests) {
    maxCostUsd = deps.maxCostUsdForTests ?? 25;
  } else {
    const auth = assertLivePaidExecutionAuthorized({ argv });
    maxCostUsd = auth.maxCostUsd;
  }
  const costCeiling = deps.maxCostUsdCeiling ?? 25;
  if (maxCostUsd > costCeiling + 1e-9) {
    throw new BudgetLimitError(
      `Hard cap is $${costCeiling.toFixed(2)}; refuse higher --max-cost-usd`,
    );
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

  const outputOverrides = (fullConfig.outputTokenOverrides ?? {}) as Record<string, number>;
  const outputLimits = {
    claudeMaxTokens:
      deps.claudeMaxTokens ??
      (typeof outputOverrides["claude-opus-5-5"] === "number"
        ? outputOverrides["claude-opus-5-5"]
        : 4096),
    geminiMaxOutputTokens:
      deps.geminiMaxOutputTokens ??
      (typeof outputOverrides["gemini-4-argon"] === "number"
        ? outputOverrides["gemini-4-argon"]
        : 4096),
  };

  const openaiKey = deps.openaiApiKey ?? process.env.OPENAI_API_KEY?.trim();
  const anthropicKey = deps.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
  const googleKey =
    deps.googleApiKey ?? process.env.GOOGLE_API_KEY?.trim() ?? process.env.GEMINI_API_KEY?.trim();
  const xaiKey = deps.xaiApiKey ?? process.env.XAI_API_KEY?.trim();

  const screening = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
  ) as ScreeningSuite;

  const models = deps.responseModels ?? STAGE1_RESPONSE_MODELS;
  const needsGoogle = models.includes("gemini-4-argon");
  const needsXai = models.includes("grok-4.7");
  const needsOpenAi = true; // Judge B always gpt-6.1-sol for PRBench
  const needsAnthropic = true; // Judge A + possibly Claude response
  const selective = deps.requireOnlySelectedProviderKeys === true;
  const credentialsOk = selective
    ? Boolean(
        (!needsOpenAi || openaiKey) &&
        (!needsAnthropic || anthropicKey) &&
        (!needsGoogle || googleKey) &&
        (!needsXai || xaiKey),
      )
    : Boolean(openaiKey && anthropicKey && googleKey && xaiKey);
  if (!credentialsOk) {
    return {
      status: "STAGE1_BLOCKED",
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
        anthropicResponsesUsd: 0,
        googleResponsesUsd: 0,
        xaiResponsesUsd: 0,
        anthropicJudgeUsd: 0,
        openaiJudgeUsd: 0,
        retriesUsd: 0,
        totalUsd: 0,
        remainingUsd: maxCostUsd,
      },
      stage2Started: false,
      courtListener: 0,
      valuesPrinted: false,
      note: "credentials_missing",
    };
  }
  const prbenchTasks =
    deps.prbenchTasks ?? (await loadPrbenchTasks(screening.upstream_ids.prbench_legal_hard));
  const legalbenchTasks =
    deps.legalbenchTasks ?? loadLegalbenchTasks(screening.upstream_ids.legalbench);
  const ragIds = deps.ragTaskIds ?? screening.upstream_ids.legalbench_rag;

  const plannedResponses = (prbenchTasks.length + legalbenchTasks.length) * models.length;
  const plannedJudges = prbenchTasks.length * models.length * 2;
  const plannedRag = deps.skipRag ? 0 : ragIds.length;

  const pricing = loadCurrentPricingTable();
  const providerCaps: ProviderCapsConfig = {
    ...parseProviderCaps(argv),
    openai: { maxDollars: parseProviderCaps(argv).openai?.maxDollars ?? 4 },
    anthropic: { maxDollars: parseProviderCaps(argv).anthropic?.maxDollars ?? 6 },
    google: { maxDollars: parseProviderCaps(argv).google?.maxDollars ?? 4 },
    xai: { maxDollars: parseProviderCaps(argv).xai?.maxDollars ?? 4 },
    maxJudgeDollars: parseProviderCaps(argv).maxJudgeDollars ?? 12,
  };

  // Resume rebuilds spend by re-applying cached artifact costs as work is visited (canary pattern).
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
  let retriesUsd = 0;
  const costByBucket = {
    openaiResponsesUsd: 0,
    anthropicResponsesUsd: 0,
    googleResponsesUsd: 0,
    xaiResponsesUsd: 0,
    anthropicJudgeUsd: 0,
    openaiJudgeUsd: 0,
  };
  const failuresByProvider: Record<string, number> = {};
  let runStatus: Stage1RunSummary["status"] = "STAGE1_COMPLETE";
  let note: string | undefined;

  const systemPrompt =
    "You are NyayaGrid external-bench Stage-1. Produce a careful legal analysis response.";
  const concurrency = parseConcurrency(argv, 2);
  const batchSize = resolveBatchSize(argv, 5);

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
    modelId: Stage1ResponseModelId,
    prompt: string,
  ): Promise<LiveProviderResult> {
    const provider = MODEL_PROVIDER[modelId];
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
    if (modelId === "claude-opus-5-5") {
      const result = await executeAnthropicMessages(
        { ...clientOpts, apiKey: anthropicKey! },
        {
          model: "claude-opus-5-5",
          effort: "high",
          maxTokens: outputLimits.claudeMaxTokens,
          messages: [{ role: "user", content: `${systemPrompt}\n\n${prompt}` }],
        },
      );
      assertSameModelPinned(modelId, result.exactModelId);
      return result;
    }
    if (modelId === "gemini-4-argon") {
      const result = await executeGeminiInteractions(
        { ...clientOpts, apiKey: googleKey! },
        {
          model: "gemini-4-argon",
          thinkingLevel: "high",
          maxOutputTokens: outputLimits.geminiMaxOutputTokens,
          input: `${systemPrompt}\n\n${prompt}`,
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
    modelId: Stage1ResponseModelId;
  };

  const work: WorkItem[] = [];
  if (deps.interleaveModelsPerTask) {
    for (const task of prbenchTasks) {
      for (const modelId of models) {
        work.push({ benchmarkId: "prbench", task, modelId });
      }
    }
    for (const task of legalbenchTasks) {
      for (const modelId of models) {
        work.push({ benchmarkId: "legalbench", task, modelId });
      }
    }
  } else {
    for (const modelId of models) {
      for (const task of prbenchTasks) {
        work.push({ benchmarkId: "prbench", task, modelId });
      }
      for (const task of legalbenchTasks) {
        work.push({ benchmarkId: "legalbench", task, modelId });
      }
    }
  }

  async function processOne(item: WorkItem): Promise<void> {
    const { task, modelId, benchmarkId } = item;
    const provider = MODEL_PROVIDER[modelId];
    const license = assertCommercialEvalAllowed(task, "production-selection");
    if (!license.allowed) {
      bumpFailure(provider);
      return;
    }

    const userPrompt = buildUserPrompt(task);
    const settings = responseSettings(modelId, outputLimits);
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
    let responseCost = 0;

    if (isResponseCacheHit(runId, responseKey)) {
      const cached = readResponseCache(runId, responseKey) as unknown as PersistedPaidCallRecord & {
        structuredParsedResponse?: { text?: string };
      };
      responseText =
        cached.structuredParsedResponse?.text ??
        (typeof (cached.response as { text?: string } | undefined)?.text === "string"
          ? (cached.response as { text: string }).text
          : "");
      {
        const cachedUsage = (cached.usage ?? {}) as {
          thinkingTokens?: number;
          cachedInputTokens?: number;
        };
        responseCost = costUsdFromPersistedUsage({
          modelId,
          inputTokens: cached.inputTokens,
          outputTokens: cached.outputTokens,
          thinkingTokens: cachedUsage.thinkingTokens,
          cachedInputTokens: cachedUsage.cachedInputTokens,
          fallbackCostUsd: cached.costEstimateUsd,
          bucket: "models",
          pricingTable: pricing,
        });
      }
      budget = applyPersistedSpend(budget, responseCost);
      responseSpendUsd += responseCost;
      cacheHits += 1;
      completedResponses += 1;
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
    } else {
      const estimatedInput = estimateTokens(systemPrompt + userPrompt);
      const modelMaxOut =
        modelId === "claude-opus-5-5"
          ? outputLimits.claudeMaxTokens
          : modelId === "gemini-4-argon"
            ? outputLimits.geminiMaxOutputTokens
            : 4096;
      const fit = assessContextFit({
        inputTokensEstimate: estimatedInput,
        maxOutputTokens: modelMaxOut,
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
        maxOutputTokens: modelMaxOut,
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
          runStatus = "STAGE1_BUDGET_STOP";
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
        responseCost = actual;
        if (provider === "openai") costByBucket.openaiResponsesUsd += actual;
        if (provider === "anthropic") costByBucket.anthropicResponsesUsd += actual;
        if (provider === "google") costByBucket.googleResponsesUsd += actual;
        if (provider === "xai") costByBucket.xaiResponsesUsd += actual;

        responseText = responseResult.text;
        const terminalIncomplete =
          responseResult.completionStatus === "incomplete" ||
          (typeof responseText === "string" && responseText.trim().length === 0);
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
            ...(terminalIncomplete
              ? { terminalReason: "OUTPUT_BUDGET_INCOMPLETE_NO_USABLE_TEXT" }
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
          completionStatus: terminalIncomplete ? "terminal_incomplete" : "success",
          cacheKey: responseKey,
          kind: "response",
        });
        completedResponses += 1;
      } catch (err) {
        const status = classifyTaskError(err);
        bumpFailure(provider);
        if (status === "BUDGET_STOP") {
          runStatus = "STAGE1_BUDGET_STOP";
          note = err instanceof Error ? err.message : String(err);
          throw err;
        }
        if (status === "UNKNOWN_COMPLETION") {
          runStatus = "STAGE1_PARTIAL";
          note = err instanceof Error ? err.message : String(err);
          return;
        }
        runStatus = "STAGE1_PARTIAL";
        return;
      }
    }

    if (benchmarkId !== "prbench" || !responseText || !responseResult) {
      return;
    }

    const responseHash = contentHashFromText(responseText);
    const judgePrompt = buildJudgePrompt(task, responseText);
    const judgePromptHash = contentHashFromText(judgePrompt);

    async function runJudge(label: "A" | "B"): Promise<void> {
      const judgeProvider = label === "A" ? "anthropic" : "openai";
      const judgeModel = label === "A" ? JUDGE_A_MODEL : JUDGE_B_MODEL;
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
        const cached = readJudgeCache(runId, judgeKey) as unknown as PersistedPaidCallRecord;
        const cachedUsage = (cached.usage ?? {}) as { thinkingTokens?: number };
        const cachedCost = costUsdFromPersistedUsage({
          modelId: judgeModel,
          inputTokens: cached.inputTokens,
          outputTokens: cached.outputTokens,
          thinkingTokens: cachedUsage.thinkingTokens,
          fallbackCostUsd: cached.costEstimateUsd,
          bucket: "judgeModels",
          pricingTable: pricing,
        });
        budget = applyPersistedSpend(budget, cachedCost);
        judgeSpendUsd += cachedCost;
        cacheHits += 1;
        completedJudges += 1;
        return;
      }

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
              model: JUDGE_A_MODEL,
              effort: "medium",
              maxTokens: 2048,
              messages: [{ role: "user", content: judgePrompt }],
            },
          );
        }
        return executeOpenAiResponses(
          { apiKey: openaiKey!, fetchImpl: deps.fetchImpl },
          {
            model: JUDGE_B_MODEL,
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
      completedJudges += 1;
    }

    try {
      await runJudge("A");
    } catch (err) {
      bumpFailure("anthropic");
      runStatus =
        classifyTaskError(err) === "BUDGET_STOP" ? "STAGE1_BUDGET_STOP" : "STAGE1_PARTIAL";
      note = err instanceof Error ? err.message : String(err);
      if (classifyTaskError(err) === "BUDGET_STOP") throw err;
    }
    try {
      await runJudge("B");
    } catch (err) {
      bumpFailure("openai");
      runStatus =
        classifyTaskError(err) === "BUDGET_STOP" ? "STAGE1_BUDGET_STOP" : "STAGE1_PARTIAL";
      note = err instanceof Error ? err.message : String(err);
      if (classifyTaskError(err) === "BUDGET_STOP") throw err;
    }
  }

  const batches = chunk(work, batchSize);
  try {
    for (const batch of batches) {
      const results = await mapWithConcurrency(batch, concurrency, async (item) => {
        await processOne(item);
        return true;
      });
      for (const r of results) {
        if (!r.ok && r.error instanceof BudgetLimitError) throw r.error;
      }
      persistProgress();
    }
  } catch (err) {
    if (err instanceof BudgetLimitError) {
      runStatus = "STAGE1_BUDGET_STOP";
      note = err.message;
    } else {
      runStatus = "STAGE1_PARTIAL";
      note = err instanceof Error ? err.message : String(err);
    }
  }

  // RAG retrieval-only (zero generation)
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
    runStatus === "STAGE1_COMPLETE" &&
    (completedResponses < plannedResponses || completedJudges < plannedJudges)
  ) {
    runStatus = "STAGE1_PARTIAL";
  }

  const summary: Stage1RunSummary = {
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
    stage2Started: false,
    courtListener: 0,
    valuesPrinted: false,
    note,
  };

  writeFileSync(
    path.join(getCacheDir(), "runs", runId, "stage1-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  return summary;
}
