/**
 * Stage-2 finalist executor: gpt-6.1-sol vs grok-4.7 by default.
 * Also supports Claude-only challenger runs (claude-opus-5-5) when frozen
 * full-config.challengerMode === "claude-only". Never dispatches Gemini.
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
import {
  isPostDispatchUnknownError,
  isRetryableLiveError,
  LiveProviderError,
} from "../providers/live-errors.js";
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
import {
  bumpTaxonomy,
  classifyErrorToTaxonomy,
  emptyFailureTaxonomy,
  type FailureTaxonomyByProvider,
} from "./failure-taxonomy.js";
import { stage2JudgeTimeoutMs, stage2ResponseTimeoutMs } from "./provider-timeouts.js";
import {
  acknowledgeUnverifiedBillingExposure,
  allowUnknownResend,
  ensureQuarantineFromPartialSummary,
  hasConsumedSingleUnknownResend,
  hasUnknownCompletionArtifact,
  isActiveUnknownQuarantine,
  isPostDispatchUnknownCode,
  persistUnknownCompletion,
  readRunUnknownQuarantine,
  recordUnknownResendAttempt,
  writeRunUnknownQuarantine,
  type UnknownCompletionRecord,
} from "./unknown-completion.js";
import {
  PROVIDER_UNKNOWN_CIRCUIT_BREAKER_THRESHOLD,
  countUnknownAttemptsForTask,
  hasTerminalProviderUnknown,
  hasTerminalSemanticRefusal,
  isProviderCircuitBroken,
  listTerminalProviderUnknowns,
  listTerminalSemanticRefusals,
  terminalizeRepeatedUnknownTask,
  terminalizeSemanticRefusal,
} from "./terminal-unknown.js";
import {
  LEGALBENCH_REV,
  PRBENCH_REV,
  RAG_REV,
  STAGE2_CLAUDE_CHALLENGER_MODEL,
  STAGE2_JUDGE_A,
  STAGE2_JUDGE_B,
  STAGE2_RESPONSE_MODELS,
  type Stage2ResponseModelId,
  type Stage2SuitePlan,
} from "./stage2-task-planner.js";

const SCHEMA_VERSION = 1;
const CLAUDE_CHALLENGER_MAX_TOKENS = 8192;

const MODEL_PROVIDER: Record<Stage2ResponseModelId, LiveProviderId> = {
  "gpt-6.1-sol": "openai",
  "grok-4.7": "xai",
  "claude-opus-5-5": "anthropic",
};

const CONTEXT_WINDOWS: Record<Stage2ResponseModelId, number> = {
  "gpt-6.1-sol": 1_050_000,
  "grok-4.7": 2_000_000,
  "claude-opus-5-5": 1_000_000,
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
  status:
    | "STAGE2_COMPLETE"
    | "STAGE2_PARTIAL"
    | "STAGE2_BUDGET_STOP"
    | "STAGE2_CHECKPOINT_STOP"
    | "STAGE2_BLOCKED"
    | "STAGE2_PAUSED_UNKNOWN_COMPLETION"
    | "STAGE2_PROVIDER_CIRCUIT_BREAKER";
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
    failureTaxonomyByProvider: FailureTaxonomyByProvider;
    gptResponsesDone: number;
    grokResponsesDone: number;
    claudeResponsesDone: number;
    judgeADone: number;
    judgeBDone: number;
    unknownQuarantines: number;
    terminalProviderFailures: number;
    sessionDistinctUnknownTasks: number;
    providerCircuitBreakerTripped: boolean;
    knownLedgerSpendUsd: number;
    unverifiedProviderBillingExposure: "YES" | "NO" | "UNKNOWN";
    responseSpendUsd: number;
    judgeSpendUsd: number;
    retriesUsd: number;
    totalSpendUsd: number;
    remainingBudgetUsd: number;
    lastProviderActivity: string | null;
    updatedAt: string;
  };
  cost: {
    authorizedUsd: number;
    openaiResponsesUsd: number;
    xaiResponsesUsd: number;
    anthropicResponsesUsd: number;
    anthropicJudgeUsd: number;
    openaiJudgeUsd: number;
    retriesUsd: number;
    totalUsd: number;
    remainingUsd: number;
    knownLedgerSpendUsd: number;
    unverifiedProviderBillingExposure: "YES" | "NO" | "UNKNOWN";
  };
  stage3Started: false;
  courtListener: 0;
  valuesPrinted: false;
  note?: string;
};

export class Stage2UnknownCompletionStopError extends Error {
  readonly code = "STAGE2_PAUSED_UNKNOWN_COMPLETION" as const;
  readonly provider: string;
  constructor(provider: string, message: string) {
    super(message);
    this.name = "Stage2UnknownCompletionStopError";
    this.provider = provider;
  }
}

export class Stage2ProviderCircuitBreakerError extends Error {
  readonly code = "STAGE2_PROVIDER_CIRCUIT_BREAKER" as const;
  readonly provider: string;
  constructor(provider: string, message: string) {
    super(message);
    this.name = "Stage2ProviderCircuitBreakerError";
    this.provider = provider;
  }
}

/** Half-run / operator checkpoint: stop paid work without invalidating cache. */
export class Stage2CheckpointStopError extends Error {
  readonly code = "STAGE2_CHECKPOINT_STOP" as const;
  constructor(message: string) {
    super(message);
    this.name = "Stage2CheckpointStopError";
  }
}

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

/** Optional hard stop on total Claude response outcomes (cache + paid). */
export function parseMaxClaudeResponses(argv: readonly string[]): number | null {
  const raw = parseArgValue(argv, "--max-claude-responses");
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid --max-claude-responses: ${raw}`);
  }
  return n;
}

/** Optional this-process paid spend subcap (does not replace --max-cost-usd). */
export function parseSessionMaxSpendUsd(argv: readonly string[]): number | null {
  const raw = parseArgValue(argv, "--session-max-spend-usd");
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid --session-max-spend-usd: ${raw}`);
  }
  return n;
}

