/**
 * Live NYAYA_PIPELINE executor for external prosecution validation.
 *
 * Requires --allow-paid-model-calls AND --max-cost-usd for paid mode.
 * Dry-run never invokes paid providers.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { getCacheDir } from "../paths.js";
import {
  assertLivePaidExecutionAuthorized,
  isLivePaidExecutionAuthorized,
} from "../live/authorization.js";
import {
  assertNextCallWithinBudget,
  BudgetLimitError,
  parseMaxCostUsd,
  recordSpend,
  reconstructSpendFromPersistedCosts,
  type BudgetState,
} from "../live/budget.js";
import { calculateActualCostUsd, worstCaseCostForBudgetGate } from "../live/cost-accounting.js";
import { loadCurrentPricingTable } from "../cost/estimator.js";
import { persistPaidCallImmediately } from "../live/persistence.js";
import { buildCacheKey, contentHashFromText } from "../live/cache-key.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import type { NormalizedTask } from "../schema/normalized-task.js";
import { DETERMINISTIC_SEED, SUITE_ID, SUITE_VERSION, type TaskGroup } from "./constants.js";
import { GPT_61_SOL_LIVE_VERIFIED } from "./model-pin.js";
import {
  buildProsecutionExternalSuitePlan,
  type LoadedSuiteSlice,
  type ProsecutionExternalSuitePlan,
} from "./suite.js";
import { scoreExactLabel, scoreCitationReliability, type ScoreOutcome } from "./scorers/index.js";
import {
  buildProsecutionPipelineRequest,
  classifyProsecutionExternalRisk,
  invokeNyayaProsecutionPipeline,
  type NyayaPipelineInvokeInput,
  type PipelineInvocationRecord,
} from "./nyaya-pipeline.js";
import {
  classifyLiveExit,
  ProsecutionExternalLiveRunReportSchema,
  type LiveExitClassification,
  type ProsecutionExternalLiveRunReport,
  type ProsecutionExternalLiveTaskResult,
} from "./live-result-schema.js";

export const DEFAULT_HARD_CAP_USD = 25;
export const DEFAULT_REQUEST_CAP = 220;
export const DEFAULT_BATCH_SIZE = 8;
export const LIVE_RUN_ID = "prosecution-external-live";

export type LiveExecutorOptions = {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** Force dry-run (no paid providers). */
  dryRun?: boolean;
  /** Commercial-only: LegalBench + LegalCiteBench. */
  commercialOnly?: boolean;
  /** Use fixtures instead of cache mounts (tests). */
  useFixturesOnly?: boolean;
  resumeRunId?: string;
  batchSize?: number;
  hardCapUsd?: number;
  requestCap?: number;
  /** Stop after N new executions (canary). */
  maxExamples?: number;
  /** Inject suite plan (tests). */
  planOverride?: ProsecutionExternalSuitePlan;
  /** Inject pipeline invoke (tests / dry-run mocks). */
  invokeOverride?: (input: NyayaPipelineInvokeInput) => Promise<PipelineInvocationRecord>;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  xaiApiKey?: string;
  fetchImpl?: typeof fetch;
  /** Bypass argv auth for unit tests that simulate paid path with mocks (still no network). */
  bypassAuthForTests?: boolean;
  maxCostUsdForTests?: number;
  onBatchBoundary?: (snap: LiveProgressSnapshot) => void;
};

export type LiveProgressSnapshot = {
  runId: string;
  completed: number;
  selected: number;
  paidCalls: number;
  providerRequests: number;
  spendUsd: number;
  remainingUsd: number;
  retries: number;
  fallbacks: number;
  criticalFailures: number;
  updatedAt: string;
};

function parseFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

function parseIntFlag(argv: readonly string[], name: string, fallback: number): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) {
      const n = Number(argv[i + 1]);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
    }
    if (argv[i]?.startsWith(`${name}=`)) {
      const n = Number(argv[i]!.slice(name.length + 1));
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
    }
  }
  return fallback;
}

