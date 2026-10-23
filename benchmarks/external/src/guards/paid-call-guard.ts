export const LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED =
  "Live model or judge API calls require --allow-paid-model-calls or EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS=1";

export type PaidCallAuthorizationContext = {
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

export function isPaidCallsAuthorized(context: PaidCallAuthorizationContext = {}): boolean {
  const argv = context.argv ?? process.argv;
  const env = context.env ?? process.env;
  return argvIncludesAllowPaid(argv) || envAllowsPaid(env);
}

export function buildLiveModelAuthorizationRequiredMessage(detail?: string): string {
  const base = LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED;
  return detail ? `${base}: ${detail}` : base;
}

export function assertPaidCallsAuthorized(
  context: PaidCallAuthorizationContext = {},
  detail?: string,
): void {
  if (!isPaidCallsAuthorized(context)) {
    throw new Error(buildLiveModelAuthorizationRequiredMessage(detail));
  }
}
