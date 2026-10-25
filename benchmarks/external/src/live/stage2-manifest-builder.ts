import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { computeStage2ExactCostPlan } from "../cost/plan-stage2.js";
import { freezeRunManifest, hashRunConfig, type RunManifest } from "./manifest.js";
import { checkCredentialPresence } from "./credentials.js";
import { ensureRunDir } from "./persistence.js";
import type { Stage2ContextProfile } from "./stage2-context-profile.js";
import type { Stage2SuitePlan } from "./stage2-task-planner.js";

export const STAGE2_RUN_ID_PREFIX = "stage2-finalists-v1";

export function buildStage2RunId(gitSha: string): string {
  return `${STAGE2_RUN_ID_PREFIX}-${gitSha.slice(0, 12)}`;
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(getRegistryDir(), name), "utf8"));
}

function hashFileContents(name: string): string {
  const p = path.join(getRegistryDir(), name);
  if (!existsSync(p)) return "MISSING";
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function buildStage2ManifestPayload(input: {
  runId: string;
  gitSha: string;
  suite: Stage2SuitePlan;
  contextProfile: Stage2ContextProfile;
  budgetMaxUsd: number;
}): {
  config: Record<string, unknown>;
  configHash: string;
  freezeArgs: Omit<RunManifest, "immutable" | "frozenAt">;
  costPlan: ReturnType<typeof computeStage2ExactCostPlan>;
} {
  const reasoning = readJson("stage2-reasoning-settings.json");
  const judge = readJson("judge-settings.json");
  const critical = readJson("critical-failure-policy.json") as { policy_version?: string };
  const scoring = readJson("scoring-policy.json");
  const advancement = readJson("stage2-stage3-advancement-policy.json");
  const finalists = readJson("stage2-finalists.json");
  const budget = readJson("stage2-budget.json");
  const pricingPath = path.join(getRegistryDir(), "..", "src", "cost", "pricing.current.json");
  const pricingSnapshot = JSON.parse(readFileSync(pricingPath, "utf8"));
  const credentials = checkCredentialPresence();

  const costPlan = computeStage2ExactCostPlan({
    suite: input.suite,
    measuredInputTokens: input.contextProfile.inputTokens,
  });

  const suiteFrozen: Stage2SuitePlan = { ...input.suite, frozen: true };

  const config = {
    runId: input.runId,
    gitSha: input.gitSha,
    stage: 2 as const,
    autoEscalate: false,
    autoStartStage3: false,
    suite: suiteFrozen,
    suiteHashes: {
      stage2Finalists: hashFileContents("stage2-finalists.json"),
      reasoning: hashFileContents("stage2-reasoning-settings.json"),
      judge: hashFileContents("judge-settings.json"),
      criticalFailure: hashFileContents("critical-failure-policy.json"),
      scoring: hashFileContents("scoring-policy.json"),
      stage3Advancement: hashFileContents("stage2-stage3-advancement-policy.json"),
      legalbenchTaskLicenses: hashFileContents("legalbench-task-licenses.json"),
      ragSourceLicenses: hashFileContents("legalbench-rag-source-licenses.json"),
    },
    models: {
      response: ["gpt-6.1-sol", "grok-4.7"],
      judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      eliminated: ["claude-opus-5-5", "gemini-4-argon"],
    },
    finalists,
    reasoningSettings: reasoning,
    judgeSettings: judge,
    criticalFailurePolicy: critical,
    scoringPolicy: scoring,
    stage3AdvancementPolicy: advancement,
    contextProfile: input.contextProfile,
    pricingSnapshot,
    pricingDate: (pricingSnapshot as { effective_date?: string }).effective_date ?? "2026-10-23",
    costPlan,
    budget: {
      totalMaxUsd: input.budgetMaxUsd,
      recommendedHardCapUsd: costPlan.recommendedHardCapUsd,
      subcaps: costPlan.providerSubcapsUsd,
      authorizedNow: false,
      batching: (budget as { batching?: unknown }).batching,
    },
    retryPolicy: {
      maxRetries: 2,
      retryable: ["429", "temporary_5xx", "connection_reset", "timeout_incomplete"],
      unknownCompletion: "UNKNOWN_COMPLETION_REVIEW_REQUIRED",
      doNotRetry: [
        "credit_balance_exhausted",
        "quota_limit_0",
        "auth_error",
        "model_not_found",
        "bad_request",
        "refusal",
      ],
    },
    selfJudgeSensitivity: {
      reportDualCombined: true,
      reportCrossProviderOnly: true,
      gptJudgeBSameProvider: true,
      grokBothJudgesCrossProvider: true,
    },
    credentialsPresence: {
      OPENAI_API_KEY: credentials.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: credentials.ANTHROPIC_API_KEY,
      XAI_API_KEY: credentials.XAI_API_KEY,
      GOOGLE_API_KEY: credentials.GOOGLE_API_KEY,
      googleMustNotBeUsed: true,
    },
    openaiGenerationAccess: "OPENAI_GENERATION_ACCESS_NOT_YET_CONFIRMED",
    paidCalls: 0,
    valuesPrinted: false,
  };

  const configHash = hashRunConfig(config);
  return {
    config,
    configHash,
    costPlan,
    freezeArgs: {
      runId: input.runId,
      configHash,
      suite: suiteFrozen,
      models: config.models,
      budgetMaxUsd: input.budgetMaxUsd,
    },
  };
}

export function freezeStage2Manifest(input: {
  runId: string;
  gitSha: string;
  suite: Stage2SuitePlan;
  contextProfile: Stage2ContextProfile;
  budgetMaxUsd: number;
}): {
  manifest: RunManifest;
  configHash: string;
  config: Record<string, unknown>;
  costPlan: ReturnType<typeof computeStage2ExactCostPlan>;
} {
  const built = buildStage2ManifestPayload(input);
  const dir = ensureRunDir(input.runId);
  writeFileSync(path.join(dir, "full-config.json"), `${JSON.stringify(built.config, null, 2)}\n`);
  writeFileSync(
    path.join(dir, "stage2-suite.json"),
    `${JSON.stringify({ ...input.suite, frozen: true }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(dir, "stage2-cost-plan.json"),
    `${JSON.stringify(built.costPlan, null, 2)}\n`,
  );
  writeFileSync(
    path.join(dir, "stage2-context-profile.json"),
    `${JSON.stringify(input.contextProfile, null, 2)}\n`,
  );
  const manifest = freezeRunManifest(input.runId, built.freezeArgs);
  return {
    manifest,
    configHash: built.configHash,
    config: built.config,
    costPlan: built.costPlan,
  };
}
