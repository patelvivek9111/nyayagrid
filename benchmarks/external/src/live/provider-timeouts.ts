/**
 * Stage-2 provider timeout policy (execution safety only).
 * Not part of frozen benchmark configHash — does not alter prompts/models/scoring.
 *
 * Evidence from stage2-finalists-v1-044fb482d7bf successful artifacts:
 * - GPT max ~141s → 180s remains acceptable
 * - Grok p95 ~161s / max ~177.7s vs prior 180s → raise to 270s
 * - Judges p95 ≪ 180s → keep 180s
 */
export const STAGE2_PROVIDER_TIMEOUTS_MS = {
  openaiResponse: 180_000,
  xaiResponse: 270_000,
  anthropicJudge: 180_000,
  openaiJudge: 180_000,
} as const;

export type Stage2ProviderTimeoutKey = keyof typeof STAGE2_PROVIDER_TIMEOUTS_MS;

/** Default used by Stage-1 / canary / Gemini when caller omits timeoutMs. */
export const DEFAULT_LIVE_TIMEOUT_MS = 180_000;

export function stage2ResponseTimeoutMs(provider: "openai" | "xai"): number {
  return provider === "xai"
    ? STAGE2_PROVIDER_TIMEOUTS_MS.xaiResponse
    : STAGE2_PROVIDER_TIMEOUTS_MS.openaiResponse;
}

export function stage2JudgeTimeoutMs(provider: "anthropic" | "openai"): number {
  return provider === "anthropic"
    ? STAGE2_PROVIDER_TIMEOUTS_MS.anthropicJudge
    : STAGE2_PROVIDER_TIMEOUTS_MS.openaiJudge;
}