function groupForTask(
  benchmarkId: string,
  metadata: Record<string, unknown> | null | undefined,
  fallback: TaskGroup,
): TaskGroup {
  const g = metadata?.taskGroup;
  if (
    typeof g === "string" &&
    [
      "US_EVIDENCE_REASONING",
      "US_AUTHORITY_VERIFICATION",
      "US_PRECEDENT_FACT_CHECKING",
      "CITATION_RELIABILITY",
      "CRIMINAL_RAG_RETRIEVAL",
      "CRIMINAL_RAG_GROUNDING",
      "ABSTENTION",
      "SOURCE_FIDELITY",
    ].includes(g)
  ) {
    return g as TaskGroup;
  }
  if (benchmarkId === "legalcitebench") return "CITATION_RELIABILITY";
  return fallback;
}

function scoreTask(task: NormalizedTask, output: string): ScoreOutcome {
  if (task.benchmarkId === "legalcitebench") {
    const mode =
      task.metadata?.citationTaskType === "CITATION_RETRIEVAL" ||
      task.metadata?.citationTaskType === "CITATION_COMPLETION"
        ? "CLOSED_BOOK_DIAGNOSTIC"
        : "NYAYA_GROUNDED_VERIFICATION";
    return scoreCitationReliability(task, output, mode);
  }
  return scoreExactLabel(task, output);
}

function isTaskEligible(task: NormalizedTask): { ok: boolean; reason?: string } {
  if (task.expectedAnswer == null || String(task.expectedAnswer).trim() === "") {
    return { ok: false, reason: "MISSING_GOLD_ANSWER" };
  }
  const conv = task.conversation ?? [];
  const hasInput =
    conv.some((t) => t.content?.trim()) || (task.input && Object.keys(task.input).length > 0);
  if (!hasInput) return { ok: false, reason: "MISSING_TASK_INPUT" };
  return { ok: true };
}

function loadCompletedIds(progressPath: string): Set<string> {
  const completed = new Set<string>();
  if (!existsSync(progressPath)) return completed;
  for (const line of readFileSync(progressPath, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const row = JSON.parse(line) as { taskId?: string; status?: string };
      if (row.taskId && (row.status === "scored" || row.status === "completed")) {
        completed.add(row.taskId);
      }
    } catch {
      // skip corrupt lines
    }
  }
  return completed;
}

function loadPersistedCosts(runDir: string): number[] {
  const jsonl = path.join(runDir, "response-calls.jsonl");
  if (!existsSync(jsonl)) return [];
  const costs: number[] = [];
  for (const line of readFileSync(jsonl, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const row = JSON.parse(line) as { payload?: { costEstimateUsd?: number } };
      const c = Number(row.payload?.costEstimateUsd ?? 0);
      if (Number.isFinite(c) && c > 0) costs.push(c);
    } catch {
      // skip
    }
  }
  return costs;
}

function accuracyOf(rows: ProsecutionExternalLiveTaskResult[]): number | null {
  const scored = rows.filter((r) => r.correct !== null && !r.ineligible);
  if (scored.length === 0) return null;
  return scored.filter((r) => r.correct).length / scored.length;
}

function ensureGoldIsolated(_task: NormalizedTask, promptProbe: string): void {
  // Structured gold keys must never appear in pipeline prompts.
  if (/\bexpectedAnswer\b|\bground_truth\b/i.test(promptProbe)) {
    throw new Error("SYSTEM_ERROR: gold field name present in execution context");
  }
}

