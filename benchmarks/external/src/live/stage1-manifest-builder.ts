import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { freezeRunManifest, hashRunConfig, type RunManifest } from "./manifest.js";
import { checkCredentialPresence } from "./credentials.js";
import { classifyModelAccessFromCredentials } from "./model-access.js";
import { ensureRunDir } from "./persistence.js";

export const STAGE1_RUN_ID_PREFIX = "stage1-screening-v1";

export function buildStage1RunId(gitSha: string): string {
  const short = gitSha.slice(0, 12);
  return `${STAGE1_RUN_ID_PREFIX}-${short}`;
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(getRegistryDir(), name), "utf8"));
}

export function hashFileContents(name: string): string {
  const p = path.join(getRegistryDir(), name);
  if (!existsSync(p)) return "MISSING";
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function buildStage1ManifestPayload(input: {
  runId: string;
  gitSha: string;
  budgetMaxUsd?: number;
}): {
  config: Record<string, unknown>;
  configHash: string;
  freezeArgs: Omit<RunManifest, "immutable" | "frozenAt">;
} {
  const screening = readJson("screening-suite.json");
  const reasoning = readJson("stage1-reasoning-settings.json");
  const judge = readJson("judge-settings.json");
  const budget = readJson("stage1-budget.json") as {
    total_max_usd?: number;
    provider_subcaps_usd?: unknown;
  };
  const pricingPath = path.join(getRegistryDir(), "..", "src", "cost", "pricing.current.json");
  const pricingSnapshot = JSON.parse(readFileSync(pricingPath, "utf8"));
  const critical = readJson("critical-failure-policy.json") as { policy_version?: string };
  const scoring = readJson("scoring-policy.json");
  const canary = readJson("canary-plan.json");
  const licenses = readJson("licenses.json");
  const credentials = checkCredentialPresence();
  const access = classifyModelAccessFromCredentials(credentials);

  const config = {
    runId: input.runId,
    gitSha: input.gitSha,
    stage: 1 as const,
    autoEscalate: false,
    screening,
    screeningHashes: {
      screeningSuite: hashFileContents("screening-suite.json"),
      legalbenchTaskLicenses: hashFileContents("legalbench-task-licenses.json"),
      ragSourceLicenses: hashFileContents("legalbench-rag-source-licenses.json"),
      reasoning: hashFileContents("stage1-reasoning-settings.json"),
      judge: hashFileContents("judge-settings.json"),
      criticalFailure: hashFileContents("critical-failure-policy.json"),
      scoring: hashFileContents("scoring-policy.json"),
    },
    models: {
      response: ["gpt-6.1-sol", "claude-opus-5-5", "gemini-4-argon", "grok-4.7"],
      judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
    },
    reasoningSettings: reasoning,
    judgeSettings: judge,
    criticalFailurePolicy: critical,
    scoringPolicy: scoring,
    licenseState: licenses,
    pricingSnapshot,
    pricingDate: "2026-10-23",
    policyVersion: {
      reasoning: "stage1-reasoning-v1",
      judge: "stage1-judge-v1",
      budget: "stage1-budget-v1",
      criticalFailure: critical.policy_version ?? "critical-failure-v1",
    },
    budget: {
      totalMaxUsd: input.budgetMaxUsd ?? budget.total_max_usd ?? 25,
      subcaps: budget.provider_subcaps_usd,
    },
    retryPolicy: {
      maxRetries: 2,
      retryable: ["429", "temporary_5xx", "connection_reset", "timeout_incomplete"],
      unknownCompletion: "UNKNOWN_COMPLETION_REVIEW_REQUIRED",
    },
    canary,
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

export function freezeStage1Manifest(input: {
  runId: string;
  gitSha: string;
  budgetMaxUsd?: number;
}): { manifest: RunManifest; configHash: string; config: Record<string, unknown> } {
  const built = buildStage1ManifestPayload(input);
  const dir = ensureRunDir(input.runId);
  writeFileSync(path.join(dir, "full-config.json"), `${JSON.stringify(built.config, null, 2)}\n`);
  const manifest = freezeRunManifest(input.runId, built.freezeArgs);
  return { manifest, configHash: built.configHash, config: built.config };
}