/** Optional hard stop on PRBench-only Claude successes (excludes LegalBench). */
export function parseMaxPrbenchResponses(argv: readonly string[]): number | null {
  const raw = parseArgValue(argv, "--max-prbench-responses");
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid --max-prbench-responses: ${raw}`);
  }
  return n;
}

/** When set, refuse paid LegalBench dispatch (cache hits still accounted). */
export function parseStopAfterPrbench(argv: readonly string[]): boolean {
  return argv.includes("--stop-after-prbench");
}

/**
 * Optional exact task-ID allowlist for paid response dispatch.
 * Base task IDs only (no `::model` suffix). Comma-separated via --task-allowlist.
 */
export function parseTaskAllowlist(argv: readonly string[]): Set<string> | null {
  const raw = parseArgValue(argv, "--task-allowlist");
  if (raw === null) return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) {
    throw new Error("Invalid --task-allowlist: empty");
  }
  return new Set(ids);
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
  if (modelId === STAGE2_CLAUDE_CHALLENGER_MODEL) {
    return {
      thinking: { type: "adaptive" },
      effort: "high",
      max_tokens: CLAUDE_CHALLENGER_MAX_TOKENS,
    };
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
      if (isPostDispatchUnknownError(err)) {
        const live = err as LiveProviderError;
        const classification =
          live.code === "TIMEOUT_POST_DISPATCH_UNKNOWN" ||
          live.code === "TRANSPORT_POST_DISPATCH_UNKNOWN" ||
          live.code === "UNKNOWN_COMPLETION"
            ? live.code
            : "UNKNOWN_COMPLETION";
        throw new UnknownCompletionError(`${live.code}: ${live.message}`, {
          failureClassification: classification,
          providerCode: live.code,
        });
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
  const challengerMode = fullConfig.challengerMode === "claude-only";
  // Google must not be used in Stage 2 even if present.
  const credentialsOk = challengerMode
    ? Boolean(openaiKey && anthropicKey) // Judge B + Claude response / Judge A
    : Boolean(openaiKey && anthropicKey && xaiKey);
  if (!credentialsOk) {
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
        failureTaxonomyByProvider: {},
        gptResponsesDone: 0,
        grokResponsesDone: 0,
        claudeResponsesDone: 0,
        judgeADone: 0,
        judgeBDone: 0,
        unknownQuarantines: 0,
        terminalProviderFailures: 0,
        sessionDistinctUnknownTasks: 0,
        providerCircuitBreakerTripped: false,
        knownLedgerSpendUsd: 0,
        unverifiedProviderBillingExposure: "NO",
        responseSpendUsd: 0,
        judgeSpendUsd: 0,
        retriesUsd: 0,
        totalSpendUsd: 0,
        remainingBudgetUsd: maxCostUsd,
        lastProviderActivity: null,
        updatedAt: new Date().toISOString(),
      },
      cost: {
        authorizedUsd: maxCostUsd,
        openaiResponsesUsd: 0,
        xaiResponsesUsd: 0,
        anthropicResponsesUsd: 0,
        anthropicJudgeUsd: 0,
        openaiJudgeUsd: 0,
        retriesUsd: 0,
        totalUsd: 0,
        remainingUsd: maxCostUsd,
        knownLedgerSpendUsd: 0,
        unverifiedProviderBillingExposure: "NO",
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

  const models =
    deps.responseModels ??
    (challengerMode ? ([STAGE2_CLAUDE_CHALLENGER_MODEL] as const) : STAGE2_RESPONSE_MODELS);
  for (const m of models) {
    if (challengerMode) {
      if (m !== STAGE2_CLAUDE_CHALLENGER_MODEL) {
        throw new Error(`Claude challenger forbids response model ${m}`);
      }
    } else if (m !== "gpt-6.1-sol" && m !== "grok-4.7") {
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
  // Finalists: registry/stage2-budget.json ($55). Claude challenger: $95 authorized cap.
  const providerCaps: ProviderCapsConfig = challengerMode
    ? {
        ...parsedCaps,
        openai: { maxDollars: parsedCaps.openai?.maxDollars ?? 20 },
        anthropic: { maxDollars: parsedCaps.anthropic?.maxDollars ?? 85 },
        google: { maxDollars: 0 },
        xai: { maxDollars: 0 },
        maxJudgeDollars: parsedCaps.maxJudgeDollars ?? 25,
      }
    : {
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
    anthropicResponsesUsd: 0,
    anthropicJudgeUsd: 0,
    openaiJudgeUsd: 0,
  };
  const failuresByProvider: Record<string, number> = {};
  const failureTaxonomyByProvider: FailureTaxonomyByProvider = {
    openai: emptyFailureTaxonomy(),
    xai: emptyFailureTaxonomy(),
    anthropic: emptyFailureTaxonomy(),
  };
  let gptResponsesDone = 0;
  let grokResponsesDone = 0;
  let claudeResponsesDone = 0;
  let judgeADone = 0;
  let judgeBDone = 0;
  let unknownQuarantines = 0;
  let terminalProviderFailures = listTerminalProviderUnknowns(runId).length;
  let lastProviderActivity: string | null = null;
  let unverifiedProviderBillingExposure: "YES" | "NO" | "UNKNOWN" = "NO";
  const quarantinedProviders = new Set<string>();
  /** Distinct taskIds that produced NEW unknown/terminal events in this process. */
  const sessionDistinctUnknownByProvider = new Map<string, Set<string>>();
  let providerCircuitBreakerTripped = false;
  const accountedTerminalKeys = new Set<string>(
    listTerminalProviderUnknowns(runId).map((t) => `${t.provider}::${t.taskId}`),
  );
  let runStatus: Stage2RunSummary["status"] = "STAGE2_COMPLETE";
  let note: string | undefined;
  const allowResendUnknown = allowUnknownResend(argv);
  const ackUnverified = acknowledgeUnverifiedBillingExposure(argv);
  const maxClaudeResponses = parseMaxClaudeResponses(argv);
  const maxPrbenchResponses = parseMaxPrbenchResponses(argv);
  const stopAfterPrbench = parseStopAfterPrbench(argv);
  const taskAllowlist = parseTaskAllowlist(argv);
  const sessionMaxSpendUsd = parseSessionMaxSpendUsd(argv);
  /** Paid dollars dispatched in this process only (excludes cache reconstruction). */
  let sessionPaidSpendUsd = 0;
  /** Claude successes on PRBench only (LegalBench excluded). */
  let prbenchClaudeResponsesDone = 0;
  /** PRBench semantic-refusal terminals accounted this process. */
  let prbenchSemanticTerminalsDone = 0;
  const accountedSemanticTerminalKeys = new Set<string>(
    listTerminalSemanticRefusals(runId).map((t) => `${t.provider}::${t.taskId}`),
  );
  prbenchSemanticTerminalsDone = listTerminalSemanticRefusals(runId).filter(
    (t) => t.benchmarkId === "prbench",
  ).length;

  // Prior post-dispatch cascade → durable run quarantine (no paid calls).
  const seededQuarantine = ensureQuarantineFromPartialSummary(runId);
  const existingQuarantine = seededQuarantine ?? readRunUnknownQuarantine(runId);
  if (existingQuarantine) {
    unverifiedProviderBillingExposure = "YES";
    // Only an active QUARANTINED marker blocks; cleared/terminalized quarantines do not.
    if (isActiveUnknownQuarantine(existingQuarantine)) {
      for (const p of existingQuarantine.providers) quarantinedProviders.add(p);
      unknownQuarantines = Math.max(unknownQuarantines, existingQuarantine.providers.length);
    }
  }

  const sessionUnknownCount = (): number => {
    let n = 0;
    for (const set of sessionDistinctUnknownByProvider.values()) n += set.size;
    return n;
  };

  const noteSessionUnknown = (provider: string, taskId: string) => {
    if (!sessionDistinctUnknownByProvider.has(provider)) {
      sessionDistinctUnknownByProvider.set(provider, new Set());
    }
    sessionDistinctUnknownByProvider.get(provider)!.add(taskId);
  };

  const systemPrompt =
    "You are NyayaGrid external-bench Stage-2. Produce a careful legal analysis response.";
  // Balanced hard-stop is serial-only: concurrency>1 would let the other finalist continue after AUTH_ERROR.
  const requestedConcurrency = parseConcurrency(argv, 1);
  void requestedConcurrency;
  const batchSize = resolveBatchSize(argv, 5);
  const accountedResponseKeys = new Set<string>();
  const accountedJudgeKeys = new Set<string>();
  let paidCallsSinceCheckpoint = 0;
  let batchStartedAt = Date.now();

  const bumpFailure = (provider: string, err?: unknown) => {
    failuresByProvider[provider] = (failuresByProvider[provider] ?? 0) + 1;
    bumpTaxonomy(failureTaxonomyByProvider, provider, classifyErrorToTaxonomy(err));
  };

  const assertClaudeResponseCheckpointAllowsDispatch = (
    modelId: Stage2ResponseModelId,
    benchmarkId: "prbench" | "legalbench",
  ): void => {
    if (
      modelId === STAGE2_CLAUDE_CHALLENGER_MODEL &&
      stopAfterPrbench &&
      benchmarkId === "legalbench"
    ) {
      runStatus = "STAGE2_CHECKPOINT_STOP";
      note = `CLAUDE_PRBENCH_BOUNDARY: refusing LegalBench paid dispatch (prbenchClaude=${prbenchClaudeResponsesDone})`;
      throw new Stage2CheckpointStopError(note);
    }
    if (
      maxPrbenchResponses !== null &&
      modelId === STAGE2_CLAUDE_CHALLENGER_MODEL &&
      benchmarkId === "prbench" &&
      prbenchClaudeResponsesDone >= maxPrbenchResponses
    ) {
      runStatus = "STAGE2_CHECKPOINT_STOP";
      note = `CLAUDE_PRBENCH_CHECKPOINT: prbenchClaude=${prbenchClaudeResponsesDone} max=${maxPrbenchResponses}; refusing further PRBench Claude dispatch`;
      throw new Stage2CheckpointStopError(note);
    }
    if (maxClaudeResponses === null) return;
    if (modelId !== STAGE2_CLAUDE_CHALLENGER_MODEL) return;
    if (claudeResponsesDone < maxClaudeResponses) return;
    runStatus = "STAGE2_CHECKPOINT_STOP";
    note = `CLAUDE_HALF_RUN_CHECKPOINT: claudeResponsesDone=${claudeResponsesDone} max=${maxClaudeResponses}; refusing response ${claudeResponsesDone + 1}`;
    throw new Stage2CheckpointStopError(note);
  };

  const assertSessionSpendAllows = (worstCaseUsd: number): void => {
    if (sessionMaxSpendUsd === null) return;
    if (sessionPaidSpendUsd + worstCaseUsd <= sessionMaxSpendUsd + 1e-9) return;
    runStatus = "STAGE2_CHECKPOINT_STOP";
    note = `CLAUDE_HALF_RUN_COST_STOP: sessionSpend=$${sessionPaidSpendUsd.toFixed(4)} worstNext=$${worstCaseUsd.toFixed(4)} cap=$${sessionMaxSpendUsd}`;
    throw new Stage2CheckpointStopError(note);
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
      failureTaxonomyByProvider: structuredClone(failureTaxonomyByProvider),
      gptResponsesDone,
      grokResponsesDone,
      claudeResponsesDone,
      judgeADone,
      judgeBDone,
      unknownQuarantines,
      terminalProviderFailures,
      sessionDistinctUnknownTasks: sessionUnknownCount(),
      providerCircuitBreakerTripped,
      knownLedgerSpendUsd: budget.spentUsd,
      unverifiedProviderBillingExposure,
      responseSpendUsd,
      judgeSpendUsd,
      retriesUsd,
      totalSpendUsd: budget.spentUsd,
      remainingBudgetUsd: remainingBudgetUsd(budget),
      lastProviderActivity,
      updatedAt: new Date().toISOString(),
    });
  };

  async function callResponseModel(
    modelId: Stage2ResponseModelId,
    prompt: string,
  ): Promise<LiveProviderResult> {
    const provider = MODEL_PROVIDER[modelId];
    const timeoutProvider =
      provider === "xai" ? "xai" : provider === "anthropic" ? "anthropic" : "openai";
    const clientOpts = {
      fetchImpl: deps.fetchImpl,
      timeoutMs: stage2ResponseTimeoutMs(timeoutProvider),
    };
    lastProviderActivity = `${provider}:${modelId}`;
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
    if (modelId === STAGE2_CLAUDE_CHALLENGER_MODEL) {
      const result = await executeAnthropicMessages(
        { ...clientOpts, apiKey: anthropicKey! },
        {
          model: "claude-opus-5-5",
          effort: "high",
          maxTokens: CLAUDE_CHALLENGER_MAX_TOKENS,
          messages: [{ role: "user", content: `${systemPrompt}\n\n${prompt}` }],
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

  function bumpModelDone(
    modelId: Stage2ResponseModelId,
    benchmarkId?: "prbench" | "legalbench",
  ): void {
    if (modelId === "gpt-6.1-sol") gptResponsesDone += 1;
    if (modelId === "grok-4.7") grokResponsesDone += 1;
    if (modelId === STAGE2_CLAUDE_CHALLENGER_MODEL) {
      claudeResponsesDone += 1;
      if (benchmarkId === "prbench") prbenchClaudeResponsesDone += 1;
    }
  }

  function recordResponseCost(provider: LiveProviderId, dollars: number): void {
    if (provider === "openai") costByBucket.openaiResponsesUsd += dollars;
    if (provider === "xai") costByBucket.xaiResponsesUsd += dollars;
    if (provider === "anthropic") costByBucket.anthropicResponsesUsd += dollars;
  }

  function accountTerminalFailure(input: {
    provider: string;
    modelId: string;
    taskId: string;
    benchmarkId: string;
    cacheKeyHint?: string;
    /** When false, do not count toward this-session circuit breaker (historical reconcile). */
    countTowardSessionCircuitBreaker?: boolean;
  }): void {
    const key = `${input.provider}::${input.taskId}`;
    const already = hasTerminalProviderUnknown(runId, input.taskId, input.provider);
    terminalizeRepeatedUnknownTask({
      runId,
      taskId: input.taskId,
      benchmarkId: input.benchmarkId,
      provider: input.provider,
      exactModelId: input.modelId,
      cacheKeyHint: input.cacheKeyHint,
    });
    const countSession = input.countTowardSessionCircuitBreaker !== false;
    if (countSession) {
      noteSessionUnknown(input.provider, input.taskId);
    }
    unverifiedProviderBillingExposure = "YES";
    // Task terminalization clears provider-wide quarantine so other work continues.
    quarantinedProviders.delete(input.provider);
    quarantinedProviders.delete("openai");
    quarantinedProviders.delete("xai");
    quarantinedProviders.delete("anthropic");
    if (!accountedTerminalKeys.has(key)) {
      accountedTerminalKeys.add(key);
      terminalProviderFailures = listTerminalProviderUnknowns(runId).length;
      bumpTaxonomy(failureTaxonomyByProvider, input.provider, "terminal_provider_unknown");
      failuresByProvider[input.provider] = (failuresByProvider[input.provider] ?? 0) + 1;
    } else if (!already) {
      terminalProviderFailures = listTerminalProviderUnknowns(runId).length;
    }
    if (!countSession) return;
    const providerSession = sessionDistinctUnknownByProvider.get(input.provider) ?? new Set();
    if (isProviderCircuitBroken(providerSession)) {
      providerCircuitBreakerTripped = true;
      quarantinedProviders.add(input.provider);
      if (!challengerMode) {
        quarantinedProviders.add("openai");
        quarantinedProviders.add("xai");
      }
      runStatus = "STAGE2_PROVIDER_CIRCUIT_BREAKER";
      note = `STAGE2_PROVIDER_CIRCUIT_BREAKER: ${input.provider} hit ${PROVIDER_UNKNOWN_CIRCUIT_BREAKER_THRESHOLD} distinct UNKNOWN/terminal tasks this session`;
      throw new Stage2ProviderCircuitBreakerError(input.provider, note);
    }
  }

  /**
   * Persist UNKNOWN. First uncertain attempt may pause for operator (unless
   * --allow-unknown-resend). Second uncertain attempt terminalizes the task and
   * continues Stage-2. Never converts UNKNOWN into success.
   * @returns "paused" | "terminal" | "retry_authorized"
   */
  function handleUnknownCompletion(input: {
    provider: string;
    modelId: string;
    taskId: string;
    benchmarkId: string;
    attemptNumber: number;
    requestStartTimestamp: string;
    err: unknown;
    cacheKeyHint?: string;
  }): "paused" | "terminal" | "retry_authorized" {
    const live = input.err instanceof LiveProviderError ? input.err : null;
    const unknownErr = input.err instanceof UnknownCompletionError ? input.err : null;
    const classification: UnknownCompletionRecord["failureClassification"] =
      unknownErr?.failureClassification ??
      (live && isPostDispatchUnknownCode(live.code)
        ? (live.code as UnknownCompletionRecord["failureClassification"])
        : "UNKNOWN_COMPLETION");
    const message = input.err instanceof Error ? input.err.message : String(input.err);
    persistUnknownCompletion({
      kind: "UNKNOWN_COMPLETION",
      runId,
      taskId: input.taskId,
      benchmarkId: input.benchmarkId,
      provider: input.provider,
      exactModelId: input.modelId,
      attemptNumber: input.attemptNumber,
      requestStartTimestamp: input.requestStartTimestamp,
      dispatchTimestamp: input.requestStartTimestamp,
      failureTimestamp: new Date().toISOString(),
      failureClassification: classification,
      providerRequestId: null,
      sanitizedErrorMessage: message.replace(/\s+/g, " ").slice(0, 500),
      usageReceived: false,
      responseBodyReceived: false,
      safelyRetryable: false,
      potentialBillingExposure: "YES",
      resendBlocked: true,
      operatorOverrideRequired: true,
      cacheKeyHint: input.cacheKeyHint,
    });
    noteSessionUnknown(input.provider, input.taskId);
    unverifiedProviderBillingExposure = "YES";
    bumpTaxonomy(failureTaxonomyByProvider, input.provider, classifyErrorToTaxonomy(input.err));
    failuresByProvider[input.provider] = (failuresByProvider[input.provider] ?? 0) + 1;

    const attemptCount = countUnknownAttemptsForTask(runId, input.taskId, input.provider);
    const resendAlreadyConsumed = hasConsumedSingleUnknownResend(
      runId,
      input.taskId,
      input.provider,
    );
    // Second uncertain outcome → terminalize task and continue (no run-wide forever pause).
    if (attemptCount >= 2 || resendAlreadyConsumed) {
      accountTerminalFailure({
        provider: input.provider,
        modelId: input.modelId,
        taskId: input.taskId,
        benchmarkId: input.benchmarkId,
        cacheKeyHint: input.cacheKeyHint,
      });
      if (runStatus === "STAGE2_COMPLETE" || runStatus === "STAGE2_PARTIAL") {
        runStatus = "STAGE2_PARTIAL";
        note =
          note ??
          `TERMINAL_PROVIDER_UNKNOWN: ${input.taskId} after ${attemptCount} uncertain attempts; continuing`;
      }
      return "terminal";
    }

    // First UNKNOWN: durable task quarantine; one authorized resend may follow.
    const quarantineProviders = challengerMode
      ? [...quarantinedProviders, input.provider]
      : [...quarantinedProviders, input.provider, "openai", "xai"];
    writeRunUnknownQuarantine({
      runId,
      reason: message,
      providers: quarantineProviders,
    });
    unknownQuarantines += 1;
    if (allowResendUnknown) {
      recordUnknownResendAttempt({
        runId,
        taskId: input.taskId,
        provider: input.provider,
      });
      return "retry_authorized";
    }
    quarantinedProviders.add(input.provider);
    if (!challengerMode) {
      quarantinedProviders.add("openai");
      quarantinedProviders.add("xai");
    }
    runStatus = "STAGE2_PAUSED_UNKNOWN_COMPLETION";
    note = `STAGE2_PAUSED_UNKNOWN_COMPLETION: ${input.provider}: ${message}`;
    throw new Stage2UnknownCompletionStopError(input.provider, note);
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
    const compositeTaskId = `${task.taskId}::${modelId}`;
    const license = assertCommercialEvalAllowed(task, "production-selection");
    if (!license.allowed) {
      bumpFailure(provider);
      return;
    }

    // Terminal provider-unknown tasks are coverage outcomes, never resent.
    if (hasTerminalProviderUnknown(runId, compositeTaskId, provider)) {
      const key = `${provider}::${compositeTaskId}`;
      if (!accountedTerminalKeys.has(key)) {
        accountedTerminalKeys.add(key);
        terminalProviderFailures = listTerminalProviderUnknowns(runId).length;
        bumpTaxonomy(failureTaxonomyByProvider, provider, "terminal_provider_unknown");
      }
      unverifiedProviderBillingExposure = "YES";
      return;
    }

    // Terminal semantic refusals are coverage outcomes, never resent.
    if (hasTerminalSemanticRefusal(runId, compositeTaskId, provider)) {
      const key = `${provider}::${compositeTaskId}`;
      if (!accountedSemanticTerminalKeys.has(key)) {
        accountedSemanticTerminalKeys.add(key);
        if (benchmarkId === "prbench") prbenchSemanticTerminalsDone += 1;
        bumpTaxonomy(failureTaxonomyByProvider, provider, "semantic_refusal");
      }
      return;
    }

    const userPrompt = buildUserPrompt(task);
    const settings = responseSettings(modelId);
    const settingsHash = hashObj(settings);
    const promptHashes = [contentHashFromText(systemPrompt), contentHashFromText(userPrompt)];
    const contentHash = contentHashFromText(userPrompt);
    const responseKey = buildCacheKey({
      revision: benchmarkId === "prbench" ? PRBENCH_REV : LEGALBENCH_REV,
      taskId: compositeTaskId,
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
        const cachedUsage = (cached.usage ?? {}) as {
          thinkingTokens?: number;
          cachedInputTokens?: number;
        };
        const responseCost = costUsdFromPersistedUsage({
          modelId,
          inputTokens: cached.inputTokens,
          outputTokens: cached.outputTokens,
          thinkingTokens: cachedUsage.thinkingTokens,
          cachedInputTokens: cachedUsage.cachedInputTokens,
          fallbackCostUsd: cached.costEstimateUsd,
          bucket: "models",
          pricingTable: pricing,
        });
        budget = applyPersistedSpend(budget, responseCost);
        responseSpendUsd += responseCost;
        recordResponseCost(provider, responseCost);
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
        bumpModelDone(modelId, benchmarkId);
        bumpTaxonomy(failureTaxonomyByProvider, provider, "successful");
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
      // Paid allowlist: only exact base task IDs may dispatch (gap closure).
      if (taskAllowlist && !taskAllowlist.has(task.taskId)) {
        return;
      }
      assertClaudeResponseCheckpointAllowsDispatch(modelId, benchmarkId);
      if (hasUnknownCompletionArtifact(runId, compositeTaskId, provider)) {
        // Quarantined UNKNOWN task — never silently convert to MISSING / auto-resend.
        unverifiedProviderBillingExposure = "YES";
        const attempts = countUnknownAttemptsForTask(runId, compositeTaskId, provider);
        const resendConsumed = hasConsumedSingleUnknownResend(runId, compositeTaskId, provider);
        // Second uncertain attempt already used → terminalize and continue (no third send).
        if (attempts >= 2 || resendConsumed) {
          accountTerminalFailure({
            provider,
            modelId,
            taskId: compositeTaskId,
            benchmarkId,
            cacheKeyHint: responseKey,
          });
          if (runStatus === "STAGE2_COMPLETE") runStatus = "STAGE2_PARTIAL";
          note =
            note ??
            `TERMINAL_PROVIDER_UNKNOWN: ${compositeTaskId}; continuing without further resend`;
          return;
        }
        if (!allowResendUnknown) {
          runStatus = "STAGE2_PAUSED_UNKNOWN_COMPLETION";
          note =
            note ?? `STAGE2_PAUSED_UNKNOWN_COMPLETION: blocked auto-resend for ${compositeTaskId}`;
          return;
        }
        // Operator --allow-unknown-resend authorizes exactly one paid attempt per UNKNOWN task.
        recordUnknownResendAttempt({
          runId,
          taskId: compositeTaskId,
          provider,
        });
      } else if (!allowResendUnknown && quarantinedProviders.has(provider)) {
        unverifiedProviderBillingExposure = "YES";
        runStatus = "STAGE2_PAUSED_UNKNOWN_COMPLETION";
        note = note ?? `STAGE2_PAUSED_UNKNOWN_COMPLETION: provider ${provider} quarantined`;
        return;
      }

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
        assertSessionSpendAllows(worst);
      } catch (err) {
        if (err instanceof Stage2CheckpointStopError) throw err;
        if (err instanceof BudgetLimitError) {
          runStatus = "STAGE2_BUDGET_STOP";
          note = err.message;
          throw err;
        }
        bumpFailure(provider);
        return;
      }

      const requestStartTimestamp = new Date().toISOString();
      try {
        responseResult = await withRetries(() => callResponseModel(modelId, userPrompt), sleep);
        paidCalls += 1;
        paidCallsSinceCheckpoint += 1;
        const actual = calculateActualCostUsd({
          modelId,
          inputTokens: responseResult.usage.inputTokens,
          outputTokens: responseResult.usage.outputTokens,
          thinkingTokens: responseResult.usage.thinkingTokens,
          cachedInputTokens: responseResult.usage.cachedInputTokens,
          bucket: "models",
          pricingTable: pricing,
        });
        sessionPaidSpendUsd += actual;
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
        recordResponseCost(provider, actual);
        responseText = responseResult.text;
        persistPaidCallImmediately({
          runId,
          benchmarkId,
          taskId: compositeTaskId,
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
        bumpModelDone(modelId, benchmarkId);
        bumpTaxonomy(failureTaxonomyByProvider, provider, "successful");
      } catch (err) {
        if (err instanceof Stage2CheckpointStopError) throw err;
        if (err instanceof BudgetLimitError) {
          bumpFailure(provider, err);
          runStatus = "STAGE2_BUDGET_STOP";
          note = err.message;
          throw err;
        }
        if (err instanceof Stage2ProviderCircuitBreakerError) throw err;
        if (err instanceof Stage2UnknownCompletionStopError) throw err;
        if (err instanceof UnknownCompletionError || isPostDispatchUnknownError(err)) {
          const disposition = handleUnknownCompletion({
            provider,
            modelId,
            taskId: compositeTaskId,
            benchmarkId,
            attemptNumber: 1,
            requestStartTimestamp,
            err,
            cacheKeyHint: responseKey,
          });
          if (disposition === "terminal") {
            return;
          }
          if (disposition === "retry_authorized") {
            // Exactly one same-run uncertain retry under operator flags.
            const retryStart = new Date().toISOString();
            try {
              assertNextCallWithinBudget(budget, worst);
              assertWithinProviderCaps({
                provider: providerCapKey(provider),
                caps: providerCaps,
                spend: providerSpend[providerCapKey(provider)],
                nextDollarsWorstCase: worst,
              });
              assertSessionSpendAllows(worst);
              responseResult = await withRetries(
                () => callResponseModel(modelId, userPrompt),
                sleep,
              );
              paidCalls += 1;
              paidCallsSinceCheckpoint += 1;
              const actual = calculateActualCostUsd({
                modelId,
                inputTokens: responseResult.usage.inputTokens,
                outputTokens: responseResult.usage.outputTokens,
                thinkingTokens: responseResult.usage.thinkingTokens,
                cachedInputTokens: responseResult.usage.cachedInputTokens,
                bucket: "models",
                pricingTable: pricing,
              });
              sessionPaidSpendUsd += actual;
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
              recordResponseCost(provider, actual);
              responseText = responseResult.text;
              persistPaidCallImmediately({
                runId,
                benchmarkId,
                taskId: compositeTaskId,
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
                attemptNumber: 2,
                costEstimateUsd: actual,
                completionStatus: "success",
                cacheKey: responseKey,
                kind: "response",
              });
              accountedResponseKeys.add(responseKey);
              completedResponses += 1;
              bumpModelDone(modelId, benchmarkId);
              bumpTaxonomy(failureTaxonomyByProvider, provider, "successful");
            } catch (retryErr) {
              if (retryErr instanceof Stage2CheckpointStopError) throw retryErr;
              if (retryErr instanceof BudgetLimitError) {
                runStatus = "STAGE2_BUDGET_STOP";
                note = retryErr.message;
                throw retryErr;
              }
              if (retryErr instanceof Stage2ProviderCircuitBreakerError) throw retryErr;
              if (
                retryErr instanceof UnknownCompletionError ||
                isPostDispatchUnknownError(retryErr)
              ) {
                handleUnknownCompletion({
                  provider,
                  modelId,
                  taskId: compositeTaskId,
                  benchmarkId,
                  attemptNumber: 2,
                  requestStartTimestamp: retryStart,
                  err: retryErr,
                  cacheKeyHint: responseKey,
                });
                return;
              }
              bumpFailure(provider, retryErr);
              if (retryErr instanceof LiveProviderError && retryErr.code === "AUTH_ERROR") {
                runStatus = "STAGE2_BLOCKED";
                note =
                  provider === "openai"
                    ? `STAGE2_BLOCKED_OPENAI_BILLING: ${retryErr.message}`
                    : `STAGE2_BLOCKED_PROVIDER_ACCESS: ${retryErr.message}`;
                throw retryErr;
              }
              if (
                (stopAfterPrbench || taskAllowlist) &&
                retryErr instanceof LiveProviderError &&
                retryErr.code === "CONTENT_FILTER_OR_REFUSAL"
              ) {
                const key = `${provider}::${compositeTaskId}`;
                terminalizeSemanticRefusal({
                  runId,
                  taskId: compositeTaskId,
                  benchmarkId,
                  provider,
                  exactModelId: modelId,
                  cacheKeyHint: responseKey,
                  sanitizedErrorMessage: retryErr.message,
                });
                if (!accountedSemanticTerminalKeys.has(key)) {
                  accountedSemanticTerminalKeys.add(key);
                  if (benchmarkId === "prbench") prbenchSemanticTerminalsDone += 1;
                }
                if (runStatus === "STAGE2_COMPLETE") runStatus = "STAGE2_PARTIAL";
                note =
                  note ??
                  `TERMINAL_SEMANTIC_REFUSAL: ${compositeTaskId}; continuing without further resend`;
                return;
              }
              runStatus = "STAGE2_PARTIAL";
              note = retryErr instanceof Error ? retryErr.message : String(retryErr);
              return;
            }
            // Successful retry falls through to judges below.
          } else {
            return;
          }
        } else {
          bumpFailure(provider, err);
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
          // Gap-closure / PRBench-boundary mode: persist semantic refusal as terminal coverage.
          if (
            (stopAfterPrbench || taskAllowlist) &&
            err instanceof LiveProviderError &&
            err.code === "CONTENT_FILTER_OR_REFUSAL"
          ) {
            const key = `${provider}::${compositeTaskId}`;
            terminalizeSemanticRefusal({
              runId,
              taskId: compositeTaskId,
              benchmarkId,
              provider,
              exactModelId: modelId,
              cacheKeyHint: responseKey,
              sanitizedErrorMessage: err.message,
            });
            if (!accountedSemanticTerminalKeys.has(key)) {
              accountedSemanticTerminalKeys.add(key);
              if (benchmarkId === "prbench") prbenchSemanticTerminalsDone += 1;
            }
            if (runStatus === "STAGE2_COMPLETE") runStatus = "STAGE2_PARTIAL";
            note =
              note ??
              `TERMINAL_SEMANTIC_REFUSAL: ${compositeTaskId}; continuing without further resend`;
            return;
          }
          runStatus = "STAGE2_PARTIAL";
          note = err instanceof Error ? err.message : String(err);
          return;
        }
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
          if (label === "A") judgeADone += 1;
          else judgeBDone += 1;
        }
        return;
      }

      if (cacheOnly) return;
      // Prefer STOP over new judge spend after finalist UNKNOWN quarantine.
      if (runStatus === "STAGE2_PAUSED_UNKNOWN_COMPLETION" || quarantinedProviders.size > 0) {
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
      assertSessionSpendAllows(worst);

      lastProviderActivity = `${judgeProvider}:${judgeModel}`;
      const result = await withRetries(async () => {
        if (label === "A") {
          return executeAnthropicMessages(
            {
              apiKey: anthropicKey!,
              fetchImpl: deps.fetchImpl,
              timeoutMs: stage2JudgeTimeoutMs("anthropic"),
            },
            {
              model: STAGE2_JUDGE_A,
              effort: "medium",
              maxTokens: 2048,
              messages: [{ role: "user", content: judgePrompt }],
            },
          );
        }
        return executeOpenAiResponses(
          {
            apiKey: openaiKey!,
            fetchImpl: deps.fetchImpl,
            timeoutMs: stage2JudgeTimeoutMs("openai"),
          },
          {
            model: STAGE2_JUDGE_B,
            effort: "medium",
            maxOutputTokens: 2048,
            input: [{ role: "user", content: judgePrompt }],
          },
        );
      }, sleep);
      paidCalls += 1;
      paidCallsSinceCheckpoint += 1;
      const score = parseJudgeScore(result.text);
      const actual = calculateActualCostUsd({
        modelId: judgeModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        bucket: "judgeModels",
        pricingTable: pricing,
      });
      sessionPaidSpendUsd += actual;
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
      if (label === "A") judgeADone += 1;
      else judgeBDone += 1;
    }

    try {
      await runJudge("A");
    } catch (err) {
      if (err instanceof Stage2CheckpointStopError) throw err;
      if (err instanceof UnknownCompletionError || isPostDispatchUnknownError(err)) {
        handleUnknownCompletion({
          provider: "anthropic",
          modelId: STAGE2_JUDGE_A,
          taskId: `${task.taskId}::${modelId}::judge_A`,
          benchmarkId: "prbench",
          attemptNumber: 1,
          requestStartTimestamp: new Date().toISOString(),
          err,
        });
      }
      bumpFailure("anthropic", err);
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
      if (err instanceof Stage2CheckpointStopError) throw err;
      if (err instanceof UnknownCompletionError || isPostDispatchUnknownError(err)) {
        handleUnknownCompletion({
          provider: "openai",
          modelId: STAGE2_JUDGE_B,
          taskId: `${task.taskId}::${modelId}::judge_B`,
          benchmarkId: "prbench",
          attemptNumber: 1,
          requestStartTimestamp: new Date().toISOString(),
          err,
        });
      }
      bumpFailure("openai", err);
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
    const elapsedBatchMs = Date.now() - batchStartedAt;
    console.error(
      JSON.stringify({
        checkpoint: true,
        runId,
        challengerMode,
        gptResponsesDone,
        grokResponsesDone,
        claudeResponsesDone,
        prbenchClaudeResponsesDone,
        prbenchSemanticTerminalsDone,
        maxClaudeResponses,
        maxPrbenchResponses,
        stopAfterPrbench,
        taskAllowlistSize: taskAllowlist?.size ?? null,
        judgeADone,
        judgeBDone,
        completedResponses,
        plannedResponses,
        completedJudges,
        plannedJudges,
        ragEvaluations,
        plannedRag,
        cacheHits,
        paidCalls,
        sessionPaidSpendUsd: Number(sessionPaidSpendUsd.toFixed(4)),
        sessionMaxSpendUsd,
        totalSpendUsd: Number(budget.spentUsd.toFixed(4)),
        knownLedgerSpendUsd: Number(budget.spentUsd.toFixed(4)),
        remainingBudgetUsd: Number(remainingBudgetUsd(budget).toFixed(4)),
        lastProviderActivity,
        unknownQuarantines,
        terminalProviderFailures,
        sessionDistinctUnknownTasks: sessionUnknownCount(),
        providerCircuitBreakerTripped,
        unverifiedProviderBillingExposure,
        failureTaxonomyByProvider: structuredClone(failureTaxonomyByProvider),
        failuresByProvider: { ...failuresByProvider },
        elapsedBatchMs,
      }),
    );
    batchStartedAt = Date.now();
    paidCallsSinceCheckpoint = 0;
  };

  // Promote repeated UNKNOWN tasks to TERMINAL_PROVIDER_UNKNOWN before paid work.
  for (const item of work) {
    const provider = MODEL_PROVIDER[item.modelId];
    const compositeTaskId = `${item.task.taskId}::${item.modelId}`;
    if (hasTerminalProviderUnknown(runId, compositeTaskId, provider)) continue;
    if (!hasUnknownCompletionArtifact(runId, compositeTaskId, provider)) continue;
    const attempts = countUnknownAttemptsForTask(runId, compositeTaskId, provider);
    const resendConsumed = hasConsumedSingleUnknownResend(runId, compositeTaskId, provider);
    if (attempts >= 2 || resendConsumed) {
      // Historical reconcile only — does not burn the session circuit-breaker budget.
      accountTerminalFailure({
        provider,
        modelId: item.modelId,
        taskId: compositeTaskId,
        benchmarkId: item.benchmarkId,
        countTowardSessionCircuitBreaker: false,
      });
      if (runStatus === "STAGE2_COMPLETE") {
        runStatus = "STAGE2_PARTIAL";
        note =
          note ??
          `TERMINAL_PROVIDER_UNKNOWN: ${compositeTaskId}; continuing Stage-2 without further resend`;
      }
    }
  }

  // Pass 1: account every cache hit first so AUTH hard-stop cannot wipe prior spend.
  for (const item of work) {
    await processOne(item, true);
  }
  emitCheckpoint();

  try {
    // Refuse paid finalist work under prior ACTIVE UNKNOWN quarantine unless operator overrides.
    // CLEARED_AFTER_TASK_TERMINALIZATION does not block continuation.
    const quarantineNow = readRunUnknownQuarantine(runId);
    if (
      quarantineNow &&
      isActiveUnknownQuarantine(quarantineNow) &&
      !ackUnverified &&
      !allowResendUnknown
    ) {
      runStatus = "STAGE2_PAUSED_UNKNOWN_COMPLETION";
      note =
        note ??
        `STAGE2_PAUSED_UNKNOWN_COMPLETION: prior quarantine ${quarantineNow.reason}; pass --acknowledge-unverified-billing-exposure to continue after reconciliation`;
      emitCheckpoint();
    } else {
      // Pass 2: serial paid execution; AUTH / circuit-breaker / budget stop aborts.
      let sinceCheckpoint = 0;
      for (const item of work) {
        await processOne(item, false);
        sinceCheckpoint += 1;
        if (sinceCheckpoint >= batchSize || paidCallsSinceCheckpoint >= 10) {
          emitCheckpoint();
          sinceCheckpoint = 0;
          // Claude challenger early economic stop: at $75 known spend, refuse if
          // remaining worst-case work cannot finish under the $95 hard cap.
          if (challengerMode && budget.spentUsd >= 75) {
            const remainingResponses = Math.max(0, plannedResponses - completedResponses);
            const remainingJudges = Math.max(0, plannedJudges - completedJudges);
            const remainWorst =
              remainingResponses *
                worstCaseCostForBudgetGate({
                  modelId: STAGE2_CLAUDE_CHALLENGER_MODEL,
                  estimatedInputTokens: 4500,
                  maxOutputTokens: CLAUDE_CHALLENGER_MAX_TOKENS,
                  bucket: "models",
                  pricingTable: pricing,
                }) +
              remainingJudges *
                worstCaseCostForBudgetGate({
                  modelId: STAGE2_JUDGE_A,
                  estimatedInputTokens: 3500,
                  maxOutputTokens: 2048,
                  bucket: "judgeModels",
                  pricingTable: pricing,
                });
            if (budget.spentUsd + remainWorst > maxCostUsd + 1e-9) {
              runStatus = "STAGE2_BUDGET_STOP";
              note = `CLAUDE_STAGE2_EARLY_ECONOMIC_STOP: known=$${budget.spentUsd.toFixed(2)} remainWorst=$${remainWorst.toFixed(2)} exceeds cap $${maxCostUsd}`;
              throw new BudgetLimitError(note);
            }
          }
        }
      }
      if (sinceCheckpoint > 0 || paidCallsSinceCheckpoint > 0) emitCheckpoint();
    }
  } catch (err) {
    if (err instanceof Stage2CheckpointStopError) {
      runStatus = "STAGE2_CHECKPOINT_STOP";
      note = err.message;
    } else if (err instanceof BudgetLimitError) {
      runStatus = "STAGE2_BUDGET_STOP";
      note = err.message;
    } else if (err instanceof Stage2ProviderCircuitBreakerError) {
      runStatus = "STAGE2_PROVIDER_CIRCUIT_BREAKER";
      providerCircuitBreakerTripped = true;
      if (!note?.startsWith("STAGE2_PROVIDER_CIRCUIT_BREAKER")) {
        note = err.message;
      }
    } else if (err instanceof Stage2UnknownCompletionStopError) {
      runStatus = "STAGE2_PAUSED_UNKNOWN_COMPLETION";
      if (!note?.startsWith("STAGE2_PAUSED_UNKNOWN_COMPLETION")) {
        note = err.message;
      }
    } else if (err instanceof LiveProviderError && err.code === "AUTH_ERROR") {
      runStatus = "STAGE2_BLOCKED";
      if (!note?.startsWith("STAGE2_BLOCKED")) {
        note = `STAGE2_BLOCKED_PROVIDER_ACCESS: ${err.message}`;
      }
    } else if (err instanceof UnknownCompletionError || isPostDispatchUnknownError(err)) {
      runStatus = "STAGE2_PAUSED_UNKNOWN_COMPLETION";
      note = err instanceof Error ? err.message : String(err);
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
  terminalProviderFailures = listTerminalProviderUnknowns(runId).length;
  const semanticTerminalFailures = listTerminalSemanticRefusals(runId).length;
  const responseTerminalCoverage =
    completedResponses + terminalProviderFailures + semanticTerminalFailures;
  const prbenchTerminalOutcomes =
    prbenchClaudeResponsesDone +
    listTerminalSemanticRefusals(runId).filter((t) => t.benchmarkId === "prbench").length +
    listTerminalProviderUnknowns(runId).filter((t) => t.benchmarkId === "prbench").length;
  if (
    stopAfterPrbench &&
    runStatus !== "STAGE2_BUDGET_STOP" &&
    runStatus !== "STAGE2_CHECKPOINT_STOP" &&
    runStatus !== "STAGE2_BLOCKED" &&
    runStatus !== "STAGE2_PAUSED_UNKNOWN_COMPLETION" &&
    runStatus !== "STAGE2_PROVIDER_CIRCUIT_BREAKER" &&
    prbenchTerminalOutcomes >= prbenchTasks.length * models.length
  ) {
    runStatus = "STAGE2_CHECKPOINT_STOP";
    note =
      note ??
      `CLAUDE_PRBENCH_BOUNDARY: PRBench terminal coverage ${prbenchTerminalOutcomes}/${prbenchTasks.length * models.length}; LegalBench not started`;
  }
  if (
    runStatus !== "STAGE2_BUDGET_STOP" &&
    runStatus !== "STAGE2_CHECKPOINT_STOP" &&
    runStatus !== "STAGE2_BLOCKED" &&
    runStatus !== "STAGE2_PAUSED_UNKNOWN_COMPLETION" &&
    runStatus !== "STAGE2_PROVIDER_CIRCUIT_BREAKER"
  ) {
    if (responseTerminalCoverage >= plannedResponses) {
      // Terminal provider/semantic failures count toward coverage; judges only for valid successes.
      runStatus = "STAGE2_COMPLETE";
    } else if (runStatus === "STAGE2_COMPLETE") {
      runStatus = "STAGE2_PARTIAL";
    }
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
      failureTaxonomyByProvider: structuredClone(failureTaxonomyByProvider),
      gptResponsesDone,
      grokResponsesDone,
      claudeResponsesDone,
      judgeADone,
      judgeBDone,
      unknownQuarantines,
      terminalProviderFailures,
      sessionDistinctUnknownTasks: sessionUnknownCount(),
      providerCircuitBreakerTripped,
      knownLedgerSpendUsd: budget.spentUsd,
      unverifiedProviderBillingExposure,
      responseSpendUsd,
      judgeSpendUsd,
      retriesUsd,
      totalSpendUsd: budget.spentUsd,
      remainingBudgetUsd: remainingBudgetUsd(budget),
      lastProviderActivity,
      updatedAt: new Date().toISOString(),
    },
    cost: {
      authorizedUsd: maxCostUsd,
      ...costByBucket,
      retriesUsd,
      totalUsd: budget.spentUsd,
      remainingUsd: remainingBudgetUsd(budget),
      knownLedgerSpendUsd: budget.spentUsd,
      unverifiedProviderBillingExposure,
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
