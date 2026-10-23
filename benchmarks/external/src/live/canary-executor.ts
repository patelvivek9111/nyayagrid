/**
 * Live PRBench canary executor: 1 OpenAI response + 2 judges, $1 hard cap.
 * Cache-first, budget-gated, persist-before-judge. No Stage-1 escalation.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadPrbenchParquet, normalizePrbenchRow } from "../adapters/prbench.js";
import { loadCurrentPricingTable } from "../cost/estimator.js";
import { executeAnthropicMessages } from "../providers/anthropic-live.js";
import { isRetryableLiveError, LiveProviderError } from "../providers/live-errors.js";
import { executeOpenAiResponses } from "../providers/openai-live.js";
import type { LiveFetch, LiveProviderResult } from "../providers/live-types.js";
import type { NormalizedTask } from "../schema/normalized-task.js";
import { assertLivePaidExecutionAuthorized } from "./authorization.js";
import {
  assertNextCallWithinBudget,
  BudgetLimitError,
  parseMaxCostUsd,
  recordSpend,
  remainingBudgetUsd,
  type BudgetState,
} from "./budget.js";
import { buildCacheKey, contentHashFromText } from "./cache-key.js";
import { calculateActualCostUsd, worstCaseCostForBudgetGate } from "./cost-accounting.js";
import { isJudgeCacheHit, readJudgeCache } from "./judge-cache.js";
import { loadExternalBenchLocalEnv } from "./load-local-env.js";
import { assertManifestImmutable, hashRunConfig, loadRunManifest } from "./manifest.js";
import { persistPaidCallImmediately, type PersistedPaidCallRecord } from "./persistence.js";
import { isResponseCacheHit, readResponseCache } from "./response-cache.js";
import { computeBackoffMs, UnknownCompletionError } from "./retry.js";
import { getCacheDir } from "../paths.js";

const PRBENCH_REV = "01947c6ef913df518e6e52626a7b29f132b12d4f";
const CANARY_TASK_ID = "b3f21d7d047856eec803e6e8";
const RESPONSE_MODEL = "gpt-6.1-sol" as const;
const JUDGE_A_MODEL = "claude-sonnet-5-5" as const;
const JUDGE_B_MODEL = "gpt-6.1-sol" as const;
const SCHEMA_VERSION = 1;

export type CanaryExecutorDeps = {
  fetchImpl?: LiveFetch;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  sleep?: (ms: number) => Promise<void>;
};

export type CanaryRunSummary = {
  status:
    | "LIVE_CANARY_PASS"
    | "LIVE_CANARY_PARTIAL"
    | "LIVE_CANARY_BLOCKED"
    | "LIVE_CANARY_BUDGET_STOP"
    | "LIVE_CANARY_UNKNOWN_COMPLETION";
  runId: string;
  taskId: string;
  paidCalls: number;
  response: {
    cacheHit: boolean;
    paidCall: boolean;
    completed: boolean;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    latencyMs: number;
    requestIdRecorded: boolean;
    costUsd: number;
    criticalFailure: boolean;
  };
  judgeA: JudgeSummary;
  judgeB: JudgeSummary;
  judgeComparison: {
    difference: number;
    disagreement: boolean;
    combinedScore: number;
  };
  cost: {
    authorizedUsd: number;
    responseUsd: number;
    judgeAUsd: number;
    judgeBUsd: number;
    retriesUsd: number;
    totalUsd: number;
    remainingUsd: number;
  };
  persistence: { response: boolean; judgeA: boolean; judgeB: boolean; atomic: boolean };
  stage1Started: false;
  googleResponseCalls: 0;
  xaiResponseCalls: 0;
  claudeOpusResponseCalls: 0;
  courtListener: 0;
  valuesPrinted: false;
  note?: string;
};

type JudgeSummary = {
  cacheHit: boolean;
  paidCall: boolean;
  score: number | null;
  tokens: { input: number; output: number };
  latencyMs: number;
  costUsd: number;
  sameProvider: boolean;
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

async function loadCanaryTask(): Promise<NormalizedTask> {
  const parquet = path.join(
    getCacheDir(),
    "prbench",
    PRBENCH_REV,
    "data",
    "legal_hard-00000-of-00001.parquet",
  );
  if (!existsSync(parquet)) {
    throw new Error(`PRBench Legal Hard parquet missing: ${parquet}`);
  }
  const rows = await loadPrbenchParquet(parquet);
  const task = rows
    .map((row) => normalizePrbenchRow(row, { split: "legal_hard", hard: true }))
    .find((t) => t.taskId === CANARY_TASK_ID);
  if (!task) throw new Error(`Canary task not found: ${CANARY_TASK_ID}`);
  return task;
}

async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  maxRetries = 2,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt + 1);
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

function emptyJudge(sameProvider: boolean): JudgeSummary {
  return {
    cacheHit: false,
    paidCall: false,
    score: null,
    tokens: { input: 0, output: 0 },
    latencyMs: 0,
    costUsd: 0,
    sameProvider,
  };
}

export async function runLiveCanary(input: {
  argv?: readonly string[];
  deps?: CanaryExecutorDeps;
}): Promise<CanaryRunSummary> {
  loadExternalBenchLocalEnv();
  const argv = input.argv ?? process.argv;
  const deps = input.deps ?? {};
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const auth = assertLivePaidExecutionAuthorized({ argv });
  const maxCostUsd = auth.maxCostUsd;
  if (maxCostUsd > 1 + 1e-9) {
    throw new BudgetLimitError("Canary hard cap is $1.00; refuse higher --max-cost-usd");
  }

  const runIdArg = parseArgValue(argv, "--run-id");
  if (!runIdArg) throw new Error("Missing --run-id");
  const runId: string = runIdArg;
  const manifest = loadRunManifest(runId);
  const fullConfigPath = path.join(getCacheDir(), "runs", runId, "full-config.json");
  if (!existsSync(fullConfigPath)) {
    throw new Error(`Missing frozen full-config.json for run ${runId}`);
  }
  const fullConfig = JSON.parse(readFileSync(fullConfigPath, "utf8")) as Record<string, unknown>;
  assertManifestImmutable(runId, hashRunConfig(fullConfig));
  if (manifest.budgetMaxUsd < maxCostUsd) {
    // Canary uses CLI max; manifest budget is stage envelope.
  }

  const openaiKey = deps.openaiApiKey ?? process.env.OPENAI_API_KEY?.trim();
  const anthropicKey = deps.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
  if (!openaiKey || !anthropicKey) {
    return {
      status: "LIVE_CANARY_BLOCKED",
      runId,
      taskId: CANARY_TASK_ID,
      paidCalls: 0,
      response: {
        cacheHit: false,
        paidCall: false,
        completed: false,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        requestIdRecorded: false,
        costUsd: 0,
        criticalFailure: false,
      },
      judgeA: emptyJudge(false),
      judgeB: emptyJudge(true),
      judgeComparison: { difference: 0, disagreement: false, combinedScore: 0 },
      cost: {
        authorizedUsd: maxCostUsd,
        responseUsd: 0,
        judgeAUsd: 0,
        judgeBUsd: 0,
        retriesUsd: 0,
        totalUsd: 0,
        remainingUsd: maxCostUsd,
      },
      persistence: { response: false, judgeA: false, judgeB: false, atomic: true },
      stage1Started: false,
      googleResponseCalls: 0,
      xaiResponseCalls: 0,
      claudeOpusResponseCalls: 0,
      courtListener: 0,
      valuesPrinted: false,
      note: "credentials_missing",
    };
  }

  const pricing = loadCurrentPricingTable();
  const task = await loadCanaryTask();
  const userPrompt = buildUserPrompt(task);
  const systemPrompt =
    "You are NyayaGrid external-bench canary. Produce a careful legal analysis response.";
  const contentHash = contentHashFromText(userPrompt);
  const responseSettings = { effort: "high", service_tier: "standard", max_output_tokens: 4096 };
  const responseSettingsHash = hashObj(responseSettings);
  const promptHashes = [contentHashFromText(systemPrompt), contentHashFromText(userPrompt)];

  const responseKey = buildCacheKey({
    revision: PRBENCH_REV,
    taskId: task.taskId,
    contentHash,
    provider: "openai",
    modelId: RESPONSE_MODEL,
    settingsHash: responseSettingsHash,
    promptHashes,
    schemaVersion: SCHEMA_VERSION,
    kind: "response",
  });

  let budget: BudgetState = { maxUsd: maxCostUsd, spentUsd: 0 };
  let paidCalls = 0;
  let responseUsd = 0;
  let judgeAUsd = 0;
  let judgeBUsd = 0;
  let retriesUsd = 0;

  let responseText = "";
  let responseResult: LiveProviderResult | null = null;
  let responseCacheHit = false;
  let responsePaid = false;
  let responsePersisted = false;

  const cachedResponse = readResponseCache(runId, responseKey);
  if (cachedResponse && isResponseCacheHit(runId, responseKey)) {
    responseCacheHit = true;
    const payload = cachedResponse as unknown as PersistedPaidCallRecord & {
      response?: LiveProviderResult;
      structuredParsedResponse?: { text?: string };
      usage?: LiveProviderResult["usage"];
    };
    responseText =
      payload.structuredParsedResponse?.text ??
      (typeof (payload.response as { text?: string } | undefined)?.text === "string"
        ? (payload.response as { text: string }).text
        : "");
    const usage = (payload.usage ?? {
      inputTokens: payload.inputTokens ?? 0,
      outputTokens: payload.outputTokens ?? 0,
    }) as LiveProviderResult["usage"];
    responseResult = {
      provider: "openai",
      exactModelId: RESPONSE_MODEL,
      text: responseText,
      raw: payload.response ?? {},
      usage,
      latencyMs: payload.latencyMs ?? 0,
      providerRequestId: payload.providerRequestId ?? null,
      finishReason: "cached",
      completionStatus: "success",
    };
    responsePersisted = true;
    responseUsd = Number(payload.costEstimateUsd ?? 0) || 0;
  } else {
    const estimatedInput = estimateTokens(systemPrompt + userPrompt);
    const worst = worstCaseCostForBudgetGate({
      modelId: RESPONSE_MODEL,
      estimatedInputTokens: estimatedInput,
      maxOutputTokens: 4096,
      bucket: "models",
      pricingTable: pricing,
    });
    assertNextCallWithinBudget(budget, worst);

    responseResult = await withRetries(
      async () =>
        executeOpenAiResponses(
          { apiKey: openaiKey, fetchImpl: deps.fetchImpl },
          {
            model: RESPONSE_MODEL,
            effort: "high",
            maxOutputTokens: 4096,
            input: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          },
        ),
      sleep,
    );
    paidCalls += 1;
    responsePaid = true;
    responseText = responseResult.text;
    const actual = calculateActualCostUsd({
      modelId: RESPONSE_MODEL,
      inputTokens: responseResult.usage.inputTokens,
      outputTokens: responseResult.usage.outputTokens,
      bucket: "models",
      pricingTable: pricing,
    });
    responseUsd = actual;
    budget = recordSpend(budget, actual);

    const record: PersistedPaidCallRecord = {
      runId,
      benchmarkId: "prbench",
      taskId: task.taskId,
      provider: "openai",
      exactModelId: RESPONSE_MODEL,
      modelConfiguration: responseSettings,
      promptVersionHash: promptHashes[0]!,
      datasetRevision: PRBENCH_REV,
      inputHash: contentHash,
      response: responseResult.raw,
      structuredParsedResponse: { text: responseText },
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
    };
    persistPaidCallImmediately(record);
    responsePersisted = true;
  }

  if (!responseText) {
    throw new Error("Canary response text empty after cache/live path");
  }

  const responseHash = contentHashFromText(responseText);
  const judgePrompt = buildJudgePrompt(task, responseText);
  const judgePromptHash = contentHashFromText(judgePrompt);

  async function runJudge(params: {
    label: "A" | "B";
    provider: "anthropic" | "openai";
    modelId: typeof JUDGE_A_MODEL | typeof JUDGE_B_MODEL;
    sameProvider: boolean;
  }): Promise<JudgeSummary> {
    const settings =
      params.provider === "anthropic"
        ? { thinking: { type: "adaptive" }, effort: "medium", max_tokens: 2048 }
        : { reasoning: { effort: "medium" }, max_output_tokens: 2048 };
    const judgeKey = buildCacheKey({
      revision: PRBENCH_REV,
      taskId: `${task.taskId}::judge_${params.label}`,
      contentHash: responseHash,
      provider: params.provider,
      modelId: params.modelId,
      settingsHash: hashObj(settings),
      promptHashes: [judgePromptHash],
      schemaVersion: SCHEMA_VERSION,
      kind: "judge",
    });

    if (isJudgeCacheHit(runId, judgeKey)) {
      const cached = readJudgeCache(runId, judgeKey) as unknown as PersistedPaidCallRecord;
      const parsed = cached.structuredParsedResponse as { score?: number } | undefined;
      return {
        cacheHit: true,
        paidCall: false,
        score: typeof parsed?.score === "number" ? parsed.score : null,
        tokens: { input: cached.inputTokens ?? 0, output: cached.outputTokens ?? 0 },
        latencyMs: cached.latencyMs ?? 0,
        costUsd: Number(cached.costEstimateUsd ?? 0) || 0,
        sameProvider: params.sameProvider,
      };
    }

    const estimatedInput = estimateTokens(judgePrompt);
    const maxOut = 2048;
    const worst = worstCaseCostForBudgetGate({
      modelId: params.modelId,
      estimatedInputTokens: estimatedInput,
      maxOutputTokens: maxOut,
      bucket: "judgeModels",
      pricingTable: pricing,
    });
    assertNextCallWithinBudget(budget, worst);

    const result = await withRetries(async () => {
      if (params.provider === "anthropic") {
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
      modelId: params.modelId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      bucket: "judgeModels",
      pricingTable: pricing,
    });
    budget = recordSpend(budget, actual);
    if (params.label === "A") judgeAUsd = actual;
    else judgeBUsd = actual;

    persistPaidCallImmediately({
      runId,
      benchmarkId: "prbench",
      taskId: `${task.taskId}::judge_${params.label}`,
      provider: params.provider,
      exactModelId: params.modelId,
      modelConfiguration: settings,
      promptVersionHash: judgePromptHash,
      datasetRevision: PRBENCH_REV,
      inputHash: responseHash,
      response: result.raw,
      structuredParsedResponse: {
        score,
        text: result.text,
        same_provider_judge: params.sameProvider,
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

    return {
      cacheHit: false,
      paidCall: true,
      score,
      tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
      latencyMs: result.latencyMs,
      costUsd: actual,
      sameProvider: params.sameProvider,
    };
  }

  let judgeA = emptyJudge(false);
  let judgeB = emptyJudge(true);
  let status: CanaryRunSummary["status"] = "LIVE_CANARY_PASS";
  let note: string | undefined;

  try {
    judgeA = await runJudge({
      label: "A",
      provider: "anthropic",
      modelId: JUDGE_A_MODEL,
      sameProvider: false,
    });
  } catch (err) {
    if (err instanceof BudgetLimitError) {
      status = "LIVE_CANARY_BUDGET_STOP";
      note = err.message;
    } else if (err instanceof UnknownCompletionError) {
      status = "LIVE_CANARY_UNKNOWN_COMPLETION";
      note = err.message;
    } else {
      status = "LIVE_CANARY_PARTIAL";
      note = err instanceof Error ? err.message : String(err);
    }
  }

  if (
    status === "LIVE_CANARY_PASS" ||
    (status === "LIVE_CANARY_PARTIAL" && judgeA.score !== null)
  ) {
    try {
      judgeB = await runJudge({
        label: "B",
        provider: "openai",
        modelId: JUDGE_B_MODEL,
        sameProvider: true,
      });
      if (status === "LIVE_CANARY_PARTIAL" && judgeB.score !== null) status = "LIVE_CANARY_PASS";
    } catch (err) {
      if (err instanceof BudgetLimitError) {
        status = "LIVE_CANARY_BUDGET_STOP";
        note = err.message;
      } else if (err instanceof UnknownCompletionError) {
        status = "LIVE_CANARY_UNKNOWN_COMPLETION";
        note = err.message;
      } else {
        status = "LIVE_CANARY_PARTIAL";
        note = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const scoreA = judgeA.score ?? 0;
  const scoreB = judgeB.score ?? 0;
  const both = judgeA.score !== null && judgeB.score !== null;
  const difference = both ? Math.abs(scoreA - scoreB) : 0;
  const combined = both ? (scoreA + scoreB) / 2 : scoreA || scoreB;
  const totalUsd = budget.spentUsd;

  const summary: CanaryRunSummary = {
    status:
      both && status === "LIVE_CANARY_PASS"
        ? "LIVE_CANARY_PASS"
        : status === "LIVE_CANARY_PASS"
          ? "LIVE_CANARY_PARTIAL"
          : status,
    runId,
    taskId: task.taskId,
    paidCalls,
    response: {
      cacheHit: responseCacheHit,
      paidCall: responsePaid,
      completed: responsePersisted,
      inputTokens: responseResult?.usage.inputTokens ?? 0,
      outputTokens: responseResult?.usage.outputTokens ?? 0,
      reasoningTokens: responseResult?.usage.reasoningTokens,
      latencyMs: responseResult?.latencyMs ?? 0,
      requestIdRecorded: Boolean(responseResult?.providerRequestId) || responseCacheHit,
      costUsd: responseUsd,
      criticalFailure: false,
    },
    judgeA,
    judgeB,
    judgeComparison: {
      difference,
      disagreement: both && difference >= 0.15,
      combinedScore: combined,
    },
    cost: {
      authorizedUsd: maxCostUsd,
      responseUsd,
      judgeAUsd,
      judgeBUsd,
      retriesUsd,
      totalUsd,
      remainingUsd: remainingBudgetUsd(budget),
    },
    persistence: {
      response: responsePersisted,
      judgeA: judgeA.score !== null || judgeA.cacheHit,
      judgeB: judgeB.score !== null || judgeB.cacheHit,
      atomic: true,
    },
    stage1Started: false,
    googleResponseCalls: 0,
    xaiResponseCalls: 0,
    claudeOpusResponseCalls: 0,
    courtListener: 0,
    valuesPrinted: false,
    note,
  };

  writeFileSync(
    path.join(getCacheDir(), "runs", runId, "canary-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  return summary;
}

/** Offline rescore from persisted judge artifacts (0 paid calls). */
export function offlineRescoreCanary(runId: string): {
  judgeA: number | null;
  judgeB: number | null;
  difference: number;
  disagreement: boolean;
  combinedScore: number;
  paidCalls: 0;
  sameAsLiveSummary: boolean;
} {
  const summaryPath = path.join(getCacheDir(), "runs", runId, "canary-summary.json");
  if (!existsSync(summaryPath)) {
    throw new Error(`Missing canary-summary.json for ${runId}`);
  }
  const prior = JSON.parse(readFileSync(summaryPath, "utf8")) as CanaryRunSummary;
  const judgeDir = path.join(getCacheDir(), "runs", runId, "judge");
  let scoreA: number | null = null;
  let scoreB: number | null = null;
  if (existsSync(judgeDir)) {
    for (const file of readdirSync(judgeDir).filter((f) => f.endsWith(".json"))) {
      const rec = JSON.parse(
        readFileSync(path.join(judgeDir, file), "utf8"),
      ) as PersistedPaidCallRecord;
      const score = (rec.structuredParsedResponse as { score?: number } | undefined)?.score;
      if (typeof score !== "number") continue;
      if (String(rec.taskId).endsWith("::judge_A")) scoreA = score;
      if (String(rec.taskId).endsWith("::judge_B")) scoreB = score;
    }
  }
  const both = scoreA !== null && scoreB !== null;
  const difference = both ? Math.abs(scoreA! - scoreB!) : 0;
  const combined = both ? (scoreA! + scoreB!) / 2 : (scoreA ?? scoreB ?? 0);
  return {
    judgeA: scoreA,
    judgeB: scoreB,
    difference,
    disagreement: both && difference >= 0.15,
    combinedScore: combined,
    paidCalls: 0,
    sameAsLiveSummary:
      scoreA === prior.judgeA.score &&
      scoreB === prior.judgeB.score &&
      Math.abs(combined - prior.judgeComparison.combinedScore) < 1e-9,
  };
}

export function parseCanaryMaxCost(argv: readonly string[]): number | null {
  return parseMaxCostUsd(argv);
}
