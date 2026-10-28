/**
 * Freeze an immutable Claude+Gemini challenger-screen manifest.
 * Reuses Stage-1 screening-suite task IDs; does not touch Stage-2 artifacts.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { freezeRunManifest, hashRunConfig, type RunManifest } from "./manifest.js";
import { checkCredentialPresence } from "./credentials.js";
import { classifyModelAccessFromCredentials } from "./model-access.js";
import { ensureRunDir } from "./persistence.js";

export const CHALLENGER_SCREEN_RUN_ID_PREFIX = "challenger-screen-v1";

export function buildChallengerScreenRunId(gitSha: string): string {
  return `${CHALLENGER_SCREEN_RUN_ID_PREFIX}-${gitSha.slice(0, 12)}`;
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(getRegistryDir(), name), "utf8"));
}

function hashFileContents(name: string): string {
  const p = path.join(getRegistryDir(), name);
  if (!existsSync(p)) return "MISSING";
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function buildChallengerScreenManifestPayload(input: {
  runId: string;
  gitSha: string;
  budgetMaxUsd?: number;
  includeGemini?: boolean;
}): {
  config: Record<string, unknown>;
  configHash: string;
  freezeArgs: Omit<RunManifest, "immutable" | "frozenAt">;
} {
  const screening = readJson("screening-suite.json");
  const challengerSettings = readJson("challenger-screen-settings.json") as {
    settings: Record<string, unknown>;
    models: string[];
    judges: { judge_a: string; judge_b: string };
    rag: unknown;
  };
  const judge = readJson("judge-settings.json");
  const budget = readJson("challenger-screen-budget.json") as {
    total_max_usd?: number;
    provider_subcaps_usd?: unknown;
  };
  const pricingPath = path.join(getRegistryDir(), "..", "src", "cost", "pricing.current.json");
  const pricingSnapshot = JSON.parse(readFileSync(pricingPath, "utf8"));
  const critical = readJson("critical-failure-policy.json") as { policy_version?: string };
  const scoring = readJson("scoring-policy.json");
  const stage2Finalists = readJson("stage2-finalists.json");
  const credentials = checkCredentialPresence();
  const access = classifyModelAccessFromCredentials(credentials);

  const includeGemini = input.includeGemini !== false;
  const responseModels = includeGemini
    ? (["claude-opus-5-5", "gemini-4-argon"] as const)
    : (["claude-opus-5-5"] as const);

  const config = {
    runId: input.runId,
    gitSha: input.gitSha,
    stage: "challenger-screen" as const,
    autoEscalate: false,
    sourceStage1RunId: "stage1-screening-v1-323ee6eb76ee",
    completedStage2RunId: "stage2-finalists-v1-044fb482d7bf",
    doNotModifyStage2Artifacts: true,
    screening,
    screeningHashes: {
      screeningSuite: hashFileContents("screening-suite.json"),
      challengerSettings: hashFileContents("challenger-screen-settings.json"),
      challengerBudget: hashFileContents("challenger-screen-budget.json"),
      judge: hashFileContents("judge-settings.json"),
      criticalFailure: hashFileContents("critical-failure-policy.json"),
      scoring: hashFileContents("scoring-policy.json"),
      stage2Finalists: hashFileContents("stage2-finalists.json"),
    },
    models: {
      response: [...responseModels],
      judges: [challengerSettings.judges.judge_a, challengerSettings.judges.judge_b],
    },
    challengerScreenSettings: challengerSettings,
    /** Drives Stage-1 executor output-token overrides for this run. */
    outputTokenOverrides: {
      "claude-opus-5-5": (challengerSettings.settings["claude-opus-5-5"] as { max_tokens?: number })
        .max_tokens,
      "gemini-4-argon": (
        challengerSettings.settings["gemini-4-argon"] as { max_output_tokens?: number }
      ).max_output_tokens,
    },
    judgeSettings: judge,
    criticalFailurePolicy: critical,
    scoringPolicy: scoring,
    historicalFinalistPolicy: stage2Finalists,
    ragPolicy: challengerSettings.rag,
    pricingSnapshot,
    pricingDate: "2026-10-23",
    policyVersion: {
      challenger: "challenger-screen-reasoning-v1",
      judge: "stage1-judge-v1",
      budget: "challenger-screen-budget-v1",
      criticalFailure: critical.policy_version ?? "critical-failure-v1",
    },
    budget: {
      totalMaxUsd: input.budgetMaxUsd ?? budget.total_max_usd ?? 20,
      subcaps: budget.provider_subcaps_usd,
    },
    retryPolicy: {
      maxRetries: 2,
      retryable: ["429", "temporary_5xx", "connection_reset", "timeout_incomplete"],
      unknownCompletion: "UNKNOWN_COMPLETION_REVIEW_REQUIRED",
      maxUncertainPaidAttemptsPerTask: 2,
    },
    credentialsPresence: credentials,
    modelAccess: access,
    valuesPrinted: false,
  };

  const configHash = hashRunConfig(config);
  return {
    config,
    configHash,
    freezeArgs: {
      runId: input.runId,
      configHash,
      suite: screening,
      models: config.models,
      budgetMaxUsd: config.budget.totalMaxUsd as number,
    },
  };
}

export function freezeChallengerScreenManifest(input: {
  runId: string;
  gitSha: string;
  budgetMaxUsd?: number;
  includeGemini?: boolean;
}): { manifest: RunManifest; configHash: string; config: Record<string, unknown> } {
  const built = buildChallengerScreenManifestPayload(input);
  const dir = ensureRunDir(input.runId);
  writeFileSync(path.join(dir, "full-config.json"), `${JSON.stringify(built.config, null, 2)}\n`);
  const manifest = freezeRunManifest(input.runId, built.freezeArgs);
  return { manifest, configHash: built.configHash, config: built.config };
}
