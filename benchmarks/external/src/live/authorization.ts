import { assertBudgetConfigured, parseMaxCostUsd } from "./budget.js";

export const LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED =
  "Live model or judge API calls require --allow-paid-model-calls AND --max-cost-usd > 0 (env alone is insufficient for unlimited spend)";

export function buildLiveModelAuthorizationRequiredMessage(detail?: string): string {
  const base = LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED;
  return detail ? `${base}: ${detail}` : base;
}

export type LiveAuthorizationContext = {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
};

function argvIncludesAllowPaid(argv: readonly string[]): boolean {
  return argv.includes("--allow-paid-model-calls");
}

function envAllowsPaid(env: NodeJS.ProcessEnv): boolean {
  const flag = env.EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS;
  return flag === "1" || flag === "true";
}

/**
 * Live paid execution requires BOTH --allow-paid-model-calls AND --max-cost-usd > 0.
 * Environment variable alone cannot authorize unlimited spend.
 */
export function isLivePaidExecutionAuthorized(context: LiveAuthorizationContext = {}): boolean {
  const argv = context.argv ?? process.argv;
  const env = context.env ?? process.env;
  const maxUsd = parseMaxCostUsd(argv);
  if (maxUsd === null || maxUsd <= 0) {
    return false;
  }
  return argvIncludesAllowPaid(argv) || envAllowsPaid(env);
}

export function assertLivePaidExecutionAuthorized(
  context: LiveAuthorizationContext = {},
  detail?: string,
): { maxCostUsd: number } {
  const argv = context.argv ?? process.argv;
  const maxUsd = parseMaxCostUsd(argv);
  try {
    assertBudgetConfigured(maxUsd);
  } catch (err) {
    throw new Error(
      buildLiveModelAuthorizationRequiredMessage(
        detail ?? "missing or invalid --max-cost-usd",
      ),
      { cause: err },
    );
  }
  if (!isLivePaidExecutionAuthorized(context)) {
    throw new Error(
      buildLiveModelAuthorizationRequiredMessage(
        detail ??
          "requires --allow-paid-model-calls (or EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS=1) AND --max-cost-usd > 0",
      ),
    );
  }
  return { maxCostUsd: maxUsd };
}
