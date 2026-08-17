/**
 * Live eval configuration — pinned model + hard spend/time caps.
 *
 * Required for `npm run eval:ai:live`:
 *   EVAL_LIVE=1
 *   OPENAI_API_KEY=...
 *
 * Optional overrides (defaults are conservative):
 *   EVAL_LIVE_MODEL / OPENAI_MODEL  — pinned chat model (default gpt-4o-mini)
 *   EVAL_LIVE_TIMEOUT_MS            — per-request timeout (default 45000)
 *   EVAL_LIVE_MAX_TOKENS            — suite token ceiling (default 80000)
 *   EVAL_LIVE_MAX_USD               — suite USD ceiling (default 0.75)
 *   EVAL_LIVE_REPEATS               — times to run each model case (default 1; use 3 for a range)
 *   EVAL_LIVE_CASE_IDS              — comma-separated case ids (isolation; skip smoke + other cases)
 *   EVAL_LIVE_WORKFLOW              — case_qa | contradiction (skip the other live workflow)
 *   EVAL_LIVE_USD_PER_1M_INPUT      — pricing for budget math (default 0.15)
 *   EVAL_LIVE_USD_PER_1M_OUTPUT     — pricing for budget math (default 0.60)
 *
 * Sampling: live Case Q&A and contradiction calls always send temperature=0
 * (`LIVE_EVAL_TEMPERATURE`). OpenAIProvider also defaults omitted temperature to 0.
 */

export const EVAL_LIVE_PINNED_MODEL_DEFAULT = "gpt-4o-mini";

/** Explicit sampling pin for live Case Q&A and contradiction. Already 0 before this isolation round. */
export const LIVE_EVAL_TEMPERATURE = 0;

/** Required fields for every live-run tracker row. Snapshot filled from the first API response. */
export type LiveRunConfigRecord = {
  promptVersionCaseQa: string;
  promptVersionContradiction: string;
  promptVersionCompare?: string;
  requestedModel: string;
  resolvedModel: string;
  systemFingerprint: string;
  rerank: boolean;
  temperature: number;
};

export function formatLiveRunConfig(record: LiveRunConfigRecord): string {
  return [
    "=== Live run config (copy into AGENT_QUALITY_TRACKER.md) ===",
    `prompt.case_qa=${record.promptVersionCaseQa}`,
    `prompt.contradiction=${record.promptVersionContradiction}`,
    record.promptVersionCompare ? `prompt.contract_compare=${record.promptVersionCompare}` : null,
    `model.requested=${record.requestedModel}`,
    `model.resolved=${record.resolvedModel}`,
    `system_fingerprint=${record.systemFingerprint}`,
    `rerank=${record.rerank ? "on" : "off"}`,
    `temperature=${record.temperature}`,
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}

export type LiveEvalWorkflowFilter = "all" | "case_qa" | "contradiction";

export type LiveEvalScope = {
  caseIds: string[] | null;
  workflow: LiveEvalWorkflowFilter;
  runSmoke: boolean;
  runCaseQa: boolean;
  runContradiction: boolean;
};

export function resolveLiveEvalScope(
  env: NodeJS.ProcessEnv = process.env,
): LiveEvalScope {
  const rawIds = env.EVAL_LIVE_CASE_IDS?.trim();
  const caseIds = rawIds
    ? rawIds.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const workflowRaw = env.EVAL_LIVE_WORKFLOW?.trim();
  const workflow: LiveEvalWorkflowFilter =
    workflowRaw === "case_qa" || workflowRaw === "contradiction" ? workflowRaw : "all";
  const isolation = caseIds != null || workflow !== "all";
  return {
    caseIds,
    workflow,
    runSmoke: !isolation,
    runCaseQa: workflow !== "contradiction",
    runContradiction: workflow !== "case_qa" && caseIds == null,
  };
}

export type LiveEvalConfig = {
  enabled: boolean;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  maxUsd: number;
  usdPer1MInput: number;
  usdPer1MOutput: number;
  /** How many times to run each model-backed case. 1 = point estimate. */
  repeats: number;
};

function readPositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function readPositiveInteger(raw: string | undefined, fallback: number): number {
  const n = Math.floor(readPositiveNumber(raw, fallback));
  return n >= 1 ? n : fallback;
}

export function resolveLiveEvalConfig(
  env: NodeJS.ProcessEnv = process.env,
): LiveEvalConfig {
  return {
    enabled: env.EVAL_LIVE === "1",
    apiKey: env.OPENAI_API_KEY?.trim() ? env.OPENAI_API_KEY.trim() : null,
    model:
      env.EVAL_LIVE_MODEL?.trim() ||
      env.OPENAI_MODEL?.trim() ||
      EVAL_LIVE_PINNED_MODEL_DEFAULT,
    timeoutMs: Math.floor(readPositiveNumber(env.EVAL_LIVE_TIMEOUT_MS, 45_000)),
    maxTokens: Math.floor(readPositiveNumber(env.EVAL_LIVE_MAX_TOKENS, 80_000)),
    maxUsd: readPositiveNumber(env.EVAL_LIVE_MAX_USD, 0.75),
    usdPer1MInput: readPositiveNumber(env.EVAL_LIVE_USD_PER_1M_INPUT, 0.15),
    usdPer1MOutput: readPositiveNumber(env.EVAL_LIVE_USD_PER_1M_OUTPUT, 0.6),
    repeats: readPositiveInteger(env.EVAL_LIVE_REPEATS, 1),
  };
}

export function liveEvalSkipReason(config: LiveEvalConfig): string | null {
  if (!config.enabled) {
    return "EVAL_LIVE is not 1 (refusing to spend without an explicit opt-in).";
  }
  if (!config.apiKey) {
    return "OPENAI_API_KEY is missing.";
  }
  return null;
}

export type EvalBudgetSnapshot = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedUsd: number;
  requests: number;
};

export class EvalBudgetTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private requests = 0;

  constructor(private readonly config: LiveEvalConfig) {}

  recordUsage(usage?: { inputTokens?: number; outputTokens?: number }): void {
    this.requests += 1;
    this.inputTokens += usage?.inputTokens ?? 0;
    this.outputTokens += usage?.outputTokens ?? 0;
  }

  snapshot(): EvalBudgetSnapshot {
    const totalTokens = this.inputTokens + this.outputTokens;
    const estimatedUsd =
      (this.inputTokens / 1_000_000) * this.config.usdPer1MInput +
      (this.outputTokens / 1_000_000) * this.config.usdPer1MOutput;
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens,
      estimatedUsd: Number(estimatedUsd.toFixed(6)),
      requests: this.requests,
    };
  }

  /** Returns a human reason when the next call should not run. */
  wouldExceedBudget(): string | null {
    const snap = this.snapshot();
    if (snap.totalTokens >= this.config.maxTokens) {
      return `Token budget exhausted (${snap.totalTokens}/${this.config.maxTokens}).`;
    }
    if (snap.estimatedUsd >= this.config.maxUsd) {
      return `USD budget exhausted (~$${snap.estimatedUsd.toFixed(4)} / $${this.config.maxUsd}).`;
    }
    return null;
  }
}

export async function generateWithEvalTimeout(
  provider: { generate: (req: any) => Promise<any> },
  request: Record<string, unknown>,
  timeoutMs: number,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      provider.generate({ ...request, signal: controller.signal }),
      new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error(`Live eval timed out after ${timeoutMs}ms`)),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
