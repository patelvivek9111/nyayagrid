import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getCacheDir, getRegistryDir } from "../paths.js";
import { assertCommercialEvalAllowed } from "../license/firewall.js";
import { assertLivePaidExecutionAuthorized } from "./authorization.js";
import { assessContextFit } from "./context-fit.js";
import { remainingBudgetUsd, type BudgetState } from "./budget.js";

export const PAID_BENCHMARK_PREFLIGHT_PASS = "PAID_BENCHMARK_PREFLIGHT_PASS" as const;

const REQUIRED_REGISTRY = [
  "screening-suite.json",
  "models.json",
  "legalbench-task-licenses.json",
  "legalbench-rag-source-licenses.json",
  "judge-config.json",
];

const CREDENTIAL_ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
] as const;

export type PreflightOptions = {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  budgetState?: BudgetState;
  tasks?: Array<{
    benchmarkId: string;
    taskId: string;
    metadata?: Record<string, unknown> | null;
    inputChars?: number;
  }>;
  models?: Array<{ exactModelId: string; contextWindow: number }>;
};

export type PreflightResult = {
  status: typeof PAID_BENCHMARK_PREFLIGHT_PASS | "PREFLIGHT_FAILED";
  checks: Record<string, boolean>;
  errors: string[];
};

function credentialsPresent(env: NodeJS.ProcessEnv): boolean {
  return CREDENTIAL_ENV_KEYS.some((k) => {
    const v = env[k];
    return typeof v === "string" && v.length > 0;
  });
}

export function runPaidBenchmarkPreflight(options: PreflightOptions = {}): PreflightResult {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const errors: string[] = [];
  const checks: Record<string, boolean> = {};

  for (const file of REQUIRED_REGISTRY) {
    const ok = existsSync(path.join(getRegistryDir(), file));
    checks[`registry_${file}`] = ok;
    if (!ok) errors.push(`Missing registry file: ${file}`);
  }

  try {
    accessSync(getCacheDir(), constants.W_OK);
    checks.cache_writable = true;
  } catch {
    checks.cache_writable = false;
    errors.push("Cache directory not writable");
  }

  if (!options.dryRun) {
    try {
      assertLivePaidExecutionAuthorized({ argv, env });
      checks.live_authorization = true;
    } catch (e) {
      checks.live_authorization = false;
      errors.push(e instanceof Error ? e.message : String(e));
    }
  } else {
    checks.live_authorization = true;
  }

  checks.credentials_present = credentialsPresent(env);
  if (!checks.credentials_present && !options.dryRun) {
    errors.push("No provider API key env vars detected (presence only check)");
  }

  if (options.tasks) {
    let licenseOk = true;
    for (const task of options.tasks) {
      const result = assertCommercialEvalAllowed(task, "production-selection");
      if (!result.allowed) {
        licenseOk = false;
        errors.push(result.reason ?? `License blocked: ${task.taskId}`);
      }
    }
    checks.licenses_production = licenseOk;
  } else {
    checks.licenses_production = true;
  }

  if (options.tasks && options.models) {
    let contextOk = true;
    for (const task of options.tasks) {
      for (const model of options.models) {
        const chars = task.inputChars ?? 0;
        const fit = assessContextFit({
          inputTokensEstimate: Math.ceil(chars / 4),
          maxOutputTokens: 800,
          contextWindow: model.contextWindow,
        });
        if (fit === "INELIGIBLE") {
          contextOk = false;
          errors.push(`Context ineligible: task=${task.taskId} model=${model.exactModelId}`);
        }
      }
    }
    checks.context_fit = contextOk;
  } else {
    checks.context_fit = true;
  }

  if (options.budgetState) {
    checks.budget_remaining = remainingBudgetUsd(options.budgetState) > 0;
    if (!checks.budget_remaining) {
      errors.push("Budget exhausted before preflight complete");
    }
  } else {
    checks.budget_remaining = true;
  }

  const pricingPath = path.join(getRegistryDir(), "..", "src", "cost", "pricing.current.json");
  const modelsPath = path.join(getRegistryDir(), "models.json");
  checks.pricing_file = existsSync(pricingPath);
  checks.models_registry = existsSync(modelsPath);
  if (!checks.pricing_file) {
    errors.push("Missing pricing.current.json");
  }

  const failed = errors.length > 0;
  return {
    status: failed ? "PREFLIGHT_FAILED" : PAID_BENCHMARK_PREFLIGHT_PASS,
    checks,
    errors,
  };
}
