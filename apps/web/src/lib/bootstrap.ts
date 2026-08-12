/**
 * Phase 9 — process-level configuration validation.
 *
 * Runs the production configuration gate (`validateConfigForEnv`) once per server process, before
 * this deployment is trusted to serve traffic. Called from two places on purpose:
 *
 * 1. `apps/web/src/instrumentation.ts`'s `register()` hook, which Next.js runs once at server
 *    startup — the earliest point a misconfigured production deployment can be refused.
 * 2. The readiness route, so a load balancer / orchestrator can observe the same validation result
 *    on every health check, not just at boot (useful if `.env` is somehow mutated post-deploy, and
 *    cheap to repeat since `validateConfigForEnv` is pure).
 *
 * Idempotent and side-effect-light: it logs and, in production only, throws via
 * `validateProductionConfig`. It never touches the database or network.
 */
import {
  ConfigurationError,
  collectConfigWarnings,
  resolveAppEnvDetailed,
  summarizeConfig,
  validateConfigForEnv,
  type ConfigValidationResult,
} from "@nyayagrid/platform";

let cached: ConfigValidationResult | null = null;

/** Throws `ConfigurationError` in production when a blocker is unmet — the desired boot-time behavior. */
export function runConfigBootstrap(): ConfigValidationResult {
  const result = validateConfigForEnv();
  cached = result;
  return result;
}

/**
 * Returns the last bootstrap result, computing one if needed. Unlike `runConfigBootstrap`, this
 * never throws: a readiness probe must be able to report "not ready" as data on every request,
 * not crash the request. A caught `ConfigurationError` is rebuilt into the same shape
 * `validateConfigForEnv` would have returned had it not thrown, from the error's own `problems`.
 */
export function getConfigBootstrapResult(): ConfigValidationResult {
  if (cached) return cached;
  try {
    return runConfigBootstrap();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      const { appEnv, source } = resolveAppEnvDetailed();
      return {
        appEnv,
        appEnvSource: source,
        summary: summarizeConfig(),
        problems: [...error.problems],
        warnings: collectConfigWarnings(),
      };
    }
    throw error;
  }
}
