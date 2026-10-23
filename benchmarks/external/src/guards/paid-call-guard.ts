import {
  LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED,
  buildLiveModelAuthorizationRequiredMessage,
  isLivePaidExecutionAuthorized,
} from "../live/authorization.js";
import { parseMaxCostUsd } from "../live/budget.js";

export { LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED, buildLiveModelAuthorizationRequiredMessage };

export type PaidCallAuthorizationContext = {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
};

/**
 * @deprecated Prefer isLivePaidExecutionAuthorized for live benchmark paths.
 * Kept for compatibility: returns true only when two-step live authorization passes.
 */
export function isPaidCallsAuthorized(context: PaidCallAuthorizationContext = {}): boolean {
  return isLivePaidExecutionAuthorized(context);
}

export function assertPaidCallsAuthorized(
  context: PaidCallAuthorizationContext = {},
  detail?: string,
): void {
  const argv = context.argv ?? process.argv;
  const maxUsd = parseMaxCostUsd(argv);
  if (maxUsd === null || maxUsd <= 0) {
    throw new Error(buildLiveModelAuthorizationRequiredMessage(detail ?? "missing --max-cost-usd"));
  }
  if (!isLivePaidExecutionAuthorized(context)) {
    throw new Error(buildLiveModelAuthorizationRequiredMessage(detail));
  }
}