export async function runProsecutionExternalLive(
  opts: LiveExecutorOptions = {},
): Promise<ProsecutionExternalLiveRunReport> {
  const argv = opts.argv ?? process.argv;
  const env = opts.env ?? process.env;
  const dryRun =
    opts.dryRun !== undefined
      ? opts.dryRun
      : parseFlag(argv, "--dry-run") || !parseFlag(argv, "--allow-paid-model-calls");

  const hardCapUsd =
    opts.hardCapUsd ?? parseMaxCostUsd(argv) ?? opts.maxCostUsdForTests ?? DEFAULT_HARD_CAP_USD;
  const requestCap = opts.requestCap ?? parseIntFlag(argv, "--max-requests", DEFAULT_REQUEST_CAP);
  const batchSize = opts.batchSize ?? parseIntFlag(argv, "--batch-size", DEFAULT_BATCH_SIZE);
  const maxExamples =
    opts.maxExamples ?? parseIntFlag(argv, "--max-examples", Number.MAX_SAFE_INTEGER);
  const runId = opts.resumeRunId ?? LIVE_RUN_ID;
  const commercialOnly = opts.commercialOnly ?? true;

  let exitHint: LiveExitClassification | null = null;
  let authorizationBlocked = false;
  let routingBlocked = false;
  let providerFailure = false;
  let datasetUnavailable = false;
  let budgetStopped = false;

  if (!dryRun) {
    if (!opts.bypassAuthForTests) {
      try {
        assertLivePaidExecutionAuthorized({ argv, env });
      } catch {
        authorizationBlocked = true;
        exitHint = "AUTHORIZATION_REQUIRED";
      }
    }
    if (!authorizationBlocked) {
      const authorized = opts.bypassAuthForTests || isLivePaidExecutionAuthorized({ argv, env });
      if (!authorized) {
        authorizationBlocked = true;
        exitHint = "AUTHORIZATION_REQUIRED";
      }
    }
    // Soft check: hard cap must not exceed $25 for this suite.
    if (!authorizationBlocked && hardCapUsd > DEFAULT_HARD_CAP_USD + 1e-9) {
      budgetStopped = true;
      exitHint = "BUDGET_BLOCKED";
    }
  }

  if (!dryRun && !authorizationBlocked) {
    loadExternalBenchLocalEnv();
  }

  const outDir = path.join(getCacheDir(), "runs", runId);
  mkdirSync(outDir, { recursive: true });
  const progressPath = path.join(outDir, "progress.jsonl");
  const completedIds = loadCompletedIds(progressPath);
  const priorCosts = loadPersistedCosts(outDir);

  let budget: BudgetState = reconstructSpendFromPersistedCosts(
    dryRun ? Number.POSITIVE_INFINITY : hardCapUsd,
    priorCosts,
  );

  const plan =
    opts.planOverride ??
    (await buildProsecutionExternalSuitePlan({
      useFixturesOnly: opts.useFixturesOnly ?? dryRun,
      commercialOnly,
    }));

  if (plan.totalSelected === 0) {
    datasetUnavailable = true;
  }

  // Reject fixture mounts for paid commercial validation.
  if (!dryRun && !opts.useFixturesOnly && !opts.planOverride) {
    const mounts = plan.slices.map((s) => s.mountStatus);
    if (mounts.every((m) => m === "FIXTURE" || m === "MISSING")) {
      datasetUnavailable = true;
    }
  }

  type WorkItem = {
    slice: LoadedSuiteSlice;
    task: NormalizedTask;
  };
  const work: WorkItem[] = [];
  for (const slice of plan.slices) {
    if (
      commercialOnly &&
      (slice.benchmarkId === "casefacts" || slice.benchmarkId === "legal-rag-bench")
    ) {
      continue;
    }
    for (const task of slice.tasks) {
      work.push({ slice, task });
    }
  }

  const taskResults: ProsecutionExternalLiveTaskResult[] = [];
  let paidCalls = 0;
  let providerRequests = 0;
  let retries = 0;
  let fallbacks = 0;
  let substitutions = 0;
  let skippedCompleted = 0;
  let ineligibleExamples = 0;
  let criticalFailures = 0;
  let gptRequested = false;
  let executedThisRun = 0;

  const pricing = loadCurrentPricingTable();
  const estimateCost = (modelId: string, inputTokens: number, outputTokens: number) => {
    try {
      return calculateActualCostUsd({ modelId, inputTokens, outputTokens, pricingTable: pricing });
    } catch {
      return worstCaseCostForBudgetGate({
        modelId,
        estimatedInputTokens: inputTokens,
        maxOutputTokens: outputTokens,
        pricingTable: pricing,
      });
    }
  };

  const invoke =
    opts.invokeOverride ??
    ((input: NyayaPipelineInvokeInput) => invokeNyayaProsecutionPipeline(input));

  if (authorizationBlocked || datasetUnavailable || budgetStopped) {
    const report = buildReport({
      plan,
      taskResults: [],
      dryRun,
      exitClassification:
        exitHint ??
        (authorizationBlocked
          ? "AUTHORIZATION_REQUIRED"
          : datasetUnavailable
            ? "DATASET_UNAVAILABLE"
            : "BUDGET_BLOCKED"),
      paidCalls: 0,
      providerRequests: 0,
      retries: 0,
      fallbacks: 0,
      substitutions: 0,
      skippedCompleted: 0,
      ineligibleExamples: 0,
      criticalFailures: 0,
      gptRequested: false,
      hardCapUsd,
      requestCap,
      actualSpendUsd: budget.spentUsd,
    });
    writeFileSync(
      path.join(outDir, "last-live-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    return report;
  }

  for (let i = 0; i < work.length; i += batchSize) {
    if (executedThisRun >= maxExamples) break;
    const batch = work.slice(i, i + batchSize);

    for (const { slice, task } of batch) {
      if (executedThisRun >= maxExamples) break;
      if (completedIds.has(task.taskId)) {
        skippedCompleted += 1;
        continue;
      }

      const eligibility = isTaskEligible(task);
      const taskGroup = groupForTask(
        task.benchmarkId,
        task.metadata ?? null,
        slice.taskGroupDefault,
      );
      if (!eligibility.ok) {
        ineligibleExamples += 1;
        const row: ProsecutionExternalLiveTaskResult = {
          benchmark: task.benchmarkId,
          datasetVersion: SUITE_VERSION,
          jurisdiction: slice.jurisdiction,
          task: String(task.taskType ?? task.metadata?.upstreamTask ?? task.benchmarkId),
          sampleId: task.taskId,
          taskGroup,
          evalMode: "NYAYA_PIPELINE",
          citationMode: null,
          license: slice.license,
          licenseClassification: slice.licenseClassification,
          score: null,
          correct: null,
          abstained: false,
          unsupportedClaim: false,
          fabricatedAuthority: false,
          sourceGroundingFailure: false,
          failures: [eligibility.reason ?? "INELIGIBLE"],
          ineligible: true,
          ineligibleReason: eligibility.reason ?? "INELIGIBLE",
          errorClass: "DATASET_ERROR",
        };
        taskResults.push(row);
        appendFileSync(
          progressPath,
          `${JSON.stringify({ taskId: task.taskId, status: "ineligible", reason: eligibility.reason })}\n`,
        );
        completedIds.add(task.taskId);
        continue;
      }

      const riskClass = classifyProsecutionExternalRisk(task, taskGroup);
      if (riskClass === "ROUTINE") gptRequested = true;

      // Budget / request gates before any paid call.
      const worstIn = 4000;
      const worstOut = 1200;
      const gateModel = riskClass === "HIGH_STAKES_LEGAL" ? "claude-opus-5-5" : "gpt-6.1-sol";
      const worstCase = dryRun
        ? 0
        : worstCaseCostForBudgetGate({
            modelId: gateModel,
            estimatedInputTokens: worstIn,
            maxOutputTokens: worstOut,
            pricingTable: pricing,
          });

      if (!dryRun) {
        try {
          assertNextCallWithinBudget(budget, worstCase);
        } catch (err) {
          if (err instanceof BudgetLimitError) {
            budgetStopped = true;
            break;
          }
          throw err;
        }
        if (providerRequests >= requestCap) {
          budgetStopped = true;
          break;
        }
      }

      let invocation: PipelineInvocationRecord;
      try {
        invocation = await invoke({
          task,
          taskGroup,
          riskClass,
          dryRun,
          openaiApiKey: opts.openaiApiKey ?? env.OPENAI_API_KEY,
          anthropicApiKey: opts.anthropicApiKey ?? env.ANTHROPIC_API_KEY,
          xaiApiKey: opts.xaiApiKey ?? env.XAI_API_KEY,
          fetchImpl: opts.fetchImpl,
          estimateCostUsd: estimateCost,
          actualCostUsd: estimateCost,
          mockComplete: dryRun
            ? async ({ modelId }) => ({
                // Never echo gold labels; dry-run validates plumbing only.
                text: "abstain — dry-run without live provider",
                servedModel: modelId,
                provider: riskClass === "HIGH_STAKES_LEGAL" ? "anthropic" : "openai",
                inputTokens: 200,
                outputTokens: 40,
              })
            : undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ROUTING_BLOCKED")) {
          routingBlocked = true;
          criticalFailures += 1;
        } else if (msg.startsWith("PROVIDER_FAILURE") || msg.includes("LiveProviderError")) {
          providerFailure = true;
        } else if (!dryRun) {
          providerFailure = true;
        }
        const row: ProsecutionExternalLiveTaskResult = {
          benchmark: task.benchmarkId,
          datasetVersion: SUITE_VERSION,
          jurisdiction: slice.jurisdiction,
          task: String(task.taskType ?? task.metadata?.upstreamTask ?? task.benchmarkId),
          sampleId: task.taskId,
          taskGroup,
          evalMode: "NYAYA_PIPELINE",
          citationMode: null,
          license: slice.license,
          licenseClassification: slice.licenseClassification,
          score: null,
          correct: null,
          abstained: false,
          unsupportedClaim: false,
          fabricatedAuthority: false,
          sourceGroundingFailure: false,
          failures: [msg],
          errorClass: msg.includes("ROUTING") ? "SYSTEM_ERROR" : "PROVIDER_ERROR",
        };
        taskResults.push(row);
        if (routingBlocked || msg.includes("CRITICAL")) {
          criticalFailures += 1;
          break;
        }
        continue;
      }

      ensureGoldIsolated(
        task,
        buildProsecutionPipelineRequest({ task, riskClass })
          .messages.map((m) => m.content)
          .join("\n"),
      );

      if (invocation.fallback) fallbacks += 1;
      if (invocation.substitution) substitutions += 1;
      if (!dryRun) {
        providerRequests += 1;
        paidCalls += 1;
        budget = recordSpend(budget, invocation.actualCostUsd);
        const cacheKey = buildCacheKey({
          revision: SUITE_VERSION,
          taskId: task.taskId,
          contentHash: contentHashFromText(
            `${task.taskId}:${invocation.requestedApiModel}:${invocation.inputTokens}`,
          ),
          provider: invocation.provider,
          modelId: invocation.requestedApiModel,
          settingsHash: contentHashFromText(
            `${invocation.riskTier}:${invocation.routingTier}:${SUITE_VERSION}`,
          ),
          promptHashes: [contentHashFromText("prosecution-external-nyaya-pipeline-v1")],
          schemaVersion: 1,
          kind: "response",
        });
        persistPaidCallImmediately({
          runId,
          benchmarkId: task.benchmarkId,
          taskId: task.taskId,
          provider: invocation.provider,
          exactModelId: invocation.servedModel ?? invocation.requestedApiModel,
          modelConfiguration: {
            logicalModel: invocation.logicalModel,
            requestedApiModel: invocation.requestedApiModel,
            riskTier: invocation.riskTier,
            fallback: invocation.fallback,
          },
          promptVersionHash: createHash("sha256")
            .update("prosecution-external-nyaya-pipeline-v1")
            .digest("hex")
            .slice(0, 16),
          datasetRevision: SUITE_VERSION,
          inputHash: contentHashFromText(task.taskId),
          response: { text: invocation.text },
          structuredParsedResponse: null,
          usage: {
            inputTokens: invocation.inputTokens,
            outputTokens: invocation.outputTokens,
          },
          inputTokens: invocation.inputTokens,
          outputTokens: invocation.outputTokens,
          latencyMs: 0,
          providerRequestId: invocation.providerRequestId,
          timestamp: new Date().toISOString(),
          attemptNumber: 1,
          costEstimateUsd: invocation.actualCostUsd,
          completionStatus: "success",
          cacheKey,
          kind: "response",
        });
      }

      const scored = scoreTask(task, invocation.text);
      if (scored.fabricatedAuthority || scored.sourceGroundingFailure) {
        // Critical grounding: fabricated authority on prosecution path stops the run.
        if (scored.fabricatedAuthority) {
          criticalFailures += 1;
        }
      }

      const citationMode =
        task.benchmarkId === "legalcitebench"
          ? task.metadata?.citationTaskType === "CITATION_RETRIEVAL" ||
            task.metadata?.citationTaskType === "CITATION_COMPLETION"
            ? ("CLOSED_BOOK_DIAGNOSTIC" as const)
            : ("NYAYA_GROUNDED_VERIFICATION" as const)
          : null;

      const row: ProsecutionExternalLiveTaskResult = {
        benchmark: task.benchmarkId,
        datasetVersion: SUITE_VERSION,
        jurisdiction: slice.jurisdiction,
        task: String(task.taskType ?? task.metadata?.upstreamTask ?? task.benchmarkId),
        sampleId: task.taskId,
        taskGroup,
        evalMode: "NYAYA_PIPELINE",
        citationMode,
        license: slice.license,
        licenseClassification: slice.licenseClassification,
        score: scored.score,
        correct: scored.correct,
        abstained: scored.abstained,
        unsupportedClaim: scored.unsupportedClaim,
        fabricatedAuthority: scored.fabricatedAuthority,
        sourceGroundingFailure: scored.sourceGroundingFailure,
        failures: scored.failures,
        resultLabel: slice.resultLabel ?? null,
        logicalModel: invocation.logicalModel,
        requestedApiModel: invocation.requestedApiModel,
        servedModel: invocation.servedModel,
        adapterSubstitution: invocation.substitution,
        modelPinStatus: invocation.modelPin.pinStatus,
        provider: invocation.provider,
        riskTier: invocation.riskTier,
        routingTier: invocation.routingTier,
        routingReason: invocation.routingReason,
        fallback: invocation.fallback,
        fallbackReason: invocation.fallbackReason,
        estimatedCostUsd: invocation.estimatedCostUsd,
        actualCostUsd: dryRun ? 0 : invocation.actualCostUsd,
        inputTokens: invocation.inputTokens,
        outputTokens: invocation.outputTokens,
        errorClass: scored.fabricatedAuthority
          ? "MODEL_ERROR"
          : scored.correct === false
            ? "MODEL_ERROR"
            : "NONE",
      };
      taskResults.push(row);
      appendFileSync(
        progressPath,
        `${JSON.stringify({
          taskId: task.taskId,
          status: "scored",
          correct: scored.correct,
          model: invocation.servedModel,
          costUsd: dryRun ? 0 : invocation.actualCostUsd,
        })}\n`,
      );
      completedIds.add(task.taskId);
      executedThisRun += 1;

      if (scored.fabricatedAuthority) {
        // STOP on critical grounding failure after persisting evidence.
        break;
      }
    }

    opts.onBatchBoundary?.({
      runId,
      completed: completedIds.size,
      selected: work.length,
      paidCalls,
      providerRequests,
      spendUsd: budget.spentUsd,
      remainingUsd: Math.max(0, hardCapUsd - budget.spentUsd),
      retries,
      fallbacks,
      criticalFailures,
      updatedAt: new Date().toISOString(),
    });

    if (budgetStopped || routingBlocked || criticalFailures > 0 || providerFailure) {
      break;
    }
  }

  const report = buildReport({
    plan,
    taskResults,
    dryRun,
    exitClassification: classifyLiveExit({
      dryRun,
      authorizationBlocked,
      criticalFailures,
      executedExamples: taskResults.filter((t) => !t.ineligible && t.correct !== null).length,
      selectedExamples: work.length,
      budgetStopped,
      providerFailure,
      routingBlocked,
      datasetUnavailable,
    }),
    paidCalls,
    providerRequests,
    retries,
    fallbacks,
    substitutions,
    skippedCompleted,
    ineligibleExamples,
    criticalFailures,
    gptRequested,
    hardCapUsd,
    requestCap,
    actualSpendUsd: dryRun ? 0 : budget.spentUsd,
  });

  writeFileSync(path.join(outDir, "last-live-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function buildReport(input: {
  plan: ProsecutionExternalSuitePlan;
  taskResults: ProsecutionExternalLiveTaskResult[];
  dryRun: boolean;
  exitClassification: LiveExitClassification;
  paidCalls: number;
  providerRequests: number;
  retries: number;
  fallbacks: number;
  substitutions: number;
  skippedCompleted: number;
  ineligibleExamples: number;
  criticalFailures: number;
  gptRequested: boolean;
  hardCapUsd: number;
  requestCap: number;
  actualSpendUsd: number;
}): ProsecutionExternalLiveRunReport {
  const lb = input.taskResults.filter((t) => t.benchmark === "legalbench");
  const cite = input.taskResults.filter((t) => t.benchmark === "legalcitebench");
  const lbSelected =
    input.plan.slices.find((s) => s.benchmarkId === "legalbench")?.selectedCount ?? 0;
  const citeSelected =
    input.plan.slices.find((s) => s.benchmarkId === "legalcitebench")?.selectedCount ?? 0;

  const groupsMap = new Map<string, ProsecutionExternalLiveTaskResult[]>();
  for (const t of input.taskResults) {
    const key = `${t.taskGroup}::${t.jurisdiction}`;
    const list = groupsMap.get(key) ?? [];
    list.push(t);
    groupsMap.set(key, list);
  }
  const groups = [...groupsMap.entries()].map(([key, rows]) => {
    const [taskGroup, jurisdiction] = key.split("::") as [TaskGroup, string];
    const scoredRows = rows.filter((r) => r.correct !== null && !r.ineligible);
    return {
      taskGroup,
      jurisdiction,
      sampleCount: rows.length,
      scored: scoredRows.length,
      accuracy:
        scoredRows.length === 0
          ? null
          : scoredRows.filter((r) => r.correct).length / scoredRows.length,
      abstentions: rows.filter((r) => r.abstained).length,
      unsupportedClaims: rows.filter((r) => r.unsupportedClaim).length,
      fabricatedAuthority: rows.filter((r) => r.fabricatedAuthority).length,
      sourceGroundingFailures: rows.filter((r) => r.sourceGroundingFailure).length,
      resultLabel: rows.find((r) => r.resultLabel)?.resultLabel ?? null,
    };
  });

  const executed = input.taskResults.filter((t) => !t.ineligible && t.correct !== null);

  return ProsecutionExternalLiveRunReportSchema.parse({
    suiteId: SUITE_ID,
    suiteVersion: SUITE_VERSION,
    seed: DETERMINISTIC_SEED,
    evalMode: "NYAYA_PIPELINE",
    paidCalls: input.dryRun ? 0 : input.paidCalls,
    courtListener: 0,
    dryRun: input.dryRun,
    exitClassification: input.exitClassification,
    internalBenchSeparated: true,
    jurisdictionSeparated: true,
    gpt61SolLiveVerified: GPT_61_SOL_LIVE_VERIFIED,
    gpt61SolRequested: input.gptRequested,
    substitutions: input.substitutions,
    fallbacks: input.fallbacks,
    retries: input.retries,
    selectedExamples: lbSelected + citeSelected,
    executedExamples: executed.length,
    skippedCompleted: input.skippedCompleted,
    ineligibleExamples: input.ineligibleExamples,
    legalbenchSelected: lbSelected,
    legalciteSelected: citeSelected,
    legalbenchExecuted: lb.filter((t) => t.correct !== null && !t.ineligible).length,
    legalciteExecuted: cite.filter((t) => t.correct !== null && !t.ineligible).length,
    legalbenchAccuracy: accuracyOf(lb),
    legalciteAccuracy: accuracyOf(cite),
    unsupportedAnswers: input.taskResults.filter((t) => t.unsupportedClaim).length,
    fabricatedCitations: input.taskResults.filter((t) => t.fabricatedAuthority).length,
    fabricatedCases: input.taskResults.filter((t) =>
      t.failures.some((f) => /FABRICATED.*CASE|fabricated case/i.test(f)),
    ).length,
    criticalFailures: input.criticalFailures,
    actualSpendUsd: input.actualSpendUsd,
    hardCapUsd: input.hardCapUsd,
    requestCap: input.requestCap,
    providerRequests: input.dryRun ? 0 : input.providerRequests,
    selectionManifestHash: input.plan.selectionManifestHash,
    groups,
    tasks: input.taskResults,
    contaminationCaveat:
      "Public benchmarks may appear in model pretraining; independence means Nyaya did not author labels.",
    runTimestamp: new Date().toISOString(),
    notes: [
      input.dryRun
        ? "DRY_RUN: no paid provider requests."
        : "PAID mode: costs and request identities recorded per call.",
      "LegalBench and LegalCiteBench scored separately.",
      "Substituted-model outputs must not be attributed to the requested pin.",
    ],
  });
}
