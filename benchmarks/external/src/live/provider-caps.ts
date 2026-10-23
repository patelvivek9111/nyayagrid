export type ProviderId = "openai" | "anthropic" | "google" | "xai" | "judge";

export type ProviderCapLimits = {
  maxCalls?: number;
  maxTokens?: number;
  maxDollars?: number;
};

export type ProviderCapsConfig = Partial<Record<ProviderId, ProviderCapLimits>> & {
  maxJudgeDollars?: number;
  maxRetries?: number;
};

export type ProviderSpendState = {
  calls: number;
  tokens: number;
  dollars: number;
};

export class ProviderCapError extends Error {
  readonly code = "STOP_PROVIDER_CAP" as const;
  constructor(message: string) {
    super(message);
    this.name = "ProviderCapError";
  }
}

export function emptyProviderSpend(): ProviderSpendState {
  return { calls: 0, tokens: 0, dollars: 0 };
}

export function parseProviderCaps(argv: readonly string[]): ProviderCapsConfig {
  const caps: ProviderCapsConfig = {};
  const readNum = (flag: string): number | undefined => {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === flag) {
        const n = Number(argv[i + 1]);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      }
      if (arg?.startsWith(`${flag}=`)) {
        const n = Number(arg.slice(flag.length + 1));
        return Number.isFinite(n) && n > 0 ? n : undefined;
      }
    }
    return undefined;
  };

  const openaiDollars = readNum("--max-openai-usd");
  const anthropicDollars = readNum("--max-anthropic-usd");
  const googleDollars = readNum("--max-google-usd");
  const xaiDollars = readNum("--max-xai-usd");
  const judgeDollars = readNum("--max-judge-usd");
  const maxRetries = readNum("--max-retries");

  if (openaiDollars !== undefined) caps.openai = { maxDollars: openaiDollars };
  if (anthropicDollars !== undefined) caps.anthropic = { maxDollars: anthropicDollars };
  if (googleDollars !== undefined) caps.google = { maxDollars: googleDollars };
  if (xaiDollars !== undefined) caps.xai = { maxDollars: xaiDollars };
  if (judgeDollars !== undefined) caps.maxJudgeDollars = judgeDollars;
  if (maxRetries !== undefined) caps.maxRetries = Math.floor(maxRetries);

  return caps;
}

export function assertWithinProviderCaps(input: {
  provider: ProviderId;
  caps: ProviderCapsConfig;
  spend: ProviderSpendState;
  nextCalls?: number;
  nextTokens?: number;
  nextDollarsWorstCase: number;
  isJudge?: boolean;
}): void {
  const nextCalls = input.nextCalls ?? 1;
  const nextTokens = input.nextTokens ?? 0;
  const limit = input.caps[input.provider];

  if (limit?.maxCalls !== undefined && input.spend.calls + nextCalls > limit.maxCalls) {
    throw new ProviderCapError(
      `STOP_PROVIDER_CAP: ${input.provider} maxCalls ${limit.maxCalls} would be exceeded`,
    );
  }
  if (limit?.maxTokens !== undefined && input.spend.tokens + nextTokens > limit.maxTokens) {
    throw new ProviderCapError(
      `STOP_PROVIDER_CAP: ${input.provider} maxTokens ${limit.maxTokens} would be exceeded`,
    );
  }
  if (
    limit?.maxDollars !== undefined &&
    input.spend.dollars + input.nextDollarsWorstCase > limit.maxDollars + 1e-9
  ) {
    throw new ProviderCapError(
      `STOP_PROVIDER_CAP: ${input.provider} maxDollars ${limit.maxDollars} would be exceeded`,
    );
  }
  if (
    input.isJudge &&
    input.caps.maxJudgeDollars !== undefined &&
    input.spend.dollars + input.nextDollarsWorstCase > input.caps.maxJudgeDollars + 1e-9
  ) {
    throw new ProviderCapError(
      `STOP_PROVIDER_CAP: maxJudgeDollars ${input.caps.maxJudgeDollars} would be exceeded`,
    );
  }
}

export function recordProviderSpend(
  spend: ProviderSpendState,
  delta: { calls?: number; tokens?: number; dollars?: number },
): ProviderSpendState {
  return {
    calls: spend.calls + (delta.calls ?? 0),
    tokens: spend.tokens + (delta.tokens ?? 0),
    dollars: spend.dollars + (delta.dollars ?? 0),
  };
}
