/**
 * Freeze an immutable Claude-only Stage-2 challenger run.
 * Reuses exact task IDs from completed stage2-finalists-v1-044fb482d7bf.
 * Does not modify finalist artifacts. Does not dispatch GPT/Grok/Gemini.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCacheDir, getRegistryDir } from "../paths.js";
import { checkCredentialPresence } from "./credentials.js";
import { freezeRunManifest, hashRunConfig, type RunManifest } from "./manifest.js";
import { ensureRunDir } from "./persistence.js";
import type { Stage2SuitePlan } from "./stage2-task-planner.js";
import {
  STAGE2_CLAUDE_CHALLENGER_MODEL,
  STAGE2_JUDGE_A,
  STAGE2_JUDGE_B,
} from "./stage2-task-planner.js";

export const STAGE2_CLAUDE_CHALLENGER_RUN_ID_PREFIX = "stage2-claude-challenger-v1";
export const SOURCE_STAGE2_FINALISTS_RUN_ID = "stage2-finalists-v1-044fb482d7bf";
export const SOURCE_STAGE2_CONFIG_HASH =
  "385d4c3f66f621ccd752b1de99d8ac2931d4e0948ce54d6e0e1f41127e9e5b0f";

export function buildStage2ClaudeChallengerRunId(gitSha: string): string {
  return `${STAGE2_CLAUDE_CHALLENGER_RUN_ID_PREFIX}-${gitSha.slice(0, 12)}`;
}

function readRegistryJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(getRegistryDir(), name), "utf8"));
}

function hashRegistryFile(name: string): string {
  const p = path.join(getRegistryDir(), name);
  if (!existsSync(p)) return "MISSING";
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function loadSourceStage2Suite(): Stage2SuitePlan {
  const suitePath = path.join(
    getCacheDir(),
    "runs",
    SOURCE_STAGE2_FINALISTS_RUN_ID,
    "stage2-suite.json",
  );
  if (!existsSync(suitePath)) {
    throw new Error(`Source Stage-2 suite missing: ${suitePath}`);
  }
  const suite = JSON.parse(readFileSync(suitePath, "utf8")) as Stage2SuitePlan;
  if (suite.actual?.prbenchHard !== 250 || suite.actual?.legalbench !== 80) {
    throw new Error(
      `Source Stage-2 suite size mismatch: prbench=${suite.actual?.prbenchHard} lb=${suite.actual?.legalbench}`,
    );
  }
  if (
    suite.upstream_ids.prbench_legal_hard.length !== 250 ||
    suite.upstream_ids.legalbench.length !== 80
  ) {
    throw new Error("Source Stage-2 upstream_ids length mismatch");
  }
  return suite;
}

export function verifySourceStage2Integrity(): {
  ok: boolean;
  configHash: string;
  expected: string;
} {
  const fullConfigPath = path.join(
    getCacheDir(),
    "runs",
    SOURCE_STAGE2_FINALISTS_RUN_ID,
    "full-config.json",
  );
  const manifestPath = path.join(
    getCacheDir(),
    "runs",
    SOURCE_STAGE2_FINALISTS_RUN_ID,
    "manifest.json",
  );
  if (!existsSync(fullConfigPath) || !existsSync(manifestPath)) {
    return { ok: false, configHash: "MISSING", expected: SOURCE_STAGE2_CONFIG_HASH };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { configHash?: string };
  const configHash = String(manifest.configHash ?? "");
  return {
    ok: configHash === SOURCE_STAGE2_CONFIG_HASH,
    configHash,
    expected: SOURCE_STAGE2_CONFIG_HASH,
  };
}

export function buildStage2ClaudeChallengerManifestPayload(input: {
  runId: string;
  gitSha: string;
  suite: Stage2SuitePlan;
  budgetMaxUsd: number;
}): {
  config: Record<string, unknown>;
  configHash: string;
  freezeArgs: Omit<RunManifest, "immutable" | "frozenAt">;
} {
  const settings = readRegistryJson("stage2-claude-challenger-settings.json");
  const budget = readRegistryJson("stage2-claude-challenger-budget.json") as {
    total_max_usd?: number;
    provider_subcaps_usd?: Record<string, number>;
  };
  const advancement = readRegistryJson("stage2-stage3-advancement-policy.json");
  const scoring = readRegistryJson("scoring-policy.json");
  const critical = readRegistryJson("critical-failure-policy.json");
  const judge = readRegistryJson("judge-settings.json");
  const pricingPath = path.join(getRegistryDir(), "..", "src", "cost", "pricing.current.json");
  const pricingSnapshot = JSON.parse(readFileSync(pricingPath, "utf8"));
  const credentials = checkCredentialPresence();

  const suiteFrozen: Stage2SuitePlan = {
    ...input.suite,
    frozen: true,
    response_models: [STAGE2_CLAUDE_CHALLENGER_MODEL],
    call_counts: {
      prbenchResponses: 250,
      legalbenchResponses: 80,
      totalResponses: 330,
      judgeCalls: 500,
      ragRetrievalOnly: 150,
      ragGenerationCalls: 0,
    },
  };

  const config = {
    runId: input.runId,
    gitSha: input.gitSha,
    stage: 2 as const,
    challengerMode: "claude-only" as const,
    autoEscalate: false,
    autoStartStage3: false,
    doNotModifyFinalistRunId: SOURCE_STAGE2_FINALISTS_RUN_ID,
    sourceStage2ConfigHash: SOURCE_STAGE2_CONFIG_HASH,
    sourceChallengerScreenRunId: "challenger-screen-v1-8802e482d165",
    suite: suiteFrozen,
    suiteHashes: {
      claudeChallengerSettings: hashRegistryFile("stage2-claude-challenger-settings.json"),
      claudeChallengerBudget: hashRegistryFile("stage2-claude-challenger-budget.json"),
      stage3Advancement: hashRegistryFile("stage2-stage3-advancement-policy.json"),
      scoring: hashRegistryFile("scoring-policy.json"),
      criticalFailure: hashRegistryFile("critical-failure-policy.json"),
      judge: hashRegistryFile("judge-settings.json"),
    },
    models: {
      response: [STAGE2_CLAUDE_CHALLENGER_MODEL],
      judges: [STAGE2_JUDGE_A, STAGE2_JUDGE_B],
      doNotDispatch: ["gpt-6.1-sol", "grok-4.7", "gemini-4-argon"],
    },
    claudeChallengerSettings: settings,
    judgeSettings: judge,
    criticalFailurePolicy: critical,
    scoringPolicy: scoring,
    stage3AdvancementPolicy: advancement,
    comparisonPolicy: {
      compareAgainstRunId: SOURCE_STAGE2_FINALISTS_RUN_ID,
      reuseGptGrokArtifacts: true,
      threeWayPairedIntersection: true,
      decisionPolicy: "stage2-to-stage3-advancement-v1",
    },
    pricingSnapshot,
    pricingDate: (pricingSnapshot as { effective_date?: string }).effective_date ?? "2026-10-23",
    budget: {
      totalMaxUsd: input.budgetMaxUsd,
      earlyRecalcUsd: 75,
      subcaps: budget.provider_subcaps_usd ?? {},
      authorizedNow: false,
    },
    retryPolicy: {
      maxRetries: 2,
      unknownCompletion: "UNKNOWN_COMPLETION_REVIEW_REQUIRED",
      circuitBreakerThreshold: 3,
      circuitBreakerScope: "current_session_distinct_tasks_only",
    },
    selfJudgeSensitivity: {
      reportDualCombined: true,
      reportJudgeAOnly: true,
      reportJudgeBOnly: true,
      claudeJudgeASameFamily: true,
    },
    ragPolicy: {
      reuseFromRunId: SOURCE_STAGE2_FINALISTS_RUN_ID,
      generationCalls: 0,
    },
    credentialsPresence: {
      OPENAI_API_KEY: credentials.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: credentials.ANTHROPIC_API_KEY,
      XAI_API_KEY: credentials.XAI_API_KEY,
      GOOGLE_API_KEY: credentials.GOOGLE_API_KEY,
      googleMustNotBeUsed: true,
      xaiMustNotBeDispatched: true,
    },
    paidCalls: 0,
    valuesPrinted: false,
  };

  const configHash = hashRunConfig(config);
  return {
    config,
    configHash,
    freezeArgs: {
      runId: input.runId,
      configHash,
      suite: suiteFrozen,
      models: config.models,
      budgetMaxUsd: input.budgetMaxUsd,
    },
  };
}

export function freezeStage2ClaudeChallengerManifest(input: {
  runId: string;
  gitSha: string;
  budgetMaxUsd?: number;
}): {
  manifest: RunManifest;
  configHash: string;
  config: Record<string, unknown>;
  suite: Stage2SuitePlan;
} {
  const integrity = verifySourceStage2Integrity();
  if (!integrity.ok) {
    throw new Error(
      `Source Stage-2 config hash mismatch: got ${integrity.configHash}, expected ${integrity.expected}`,
    );
  }
  const suite = loadSourceStage2Suite();
  const budgetMaxUsd = input.budgetMaxUsd ?? 95;
  const built = buildStage2ClaudeChallengerManifestPayload({
    runId: input.runId,
    gitSha: input.gitSha,
    suite,
    budgetMaxUsd,
  });
  const dir = ensureRunDir(input.runId);
  writeFileSync(path.join(dir, "full-config.json"), `${JSON.stringify(built.config, null, 2)}\n`);
  writeFileSync(
    path.join(dir, "stage2-suite.json"),
    `${JSON.stringify({ ...suite, frozen: true, response_models: [STAGE2_CLAUDE_CHALLENGER_MODEL] }, null, 2)}\n`,
  );
  // Reuse model-independent RAG retrieval from completed finalists run.
  const ragSrc = path.join(
    getCacheDir(),
    "runs",
    SOURCE_STAGE2_FINALISTS_RUN_ID,
    "rag-retrieval-results.json",
  );
  const ragDst = path.join(dir, "rag-retrieval-results.json");
  if (existsSync(ragSrc) && !existsSync(ragDst)) {
    copyFileSync(ragSrc, ragDst);
  }
  const manifest = freezeRunManifest(input.runId, built.freezeArgs);
  return {
    manifest,
    configHash: built.configHash,
    config: built.config,
    suite,
  };
}
